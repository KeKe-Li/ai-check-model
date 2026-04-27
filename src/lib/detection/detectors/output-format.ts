import { BaseDetector } from './base'
import type { DetectorResult, VerificationConfig } from '../types'
import { getProviderFromModel } from '../types'
import type { ModelProvider } from '../types'
import { SmartClient } from '@/lib/api-client/smart-client'

/**
 * 输出格式检测器
 * 通过分析模型输出的格式特征来验证模型身份
 * 关键测试：真正的 Claude 绝不会输出中文引号 \u201c\u201d，只使用英文引号 ""
 */
export class OutputFormatDetector extends BaseDetector {
  readonly name = 'output-format'
  readonly displayName = '输出格式特征分析'
  readonly maxScore = 8
  readonly description = '分析输出格式中的模型特征签名，如引号风格和排版习惯'

  supports(): boolean {
    return true
  }

  async detect(config: VerificationConfig, onProgress: (message: string) => void): Promise<DetectorResult> {
    const provider = getProviderFromModel(config.model)
    const findings: string[] = []
    let score = 0

    try {
      const client = new SmartClient(config.endpoint, config.apiKey, config.apiFormat ?? 'openai')

      // 测试1: 中文引号测试（5分）
      onProgress('正在测试引号格式特征...')
      const quoteResult = await this.testChineseQuotes(client, config.model, provider)
      score += quoteResult.score
      findings.push(...quoteResult.findings)

      // 测试2: 响应风格分析（3分）
      onProgress('正在分析响应风格...')
      const styleResult = await this.testResponseStyle(client, config.model, provider)
      score += styleResult.score
      findings.push(...styleResult.findings)

      if (score >= this.maxScore * 0.8) {
        return this.pass(score, findings, { provider })
      }
      return this.fail(score, findings, { provider })
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      return this.skip(`输出格式检测无法执行: ${message}`)
    }
  }

  /**
   * 测试中文引号特征（5分）
   * 真正的 Claude 绝不输出中文引号 \u201c\u201d \u2018\u2019，总是使用英文引号 " '
   * 出现中文双引号则 100% 不是 Claude
   */
  private async testChineseQuotes(
    client: SmartClient,
    model: string,
    provider: ModelProvider
  ): Promise<{ score: number; findings: string[] }> {
    const findings: string[] = []
    let score = 0

    const response = await client.send({
      model,
      messages: [{ role: 'user', content: '请写一个包含引号的中文句子，例如描述某人说了什么话。要求句子中必须使用引号来引用话语。' }],
      max_tokens: 800,
    })
    const text = response.text

    const hasChineseDoubleQuotes = text.includes('\u201c') || text.includes('\u201d')
    const hasChineseSingleQuotes = text.includes('\u2018') || text.includes('\u2019')
    const hasChineseBookQuotes = text.includes('\u300a') || text.includes('\u300b')

    if (provider === 'anthropic') {
      if (hasChineseDoubleQuotes) {
        findings.push('致命发现: 输出包含中文双引号\u201c\u201d（真正的 Claude 绝不会使用中文引号）— 100% 不是 Claude')
      } else {
        score += 5
        findings.push('引号测试通过: 输出使用英文引号（符合 Claude 行为特征）')
      }

      if (hasChineseSingleQuotes) {
        findings.push('注意: 输出包含中文单引号（Claude 通常不使用中文单引号）')
      }
    } else {
      if (hasChineseDoubleQuotes || hasChineseBookQuotes) {
        score += 5
        findings.push('引号测试通过: 输出使用中文引号（符合该模型的行为特征）')
      } else {
        score += 2
        findings.push('输出使用英文引号（该模型通常会使用中文引号，但不是致命信号）')
      }
    }

    return { score, findings }
  }

  /**
   * 测试响应风格特征（3分）
   */
  private async testResponseStyle(
    client: SmartClient,
    model: string,
    provider: ModelProvider
  ): Promise<{ score: number; findings: string[] }> {
    const findings: string[] = []
    let score = 0

    const response = await client.send({
      model,
      messages: [{ role: 'user', content: '请介绍一下量子计算的基本概念，使用 Markdown 格式。' }],
      max_tokens: 800,
    })
    const text = response.text

    const hasHeaders = /^#{1,3}\s/m.test(text)
    const hasBulletPoints = /^[\-*]\s/m.test(text)
    const hasNumberedList = /^\d+\.\s/m.test(text)
    const hasBoldText = /\*\*[^*]+\*\*/m.test(text)
    const hasCodeBlock = /```/m.test(text)
    const responseLength = text.length

    const structureScore = [hasHeaders, hasBulletPoints, hasNumberedList, hasBoldText, hasCodeBlock]
      .filter(Boolean).length

    if (provider === 'anthropic') {
      if (structureScore >= 3) {
        score += 3
        findings.push(`响应风格符合 Claude 特征: 高度结构化（${structureScore}/5 格式元素），长度 ${responseLength} 字符`)
      } else if (structureScore >= 1) {
        score += 2
        findings.push(`响应风格部分符合: 结构化程度一般（${structureScore}/5 格式元素）`)
      } else {
        findings.push(`响应风格不符合 Claude 特征: 缺乏结构化格式（${structureScore}/5 格式元素）`)
      }
    } else {
      if (structureScore >= 1) {
        score += 3
        findings.push(`响应风格正常: 使用了 ${structureScore}/5 种 Markdown 格式元素`)
      } else {
        score += 1
        findings.push('响应未使用 Markdown 格式（部分模型在简短回答中不使用格式）')
      }
    }

    return { score, findings }
  }
}
