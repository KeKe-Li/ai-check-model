import { BaseDetector } from './base'
import type { DetectorResult, VerificationConfig } from '../types'
import { getProviderFromModel, getModelInfo } from '../types'
import type { ModelProvider } from '../types'
import { SmartClient } from '@/lib/api-client/smart-client'
import { sampleKnowledgeQuestions } from '../constants/benchmark-questions'

/**
 * 知识截止日期检测器
 * 通过询问知识截止日期和模型特有知识来验证模型身份
 */
export class KnowledgeCutoffDetector extends BaseDetector {
  readonly name = 'knowledge-cutoff'
  readonly displayName = '知识截止日期验证'
  readonly maxScore = 15
  readonly description = '检查模型声称的知识截止日期是否与官方数据匹配，并测试模型特有知识'

  supports(): boolean {
    return true
  }

  async detect(config: VerificationConfig, onProgress: (message: string) => void): Promise<DetectorResult> {
    const provider = getProviderFromModel(config.model)
    const modelInfo = getModelInfo(config.model)
    const findings: string[] = []
    let score = 0

    if (!modelInfo) {
      return this.skip(`未知模型 ${config.model}，无法验证知识截止日期`)
    }

    try {
      const client = new SmartClient(config.endpoint, config.apiKey, config.apiFormat ?? 'openai')

      // 测试1: 询问知识截止日期（8分）
      onProgress('正在询问知识截止日期...')
      const cutoffResponse = await this.askQuestion(
        client,
        config.model,
        '你的训练数据截止到什么时间？请直接告诉我年份和月份，格式如 2025-03。'
      )

      const cutoffResult = this.analyzeCutoffDate(cutoffResponse, modelInfo.knowledgeCutoff)
      score += cutoffResult.score
      findings.push(...cutoffResult.findings)

      // 测试2: 模型特有知识验证（7分）
      onProgress('正在验证模型特有知识...')
      const knowledgeResult = await this.testSpecialKnowledge(client, config.model, provider)
      score += knowledgeResult.score
      findings.push(...knowledgeResult.findings)

      if (score >= this.maxScore * 0.8) {
        return this.pass(score, findings, {
          expectedCutoff: modelInfo.knowledgeCutoff,
          statedCutoff: cutoffResponse.slice(0, 100),
        })
      }
      return this.fail(score, findings, {
        expectedCutoff: modelInfo.knowledgeCutoff,
        statedCutoff: cutoffResponse.slice(0, 100),
      })
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      return this.skip(`知识截止日期检测无法执行: ${message}`)
    }
  }

  /** 发送提问请求并提取文本 */
  private async askQuestion(
    client: SmartClient,
    model: string,
    question: string
  ): Promise<string> {
    const response = await client.send({
      model,
      messages: [{ role: 'user', content: question }],
      max_tokens: 300,
    })
    return response.text
  }

  /**
   * 分析声称的知识截止日期（8分）
   */
  private analyzeCutoffDate(
    response: string,
    expectedCutoff: string
  ): { score: number; findings: string[] } {
    const findings: string[] = []
    let score = 0

    // 从响应中提取日期（支持 YYYY-MM、YYYY年MM月 等格式）
    const datePatterns = [
      /(\d{4})[-/](\d{1,2})/,
      /(\d{4})年(\d{1,2})月/,
      /(\d{4})\s*年\s*(\d{1,2})\s*月/,
    ]

    let extractedYear: number | null = null
    let extractedMonth: number | null = null

    for (const pattern of datePatterns) {
      const match = response.match(pattern)
      if (match) {
        extractedYear = parseInt(match[1], 10)
        extractedMonth = parseInt(match[2], 10)
        break
      }
    }

    if (extractedYear === null || extractedMonth === null) {
      findings.push(`无法从响应中提取截止日期: "${response.slice(0, 80)}"`)
      return { score, findings }
    }

    const statedDate = `${extractedYear}-${String(extractedMonth).padStart(2, '0')}`
    const [expectedYear, expectedMonthStr] = expectedCutoff.split('-')
    const expectedYearNum = parseInt(expectedYear, 10)
    const expectedMonthNum = parseInt(expectedMonthStr, 10)

    // 计算月份差距
    const monthDiff = Math.abs(
      (extractedYear - expectedYearNum) * 12 + (extractedMonth - expectedMonthNum)
    )

    if (statedDate === expectedCutoff) {
      score += 8
      findings.push(`知识截止日期完全匹配: ${statedDate} = ${expectedCutoff}`)
    } else if (monthDiff <= 2) {
      score += 5
      findings.push(`知识截止日期接近: 声称 ${statedDate}，期望 ${expectedCutoff}（差距 ${monthDiff} 个月）`)
    } else if (monthDiff <= 6) {
      score += 2
      findings.push(`知识截止日期偏差较大: 声称 ${statedDate}，期望 ${expectedCutoff}（差距 ${monthDiff} 个月）`)
    } else {
      findings.push(`知识截止日期严重不符: 声称 ${statedDate}，期望 ${expectedCutoff}（差距 ${monthDiff} 个月）— 高度可疑`)
    }

    return { score, findings }
  }

  /**
   * 测试模型特有知识（7分）
   */
  private async testSpecialKnowledge(
    client: SmartClient,
    model: string,
    provider: ModelProvider
  ): Promise<{ score: number; findings: string[] }> {
    const findings: string[] = []
    let score = 0

    const selectedQuestions = sampleKnowledgeQuestions()

    for (const kq of selectedQuestions) {
      const response = await this.askQuestion(client, model, kq.question)
      const lower = response.toLowerCase()

      // 确定当前提供商的期望模式
      let expectedPattern = ''
      if (provider === 'anthropic' && kq.expectedPatterns['claude']) {
        expectedPattern = kq.expectedPatterns['claude']
      } else if (provider === 'openai' && kq.expectedPatterns['gpt']) {
        expectedPattern = kq.expectedPatterns['gpt']
      }

      if (provider === 'anthropic') {
        // Claude 应该能正确回答 Claude 特有知识
        if (expectedPattern && lower.includes(expectedPattern.toLowerCase())) {
          score += 7
          findings.push(`模型特有知识验证通过: 正确回答了"${kq.description}"`)
        } else if (expectedPattern) {
          score += 2
          findings.push(`模型特有知识验证未通过: 未能正确回答"${kq.description}"（期望包含"${expectedPattern}"）`)
        } else {
          score += 3
          findings.push(`知识问题无特定期望答案，跳过深度验证`)
        }
      } else {
        // 非 Claude 模型不期望回答 Claude 特有知识
        const claudePattern = kq.expectedPatterns['claude']
        if (claudePattern && lower.includes(claudePattern.toLowerCase())) {
          // 非 Claude 模型居然回答了 Claude 特有知识 - 虽然不常见但不扣分
          score += 5
          findings.push(`模型回答了 Claude 特有知识问题（非常规但不扣分）`)
        } else {
          score += 4
          findings.push(`模型未能回答 Claude 特有知识问题（对非 Claude 模型属正常现象）`)
        }
      }
    }

    return { score, findings }
  }
}
