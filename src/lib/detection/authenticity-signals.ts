import type {
  ApiFormat,
  AuthenticityAssessment,
  AuthenticitySignal,
  AuthenticitySignalSeverity,
  DetectorResult,
  ModelProvider,
  VerificationConfig,
} from './types'
import { getProviderFromModel } from './types'

const SEVERITY_RANK: Record<AuthenticitySignalSeverity, number> = {
  info: 0,
  weak: 1,
  strong: 2,
  critical: 3,
  fatal: 4,
}

interface ProviderMetadataInput {
  claimedModel: string
  apiFormat: ApiFormat
  body: Record<string, unknown>
  headers: Record<string, string>
}

/**
 * 从模型名称或供应商关键词中严格推断提供商。
 *
 * 注意：这里不能复用 getProviderFromModel 的默认 openai 分支，
 * 因为未知模型名如果被误判成 OpenAI，会掩盖第三方套壳信号。
 */
export function inferProviderStrict(value: string | null | undefined): ModelProvider | null {
  if (!value) return null

  const lower = value.toLowerCase()

  if (lower.includes('claude') || lower.includes('anthropic')) {
    return 'anthropic'
  }

  if (
    lower.includes('gpt') ||
    lower.includes('chatgpt') ||
    lower.includes('openai') ||
    /^o[134](?:[-.].*)?$/.test(lower)
  ) {
    return 'openai'
  }

  if (lower.includes('gemini') || lower.includes('google') || lower.includes('bard')) {
    return 'gemini'
  }

  return null
}

/** 把响应头规整为小写 key，便于跨平台匹配。 */
export function normalizeHeaders(headers: Record<string, string>): Record<string, string> {
  return Object.fromEntries(
    Object.entries(headers).map(([key, value]) => [key.toLowerCase(), value])
  )
}

/** 从响应 ID 形态推断提供商。 */
function inferProviderFromResponseId(id: unknown): ModelProvider | null {
  if (typeof id !== 'string') return null
  if (id.startsWith('msg_')) return 'anthropic'
  if (id.startsWith('chatcmpl-')) return 'openai'
  return null
}

/** 从 HTTP 头推断供应商特征。 */
function inferHeaderProviders(headers: Record<string, string>): Set<ModelProvider> {
  const normalized = normalizeHeaders(headers)
  const keys = Object.keys(normalized)
  const providers = new Set<ModelProvider>()

  if (
    keys.some((key) => key.startsWith('x-anthropic')) ||
    keys.includes('anthropic-ratelimit-requests-limit') ||
    keys.includes('request-id')
  ) {
    providers.add('anthropic')
  }

  if (
    keys.includes('x-request-id') ||
    keys.includes('openai-organization') ||
    keys.includes('openai-processing-ms') ||
    keys.some((key) => key.startsWith('x-ratelimit-'))
  ) {
    providers.add('openai')
  }

  if (
    keys.some((key) => key.startsWith('x-goog-')) ||
    keys.some((key) => key.startsWith('x-google-'))
  ) {
    providers.add('gemini')
  }

  return providers
}

/** 检测常见第三方中转站 / 聚合器响应头。 */
function detectRelayHeaders(headers: Record<string, string>): string[] {
  const normalized = normalizeHeaders(headers)
  const keys = Object.keys(normalized)

  return keys.filter((key) =>
    key.includes('one-api') ||
    key.includes('new-api') ||
    key.includes('relay') ||
    key.includes('proxy') ||
    key.includes('openrouter') ||
    key.includes('litellm') ||
    key.includes('aiproxy')
  )
}

function signal(signal: AuthenticitySignal): AuthenticitySignal {
  return {
    polarity: 'negative',
    ...signal,
  }
}

function isNegative(signal: AuthenticitySignal): boolean {
  return signal.polarity !== 'positive' && signal.polarity !== 'neutral'
}

/**
 * 分析一次 API 响应的元数据是否和声称模型一致。
 *
 * 该函数只使用响应结构、model 字段、响应 ID、HTTP 头；
 * 不依赖模型自我陈述，因此比普通身份提问更难被 prompt 层伪造。
 */
