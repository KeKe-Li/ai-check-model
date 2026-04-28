import { BaseDetector } from './base'
import type { AuthenticitySignal, DetectorResult, VerificationConfig } from '../types'
import { getProviderFromModel } from '../types'
import type { ModelProvider } from '../types'

/**
 * 错误响应指纹检测器
 *
 * 故意发送无效请求来触发错误响应，验证错误格式是否匹配官方 API。
 * 不同供应商有完全不同的错误响应结构，中转站往往返回自己的错误格式。
 */
export class ErrorFingerprintDetector extends BaseDetector {
  readonly name = 'error-fingerprint'
  readonly displayName = '错误响应指纹检测'
  readonly maxScore = 12
  readonly description = '通过故意触发错误验证错误响应格式是否匹配官方 API'

  supports(): boolean {
    return true
  }

  async detect(config: VerificationConfig, onProgress: (message: string) => void): Promise<DetectorResult> {
    const provider = getProviderFromModel(config.model)
    const apiFormat = config.apiFormat ?? 'openai'
    const findings: string[] = []
    const signals: AuthenticitySignal[] = []
    let score = 0

    try {
      // 测试1: 无效模型名（4分）
      onProgress('正在测试无效模型名错误格式...')
      const invalidModelResult = await this.testInvalidModel(config, provider, apiFormat)
      score += invalidModelResult.score
      findings.push(...invalidModelResult.findings)
      signals.push(...invalidModelResult.signals)

      // 测试2: 超大 max_tokens（4分）
      onProgress('正在测试超大 max_tokens 错误格式...')
      const maxTokensResult = await this.testExcessiveMaxTokens(config, provider, apiFormat)
      score += maxTokensResult.score
      findings.push(...maxTokensResult.findings)
      signals.push(...maxTokensResult.signals)

      // 测试3: 空消息列表（4分）
      onProgress('正在测试空消息错误格式...')
      const emptyResult = await this.testEmptyMessages(config, provider, apiFormat)
      score += emptyResult.score
      findings.push(...emptyResult.findings)
      signals.push(...emptyResult.signals)

      const details = { provider, apiFormat, authenticitySignals: signals }

      if (score >= this.maxScore * 0.7) {
        return this.pass(score, findings, details)
      }
      return this.fail(score, findings, details)
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      return this.skip(`错误响应指纹检测无法执行: ${message}`)
    }
  }

  /** 发送原始 HTTP 请求以获取错误响应 */
  private async rawRequest(
    endpoint: string,
    apiKey: string,
    apiFormat: 'anthropic' | 'openai',
    body: unknown
  ): Promise<{ status: number; body: Record<string, unknown>; headers: Record<string, string> }> {
    const baseUrl = endpoint.endsWith('/') ? endpoint.slice(0, -1) : endpoint
    const url = apiFormat === 'anthropic'
      ? `${baseUrl.replace(/\/v1$/, '')}/v1/messages`
      : `${baseUrl.replace(/\/v1$/, '')}/v1/chat/completions`

    const headers: Record<string, string> = { 'content-type': 'application/json' }
    if (apiFormat === 'anthropic') {
      headers['x-api-key'] = apiKey
      headers['anthropic-version'] = '2023-06-01'
    } else {
      headers['authorization'] = `Bearer ${apiKey}`
    }

    const response = await fetch(url, {
      method: 'POST',
      headers,
      body: JSON.stringify(body),
    })

    const responseHeaders: Record<string, string> = {}
    response.headers.forEach((value, key) => { responseHeaders[key] = value })

    let responseBody: Record<string, unknown> = {}
    try {
      responseBody = await response.json() as Record<string, unknown>
    } catch {
      const text = await response.text().catch(() => '')
      responseBody = { _raw: text }
    }

    return { status: response.status, body: responseBody, headers: responseHeaders }
  }

