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
    id: 'claude-sonnet-4-5-20250929',
    name: 'Claude Sonnet 4.5',
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
    id: 'gpt-5.4',
    name: 'GPT-5.4',
    provider: 'openai',
    knowledgeCutoff: '2025-06',
    supportsThinking: true,
    supportsLogprobs: true,
    supportsStreaming: true,
    group: 'OpenAI',
  },
  {
    id: 'gpt-5.2',
    name: 'GPT-5.2',
    provider: 'openai',
    knowledgeCutoff: '2025-03',
    supportsThinking: true,
    supportsLogprobs: true,
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
  if (modelId.startsWith('gpt') || modelId.startsWith('o1') || modelId.startsWith('o3')) return 'openai'
  if (modelId.startsWith('gemini')) return 'gemini'

  return 'openai' // 默认 OpenAI 兼容
}
