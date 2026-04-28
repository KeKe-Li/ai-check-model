import { BaseDetector } from './base'
import type { AuthenticitySignal, DetectorResult, VerificationConfig } from '../types'
import { getModelInfo, getProviderFromModel } from '../types'
import { SmartClient } from '@/lib/api-client/smart-client'
import { AnthropicClient } from '@/lib/api-client/anthropic'
import { TOKEN_REFERENCE_TEXTS, CACHE_TEST_SYSTEM_PROMPT } from '../constants/token-references'

/**
 * Token 计数精确度检测器
 *
 * 不同模型使用不同 tokenizer，对相同文本的 token 计数不同。
 * 通过验证 API 返回的 usage.input_tokens 是否匹配预期范围，
 * 检测 tokenizer 不一致（跨厂伪装）。
 *
 * 同时测试 Anthropic Prompt Caching 指纹：
 * 真正的 Claude 支持 prompt caching，会在 usage 中返回
 * cache_creation_input_tokens / cache_read_input_tokens。
 */
export class TokenAccuracyDetector extends BaseDetector {
  readonly name = 'token-accuracy'
  readonly displayName = 'Token 计数精确度验证'
  readonly maxScore = 20
  readonly description = '验证 token 计数是否匹配声称模型的 tokenizer，并测试 Prompt Caching 指纹'

  supports(): boolean {
    return true
  }

  async detect(config: VerificationConfig, onProgress: (message: string) => void): Promise<DetectorResult> {
    const provider = getProviderFromModel(config.model)
    const modelInfo = getModelInfo(config.model)
    const apiFormat = config.apiFormat ?? 'openai'
    const client = new SmartClient(config.endpoint, config.apiKey, apiFormat)
    const findings: string[] = []
    const signals: AuthenticitySignal[] = []
    let score = 0

    try {
      // 测试1: Token 计数精确度（12分）
      onProgress('正在验证 token 计数精确度...')
      const tokenResult = await this.testTokenAccuracy(client, config.model, provider)
      score += tokenResult.score
      findings.push(...tokenResult.findings)
      signals.push(...tokenResult.signals)

      // 测试2: Prompt Caching 指纹（8分，仅 Anthropic 原生格式且支持缓存的模型）
      if (provider === 'anthropic' && apiFormat === 'anthropic' && modelInfo?.supportsCaching) {
        onProgress('正在验证 Prompt Caching 指纹...')
        const cacheResult = await this.testPromptCaching(config)
        score += cacheResult.score
        findings.push(...cacheResult.findings)
        signals.push(...cacheResult.signals)
      } else if (provider === 'anthropic' && apiFormat !== 'anthropic') {
        findings.push('Prompt Caching 测试跳过: OpenAI 兼容格式不支持 cache_control 参数')
      }

      const details = { provider, apiFormat, authenticitySignals: signals }

      if (score >= this.maxScore * 0.6) {
        return this.pass(score, findings, details)
      }
      return this.fail(score, findings, details)
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      return this.skip(`Token 计数检测无法执行: ${message}`)
    }
  }

  /**
   * 测试 Token 计数精确度
   * 发送已知文本，检查 usage.input_tokens 是否在预期范围内
   */
  private async testTokenAccuracy(
    client: SmartClient,
    model: string,
    provider: 'anthropic' | 'openai' | 'gemini'
  ): Promise<{ score: number; findings: string[]; signals: AuthenticitySignal[] }> {
    const findings: string[] = []
    const signals: AuthenticitySignal[] = []
    let score = 0
    let matchCount = 0
    let mismatchCount = 0
    const deviations: number[] = []

    for (const ref of TOKEN_REFERENCE_TEXTS) {
      try {
        const response = await client.send({
          model,
          messages: [{ role: 'user', content: ref.text }],
          max_tokens: 10,
          temperature: 0,
        })

        const usage = response.body.usage as { input_tokens?: number } | undefined
        const inputTokens = usage?.input_tokens

        if (typeof inputTokens !== 'number' || inputTokens <= 0) {
          findings.push(`[${ref.id}] usage.input_tokens 缺失或无效`)
          continue
        }

        const expected = ref.expectedTokens[provider]
        // input_tokens 包含消息格式化开销（+5~20 tokens），放宽范围
        const adjustedMin = expected.min
        const adjustedMax = expected.max + 25

        if (inputTokens >= adjustedMin && inputTokens <= adjustedMax) {
          matchCount++
          findings.push(`[${ref.id}] token 计数匹配: ${inputTokens} (预期 ${expected.min}-${expected.max}+开销)`)
        } else {
          mismatchCount++
          const deviation = inputTokens < adjustedMin
            ? (adjustedMin - inputTokens) / adjustedMin
            : (inputTokens - adjustedMax) / adjustedMax
          deviations.push(deviation)
          findings.push(`[${ref.id}] token 计数偏离: ${inputTokens} (预期范围 ${adjustedMin}-${adjustedMax})，偏差 ${(deviation * 100).toFixed(1)}%`)
        }
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error)
        findings.push(`[${ref.id}] 测试失败: ${message.slice(0, 80)}`)
      }
    }

