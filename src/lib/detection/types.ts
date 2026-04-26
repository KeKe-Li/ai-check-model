/**
 * 检测器执行结果
 * 表示单个检测器对 API 端点的分析结果
 */
export interface DetectorResult {
  detectorName: string
  displayName: string
  score: number
  maxScore: number
  status: 'pass' | 'warn' | 'fail' | 'skip'
  details: Record<string, unknown>
  findings: string[]
}

/**
 * 真实性证据强度
 *
 * - info: 仅作背景说明，不参与封顶
 * - weak: 弱信号，单独不足以下结论
 * - strong: 强信号，应该在最终报告中展示
 * - critical: 关键疑点，会限制最高可信度
 * - fatal: 致命矛盾，通常意味着“声称模型”和“实际来源”冲突
 */
export type AuthenticitySignalSeverity = 'info' | 'weak' | 'strong' | 'critical' | 'fatal'

/**
 * 真实性信号方向
 *
 * positive: 支持官方/真实模型
 * negative: 指向套壳、转发篡改或模型不一致
 * neutral: 仅描述兼容层、代理层等背景事实
 */
export type AuthenticitySignalPolarity = 'positive' | 'negative' | 'neutral'

/**
 * 单条真实性证据
 * 用于把各检测器里的关键发现汇总到最终裁决。
 */
export interface AuthenticitySignal {
  id: string
  severity: AuthenticitySignalSeverity
  message: string
  polarity?: AuthenticitySignalPolarity
  evidence?: Record<string, unknown>
}

/**
 * SSE 检测事件类型
 * 用于实时推送检测进度和结果
 */
export type DetectionEvent =
  | { type: 'started'; totalDetectors: number }
  | { type: 'detector:start'; detector: string; displayName: string; index: number }
  | { type: 'detector:progress'; detector: string; message: string }
  | { type: 'detector:complete'; result: DetectorResult }
  | { type: 'scoring'; message: string }
  | { type: 'complete'; report: VerificationReport }
  | { type: 'error'; message: string }

/**
 * 完整验证报告
 * 包含所有检测器结果和综合评分
 */
export interface VerificationReport {
  jobId: string
  totalScore: number
  confidenceLevel: 'HIGH' | 'MEDIUM' | 'LOW' | 'VERY_LOW'
  verdict: string
  modelClaimed: string
  modelDetected: string | null
  results: DetectorResult[]
  durationMs: number
  /** 跨检测器汇总后的真实性评估 */
  authenticity?: AuthenticityAssessment
}

/**
 * 最终真实性评估
 * 与 totalScore 并行展示，避免只看归一化分数造成误判。
 */
export interface AuthenticityAssessment {
  verdict:
    | 'likely_genuine'
    | 'compatible_but_unverified'
    | 'inconclusive'
    | 'needs_review'
    | 'suspicious'
    | 'likely_fake'
  summary: string[]
  criticalSignals: AuthenticitySignal[]
  scoreCapApplied?: number
}

/**
 * API 格式类型
 * anthropic: 原生 Anthropic 格式 (/v1/messages + x-api-key)
 * openai: OpenAI 兼容格式 (/v1/chat/completions + Bearer token)
 */
export type ApiFormat = 'anthropic' | 'openai'

/**
 * 验证任务配置
 * 输入参数用于启动检测流程
 */
export interface VerificationConfig {
  endpoint: string
  apiKey: string
  model: string
  jobId: string
  /** 实际 API 格式（由编排器自动探测） */
  apiFormat?: ApiFormat
}

/**
 * 置信度等级类型
 */
export type ConfidenceLevel = 'HIGH' | 'MEDIUM' | 'LOW' | 'VERY_LOW'

/**
 * 模型提供商类型
 */
export type ModelProvider = 'anthropic' | 'openai' | 'gemini'

/**
 * 模型信息结构
 * 定义支持的 AI 模型及其能力
 */
export interface ModelInfo {
  id: string
  name: string
  provider: ModelProvider
  knowledgeCutoff: string
  supportsThinking: boolean
  supportsLogprobs: boolean
  supportsStreaming: boolean
  group: string
}

/**
 * 支持的模型列表
 * 包含 Claude、GPT 和 Gemini 系列模型
 */
