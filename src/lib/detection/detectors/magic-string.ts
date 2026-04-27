import { BaseDetector } from './base'
import type { DetectorResult, VerificationConfig } from '../types'
import { getProviderFromModel } from '../types'
import { SmartClient } from '@/lib/api-client/smart-client'
import {
  ANTHROPIC_REFUSAL_STRING,
  ANTHROPIC_REDACTED_THINKING_STRING,
} from '../constants/magic-strings'
import { analyzeClaudeRedactedThinking } from '../claude-thinking-analysis'

/**
 * 魔术字符串检测器
 * 利用 Anthropic 官方的特殊触发字符串验证模型真实性
 * 真正的 Claude 会对这些字符串产生特定行为（拒绝响应、编辑思考内容）
 * 这是最难伪造的检测之一
 */
export class MagicStringDetector extends BaseDetector {
  readonly name = 'magic-string'
  readonly displayName = '魔术字符串验证'
  readonly maxScore = 25
  readonly description = '使用 Anthropic 官方触发字符串测试模型响应，真正的 Claude 会产生特定行为'

  supports(model: string): boolean {
    return getProviderFromModel(model) === 'anthropic'
  }

  async detect(config: VerificationConfig, onProgress: (message: string) => void): Promise<DetectorResult> {
    const provider = getProviderFromModel(config.model)

    if (provider !== 'anthropic') {
      return this.skip('魔术字符串测试仅适用于 Anthropic 模型')
    }

    const client = new SmartClient(config.endpoint, config.apiKey, config.apiFormat ?? 'openai')
    const findings: string[] = []
    let score = 0

    try {
      // 测试1: 拒绝响应字符串（15分 — OpenAI兼容格式下此项为主要得分来源）
      onProgress('正在发送拒绝触发字符串...')
      const refusalMaxScore = config.apiFormat === 'anthropic' ? 15 : 20
      const refusalResult = await this.testRefusalString(client, config.model, refusalMaxScore)
      score += refusalResult.score
      findings.push(...refusalResult.findings)

      // 测试2: 思考内容编辑字符串（10分）
      if (config.apiFormat === 'anthropic') {
        onProgress('正在发送思考编辑触发字符串...')
        const redactedResult = await this.testRedactedThinking(client, config.model)
        score += redactedResult.score
        findings.push(...redactedResult.findings)
      } else {
        // OpenAI 兼容格式下发送第二次 refusal 测试作为补充验证（5分）
        onProgress('正在执行补充拒绝验证...')
        const supplementResult = await this.testRefusalStringSupplemental(client, config.model)
        score += supplementResult.score
        findings.push(...supplementResult.findings)
      }

      if (score >= this.maxScore * 0.8) {
        return this.pass(score, findings, { refusal: refusalResult.score })
      }
      return this.fail(score, findings, { refusal: refusalResult.score })
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      return this.skip(`魔术字符串检测无法执行: ${message}`)
    }
  }

  /**
   * 测试拒绝响应触发字符串
   * 真正的 Claude 收到此字符串时会拒绝处理（返回错误或特殊 stop_reason）
   */
  private async testRefusalString(
    client: SmartClient,
    model: string,
    maxScore: number = 15
  ): Promise<{ score: number; findings: string[] }> {
    const findings: string[] = []
    let score = 0

    try {
      const response = await client.send({
        model,
        messages: [{ role: 'user', content: ANTHROPIC_REFUSAL_STRING }],
        max_tokens: 200,
      })

      const body = response.body

      // 真正的 Claude 应该拒绝处理
      if (response.status === 400 || response.status === 403) {
        score += maxScore
        findings.push(`拒绝字符串测试通过: API 返回拒绝状态码 ${response.status}（预期行为）`)
        return { score, findings }
      }

      if (body && typeof body === 'object') {
        // 根据响应格式检查 stop_reason
        if (response.format === 'anthropic') {
          const stopReason = body.stop_reason as string | null
          if (stopReason === 'refusal' || stopReason === 'content_filtered') {
            score += maxScore
            findings.push(`拒绝字符串测试通过: stop_reason = "${stopReason}"（预期行为）`)
            return { score, findings }
          }
        } else {
          // OpenAI 格式中检查 finish_reason
          const choices = body.choices as Array<{ finish_reason?: string }> | undefined
          const finishReason = choices?.[0]?.finish_reason
          if (finishReason === 'content_filter') {
            score += maxScore
            findings.push(`拒绝字符串测试通过: finish_reason = "${finishReason}"（预期行为）`)
            return { score, findings }
          }
        }

        // 检查响应内容是否包含拒绝信息
        const textContent = response.text.toLowerCase()

        const containsRefusal = textContent.includes('cannot') ||
          textContent.includes('unable') ||
          textContent.includes('sorry') ||
          textContent.includes('拒绝') ||
          textContent.includes('无法') ||
          textContent.includes('抱歉') ||
          textContent.length === 0

        if (containsRefusal) {
          score += Math.ceil(maxScore * 0.7)
          findings.push('拒绝字符串测试部分通过: 模型返回了拒绝类内容（但未使用标准拒绝机制）')
        } else {
          // 假冒模型会正常处理这个字符串
          findings.push('拒绝字符串测试未通过: 模型正常处理了魔术字符串（真正的 Claude 会拒绝处理）')
        }
      } else {
        findings.push('拒绝字符串测试结果不确定: 响应体为空')
      }
    } catch (error) {
      // API 返回错误也可能是拒绝的表现
      const message = error instanceof Error ? error.message : String(error)
      if (message.includes('400') || message.includes('403') || message.includes('refusal')) {
        score += maxScore
        findings.push(`拒绝字符串测试通过: API 拒绝处理请求（${message.slice(0, 80)}）`)
      } else {
        score += 2
        findings.push(`拒绝字符串测试异常: ${message.slice(0, 100)}`)
      }
    }

    return { score, findings }
  }