    const totalTested = matchCount + mismatchCount
    if (totalTested === 0) {
      findings.push('所有 token 计数测试均未返回有效 usage 数据')
      signals.push({
        id: 'token-accuracy-no-usage',
        severity: 'weak',
        polarity: 'negative',
        message: 'API 响应中未包含 usage.input_tokens，无法验证 tokenizer 一致性',
      })
      return { score: 2, findings, signals }
    }

    if (mismatchCount === 0) {
      score += 12
      findings.push(`Token 计数精确度验证通过: ${matchCount}/${totalTested} 组全部匹配`)
      signals.push({
        id: 'token-accuracy-match',
        severity: 'strong',
        polarity: 'positive',
        message: `Token 计数与 ${provider} tokenizer 预期一致，支持模型真实性`,
      })
    } else if (mismatchCount === 1 && totalTested >= 2) {
      score += 7
      findings.push(`Token 计数部分匹配: ${matchCount}/${totalTested} 组匹配，1组偏离`)
      signals.push({
        id: 'token-accuracy-partial',
        severity: 'weak',
        polarity: 'negative',
        message: 'Token 计数存在1组偏离，可能是 API 开销差异，需结合其他证据判断',
      })
    } else {
      const avgDeviation = deviations.reduce((a, b) => a + b, 0) / deviations.length
      if (avgDeviation > 0.3) {
        findings.push(`Token 计数严重偏离: ${mismatchCount}/${totalTested} 组不匹配，平均偏差 ${(avgDeviation * 100).toFixed(1)}% — 极可能使用了不同 tokenizer`)
        signals.push({
          id: 'token-accuracy-mismatch',
          severity: 'fatal',
          polarity: 'negative',
          message: `Token 计数与 ${provider} tokenizer 严重不匹配（偏差 ${(avgDeviation * 100).toFixed(1)}%），底层模型极可能不是 ${provider}`,
          evidence: { matchCount, mismatchCount, avgDeviation },
        })
      } else {
        score += 3
        findings.push(`Token 计数偏离: ${mismatchCount}/${totalTested} 组不匹配，偏差较小`)
        signals.push({
          id: 'token-accuracy-suspicious',
          severity: 'critical',
          polarity: 'negative',
          message: `Token 计数存在多组偏离，tokenizer 可能不匹配`,
          evidence: { matchCount, mismatchCount, avgDeviation },
        })
      }
    }

