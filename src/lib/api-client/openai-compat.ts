/**
 * OpenAI 兼容 API 客户端
 * 支持 OpenAI 和兼容端点（如 Ollama、vLLM 等）
 */

export interface OpenAIResponse {
  status: number
  headers: Record<string, string>
  body: unknown
  raw: Response
}

export interface OpenAIChatParams {
  model: string
  messages: Array<{ role: string; content: string }>
  max_tokens?: number
  temperature?: number
  stream?: boolean
  logprobs?: boolean
  top_logprobs?: number
  response_format?: { type: string }
  seed?: number
}

export class OpenAICompatClient {
  private readonly endpoint: string
  private readonly apiKey: string

  constructor(endpoint: string, apiKey: string) {
    this.endpoint = this.normalizeEndpoint(endpoint)
    this.apiKey = apiKey
  }

  /**
   * 标准化端点 URL
   * 处理三种情况:
   * - "https://api.openai.com" → "https://api.openai.com/v1"
   * - "https://api.openai.com/v1" → "https://api.openai.com/v1"
   * - "https://api.openai.com/v1/chat/completions" → "https://api.openai.com/v1"
   */
  private normalizeEndpoint(endpoint: string): string {
    const url = endpoint.endsWith('/') ? endpoint.slice(0, -1) : endpoint

    // 如果已包含 /v1/chat/completions，去掉 /chat/completions
    if (url.endsWith('/v1/chat/completions')) {
      return url.slice(0, -17)  // 去掉 "/chat/completions"
    }

    // 如果已包含 /v1，直接使用
    if (url.endsWith('/v1')) {
      return url
    }

    // 否则添加 /v1
    return `${url}/v1`
  }

  /**
   * 发送聊天补全请求
   */
  async sendChatCompletion(params: OpenAIChatParams): Promise<OpenAIResponse> {
    const url = `${this.endpoint}/chat/completions`

    const response = await fetch(url, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${this.apiKey}`,
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
   * 查询模型目录中的指定模型。
   *
   * 官方 OpenAI API 暴露 GET /v1/models/{model}；很多中转站也会模拟
   * 该接口。这里不把 404/405 直接抛错，而是把状态码和 body 交给检测器
   * 分析，避免误杀“不实现模型目录但聊天接口可用”的中转站。
   */
  async retrieveModel(model: string): Promise<OpenAIResponse> {
    const url = `${this.endpoint}/models/${encodeURIComponent(model)}`

    const response = await fetch(url, {
      method: 'GET',
      headers: {
        'Authorization': `Bearer ${this.apiKey}`,
        'content-type': 'application/json',
      },
    })

    const headers = this.extractHeaders(response)
    let body: unknown = null
    try {
      body = await response.json()
    } catch {
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
