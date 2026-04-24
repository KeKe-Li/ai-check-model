import { BaseDetector } from './base'
import type { DetectorResult, VerificationConfig } from '../types'
import { getProviderFromModel } from '../types'
import { SmartClient } from '@/lib/api-client/smart-client'

/**
 * 元数据检测器
 * 通过分析 API 响应的结构、ID 格式和 HTTP 头信息来验证模型真实性
 */
export class MetadataDetector extends BaseDetector {
  readonly name = 'metadata'
  readonly displayName = '响应元数据分析'
  readonly maxScore = 15
  readonly description = '检查 API 响应结构、ID 格式和 HTTP 头信息是否符合官方规范'

  supports(): boolean {
    return true
  }

  async detect(config: VerificationConfig, onProgress: (message: string) => void): Promise<DetectorResult> {
    const provider = getProviderFromModel(config.model)
    const findings: string[] = []
    let score = 0

    try {
      onProgress('正在发送测试请求...')

      const client = new SmartClient(config.endpoint, config.apiKey, config.apiFormat ?? 'openai')
      const response = await client.send({
        model: config.model,
        messages: [{ role: 'user', content: '你好' }],
        max_tokens: 100,
      })

      // 格式本身是检测信号：声称 Claude 但用 OpenAI 格式，记录为发现
      if (provider === 'anthropic' && response.format === 'openai') {
        findings.push('注意: 声称是 Anthropic 模型但端点使用 OpenAI 兼容格式（常见于中转代理）')
      }

      onProgress('正在分析响应结构...')

      const body = response.body
      const headers = response.headers

      if (response.format === 'anthropic') {
        // Anthropic 格式响应结构检查
        const result = this.checkAnthropicStructure(body, headers, config.model, onProgress)
        score = result.score
        findings.push(...result.findings)
      } else {
        // OpenAI 格式响应结构检查
        const result = this.checkOpenAIStructure(body, headers, config.model, provider, onProgress)
        score = result.score
        findings.push(...result.findings)
      }

      if (score >= this.maxScore * 0.8) {
        return this.pass(score, findings, { provider, format: response.format })
      }
      return this.fail(score, findings, { provider, format: response.format })
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      return this.skip(`元数据检测无法执行: ${message}`)
    }
  }

  /** 检查 Anthropic 格式响应结构 */
  private checkAnthropicStructure(
    body: Record<string, unknown>,
    headers: Record<string, string>,
    claimedModel: string,
    onProgress: (message: string) => void
  ): { score: number; findings: string[] } {
    const findings: string[] = []
    let score = 0

    // 检查1: 响应结构完整性（5分）
    if (body && typeof body === 'object') {
      const hasId = typeof body.id === 'string'
      const hasType = body.type === 'message'
      const hasModel = typeof body.model === 'string'
      const hasContent = Array.isArray(body.content)
      const hasStopReason = 'stop_reason' in body
      const hasUsage = typeof body.usage === 'object' && body.usage !== null

      const structureFields = [hasId, hasType, hasModel, hasContent, hasStopReason, hasUsage]
      const matchedCount = structureFields.filter(Boolean).length

      if (matchedCount === 6) {
        score += 5
        findings.push('响应结构完全符合 Anthropic 官方格式（id, type, model, content, stop_reason, usage）')
      } else if (matchedCount >= 4) {
        score += 3
        findings.push(`响应结构部分符合 Anthropic 格式（${matchedCount}/6 字段匹配）`)
      } else {
        findings.push(`响应结构不符合 Anthropic 格式（仅 ${matchedCount}/6 字段匹配），可能是代理转发`)
      }

      // 检查2: ID 格式（5分）
      if (hasId) {
        const responseId = body.id as string
        if (responseId.startsWith('msg_')) {
          score += 5
          findings.push(`响应 ID 格式正确: ${responseId.slice(0, 20)}... (以 msg_ 开头)`)
        } else if (responseId.startsWith('chatcmpl-')) {
          findings.push(`响应 ID 为 OpenAI 格式 (chatcmpl-)，但声称是 Anthropic 模型 — 高度可疑`)
        } else {
          score += 1
          findings.push(`响应 ID 格式非标准: ${responseId.slice(0, 20)}...`)
        }
      } else {
        findings.push('响应中缺少 id 字段')
      }

      // 检查3: model 字段匹配（2分）
      if (hasModel) {
        const returnedModel = body.model as string
        if (returnedModel === claimedModel || returnedModel.includes(claimedModel.split('-')[0])) {
          score += 2
          findings.push(`返回的模型标识与声称一致: ${returnedModel}`)
        } else {
          findings.push(`返回的模型标识不匹配: 声称 ${claimedModel}，实际返回 ${returnedModel}`)
        }
      }
    } else {
      findings.push('响应 body 为空或非 JSON 对象')
    }

    // 检查4: HTTP 头信息（3分）
    onProgress('正在检查 HTTP 头信息...')
    const hasRequestId = !!headers['request-id']
    const hasAnthropicHeaders = Object.keys(headers).some((key) =>
      key.toLowerCase().startsWith('x-anthropic') || key.toLowerCase() === 'request-id'
    )
    const hasOpenAIHeaders = !!headers['x-request-id'] || !!headers['openai-organization']

    if (hasRequestId || hasAnthropicHeaders) {
      score += 3
      findings.push('HTTP 头包含 Anthropic 特征字段（request-id）')
    } else if (hasOpenAIHeaders) {
      findings.push('HTTP 头包含 OpenAI 特征字段，但声称是 Anthropic 模型 — 可能为代理')
    } else {
      score += 1
      findings.push('HTTP 头中未找到明确的提供商特征字段')
    }

    return { score, findings }
  }

