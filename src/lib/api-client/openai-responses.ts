/**
 * OpenAI Responses API 客户端
 * 用于检测第三方中转站是否支持 OpenAI 新版 Responses API 指纹。
 */

export interface OpenAIResponsesResponse {
  status: number
  headers: Record<string, string>
  body: Record<string, unknown>
  raw: Response
}

export interface OpenAIResponsesParams {
  model: string
  input: string
  instructions?: string
  max_output_tokens?: number
  temperature?: number
}

export class OpenAIResponsesClient {
  private readonly endpoint: string
  private readonly apiKey: string

  constructor(endpoint: string, apiKey: string) {
    this.endpoint = this.normalizeEndpoint(endpoint)
    this.apiKey = apiKey
  }

  private normalizeEndpoint(endpoint: string): string {
    const url = endpoint.endsWith('/') ? endpoint.slice(0, -1) : endpoint

    if (url.endsWith('/v1/responses')) {
      return url.slice(0, -10)
    }

    if (url.endsWith('/v1')) {
      return url
    }

    return `${url}/v1`
  }

  async createResponse(params: OpenAIResponsesParams): Promise<OpenAIResponsesResponse> {
    const response = await fetch(`${this.endpoint}/responses`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${this.apiKey}`,
        'content-type': 'application/json',
      },
      body: JSON.stringify(params),
    })

    const headers = this.extractHeaders(response)
    let body: Record<string, unknown> = {}

    try {
      const parsed = await response.json()
      body = parsed && typeof parsed === 'object'
        ? parsed as Record<string, unknown>
        : { value: parsed }
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

  private extractHeaders(response: Response): Record<string, string> {
    const headers: Record<string, string> = {}
    response.headers.forEach((value, key) => {
      headers[key] = value
    })
    return headers
  }
}
