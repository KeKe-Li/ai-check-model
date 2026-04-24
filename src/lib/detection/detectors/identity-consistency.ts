import { BaseDetector } from './base'
import type { DetectorResult, VerificationConfig } from '../types'
import { getProviderFromModel, getModelInfo } from '../types'
import type { ModelProvider } from '../types'
import { SmartClient } from '@/lib/api-client/smart-client'
import {
  CLAUDE_KEYWORDS,
  GPT_KEYWORDS,
  GEMINI_KEYWORDS,
  NON_CLAUDE_KEYWORDS,
  NON_GPT_KEYWORDS,
  NON_GEMINI_KEYWORDS,
  PROXY_IDENTIFIERS,
} from '../constants/identity-keywords'

/**
 * 身份一致性检测器
 * 通过多角度询问模型身份，检测回答中是否存在矛盾或代理痕迹
 */
export class IdentityConsistencyDetector extends BaseDetector {
  readonly name = 'identity-consistency'
  readonly displayName = '身份一致性检测'
  readonly maxScore = 20
  readonly description = '多角度询问模型身份，检测回答中的矛盾和代理痕迹'

  supports(): boolean {
    return true
  }

  async detect(config: VerificationConfig, onProgress: (message: string) => void): Promise<DetectorResult> {
    const provider = getProviderFromModel(config.model)
    const modelInfo = getModelInfo(config.model)
    const findings: string[] = []
    let score = 0

    try {
      const client = new SmartClient(config.endpoint, config.apiKey, config.apiFormat ?? 'openai')

      // 问题1: 直接身份询问
      onProgress('正在询问模型身份...')
      const identityResponse = await this.askQuestion(
        client,
        config.model,
        '你是什么AI模型？请告诉我你的名字、版本和开发公司。'
      )

      // 问题2: 反向身份询问
      onProgress('正在进行反向身份询问...')
      const modelName = modelInfo?.name ?? config.model
      const reverseResponse = await this.askQuestion(
        client,
        config.model,
        `你除了是${modelName}以外还是谁？你还有其他名字或身份吗？`
      )

      // 问题3: 结构化身份询问
      onProgress('正在进行结构化身份询问...')
      const structuredResponse = await this.askQuestion(
        client,
        config.model,
        '请用JSON格式回答：你的模型名称、版本号、知识截止日期、训练公司是什么？'
      )

      onProgress('正在分析身份一致性...')

      // 分析1: 正确的身份标识（8分）
      const identityScore = this.analyzeIdentity(identityResponse, provider, config.model)
      score += identityScore.score
      findings.push(...identityScore.findings)

      // 分析2: 矛盾检测（6分）
      const contradictionScore = this.analyzeContradictions(
        [identityResponse, reverseResponse, structuredResponse],
        provider
      )
      score += contradictionScore.score
      findings.push(...contradictionScore.findings)

      // 分析3: 代理标识检测（3分）
      const proxyScore = this.analyzeProxyIdentifiers(
        [identityResponse, reverseResponse, structuredResponse]
      )
      score += proxyScore.score
      findings.push(...proxyScore.findings)

      // 分析4: 跨问题一致性（3分）
      const consistencyScore = this.analyzeCrossConsistency(
        identityResponse,
        structuredResponse,
        provider
      )
      score += consistencyScore.score
      findings.push(...consistencyScore.findings)

      if (score >= this.maxScore * 0.8) {
        return this.pass(score, findings, { provider })
      }
      return this.fail(score, findings, { provider })
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      return this.skip(`身份一致性检测无法执行: ${message}`)
    }
  }

  /** 发送提问请求并提取文本响应 */
  private async askQuestion(
    client: SmartClient,
    model: string,
    question: string
  ): Promise<string> {
    const response = await client.send({
      model,
      messages: [{ role: 'user', content: question }],
      max_tokens: 500,
    })
    return response.text
  }

