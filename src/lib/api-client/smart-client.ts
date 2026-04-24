/**
 * 智能 API 客户端
 * 自动探测端点使用的 API 格式（Anthropic 原生 / OpenAI 兼容）
 * 并提供统一的调用接口
 */

import { AnthropicClient } from './anthropic'
import { OpenAICompatClient } from './openai-compat'
import type { ApiFormat } from '@/lib/detection/types'

export interface SmartMessage {
  role: 'user' | 'assistant' | 'system'
  content: string
}

export interface SmartSendParams {
  model: string
  messages: SmartMessage[]
  max_tokens: number
  system?: string
  temperature?: number
  stream?: boolean
  thinking?: { type: string; budget_tokens: number }
}

export interface SmartResponse {
  /** 提取的文本内容 */
  text: string
  /** 原始响应体 */
  body: Record<string, unknown>
  /** HTTP 状态码 */
  status: number
  /** 响应头 */
  headers: Record<string, string>
  /** 实际使用的 API 格式 */
  format: ApiFormat
  /** 思考内容（如果有） */
  thinkingText: string | null
  /** 思考块列表（Claude 原生格式） */
  thinkingBlocks: Array<{ type: string; thinking?: string; text?: string }> | null
  /** 原始 fetch Response 对象（用于流式 TTFB 测量等场景） */
  raw: Response
}

/**
 * 探测端点使用的 API 格式
 * 先尝试 Anthropic 格式，失败则尝试 OpenAI 格式
 */
export async function detectApiFormat(
  endpoint: string,
  apiKey: string,
  model: string
): Promise<ApiFormat> {
  // 先尝试 Anthropic 原生格式
  try {
    const client = new AnthropicClient(endpoint, apiKey)
    const response = await client.sendMessage({
      model,
      messages: [{ role: 'user', content: 'hi' }],
      max_tokens: 10,
    })

    // 如果状态码是 200 且有正确结构，说明是 Anthropic 格式
    if (response.status === 200) {
      const body = response.body as Record<string, unknown> | null
      if (body && body.type === 'message' && body.content) {
        return 'anthropic'
      }
    }
  } catch {
    // Anthropic 格式失败，继续尝试 OpenAI
  }

  // 尝试 OpenAI 兼容格式
  try {
    const client = new OpenAICompatClient(endpoint, apiKey)
    const response = await client.sendChatCompletion({
      model,
      messages: [{ role: 'user', content: 'hi' }],
      max_tokens: 10,
    })

    if (response.status === 200) {
      const body = response.body as Record<string, unknown> | null
      if (body && (body.choices || body.object === 'chat.completion')) {
        return 'openai'
      }
    }
  } catch {
    // OpenAI 格式也失败
  }

  // 默认用 OpenAI 兼容格式（大多数中转站用此格式）
  return 'openai'
}

/**
 * 智能客户端
 * 根据探测到的 API 格式发送请求，提供统一的响应结构
 */
export class SmartClient {
  private readonly endpoint: string
  private readonly apiKey: string
  private readonly format: ApiFormat
  private readonly anthropicClient: AnthropicClient
  private readonly openaiClient: OpenAICompatClient

  constructor(endpoint: string, apiKey: string, format: ApiFormat) {
    this.endpoint = endpoint
    this.apiKey = apiKey
    this.format = format
    this.anthropicClient = new AnthropicClient(endpoint, apiKey)
    this.openaiClient = new OpenAICompatClient(endpoint, apiKey)
  }

  get apiFormat(): ApiFormat {
    return this.format
  }

  /**
   * 发送消息并返回统一格式的响应
   */
  async send(params: SmartSendParams): Promise<SmartResponse> {
    if (this.format === 'anthropic') {
      return this.sendAnthropic(params)
    }
    return this.sendOpenAI(params)
  }

  /**
   * 发送带思考功能的消息
   */
  async sendWithThinking(
    params: Omit<SmartSendParams, 'thinking'>,
    budgetTokens: number = 5000
  ): Promise<SmartResponse> {
    if (this.format === 'anthropic') {
      return this.sendAnthropic({
        ...params,
        thinking: { type: 'enabled', budget_tokens: budgetTokens },
      })
    }
    // OpenAI 兼容格式不支持 thinking 参数，直接发送普通请求
    return this.sendOpenAI(params)
  }

  private async sendAnthropic(params: SmartSendParams): Promise<SmartResponse> {
    const response = await this.anthropicClient.sendMessage({
      model: params.model,
      messages: params.messages.filter(m => m.role !== 'system').map(m => ({
        role: m.role,
        content: m.content,
      })),
      max_tokens: params.max_tokens,
      system: params.system ?? params.messages.find(m => m.role === 'system')?.content,
      temperature: params.temperature,
      stream: params.stream,
      thinking: params.thinking,
    })

    const body = (response.body ?? {}) as Record<string, unknown>
    const content = body.content as Array<{ type: string; text?: string; thinking?: string }> | undefined

    // 提取文本
    const textBlocks = content?.filter(b => b.type === 'text') ?? []
    const text = textBlocks.map(b => b.text ?? '').join('\n')

    // 提取思考内容
    const thinkingBlocks = content?.filter(b => b.type === 'thinking') ?? null
    const thinkingText = thinkingBlocks && thinkingBlocks.length > 0
      ? thinkingBlocks.map(b => b.thinking ?? b.text ?? '').join('\n')
      : null

    return {
      text,
      body,
      status: response.status,
      headers: response.headers,
      format: 'anthropic',
      thinkingText,
      thinkingBlocks,
      raw: response.raw,
    }
  }

  private async sendOpenAI(params: SmartSendParams): Promise<SmartResponse> {
    // 构建 OpenAI 格式的消息
    const messages: Array<{ role: string; content: string }> = []
    if (params.system) {
      messages.push({ role: 'system', content: params.system })
    }
    for (const m of params.messages) {
      messages.push({ role: m.role, content: m.content })
    }

    const response = await this.openaiClient.sendChatCompletion({
      model: params.model,
      messages,
      max_tokens: params.max_tokens,
      temperature: params.temperature,
      stream: params.stream,
    })

    const body = (response.body ?? {}) as Record<string, unknown>
    const choices = body.choices as Array<{
      message?: {
        content?: string | null
        reasoning_content?: string | null
      }
    }> | undefined

    const firstChoice = choices?.[0]?.message
    const text = firstChoice?.content ?? ''
    const reasoningContent = firstChoice?.reasoning_content ?? null

    return {
      text,
      body,
      status: response.status,
      headers: response.headers,
      format: 'openai',
      thinkingText: reasoningContent,
      thinkingBlocks: null,
      raw: response.raw,
    }
  }
}
