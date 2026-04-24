/**
 * Anthropic API 客户端
 * 支持代理端点和标准 API
 */

export interface AnthropicResponse {
  status: number
  headers: Record<string, string>
  body: unknown
  raw: Response
}

export interface AnthropicMessageParams {
  model: string
  messages: Array<{ role: string; content: string }>
  max_tokens: number
  system?: string
  temperature?: number
  stream?: boolean
  thinking?: { type: string; budget_tokens: number }
}

export interface AnthropicCountTokensParams {
  model: string
  messages: Array<{ role: string; content: string }>
  system?: string
}

export class AnthropicClient {
  private readonly endpoint: string
  private readonly apiKey: string

  constructor(endpoint: string, apiKey: string) {
    this.endpoint = this.normalizeEndpoint(endpoint)
    this.apiKey = apiKey
  }

  /**
   * 标准化端点 URL
   * 处理三种情况:
   * - "https://api.example.com" → "https://api.example.com/v1"
   * - "https://api.example.com/v1" → "https://api.example.com/v1"
   * - "https://api.example.com/v1/messages" → "https://api.example.com/v1"
   */
  private normalizeEndpoint(endpoint: string): string {
    const url = endpoint.endsWith('/') ? endpoint.slice(0, -1) : endpoint

    // 如果已包含 /v1/messages，去掉 /messages
    if (url.endsWith('/v1/messages')) {
      return url.slice(0, -9)  // 去掉 "/messages"
    }

    // 如果已包含 /v1，直接使用
    if (url.endsWith('/v1')) {
      return url
    }

    // 否则添加 /v1
    return `${url}/v1`
  }

  /**
   * 发送消息
   */
  async sendMessage(params: AnthropicMessageParams): Promise<AnthropicResponse> {
    const url = `${this.endpoint}/messages`

    const response = await fetch(url, {
      method: 'POST',
      headers: {
        'x-api-key': this.apiKey,
        'anthropic-version': '2023-06-01',
        'content-type': 'application/json',
      },
      body: JSON.stringify(params),
    })

    const headers = this.extractHeaders(response)

    // 如果是流式响应，直接返回原始响应
    if (params.stream) {
      return {
        status: response.status,
        headers,
        body: null,
        raw: response,
      }
    }

    // 非流式响应，解析 JSON
    let body: unknown = null
    try {
      body = await response.json()
    } catch {
      // JSON 解析失败时保留 null
      const text = await response.text().catch(() => '')
      body = { error: { message: text || `HTTP ${response.status}` } }
    }

    return {
      status: response.status,
      headers,
      body,
      raw: response,
    }
  }

  /**
   * 发送带思考功能的消息
   * 便捷方法，自动启用扩展思考
   */
  async sendMessageWithThinking(
    params: Omit<AnthropicMessageParams, 'thinking'>,
    budgetTokens: number = 5000
  ): Promise<AnthropicResponse> {
    return this.sendMessage({
      ...params,
      thinking: {
        type: 'enabled',
        budget_tokens: budgetTokens,
      },
    })
  }

  /**
   * 计算 token 数量
   */
  async countTokens(params: AnthropicCountTokensParams): Promise<{ input_tokens: number }> {
    const url = `${this.endpoint}/messages/count_tokens`

    const response = await fetch(url, {
      method: 'POST',
      headers: {
        'x-api-key': this.apiKey,
        'anthropic-version': '2023-06-01',
        'content-type': 'application/json',
      },
      body: JSON.stringify(params),
    })

    if (!response.ok) {
      const errorText = await response.text()
      throw new Error(`Token 计数失败 (${response.status}): ${errorText}`)
    }

    const data = await response.json() as { input_tokens: number }
    return data
  }

  /**
   * 提取响应头为普通对象
   */
  private extractHeaders(response: Response): Record<string, string> {
    const headers: Record<string, string> = {}
    response.headers.forEach((value, key) => {
      headers[key] = value
    })
    return headers
  }
}
