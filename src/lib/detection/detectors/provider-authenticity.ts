import { AnthropicClient } from '@/lib/api-client/anthropic'
import { SmartClient } from '@/lib/api-client/smart-client'
import { analyzeProviderMetadata } from '../authenticity-signals'
import { BaseDetector } from './base'
import type { AuthenticitySignal, DetectorResult, VerificationConfig } from '../types'
import { getModelInfo, getProviderFromModel } from '../types'

/**
 * 官方来源指纹检测器
 *
 * 身份问答很容易被系统提示词伪造，本检测器优先看：
 * - 响应元数据是否跨供应商；
 * - GPT logprobs 等官方兼容能力是否真实返回；
 * - Claude 原生 count_tokens 是否可用；
 * - 是否出现常见中转/聚合器痕迹。
 */
export class ProviderAuthenticityDetector extends BaseDetector {
  readonly name = 'provider-authenticity'
  readonly displayName = '官方来源指纹检测'
  readonly maxScore = 25
  readonly description = '交叉验证响应元数据、供应商专属能力和中转痕迹，鉴别 GPT/Claude 是否掺假'

  supports(model: string): boolean {
    const provider = getProviderFromModel(model)
    return provider === 'openai' || provider === 'anthropic'
  }

  async detect(config: VerificationConfig, onProgress: (message: string) => void): Promise<DetectorResult> {
    const provider = getProviderFromModel(config.model)
    const modelInfo = getModelInfo(config.model)
    const apiFormat = config.apiFormat ?? 'openai'
    const client = new SmartClient(config.endpoint, config.apiKey, apiFormat)
    const findings: string[] = []
    const authenticitySignals: AuthenticitySignal[] = []
    let score = 0

    try {
      onProgress('正在采集官方来源元数据指纹...')
      const probe = await client.send({
        model: config.model,
        messages: [{ role: 'user', content: '只回复 OK，不要输出其他内容。' }],
        max_tokens: 20,
        temperature: 0,
      })

      if (probe.status >= 400) {
        const message = this.extractErrorMessage(probe.body)
        const httpErrorSignal: AuthenticitySignal = {
          id: 'provider-probe-http-error',
          severity: 'critical',
          polarity: 'negative',
          message: `官方来源指纹基础探针失败: HTTP ${probe.status}${message ? ` ${message}` : ''}`,
          evidence: { status: probe.status, message },
        }

        findings.push(httpErrorSignal.message)
        return this.fail(0, findings, {
          provider,
          apiFormat,
          authenticitySignals: [httpErrorSignal],
        })
      }

      const metadataSignals = analyzeProviderMetadata({
        claimedModel: config.model,
        apiFormat,
        body: probe.body,
        headers: probe.headers,
      })
      authenticitySignals.push(...metadataSignals)

      const fatalSignal = metadataSignals.find((item) => item.severity === 'fatal')
      const criticalSignals = metadataSignals.filter((item) => item.severity === 'critical')
      const positiveStrong = metadataSignals.filter((item) => item.polarity === 'positive' && item.severity === 'strong')

      if (fatalSignal) {
        findings.push(`致命元数据矛盾: ${fatalSignal.message}`)
      } else {
        score += 6
        findings.push('未发现 model 字段级别的跨供应商致命矛盾')
      }

      if (criticalSignals.length > 0) {
        findings.push(`发现 ${criticalSignals.length} 个关键元数据疑点: ${criticalSignals.map((item) => item.message).join('；')}`)
      } else {
        score += 4
        findings.push('响应 ID / HTTP 头未暴露关键跨供应商冲突')
      }

      if (positiveStrong.length > 0) {
        score += 4
        findings.push(...positiveStrong.map((item) => item.message))
      }

      if (provider === 'openai') {
        onProgress('正在验证 OpenAI 专属能力指纹...')
        const logprobs = await this.testOpenAILogprobs(client, config.model, !!modelInfo?.supportsLogprobs)
        score += logprobs.score
        findings.push(...logprobs.findings)
        authenticitySignals.push(...logprobs.signals)
      } else if (provider === 'anthropic') {
        onProgress('正在验证 Anthropic 专属能力指纹...')
        const claudeProbe = await this.testClaudeNativeCapability(config)
        score += claudeProbe.score
        findings.push(...claudeProbe.findings)
        authenticitySignals.push(...claudeProbe.signals)
      }

      // 没有强负面信号时给基础可信分；出现 fatal 时保持低分。
      if (!fatalSignal && criticalSignals.length === 0) {
        score += 5
        findings.push('官方来源指纹未发现强负面证据')
      }

      const details = {
        provider,
        apiFormat,
        authenticitySignals,
      }

      if (score >= 12) {
        return this.pass(Math.min(score, this.maxScore), findings, details)
      }

      return this.fail(Math.min(score, this.maxScore), findings, details)
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      return this.skip(`官方来源指纹检测无法执行: ${message}`)
    }
  }

