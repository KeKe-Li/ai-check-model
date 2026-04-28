import { BaseDetector } from './base'
import type { AuthenticitySignal, DetectorResult, VerificationConfig } from '../types'
import { getProviderFromModel } from '../types'
import type { ModelProvider } from '../types'
import { SmartClient } from '@/lib/api-client/smart-client'

/** 各供应商的 Rate Limit Header 名称 */
const RATE_LIMIT_HEADERS: Record<ModelProvider, { required: string[]; optional: string[] }> = {
  anthropic: {
    required: [
      'anthropic-ratelimit-requests-limit',
      'anthropic-ratelimit-requests-remaining',
      'anthropic-ratelimit-tokens-limit',
      'anthropic-ratelimit-tokens-remaining',
    ],
    optional: [
      'anthropic-ratelimit-requests-reset',
      'anthropic-ratelimit-tokens-reset',
      'anthropic-ratelimit-input-tokens-limit',
      'anthropic-ratelimit-input-tokens-remaining',
      'anthropic-ratelimit-output-tokens-limit',
      'anthropic-ratelimit-output-tokens-remaining',
      'retry-after',
    ],
  },
  openai: {
    required: [
      'x-ratelimit-limit-requests',
      'x-ratelimit-remaining-requests',
      'x-ratelimit-limit-tokens',
      'x-ratelimit-remaining-tokens',
    ],
    optional: [
      'x-ratelimit-reset-requests',
      'x-ratelimit-reset-tokens',
    ],
  },
  gemini: {
    required: [],
    optional: [
      'x-ratelimit-limit',
      'x-ratelimit-remaining',
      'x-ratelimit-reset',
    ],
  },
}

/**
 * Rate Limit 指纹检测器
 *
 * 真正的官方 API 在响应头中包含特定格式的 Rate Limit 信息。
 * 中转站往往无法完美模拟这些 Header，或者返回自己的 Rate Limit 格式。
 */
export class RateLimitFingerprintDetector extends BaseDetector {
  readonly name = 'rate-limit-fingerprint'
  readonly displayName = 'Rate Limit 指纹检测'
  readonly maxScore = 10
  readonly description = '验证响应头中 Rate Limit 信息是否符合官方格式'

  supports(model: string): boolean {
    const provider = getProviderFromModel(model)
    return provider === 'anthropic' || provider === 'openai'
  }

  async detect(config: VerificationConfig, onProgress: (message: string) => void): Promise<DetectorResult> {
    const provider = getProviderFromModel(config.model)
    const apiFormat = config.apiFormat ?? 'openai'
    const client = new SmartClient(config.endpoint, config.apiKey, apiFormat)
    const findings: string[] = []
    const signals: AuthenticitySignal[] = []
    let score = 0

    try {
      // 发送两次请求，检查 Rate Limit Header 存在性和递减行为
      onProgress('正在采集第一次 Rate Limit 信息...')
      const resp1 = await client.send({
        model: config.model,
        messages: [{ role: 'user', content: '只回复 OK' }],
        max_tokens: 10,
        temperature: 0,
      })

      if (resp1.status >= 400) {
        return this.skip('基础请求失败，无法检测 Rate Limit')
      }

      // 测试1: Header 存在性（5分）
      onProgress('正在分析 Rate Limit Header...')
      const presenceResult = this.analyzeHeaderPresence(resp1.headers, provider)
      score += presenceResult.score
      findings.push(...presenceResult.findings)
      signals.push(...presenceResult.signals)

      // 测试2: 数值合理性和递减行为（5分）
      onProgress('正在采集第二次 Rate Limit 信息...')
      const resp2 = await client.send({
        model: config.model,
        messages: [{ role: 'user', content: '只回复 OK' }],
        max_tokens: 10,
        temperature: 0,
      })

      if (resp2.status < 400) {
        const behaviorResult = this.analyzeRateLimitBehavior(resp1.headers, resp2.headers, provider)
        score += behaviorResult.score
        findings.push(...behaviorResult.findings)
        signals.push(...behaviorResult.signals)
      }

      const details = { provider, apiFormat, authenticitySignals: signals }

      if (score >= this.maxScore * 0.6) {
        return this.pass(score, findings, details)
      }
      return this.fail(score, findings, details)
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      return this.skip(`Rate Limit 检测无法执行: ${message}`)
    }
  }