export const SUPPORTED_MODELS: ModelInfo[] = [
  // Claude 系列
  {
    id: 'claude-opus-4-7',
    name: 'Claude Opus 4.7',
    provider: 'anthropic',
    knowledgeCutoff: '2025-05',
    supportsThinking: true,
    supportsLogprobs: false,
    supportsStreaming: true,
    group: 'Claude',
  },
  {
    id: 'claude-opus-4-6',
    name: 'Claude Opus 4.6',
    provider: 'anthropic',
    knowledgeCutoff: '2025-05',
    supportsThinking: true,
    supportsLogprobs: false,
    supportsStreaming: true,
    group: 'Claude',
  },
  {
    id: 'claude-sonnet-4-6',
    name: 'Claude Sonnet 4.6',
    provider: 'anthropic',
    knowledgeCutoff: '2025-05',
    supportsThinking: true,
    supportsLogprobs: false,
    supportsStreaming: true,
    group: 'Claude',
  },
  {
    id: 'claude-haiku-4-5-20251001',
    name: 'Claude Haiku 4.5',
    provider: 'anthropic',
    knowledgeCutoff: '2025-04',
    supportsThinking: true,
    supportsLogprobs: false,
    supportsStreaming: true,
    group: 'Claude',
  },
  {
    id: 'claude-sonnet-4-20250514',
    name: 'Claude Sonnet 4',
    provider: 'anthropic',
    knowledgeCutoff: '2025-03',
    supportsThinking: true,
    supportsLogprobs: false,
    supportsStreaming: true,
    group: 'Claude',
  },
  // GPT 系列
  {
    id: 'gpt-5.5',
    name: 'GPT-5.5',
    provider: 'openai',
    knowledgeCutoff: '2025-12',
    supportsThinking: true,
    supportsLogprobs: false,
    supportsStreaming: true,
    group: 'OpenAI',
  },
  {
    id: 'gpt-5.4',
    name: 'GPT-5.4',
    provider: 'openai',
    knowledgeCutoff: '2025-08',
    supportsThinking: true,
    supportsLogprobs: false,
    supportsStreaming: true,
    group: 'OpenAI',
  },
  {
    id: 'gpt-5.4-mini',
    name: 'GPT-5.4 mini',
    provider: 'openai',
    knowledgeCutoff: '2025-08',
    supportsThinking: true,
    supportsLogprobs: false,
    supportsStreaming: true,
    group: 'OpenAI',
  },
  {
    id: 'gpt-4o',
    name: 'GPT-4o',
    provider: 'openai',
    knowledgeCutoff: '2024-10',
    supportsThinking: false,
    supportsLogprobs: true,
    supportsStreaming: true,
    group: 'OpenAI',
  },
  {
    id: 'o3',
    name: 'o3',
    provider: 'openai',
    knowledgeCutoff: '2024-10',
    supportsThinking: true,
    supportsLogprobs: false,
    supportsStreaming: true,
    group: 'OpenAI',
  },
  // Gemini 系列
  {
    id: 'gemini-3.1-pro-preview',
    name: 'Gemini 3.1 Pro',
    provider: 'gemini',
    knowledgeCutoff: '2025-06',
    supportsThinking: true,
    supportsLogprobs: false,
    supportsStreaming: true,
    group: 'Google',
  },
  {
    id: 'gemini-3-flash',
    name: 'Gemini 3 Flash',
    provider: 'gemini',
    knowledgeCutoff: '2025-03',
    supportsThinking: true,
    supportsLogprobs: false,
    supportsStreaming: true,
    group: 'Google',
  },
  {
    id: 'gemini-2.5-pro',
    name: 'Gemini 2.5 Pro',
    provider: 'gemini',
    knowledgeCutoff: '2025-01',
    supportsThinking: true,
    supportsLogprobs: false,
    supportsStreaming: true,
    group: 'Google',
  },
]

/**
 * 根据模型 ID 查找模型信息
 * @param modelId - 模型标识符
 * @returns 模型信息或 undefined
 */
export function getModelInfo(modelId: string): ModelInfo | undefined {
  return SUPPORTED_MODELS.find((m) => m.id === modelId)
}

/**
 * 从模型 ID 推断提供商
 * @param modelId - 模型标识符
 * @returns 模型提供商类型
 */
export function getProviderFromModel(modelId: string): ModelProvider {
  const info = getModelInfo(modelId)
  if (info) return info.provider

  if (modelId.startsWith('claude')) return 'anthropic'
  if (
    modelId.startsWith('gpt') ||
    modelId.startsWith('o1') ||
    modelId.startsWith('o3') ||
    modelId.startsWith('o4') ||
    modelId.startsWith('o5')
  ) return 'openai'
  if (modelId.startsWith('gemini')) return 'gemini'

  return 'openai' // 默认 OpenAI 兼容
}