  /** 测试1: 无效模型名 */
  private async testInvalidModel(
    config: VerificationConfig,
    provider: ModelProvider,
    apiFormat: 'anthropic' | 'openai'
  ): Promise<{ score: number; findings: string[]; signals: AuthenticitySignal[] }> {
    const findings: string[] = []
    const signals: AuthenticitySignal[] = []
    let score = 0

    const fakeModel = 'nonexistent-model-xyz-99999'
    const body = apiFormat === 'anthropic'
      ? { model: fakeModel, messages: [{ role: 'user', content: 'hi' }], max_tokens: 10 }
      : { model: fakeModel, messages: [{ role: 'user', content: 'hi' }], max_tokens: 10 }

    try {
      const resp = await this.rawRequest(config.endpoint, config.apiKey, apiFormat, body)

      if (resp.status === 404 || resp.status === 400) {
        const errorShape = this.analyzeErrorShape(resp.body, provider, apiFormat)
        if (errorShape.matches) {
          score += 4
          findings.push(`无效模型名: HTTP ${resp.status} 错误格式匹配 ${provider} 官方格式`)
          signals.push({
            id: 'error-format-model-match',
            severity: 'strong',
            polarity: 'positive',
            message: `无效模型错误响应格式符合 ${provider} 官方 API 规范`,
          })
        } else {
          score += 1
          findings.push(`无效模型名: HTTP ${resp.status} 但错误格式不匹配官方: ${errorShape.reason}`)
          signals.push({
            id: 'error-format-model-mismatch',
            severity: 'strong',
            polarity: 'negative',
            message: `错误响应格式不符合 ${provider} 官方规范: ${errorShape.reason}`,
            evidence: { errorBody: JSON.stringify(resp.body).slice(0, 200) },
          })
        }
      } else if (resp.status === 200) {
        findings.push(`无效模型名: 意外返回 200 — 端点可能自动回退到默认模型`)
        signals.push({
          id: 'error-format-model-fallback',
          severity: 'critical',
          polarity: 'negative',
          message: '无效模型名返回 200（官方 API 应返回 404/400），端点可能有自动回退机制',
        })
      } else {
        score += 2
        findings.push(`无效模型名: HTTP ${resp.status}（非标准错误码但至少拒绝了）`)
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      findings.push(`无效模型名测试异常: ${message.slice(0, 80)}`)
    }

    return { score, findings, signals }
  }

  /** 测试2: 超大 max_tokens */
  private async testExcessiveMaxTokens(
    config: VerificationConfig,
    provider: ModelProvider,
    apiFormat: 'anthropic' | 'openai'
  ): Promise<{ score: number; findings: string[]; signals: AuthenticitySignal[] }> {
    const findings: string[] = []
    const signals: AuthenticitySignal[] = []
    let score = 0

    const body = apiFormat === 'anthropic'
      ? { model: config.model, messages: [{ role: 'user', content: 'hi' }], max_tokens: 9999999 }
      : { model: config.model, messages: [{ role: 'user', content: 'hi' }], max_tokens: 9999999 }

    try {
      const resp = await this.rawRequest(config.endpoint, config.apiKey, apiFormat, body)

      if (resp.status === 400 || resp.status === 422) {
        const errorMessage = this.extractErrorMessage(resp.body)
        const hasLimitInfo = /\d{3,}/.test(errorMessage)

        if (hasLimitInfo) {
          score += 4
          findings.push(`超大 max_tokens: HTTP ${resp.status}，错误消息包含限制值信息`)
          signals.push({
            id: 'error-format-maxtoken-limit',
            severity: 'strong',
            polarity: 'positive',
            message: '超大 max_tokens 触发标准错误并包含限制值信息（官方行为）',
          })
        } else {
          score += 2
          findings.push(`超大 max_tokens: HTTP ${resp.status}，但错误消息缺少具体限制值`)
        }
      } else if (resp.status === 200) {
        score += 2
        findings.push('超大 max_tokens: 请求未被拒绝（可能端点自动截断了）')
      } else {
        score += 1
        findings.push(`超大 max_tokens: HTTP ${resp.status}`)
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      findings.push(`超大 max_tokens 测试异常: ${message.slice(0, 80)}`)
    }

    return { score, findings, signals }
  }

  /** 测试3: 空消息列表 */
  private async testEmptyMessages(
    config: VerificationConfig,
    provider: ModelProvider,
    apiFormat: 'anthropic' | 'openai'
  ): Promise<{ score: number; findings: string[]; signals: AuthenticitySignal[] }> {
    const findings: string[] = []
    const signals: AuthenticitySignal[] = []
    let score = 0

    const body = apiFormat === 'anthropic'
      ? { model: config.model, messages: [], max_tokens: 10 }
      : { model: config.model, messages: [], max_tokens: 10 }

    try {
      const resp = await this.rawRequest(config.endpoint, config.apiKey, apiFormat, body)

      if (resp.status === 400 || resp.status === 422) {
        const errorShape = this.analyzeErrorShape(resp.body, provider, apiFormat)
        if (errorShape.matches) {
          score += 4
          findings.push(`空消息: HTTP ${resp.status}，错误格式匹配 ${provider} 官方`)
        } else {
          score += 2
          findings.push(`空消息: HTTP ${resp.status}，错误格式不完全匹配: ${errorShape.reason}`)
        }
      } else if (resp.status === 200) {
        findings.push('空消息: 意外返回 200（官方 API 应拒绝空消息列表）')
        signals.push({
          id: 'error-format-empty-accepted',
          severity: 'weak',
          polarity: 'negative',
          message: '空消息列表被接受（官方 API 应返回 400），可能是中转站兼容处理',
        })
      } else {
        score += 2
        findings.push(`空消息: HTTP ${resp.status}`)
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      findings.push(`空消息测试异常: ${message.slice(0, 80)}`)
    }

    return { score, findings, signals }
  }

  /** 分析错误响应结构是否匹配官方格式 */
  private analyzeErrorShape(
    body: Record<string, unknown>,
    provider: ModelProvider,
    apiFormat: 'anthropic' | 'openai'
  ): { matches: boolean; reason: string } {
    if (apiFormat === 'anthropic' || provider === 'anthropic') {
      // Anthropic 格式: { type: "error", error: { type: "...", message: "..." } }
      if (body.type === 'error' && typeof body.error === 'object' && body.error !== null) {
        const error = body.error as Record<string, unknown>
        if (typeof error.type === 'string' && typeof error.message === 'string') {
          return { matches: true, reason: '' }
        }
        return { matches: false, reason: 'error 对象缺少 type 或 message 字段' }
      }
      return { matches: false, reason: '缺少顶层 type:"error" 结构' }
    }

    // OpenAI 格式: { error: { message: "...", type: "...", code: "..." } }
    if (typeof body.error === 'object' && body.error !== null) {
      const error = body.error as Record<string, unknown>
      if (typeof error.message === 'string') {
        if (typeof error.type === 'string' || typeof error.code === 'string') {
          return { matches: true, reason: '' }
        }
        return { matches: false, reason: 'error 对象缺少 type 和 code 字段' }
      }
      return { matches: false, reason: 'error 对象缺少 message 字段' }
    }
    return { matches: false, reason: '缺少 error 对象' }
  }

  /** 提取错误消息文本 */
  private extractErrorMessage(body: Record<string, unknown>): string {
    const error = body.error
    if (typeof error === 'object' && error !== null) {
      const msg = (error as Record<string, unknown>).message
      if (typeof msg === 'string') return msg
    }
    return JSON.stringify(body).slice(0, 200)
  }
}