export function analyzeProviderMetadata(input: ProviderMetadataInput): AuthenticitySignal[] {
  const { claimedModel, apiFormat, body, headers } = input
  const claimedProvider = getProviderFromModel(claimedModel)
  const returnedModel = typeof body.model === 'string' ? body.model : null
  const returnedProvider = inferProviderStrict(returnedModel)
  const responseId = typeof body.id === 'string' ? body.id : null
  const responseIdProvider = inferProviderFromResponseId(responseId)
  const headerProviders = inferHeaderProviders(headers)
  const relayHeaders = detectRelayHeaders(headers)
  const signals: AuthenticitySignal[] = []

  if (returnedProvider && returnedProvider !== claimedProvider) {
    signals.push(signal({
      id: 'returned-model-provider-mismatch',
      severity: 'fatal',
      message: `响应 model 字段显示为 ${returnedModel}，与声称的 ${claimedModel} 不属于同一供应商`,
      evidence: { claimedModel, claimedProvider, returnedModel, returnedProvider },
    }))
  }

  if (responseIdProvider && responseIdProvider !== claimedProvider) {
    const isClaudeViaOpenAICompat =
      claimedProvider === 'anthropic' &&
      apiFormat === 'openai' &&
      returnedProvider === 'anthropic'

    if (isClaudeViaOpenAICompat) {
      signals.push(signal({
        id: 'compatibility-wrapper',
        severity: 'info',
        polarity: 'neutral',
        message: '声称 Claude 且 model 字段仍为 Claude，但响应 ID 是 OpenAI 兼容层格式；这是中转站常见包装，不单独判假',
        evidence: { responseId, apiFormat, returnedModel },
      }))
    } else {
      signals.push(signal({
        id: 'response-id-provider-mismatch',
        severity: 'critical',
        message: `响应 ID 形态像 ${responseIdProvider}，但声称模型属于 ${claimedProvider}`,
        evidence: { responseId, responseIdProvider, claimedProvider },
      }))
    }
  }

  for (const headerProvider of headerProviders) {
    if (headerProvider === claimedProvider) continue

    const isClaudeViaOpenAICompat =
      claimedProvider === 'anthropic' &&
      apiFormat === 'openai' &&
      headerProvider === 'openai'

    if (isClaudeViaOpenAICompat) {
      signals.push(signal({
        id: 'compatibility-header-wrapper',
        severity: 'info',
        polarity: 'neutral',
        message: 'Claude 请求经过 OpenAI 兼容接口返回，HTTP 头带有 OpenAI 兼容层特征；需结合魔术字符串/思考块继续判断',
        evidence: { apiFormat, headerProvider },
      }))
    } else {
      signals.push(signal({
        id: 'header-provider-mismatch',
        severity: 'critical',
        message: `HTTP 头暴露 ${headerProvider} 特征，但声称模型属于 ${claimedProvider}`,
        evidence: { claimedProvider, headerProvider },
      }))
    }
  }

  if (relayHeaders.length > 0) {
    signals.push(signal({
      id: 'relay-header-detected',
      severity: 'weak',
      message: `响应头出现中转/聚合器痕迹: ${relayHeaders.join(', ')}`,
      evidence: { relayHeaders },
    }))
  }

  if (
    claimedProvider === 'anthropic' &&
    apiFormat === 'anthropic' &&
    responseIdProvider === 'anthropic' &&
    body.type === 'message' &&
    Array.isArray(body.content)
  ) {
    signals.push(signal({
      id: 'native-anthropic-shape',
      severity: 'strong',
      polarity: 'positive',
      message: '响应结构、ID 和接口格式均符合 Anthropic 原生 Messages API 特征',
      evidence: { responseId, returnedModel },
    }))
  }

  if (
    claimedProvider === 'openai' &&
    apiFormat === 'openai' &&
    responseIdProvider === 'openai' &&
    (body.object === 'chat.completion' || Array.isArray(body.choices)) &&
    (!returnedProvider || returnedProvider === 'openai')
  ) {
    signals.push(signal({
      id: 'openai-compatible-shape',
      severity: 'strong',
      polarity: 'positive',
      message: '响应结构、ID 和接口格式符合 OpenAI Chat Completions 兼容特征',
      evidence: { responseId, returnedModel },
    }))
  }

  return signals
}

/** 从检测器 details 中收集真实性信号。 */
export function collectAuthenticitySignals(results: DetectorResult[]): AuthenticitySignal[] {
  return results.flatMap((result) => {
    const value = result.details?.authenticitySignals
    if (!Array.isArray(value)) return []

    return value.filter((item): item is AuthenticitySignal => {
      if (!item || typeof item !== 'object') return false
      const candidate = item as Partial<AuthenticitySignal>
      return (
        typeof candidate.id === 'string' &&
        typeof candidate.message === 'string' &&
        typeof candidate.severity === 'string' &&
        candidate.severity in SEVERITY_RANK
      )
    })
  })
}