  /** 分析 Rate Limit Header 存在性 */
  private analyzeHeaderPresence(
    headers: Record<string, string>,
    provider: ModelProvider
  ): { score: number; findings: string[]; signals: AuthenticitySignal[] } {
    const findings: string[] = []
    const signals: AuthenticitySignal[] = []
    let score = 0

    const normalized = Object.fromEntries(
      Object.entries(headers).map(([k, v]) => [k.toLowerCase(), v])
    )
    const expectedHeaders = RATE_LIMIT_HEADERS[provider]
    const foundRequired = expectedHeaders.required.filter(h => h in normalized)
    const foundOptional = expectedHeaders.optional.filter(h => h in normalized)
    const totalExpected = expectedHeaders.required.length

    if (totalExpected === 0) {
      findings.push(`${provider} 无标准 Rate Limit Header 要求，跳过`)
      return { score: 5, findings, signals }
    }

    const coverage = foundRequired.length / totalExpected

    if (coverage >= 0.75) {
      score += 5
      findings.push(`Rate Limit Header: ${foundRequired.length}/${totalExpected} 必要头存在（+${foundOptional.length} 可选）`)
      signals.push({
        id: 'rate-limit-headers-present',
        severity: 'strong',
        polarity: 'positive',
        message: `${provider} Rate Limit Header 覆盖率 ${(coverage * 100).toFixed(0)}%，符合官方 API 行为`,
        evidence: { foundRequired, foundOptional },
      })
    } else if (coverage >= 0.25) {
      score += 2
      findings.push(`Rate Limit Header: 仅 ${foundRequired.length}/${totalExpected} 必要头存在 — 部分缺失`)
      signals.push({
        id: 'rate-limit-headers-partial',
        severity: 'weak',
        polarity: 'negative',
        message: `${provider} Rate Limit Header 不完整（${foundRequired.length}/${totalExpected}），可能被中转层剥离`,
      })
    } else {
      findings.push(`Rate Limit Header: 几乎不存在（${foundRequired.length}/${totalExpected}）— 极可能经过代理层`)
      signals.push({
        id: 'rate-limit-headers-absent',
        severity: 'strong',
        polarity: 'negative',
        message: `${provider} Rate Limit Header 几乎完全缺失，端点极可能不是直连官方 API`,
        evidence: { found: foundRequired.length, expected: totalExpected },
      })
    }

    return { score, findings, signals }
  }

  /** 分析两次请求间 Rate Limit 数值的递减行为 */
  private analyzeRateLimitBehavior(
    headers1: Record<string, string>,
    headers2: Record<string, string>,
    provider: ModelProvider
  ): { score: number; findings: string[]; signals: AuthenticitySignal[] } {
    const findings: string[] = []
    const signals: AuthenticitySignal[] = []
    let score = 0

    const norm1 = Object.fromEntries(Object.entries(headers1).map(([k, v]) => [k.toLowerCase(), v]))
    const norm2 = Object.fromEntries(Object.entries(headers2).map(([k, v]) => [k.toLowerCase(), v]))

    const remainingKey = provider === 'anthropic'
      ? 'anthropic-ratelimit-requests-remaining'
      : 'x-ratelimit-remaining-requests'
    const limitKey = provider === 'anthropic'
      ? 'anthropic-ratelimit-requests-limit'
      : 'x-ratelimit-limit-requests'

    const remaining1 = parseInt(norm1[remainingKey] ?? '', 10)
    const remaining2 = parseInt(norm2[remainingKey] ?? '', 10)
    const limit = parseInt(norm1[limitKey] ?? '', 10)

    if (isNaN(remaining1) || isNaN(remaining2)) {
      findings.push('Rate Limit 递减检测: remaining 值缺失或非数字')
      return { score: 2, findings, signals }
    }

    // remaining 应该 <= limit
    if (!isNaN(limit) && remaining1 > limit) {
      findings.push(`Rate Limit 数值异常: remaining (${remaining1}) > limit (${limit})`)
      signals.push({
        id: 'rate-limit-value-invalid',
        severity: 'strong',
        polarity: 'negative',
        message: 'Rate Limit remaining 超过 limit，数值不合理',
      })
      return { score: 0, findings, signals }
    }

    // 两次请求间 remaining 应该递减（或重置后保持不变）
    if (remaining2 < remaining1) {
      score += 5
      findings.push(`Rate Limit 递减正常: ${remaining1} → ${remaining2}（符合预期）`)
      signals.push({
        id: 'rate-limit-decrement-valid',
        severity: 'strong',
        polarity: 'positive',
        message: 'Rate Limit remaining 正确递减，符合官方 API 行为',
      })
    } else if (remaining2 === remaining1) {
      score += 3
      findings.push(`Rate Limit 未递减: 保持 ${remaining1}（可能在同一窗口起始或被重置）`)
    } else {
      score += 4
      findings.push(`Rate Limit 递增: ${remaining1} → ${remaining2}（可能跨越了重置窗口）`)
    }

    return { score, findings, signals }
  }
}
