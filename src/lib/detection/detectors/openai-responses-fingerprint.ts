import { OpenAIResponsesClient } from '@/lib/api-client/openai-responses'
import { normalizeHeaders } from '../authenticity-signals'
import { BaseDetector } from './base'
import type { AuthenticitySignal, DetectorResult, VerificationConfig } from '../types'
import { getProviderFromModel } from '../types'

interface AnalyzeOpenAIResponsesFingerprintInput {
  claimedModel: string
  status: number
  body: Record<string, unknown>
  headers: Record<string, string>
}

interface AnalyzeOpenAIResponsesFingerprintResult {
  score: number
  findings: string[]
  signals: AuthenticitySignal[]
}

function errorMessage(body: Record<string, unknown>): string {
  const error = body.error
  if (error && typeof error === 'object' && 'message' in error) {
    const message = (error as { message?: unknown }).message
    return typeof message === 'string' ? message : ''
  }
  return ''
}

export function analyzeOpenAIResponsesFingerprint(
  input: AnalyzeOpenAIResponsesFingerprintInput
): AnalyzeOpenAIResponsesFingerprintResult {
  const { claimedModel, status, body, headers } = input
  const normalizedHeaders = normalizeHeaders(headers)
  const findings: string[] = []
  const signals: AuthenticitySignal[] = []
  let score = 0

  if (status === 404 || status === 405) {
    const message = errorMessage(body)
    findings.push(`Responses API 不可用: HTTP ${status}${message ? ` ${message}` : ''}`)
    signals.push({
      id: 'openai-responses-api-unavailable',
      severity: 'strong',
      polarity: 'negative',
      message: '声称 OpenAI/GPT 的端点不支持 Responses API，只能证明兼容 Chat Completions，不能证明完整官方能力',
      evidence: { status, message },
    })
    return { score, findings, signals }
  }

  if (status >= 400) {
    const message = errorMessage(body)
    findings.push(`Responses API 探针失败: HTTP ${status}${message ? ` ${message}` : ''}`)
    signals.push({
      id: 'openai-responses-api-error',
      severity: 'weak',
      polarity: 'negative',
      message: 'Responses API 探针失败，真实性需要结合其他证据判断',
      evidence: { status, message },
    })
    return { score, findings, signals }
  }

  const hasResponseId = typeof body.id === 'string' && body.id.startsWith('resp_')
  const hasObject = body.object === 'response'
  const hasOutput = Array.isArray(body.output)
  const hasUsage = typeof body.usage === 'object' && body.usage !== null
  const returnedModel = typeof body.model === 'string' ? body.model : ''
  const modelMatches = returnedModel === claimedModel ||
    returnedModel.includes(claimedModel) ||
    claimedModel.includes(returnedModel)
  const hasRequestId = typeof normalizedHeaders['x-request-id'] === 'string'

  if (hasResponseId) score += 4
  if (hasObject) score += 3
  if (hasOutput) score += 3
  if (hasUsage) score += 2
  if (modelMatches) score += 2
  if (hasRequestId) score += 1

  if (score >= 12) {
    findings.push('Responses API 指纹通过: response id、object、output、usage 等结构完整')
    signals.push({
      id: 'openai-responses-shape-present',
      severity: 'strong',
      polarity: 'positive',
      message: '端点支持 OpenAI Responses API 响应形态，增强 GPT 官方能力可信度',
      evidence: { returnedModel, hasRequestId },
    })
  } else {
    findings.push(`Responses API 指纹不完整: ${score}/15`)
    signals.push({
      id: 'openai-responses-shape-incomplete',
      severity: 'strong',
      polarity: 'negative',
      message: '端点返回的 Responses API 结构不完整，可能是中转层模拟或能力缺失',
      evidence: { returnedModel, score },
    })
  }

  return { score, findings, signals }
}

export class OpenAIResponsesFingerprintDetector extends BaseDetector {
  readonly name = 'openai-responses-fingerprint'
  readonly displayName = 'OpenAI Responses 指纹检测'
  readonly maxScore = 15
  readonly description = '验证 OpenAI/GPT 端点是否支持 Responses API 官方响应形态'

  supports(model: string): boolean {
    return getProviderFromModel(model) === 'openai'
  }

  async detect(config: VerificationConfig, onProgress: (message: string) => void): Promise<DetectorResult> {
    if (getProviderFromModel(config.model) !== 'openai') {
      return this.skip('Responses API 指纹仅适用于 OpenAI/GPT 模型')
    }

    onProgress('正在检测 OpenAI Responses API 指纹...')

    try {
      const client = new OpenAIResponsesClient(config.endpoint, config.apiKey)
      const response = await client.createResponse({
        model: config.model,
        input: '只输出 OK。',
        max_output_tokens: 16,
      })
      const result = analyzeOpenAIResponsesFingerprint({
        claimedModel: config.model,
        status: response.status,
        body: response.body,
        headers: response.headers,
      })
      const details = {
        status: response.status,
        authenticitySignals: result.signals,
      }

      if (result.score >= 12) {
        return this.pass(result.score, result.findings, details)
      }

      return this.fail(result.score, result.findings, details)
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      return this.skip(`OpenAI Responses 指纹检测无法执行: ${message}`)
    }
  }
}
