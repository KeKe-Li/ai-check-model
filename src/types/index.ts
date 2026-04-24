/**
 * 标准 API 响应结构
 * 统一的 API 返回格式
 */
export interface ApiResponse<T> {
  success: boolean
  data?: T
  error?: string
}

/**
 * 分页信息
 */
export interface PaginationInfo {
  page: number
  limit: number
  total: number
  totalPages: number
}

/**
 * 分页响应结构
 * 用于列表查询接口
 */
export interface PaginatedResponse<T> {
  data: T[]
  pagination: PaginationInfo
}

/**
 * 验证任务摘要
 * 用于历史记录列表展示
 */
export interface VerificationJobSummary {
  id: string
  endpointUrl: string
  endpointDomain: string
  modelClaimed: string
  modelDetected: string | null
  totalScore: number | null
  confidenceLevel: string | null
  status: string
  durationMs: number | null
  createdAt: string
}

/**
 * 模型验证记录
 * 排行榜中的单次验证记录
 */
export interface ModelVerificationRecord {
  model: string
  score: number
  checkedAt: string
}

/**
 * 排行榜条目
 * 展示端点的聚合统计信息
 */
export interface LeaderboardEntry {
  rank: number
  domain: string
  displayName: string | null
  avgScore: number
  totalChecks: number
  lastCheckedAt: string
  modelsVerified: ModelVerificationRecord[]
  status: string
}