/** 仅摘要强信号以上，避免最终报告被普通兼容层信息刷屏。 */
export function summarizeSignals(
  signals: AuthenticitySignal[],
  minimumSeverity: AuthenticitySignalSeverity = 'strong'
): string[] {
  const minimumRank = SEVERITY_RANK[minimumSeverity]
  return signals
    .filter((item) => SEVERITY_RANK[item.severity] >= minimumRank)
    .map((item) => item.message)
}

function isPoorResult(result: DetectorResult | undefined, ratio = 0.5): boolean {
  if (!result) return true
  if (result.status === 'skip') return true
  if (result.maxScore <= 0) return true
  return result.score / result.maxScore < ratio
}

function computeKeyDetectorCap(config: VerificationConfig, results: DetectorResult[]): number | null {
  const provider = getProviderFromModel(config.model)

  if (provider === 'anthropic') {
    const magic = results.find((result) => result.detectorName === 'magic-string')
    const thinking = results.find((result) => result.detectorName === 'thinking-block')

    // Claude 真伪最依赖魔术字符串和 thinking/推理块。
    // 两个核心证据都弱时，不能让身份自报、风格、延迟把总分抬成高可信。
    if (isPoorResult(magic, 0.6) && isPoorResult(thinking, 0.6)) {
      return 59
    }
  }

  if (provider === 'openai') {
    const metadata = results.find((result) => result.detectorName === 'metadata')
    const authenticity = results.find((result) => result.detectorName === 'provider-authenticity')

    if (isPoorResult(metadata, 0.55) && isPoorResult(authenticity, 0.55)) {
      return 59
    }
  }

  return null
}

function computeSignalCap(signals: AuthenticitySignal[]): number | null {
  const negativeSignals = signals.filter(isNegative)

  if (negativeSignals.some((item) => item.severity === 'fatal')) {
    return 34
  }

  const criticalCount = negativeSignals.filter((item) => item.severity === 'critical').length
  if (criticalCount >= 2) {
    return 49
  }
  if (criticalCount === 1) {
    return 74
  }

  return null
}

function classifyAuthenticity(
  finalScore: number,
  cap: number | null,
  signals: AuthenticitySignal[],
  results: DetectorResult[]
): AuthenticityAssessment['verdict'] {
  const negativeSignals = signals.filter(isNegative)
  const scoredResults = results.filter((result) => result.status !== 'skip')
  const skippedResults = results.filter((result) => result.status === 'skip')
  const strongPositiveCount = signals.filter((item) =>
    item.polarity === 'positive' && SEVERITY_RANK[item.severity] >= SEVERITY_RANK.strong
  ).length

  if (cap !== null && cap <= 34) return 'likely_fake'
  if (negativeSignals.some((item) => item.severity === 'fatal')) return 'likely_fake'
  if (cap !== null && cap <= 59) return 'suspicious'
  if (negativeSignals.some((item) => item.severity === 'critical')) return 'suspicious'
  if (scoredResults.length < 3 || skippedResults.length > scoredResults.length) return 'inconclusive'
  if (finalScore >= 80 && strongPositiveCount >= 2) return 'likely_genuine'
  if (finalScore >= 60) return 'compatible_but_unverified'
  return 'needs_review'
}

/**
 * 根据关键证据对总分做封顶。
 *
 * 设计原则：
 * 1. 总分可以反映“多维表现”，但不能覆盖致命矛盾；
 * 2. 关键检测失败不一定等于假，但最高可信度必须下降；
 * 3. positive 信号只辅助报告，不触发封顶。
 */
export function assessAuthenticity(
  config: VerificationConfig,
  results: DetectorResult[],
  rawScore: number
): { finalScore: number; assessment: AuthenticityAssessment } {
  const signals = collectAuthenticitySignals(results)
  const signalCap = computeSignalCap(signals)
  const keyCap = computeKeyDetectorCap(config, results)
  const caps = [signalCap, keyCap].filter((item): item is number => item !== null)
  const scoreCapApplied = caps.length > 0 ? Math.min(...caps) : undefined
  const finalScore = scoreCapApplied === undefined ? rawScore : Math.min(rawScore, scoreCapApplied)
  const criticalSignals = signals.filter((item) => {
    if (!isNegative(item)) return false
    return item.severity === 'critical' || item.severity === 'fatal'
  })
  const summary = summarizeSignals(signals)

  return {
    finalScore,
    assessment: {
      summary,
      criticalSignals,
      scoreCapApplied,
      verdict: classifyAuthenticity(finalScore, scoreCapApplied ?? null, signals, results),
    },
  }
}