    return { score, findings, signals }
  }

  /**
   * 测试 Anthropic Prompt Caching 指纹
   *
   * 真正的 Claude API 支持 prompt caching：
   * - 第一次请求：usage 包含 cache_creation_input_tokens
   * - 第二次相同 system prompt：usage 包含 cache_read_input_tokens
   *
   * 中转站几乎无法模拟此行为，因为：
   * 1. 需要后端真的是 Anthropic API
   * 2. cache_control 参数需要被正确转发
   * 3. usage 中的缓存字段需要被正确返回
   */
  private async testPromptCaching(
    config: VerificationConfig
  ): Promise<{ score: number; findings: string[]; signals: AuthenticitySignal[] }> {
    const findings: string[] = []
    const signals: AuthenticitySignal[] = []
    let score = 0

    try {
      const client = new AnthropicClient(config.endpoint, config.apiKey)

      // 第一次请求：创建缓存
      const resp1 = await client.sendMessage({
        model: config.model,
        system: [{
          type: 'text',
          text: CACHE_TEST_SYSTEM_PROMPT,
          cache_control: { type: 'ephemeral' },
        }],
        messages: [{ role: 'user', content: '用一句话总结量子计算的核心优势。' }],
        max_tokens: 100,
      })

      const body1 = resp1.body as Record<string, unknown> | null
      const usage1 = body1?.usage as Record<string, unknown> | undefined
      const cacheCreation = typeof usage1?.cache_creation_input_tokens === 'number'
        ? usage1.cache_creation_input_tokens as number
        : null
      const cacheRead1 = typeof usage1?.cache_read_input_tokens === 'number'
        ? usage1.cache_read_input_tokens as number
        : null

      if (resp1.status >= 400) {
        findings.push(`Prompt Caching 测试: 请求失败 (HTTP ${resp1.status})`)
        signals.push({
          id: 'prompt-caching-request-failed',
          severity: 'weak',
          polarity: 'negative',
          message: 'Prompt Caching 请求失败，端点可能不支持 cache_control 参数',
        })
        return { score: 1, findings, signals }
      }

      if (cacheCreation !== null && cacheCreation > 0) {
        score += 4
        findings.push(`Prompt Caching 第一次请求: cache_creation_input_tokens = ${cacheCreation}（缓存已创建）`)

        // 第二次请求：读取缓存
        const resp2 = await client.sendMessage({
          model: config.model,
          system: [{
            type: 'text',
            text: CACHE_TEST_SYSTEM_PROMPT,
            cache_control: { type: 'ephemeral' },
          }],
          messages: [{ role: 'user', content: '量子纠缠的本质是什么？' }],
          max_tokens: 100,
        })

        const body2 = resp2.body as Record<string, unknown> | null
        const usage2 = body2?.usage as Record<string, unknown> | undefined
        const cacheRead2 = typeof usage2?.cache_read_input_tokens === 'number'
          ? usage2.cache_read_input_tokens as number
          : null

        if (cacheRead2 !== null && cacheRead2 > 0) {
          score += 4
          findings.push(`Prompt Caching 第二次请求: cache_read_input_tokens = ${cacheRead2}（缓存命中）`)
          signals.push({
            id: 'prompt-caching-confirmed',
            severity: 'strong',
            polarity: 'positive',
            message: `Anthropic Prompt Caching 指纹通过: 创建 ${cacheCreation} tokens，命中 ${cacheRead2} tokens`,
            evidence: { cacheCreation, cacheRead: cacheRead2 },
          })
        } else {
          score += 1
          findings.push('Prompt Caching 第二次请求: 未命中缓存（cache_read_input_tokens 缺失或为0）')
          signals.push({
            id: 'prompt-caching-no-hit',
            severity: 'weak',
            polarity: 'neutral',
            message: 'Prompt Caching 创建成功但未命中，可能是端点缓存策略不同',
          })
        }
      } else if (cacheRead1 !== null && cacheRead1 > 0) {
        score += 5
        findings.push(`Prompt Caching 指纹: cache_read_input_tokens = ${cacheRead1}（已有缓存）`)
        signals.push({
          id: 'prompt-caching-existing',
          severity: 'strong',
          polarity: 'positive',
          message: 'Prompt Caching 指纹存在（从已有缓存读取），支持 Anthropic 官方来源',
        })
      } else {
        findings.push('Prompt Caching 测试: usage 中无缓存相关字段 — 端点可能不支持或未透传 cache_control')
        signals.push({
          id: 'prompt-caching-absent',
          severity: 'strong',
          polarity: 'negative',
          message: 'Anthropic Prompt Caching 指纹缺失: 真正的 Claude API 应返回缓存 token 计数',
        })
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      findings.push(`Prompt Caching 测试异常: ${message.slice(0, 100)}`)
      signals.push({
        id: 'prompt-caching-error',
        severity: 'weak',
        polarity: 'negative',
        message: 'Prompt Caching 测试异常，端点可能不支持此功能',
      })
    }

    return { score, findings, signals }
  }
}
