import { AnthropicClient } from '@/lib/api-client/anthropic'
import { OpenAICompatClient } from '@/lib/api-client/openai-compat'
import {
  compareModelIdentity,
  inferProviderStrict,
} from '../authenticity-signals'
import { BaseDetector } from './base'
import type { AuthenticitySignal, DetectorResult, VerificationConfig } from '../types'
import { getProviderFromModel } from '../types'

interface AnalyzeModelCatalogFingerprintInput {
  claimedModel: string
  status: number
  body: Record<string, unknown>
}

interface AnalyzeModelCatalogFingerprintResult {
  score: number
  findings: string[]
  signals: AuthenticitySignal[]
}

function extractErrorMessage(body: Record<string, unknown>): string {
  const error = body.error
  if (error && typeof error === 'object' && 'message' in error) {
    const message = (error as { message?: unknown }).message
    return typeof message === 'string' ? message.slice(0, 160) : ''
  }
  return ''
}

function extractModelId(body: Record<string, unknown>): string | null {
  if (typeof body.id === 'string') return body.id

  const data = body.data
  if (data && typeof data === 'object' && 'id' in data) {
    const id = (data as { id?: unknown }).id
    return typeof id === 'string' ? id : null
  }

  return null
}

/**
 * 分析模型目录探针结果。
 *
 * 该探针比普通聊天响应更难被“行为题库”伪造：如果中转站声称某个模型，
 * 但模型目录把它解析成另一个档位，说明路由层已经暴露串模型/降级证据。
 */
export function analyzeModelCatalogFingerprint(
  input: AnalyzeModelCatalogFingerprintInput
): AnalyzeModelCatalogFingerprintResult {
  const { claimedModel, status, body } = input
  const findings: string[] = []
  const signals: AuthenticitySignal[] = []

  if (status === 404 || status === 405) {
    const message = extractErrorMessage(body)
    findings.push(`模型目录探针不可用: HTTP ${status}${message ? ` ${message}` : ''}`)
    signals.push({
      id: 'model-catalog-unavailable',
      severity: 'strong',
      polarity: 'negative',
      message: '端点不支持模型目录探针，无法从目录层确认声称模型是否真实暴露',
      evidence: { status, message },
    })
    return { score: 0, findings, signals }
  }

  if (status >= 400) {
    const message = extractErrorMessage(body)
    findings.push(`模型目录探针失败: HTTP ${status}${message ? ` ${message}` : ''}`)
    signals.push({
      id: 'model-catalog-error',
      severity: 'weak',
      polarity: 'negative',
      message: '模型目录探针失败，真实性需要结合聊天响应和官方能力指纹判断',
      evidence: { status, message },
    })
    return { score: 0, findings, signals }
  }

  const returnedModel = extractModelId(body)
  if (!returnedModel) {
    findings.push('模型目录响应缺少 id 字段，无法确认目录层模型身份')
    signals.push({
      id: 'model-catalog-shape-incomplete',
      severity: 'strong',
      polarity: 'negative',
      message: '模型目录响应结构不完整，可能是中转站模拟或目录能力缺失',
      evidence: { bodyKeys: Object.keys(body) },
    })
    return { score: 1, findings, signals }
  }

  const claimedProvider = getProviderFromModel(claimedModel)
  const returnedProvider = inferProviderStrict(returnedModel)
  if (returnedProvider && returnedProvider !== claimedProvider) {
    findings.push(`模型目录返回跨供应商模型: 声称 ${claimedModel}，目录返回 ${returnedModel}`)
    signals.push({
      id: 'model-catalog-provider-mismatch',
      severity: 'fatal',
      polarity: 'negative',
      message: `模型目录显示 ${returnedModel}，与声称的 ${claimedModel} 不属于同一供应商`,
      evidence: { claimedModel, claimedProvider, returnedModel, returnedProvider },
    })
    return { score: 0, findings, signals }
  }

  const identity = compareModelIdentity(claimedModel, returnedModel)
  if (identity && !identity.matched) {
    findings.push(`模型目录返回同厂不同档位模型: 声称 ${claimedModel}，目录返回 ${returnedModel}`)
    signals.push({
      id: 'model-catalog-family-mismatch',
      severity: 'fatal',
      polarity: 'negative',
      message: `模型目录显示 ${returnedModel}，与声称的 ${claimedModel} 不是同一模型系列/档位`,
      evidence: {
        claimedModel,
        returnedModel,
        claimedFamily: identity.claimed.family,
        returnedFamily: identity.returned.family,
      },
    })
    return { score: 0, findings, signals }
  }

  if (identity?.matched || returnedModel === claimedModel) {
    findings.push(`模型目录确认声称模型: ${returnedModel}`)
    signals.push({
      id: 'model-catalog-identity-match',
      severity: 'strong',
      polarity: 'positive',
      message: `模型目录返回的模型身份与声称模型一致: ${returnedModel}`,
      evidence: {
        claimedModel,
        returnedModel,
        family: identity?.claimed.family,
      },
    })
    return { score: 10, findings, signals }
  }

  findings.push(`模型目录返回无法归一化的模型 id: ${returnedModel}`)
  signals.push({
    id: 'model-catalog-unrecognized-return',
    severity: 'weak',
    polarity: 'negative',
    message: '模型目录返回了无法归一化比较的模型 id，真实性需结合其他探针判断',
    evidence: { claimedModel, returnedModel },
  })
  return { score: 3, findings, signals }
}

export class ModelCatalogDetector extends BaseDetector {
  readonly name = 'model-catalog'
  readonly displayName = '模型目录指纹检测'
  readonly maxScore = 10
  readonly description = '调用模型目录接口，验证中转站是否在目录层暴露声称模型'

  supports(model: string): boolean {
    const provider = getProviderFromModel(model)
    return provider === 'openai' || provider === 'anthropic'
  }

  async detect(config: VerificationConfig, onProgress: (message: string) => void): Promise<DetectorResult> {
    const apiFormat = config.apiFormat ?? 'openai'

    try {
      onProgress('正在查询模型目录指纹...')
      const response = apiFormat === 'anthropic'
        ? await new AnthropicClient(config.endpoint, config.apiKey).retrieveModel(config.model)
        : await new OpenAICompatClient(config.endpoint, config.apiKey).retrieveModel(config.model)

      const result = analyzeModelCatalogFingerprint({
        claimedModel: config.model,
        status: response.status,
        body: (response.body ?? {}) as Record<string, unknown>,
      })
      const details = {
        status: response.status,
        apiFormat,
        authenticitySignals: result.signals,
      }

      if (result.score >= 8) {
        return this.pass(result.score, result.findings, details)
      }

      return this.fail(result.score, result.findings, details)
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      return this.skip(`模型目录指纹检测无法执行: ${message}`)
    }
  }
}