  /** 检查 OpenAI 格式响应结构 */
  private checkOpenAIStructure(
    body: Record<string, unknown>,
    headers: Record<string, string>,
    claimedModel: string,
    provider: string,
    onProgress: (message: string) => void
  ): { score: number; findings: string[] } {
    const findings: string[] = []
    let score = 0

    // 检查1: 响应结构完整性（5分）
    if (body && typeof body === 'object') {
      const hasId = typeof body.id === 'string'
      const hasObject = body.object === 'chat.completion'
      const hasModel = typeof body.model === 'string'
      const hasChoices = Array.isArray(body.choices)
      const hasUsage = typeof body.usage === 'object' && body.usage !== null

      const structureFields = [hasId, hasObject, hasModel, hasChoices, hasUsage]
      const matchedCount = structureFields.filter(Boolean).length

      if (matchedCount === 5) {
        score += 5
        findings.push('响应结构完全符合 OpenAI 官方格式（id, object, model, choices, usage）')
      } else if (matchedCount >= 3) {
        score += 3
        findings.push(`响应结构部分符合 OpenAI 格式（${matchedCount}/5 字段匹配）`)
      } else {
        findings.push(`响应结构不符合 OpenAI 格式（仅 ${matchedCount}/5 字段匹配）`)
      }

      // 检查2: ID 格式（5分）
      if (hasId) {
        const responseId = body.id as string
        if (responseId.startsWith('chatcmpl-')) {
          score += 5
          findings.push(`响应 ID 格式正确: ${responseId.slice(0, 20)}... (以 chatcmpl- 开头)`)
        } else if (responseId.startsWith('msg_')) {
          // 声称 OpenAI 格式但 ID 是 Anthropic 的
          if (provider === 'anthropic') {
            score += 3
            findings.push(`响应 ID 为 Anthropic 格式 (msg_)，通过 OpenAI 兼容层转发（常见于中转）`)
          } else {
            findings.push(`响应 ID 为 Anthropic 格式 (msg_)，但声称是 OpenAI 模型 — 高度可疑`)
          }
        } else {
          score += 1
          findings.push(`响应 ID 格式非标准: ${responseId.slice(0, 20)}...`)
        }
      } else {
        findings.push('响应中缺少 id 字段')
      }

      // 检查3: model 字段匹配（2分）
      if (hasModel) {
        const returnedModel = body.model as string
        if (returnedModel === claimedModel || returnedModel.includes(claimedModel)) {
          score += 2
          findings.push(`返回的模型标识与声称一致: ${returnedModel}`)
        } else {
          findings.push(`返回的模型标识不匹配: 声称 ${claimedModel}，实际返回 ${returnedModel}`)
        }
      }
    } else {
      findings.push('响应 body 为空或非 JSON 对象')
    }

    // 检查4: HTTP 头信息（3分）
    onProgress('正在检查 HTTP 头信息...')
    const hasXRequestId = !!headers['x-request-id']
    const hasOpenAIOrgHeader = !!headers['openai-organization']

    if (hasXRequestId || hasOpenAIOrgHeader) {
      score += 3
      findings.push('HTTP 头包含 OpenAI 特征字段（x-request-id）')
    } else {
      score += 1
      findings.push('HTTP 头中未找到明确的 OpenAI 特征字段')
    }

    return { score, findings }
  }
}