  private async testOpenAILogprobs(
    client: SmartClient,
    model: string,
    shouldSupportLogprobs: boolean
  ): Promise<{ score: number; findings: string[]; signals: AuthenticitySignal[] }> {
    const findings: string[] = []
    const signals: AuthenticitySignal[] = []
    let score = 0

    if (!shouldSupportLogprobs) {
      score += 4
      findings.push('该声称模型不要求 logprobs 指纹，跳过强校验')
      return { score, findings, signals }
    }

    try {
      const response = await client.send({
        model,
        messages: [{ role: 'user', content: '只输出一个英文单词 yes。' }],
        max_tokens: 5,
        temperature: 0,
        logprobs: true,
        top_logprobs: 1,
        seed: 7,
      })

      if (response.status >= 400) {
        const message = this.extractErrorMessage(response.body)
        findings.push(`logprobs 探针被拒绝: HTTP ${response.status} ${message}`)
        signals.push({
          id: 'openai-logprobs-rejected',
          severity: 'strong',
          polarity: 'negative',
          message: '声称支持 OpenAI logprobs 的 GPT 模型拒绝了 logprobs 探针',
          evidence: { status: response.status, message },
        })
        return { score, findings, signals }
      }

      const choices = response.body.choices as Array<{
        logprobs?: {
          content?: unknown[]
        } | null
      }> | undefined
      const logprobContent = choices?.[0]?.logprobs?.content

      if (Array.isArray(logprobContent) && logprobContent.length > 0) {
        score += 10
        findings.push(`OpenAI logprobs 指纹通过: 返回 ${logprobContent.length} 个 token 级概率项`)
        signals.push({
          id: 'openai-logprobs-present',
          severity: 'strong',
          polarity: 'positive',
          message: 'GPT 响应包含 token 级 logprobs，符合 OpenAI 兼容能力指纹',
          evidence: { logprobItems: logprobContent.length },
        })
      } else {
        score += 2
        findings.push('logprobs 探针未返回 token 级概率项，可能被中转层剥离或底层不是目标 GPT')
        signals.push({
          id: 'openai-logprobs-missing',
          severity: 'strong',
          polarity: 'negative',
          message: '声称 GPT 且应支持 logprobs，但响应未包含 token 级 logprobs',
        })
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      findings.push(`logprobs 探针异常: ${message.slice(0, 120)}`)
      signals.push({
        id: 'openai-logprobs-error',
        severity: 'weak',
        polarity: 'negative',
        message: 'OpenAI logprobs 探针异常，真实性需结合其他证据判断',
        evidence: { message },
      })
    }

    return { score, findings, signals }
  }

  private async testClaudeNativeCapability(
    config: VerificationConfig
  ): Promise<{ score: number; findings: string[]; signals: AuthenticitySignal[] }> {
    const findings: string[] = []
    const signals: AuthenticitySignal[] = []

    if (config.apiFormat !== 'anthropic') {
      findings.push('当前端点使用 OpenAI 兼容格式，无法直接调用 Anthropic count_tokens；需依赖魔术字符串与 thinking 证据')
      signals.push({
        id: 'claude-openai-compatible-mode',
        severity: 'info',
        polarity: 'neutral',
        message: 'Claude 通过 OpenAI 兼容格式暴露，原生 Anthropic 能力被兼容层隐藏',
      })
      return { score: 3, findings, signals }
    }

    try {
      const client = new AnthropicClient(config.endpoint, config.apiKey)
      const result = await client.countTokens({
        model: config.model,
        messages: [{ role: 'user', content: '你好' }],
      })

      if (typeof result.input_tokens === 'number' && result.input_tokens > 0) {
        findings.push(`Anthropic count_tokens 指纹通过: input_tokens=${result.input_tokens}`)
        signals.push({
          id: 'anthropic-count-tokens-present',
          severity: 'strong',
          polarity: 'positive',
          message: 'Anthropic 原生 count_tokens 能力可用，支持 Claude 官方来源判断',
          evidence: { inputTokens: result.input_tokens },
        })
        return { score: 8, findings, signals }
      }

      findings.push('Anthropic count_tokens 返回异常结果')
      signals.push({
        id: 'anthropic-count-tokens-invalid',
        severity: 'weak',
        polarity: 'negative',
        message: 'Anthropic 原生 count_tokens 返回异常结果',
        evidence: { result },
      })
      return { score: 2, findings, signals }
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      findings.push(`Anthropic count_tokens 探针失败: ${message.slice(0, 120)}`)
      signals.push({
        id: 'anthropic-count-tokens-error',
        severity: 'weak',
        polarity: 'negative',
        message: 'Anthropic 原生 count_tokens 不可用，可能是中转层隐藏或非原生 Claude 端点',
        evidence: { message },
      })
      return { score: 1, findings, signals }
    }
  }

  private extractErrorMessage(body: Record<string, unknown>): string {
    const error = body.error
    if (error && typeof error === 'object' && 'message' in error) {
      const message = (error as { message?: unknown }).message
      return typeof message === 'string' ? message.slice(0, 120) : ''
    }
    return ''
  }
}
