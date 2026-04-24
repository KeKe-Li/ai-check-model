/**
 * API 客户端通用类型
 */

/** API 响应接口 */
export interface ApiClientResponse {
  status: number
  headers: Record<string, string>
  body: unknown
  raw: Response
}

/** 聊天消息 */
export interface ChatMessage {
  role: 'user' | 'assistant' | 'system'
  content: string
}