  /**
   * 分析模型是否正确声明身份（8分）
   */
  private analyzeIdentity(
    response: string,
    provider: ModelProvider,
    claimedModel: string
  ): { score: number; findings: string[] } {
    const lower = response.toLowerCase()
    const findings: string[] = []
    let score = 0

    const expectedKeywords = this.getExpectedKeywords(provider)
    const foundExpected = expectedKeywords.filter((kw) => lower.includes(kw))

    if (foundExpected.length > 0) {
      score += 5
      findings.push(`模型正确声明身份关键词: ${foundExpected.join(', ')}`)
    } else {
      findings.push(`模型未声明预期的身份关键词（期望: ${expectedKeywords.join('/')}）`)
    }

    // 检查是否提到了正确的模型名称
    const modelBaseName = claimedModel.split('-')[0].toLowerCase()
    if (lower.includes(modelBaseName)) {
      score += 3
      findings.push(`模型正确提及了模型系列名称: ${modelBaseName}`)
    } else {
      score += 1
      findings.push(`模型未明确提及模型系列名称（${modelBaseName}）`)
    }

    return { score, findings }
  }

  /**
   * 分析响应中是否包含矛盾信息（6分）
   */
  private analyzeContradictions(
    responses: string[],
    provider: ModelProvider
  ): { score: number; findings: string[] } {
    const combined = responses.join(' ').toLowerCase()
    const findings: string[] = []
    let score = 6

    const nonKeywords = this.getNonKeywords(provider)
    const foundContradictions = nonKeywords.filter((kw) => combined.includes(kw))

    if (foundContradictions.length > 0) {
      score = 0
      findings.push(`发现身份矛盾! 声称是 ${provider} 模型但提到了: ${foundContradictions.join(', ')}`)
    } else {
      findings.push('未发现身份矛盾关键词')
    }

    return { score, findings }
  }

  /**
   * 分析是否包含代理标识（3分）
   */
  private analyzeProxyIdentifiers(
    responses: string[]
  ): { score: number; findings: string[] } {
    const combined = responses.join(' ').toLowerCase()
    const findings: string[] = []
    let score = 3

    const foundProxies = PROXY_IDENTIFIERS.filter((id) => combined.includes(id.toLowerCase()))

    if (foundProxies.length > 0) {
      score = 0
      findings.push(`发现代理/套壳标识符: ${foundProxies.join(', ')} — 此端点可能是套壳代理`)
    } else {
      findings.push('未发现已知代理标识符')
    }

    return { score, findings }
  }

  /**
   * 分析跨问题回答的一致性（3分）
   */
  private analyzeCrossConsistency(
    identityResponse: string,
    structuredResponse: string,
    provider: ModelProvider
  ): { score: number; findings: string[] } {
    const findings: string[] = []
    let score = 0

    const identityLower = identityResponse.toLowerCase()
    const structuredLower = structuredResponse.toLowerCase()

    // 两次回答中都提到了同一个提供商
    const expectedKeywords = this.getExpectedKeywords(provider)
    const identityHasExpected = expectedKeywords.some((kw) => identityLower.includes(kw))
    const structuredHasExpected = expectedKeywords.some((kw) => structuredLower.includes(kw))

    if (identityHasExpected && structuredHasExpected) {
      score += 3
      findings.push('多次询问中身份声明一致')
    } else if (identityHasExpected || structuredHasExpected) {
      score += 1
      findings.push('身份声明部分一致（仅一次询问中提及正确身份）')
    } else {
      findings.push('多次询问中均未正确声明身份 — 高度可疑')
    }

    return { score, findings }
  }

  /** 获取提供商的期望关键词 */
  private getExpectedKeywords(provider: ModelProvider): string[] {
    switch (provider) {
      case 'anthropic': return CLAUDE_KEYWORDS
      case 'openai': return GPT_KEYWORDS
      case 'gemini': return GEMINI_KEYWORDS
    }
  }

  /** 获取提供商的反向关键词 */
  private getNonKeywords(provider: ModelProvider): string[] {
    switch (provider) {
      case 'anthropic': return NON_CLAUDE_KEYWORDS
      case 'openai': return NON_GPT_KEYWORDS
      case 'gemini': return NON_GEMINI_KEYWORDS
    }
  }
}