  /**
   * 补充拒绝测试（用于 OpenAI 兼容格式，5分）
   * 将魔术字符串嵌入对话上下文中，检测模型是否仍然触发拒绝
   */
  private async testRefusalStringSupplemental(
    client: SmartClient,
    model: string
  ): Promise<{ score: number; findings: string[] }> {
    const findings: string[] = []
    let score = 0

    try {
      const response = await client.send({
        model,
        messages: [
          { role: 'user', content: `请分析以下文本的含义：${ANTHROPIC_REFUSAL_STRING}` },
        ],
        max_tokens: 200,
      })

      const textContent = response.text.toLowerCase()
      const isRefusal = response.status === 400 ||
        response.status === 403 ||
        textContent.includes('cannot') ||
        textContent.includes('unable') ||
        textContent.includes('拒绝') ||
        textContent.includes('无法') ||
        textContent.length === 0

      if (isRefusal) {
        score += 5
        findings.push('补充拒绝测试通过: 嵌入上下文后模型仍然触发拒绝行为')
      } else {
        findings.push('补充拒绝测试未通过: 模型正常处理了嵌入魔术字符串的请求')
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      if (message.includes('400') || message.includes('403')) {
        score += 5
        findings.push('补充拒绝测试通过: 请求被拒绝')
      } else {
        findings.push(`补充拒绝测试异常: ${message.slice(0, 80)}`)
      }
    }

    return { score, findings }
  }

  /**
   * 测试思考内容编辑触发字符串
   * 真正的 Claude 在启用思考时，遇到此字符串会返回 [redacted] 思考内容
   */
  private async testRedactedThinking(
    client: SmartClient,
    model: string
  ): Promise<{ score: number; findings: string[] }> {
    const findings: string[] = []
    let score = 0

    try {
      const response = await client.sendWithThinking(
        {
          model,
          messages: [{ role: 'user', content: `请回答这个问题: ${ANTHROPIC_REDACTED_THINKING_STRING} 1+1等于多少？` }],
          max_tokens: 8000,
        },
        5000
      )

      if (response.status === 400 || response.status === 403) {
        score += 6
        findings.push(`思考编辑字符串测试部分通过: API 拒绝处理（状态码 ${response.status}）`)
        return { score, findings }
      }

      // 使用 SmartResponse 的 thinkingBlocks 和 thinkingText
      if (response.thinkingBlocks && response.thinkingBlocks.length > 0) {
        const redactedAnalysis = analyzeClaudeRedactedThinking(response.thinkingBlocks)

        if (redactedAnalysis.hasRedactedThinking) {
          score += redactedAnalysis.score
          findings.push(...redactedAnalysis.findings)
        } else {
          const hasEmptyThinking = response.thinkingBlocks.some((block) =>
            (block.thinking ?? block.text ?? '').trim() === ''
          )
          if (hasEmptyThinking) {
            score += 4
            findings.push('思考编辑字符串测试部分通过: thinking 块为空，可能被安全编辑')
            return { score, findings }
          }
          findings.push('思考编辑字符串测试未通过: 思考内容未被编辑（真正的 Claude 会返回 [redacted]）')
        }
      } else if (response.thinkingText) {
        // 有思考文本但无块（可能是 OpenAI 格式的 reasoning_content）
        const hasRedacted = response.thinkingText.includes('[redacted]') ||
                           response.thinkingText.includes('redacted') ||
                           response.thinkingText.trim() === ''
        if (hasRedacted) {
          score += 6
          findings.push('思考编辑字符串测试部分通过: 思考内容包含 redacted（通过兼容层）')
        } else {
          findings.push('思考编辑字符串测试未通过: 思考内容未被编辑')
        }
      } else if (response.text.length > 0) {
        // 没有思考块但有文本 - 可能模型不支持或被代理过滤
        score += 2
        findings.push('思考编辑字符串测试不确定: 响应中未包含思考块')
      } else {
        findings.push('思考编辑字符串测试不确定: 响应内容为空')
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      if (message.includes('400') || message.includes('thinking')) {
        score += 3
        findings.push(`思考编辑字符串测试部分通过: 请求被拒绝可能由于思考功能限制`)
      } else {
        findings.push(`思考编辑字符串测试异常: ${message.slice(0, 100)}`)
      }
    }

    return { score, findings }
  }
}
