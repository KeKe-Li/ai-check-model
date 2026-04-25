import { BaseDetector } from './base'
import type { DetectorResult, VerificationConfig } from '../types'
import { getModelInfo } from '../types'
import { SmartClient } from '@/lib/api-client/smart-client'
import { analyzeClaudeThinkingBlocks } from '../claude-thinking-analysis'

/**
 * 思考块检测器
 * 验证模型是否真正支持扩展思考功能
 * 这是最强的验证信号之一：只有真正的高端模型才有思考链能力
 */
export class ThinkingBlockDetector extends BaseDetector {
  readonly name = 'thinking-block'
  readonly displayName = '扩展思考验证'
  readonly maxScore = 20
  readonly description = '验证模型是否真正支持扩展思考（thinking），并检查思考内容的质量'

  supports(model: string): boolean {
    const info = getModelInfo(model)
    return info?.supportsThinking ?? false
  }

  async detect(config: VerificationConfig, onProgress: (message: string) => void): Promise<DetectorResult> {
    const modelInfo = getModelInfo(config.model)

    if (!modelInfo?.supportsThinking) {
      return this.skip('此模型不支持扩展思考功能')
    }

    const apiFormat = config.apiFormat ?? 'openai'
    const findings: string[] = []
    let score = 0

    try {
      const client = new SmartClient(config.endpoint, config.apiKey, apiFormat)

      if (apiFormat === 'anthropic') {
        // Anthropic 原生格式：使用 sendWithThinking 获取 thinkingBlocks
        const result = await this.testAnthropicThinking(client, config.model, onProgress)
        score = result.score
        findings.push(...result.findings)
      } else {
        // OpenAI 兼容格式：检查 reasoning_content（thinkingText）
        const result = await this.testOpenAIReasoning(client, config.model, onProgress)
        score = result.score
        findings.push(...result.findings)
      }

      if (score >= this.maxScore * 0.8) {
        return this.pass(score, findings, { apiFormat })
      }
      return this.fail(score, findings, { apiFormat })
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      return this.skip(`扩展思考检测无法执行: ${message}`)
    }
  }

  /**
   * 测试 Anthropic 格式的扩展思考功能
   */
  private async testAnthropicThinking(
    client: SmartClient,
    model: string,
    onProgress: (message: string) => void
  ): Promise<{ score: number; findings: string[] }> {
    const findings: string[] = []
    let score = 0

    // 测试1: 基本思考功能（10分）
    onProgress('正在测试扩展思考功能...')
    try {
      const response = await client.sendWithThinking(
        {
          model,
          messages: [{ role: 'user', content: '请计算 17 × 23 并解释你的思考过程。' }],
          max_tokens: 8000,
        },
        5000
      )

      if (response.thinkingBlocks && response.thinkingBlocks.length > 0) {
        const analysis = analyzeClaudeThinkingBlocks(response.thinkingBlocks)
        score += analysis.score
        findings.push(...analysis.findings)

        // 验证思考内容是否包含数学推理
        const thinkingText = response.thinkingBlocks
          .map((block) => block.thinking ?? block.text ?? '')
          .join('\n')
        if (thinkingText.includes('17') || thinkingText.includes('23') || thinkingText.includes('391')) {
          findings.push('思考内容包含相关数学推理过程')
        }
      } else if (response.thinkingText && response.thinkingText.length > 0) {
        // 有 thinkingText 但没有 thinkingBlocks（不应在 Anthropic 格式出现，但防御性处理）
        if (response.thinkingText.length > 50) {
          score += 8
          findings.push(`扩展思考通过（非标准格式）: 思考文本 ${response.thinkingText.length} 字符`)
        } else {
          score += 4
          findings.push(`扩展思考部分通过（非标准格式）: 思考文本较短 ${response.thinkingText.length} 字符`)
        }
      } else if (response.text.length > 0) {
        // 没有思考块但有文本块 - 可能是代理过滤了思考内容
        score += 2
        findings.push('响应中无思考块（可能被代理过滤），仅有文本块')
      } else {
        findings.push('响应中既无思考块也无文本块')
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      if (message.includes('thinking') || message.includes('not supported')) {
        findings.push(`思考功能请求失败: 端点可能不支持思考功能 (${message.slice(0, 80)})`)
      } else {
        findings.push(`思考功能测试异常: ${message.slice(0, 100)}`)
      }
    }

    // 测试2: 中文思考链指令遵从测试（10分）
    // 只有 Opus 级别的模型能够可靠地遵从"使用中文思考"的指令
    onProgress('正在测试中文思考链能力...')
    try {
      const response = await client.sendWithThinking(
        {
          model,
          messages: [{ role: 'user', content: '什么是递归？用一句话解释。' }],
          max_tokens: 8000,
          system: '请使用中文进行思考。你的思考过程（thinking）必须全部使用中文。',
        },
        5000
      )

      if (response.thinkingBlocks && response.thinkingBlocks.length > 0) {
        const thinkingText = response.thinkingBlocks
          .map((block) => block.thinking ?? block.text ?? '')
          .join('\n')

        // 统计中文字符比例
        const chineseChars = (thinkingText.match(/[\u4e00-\u9fff]/g) ?? []).length
        const totalChars = thinkingText.length
        const chineseRatio = totalChars > 0 ? chineseChars / totalChars : 0

        if (chineseRatio > 0.3) {
          score += 10
          findings.push(`中文思考链测试通过: 中文占比 ${(chineseRatio * 100).toFixed(1)}%（Opus 级别模型特征）`)
        } else if (chineseRatio > 0.1) {
          score += 5
          findings.push(`中文思考链部分通过: 中文占比 ${(chineseRatio * 100).toFixed(1)}%（思考中混合了英文）`)
        } else if (thinkingText.length > 0) {
          score += 2
          findings.push(`中文思考链测试未通过: 中文占比 ${(chineseRatio * 100).toFixed(1)}%（思考主要使用英文）`)
        } else {
          findings.push('中文思考链测试: 思考内容为空')
        }
      } else if (response.thinkingText && response.thinkingText.length > 0) {
        // 回退到 thinkingText 分析
        const chineseChars = (response.thinkingText.match(/[\u4e00-\u9fff]/g) ?? []).length
        const totalChars = response.thinkingText.length
        const chineseRatio = totalChars > 0 ? chineseChars / totalChars : 0

        if (chineseRatio > 0.3) {
          score += 8
          findings.push(`中文思考链测试通过（非标准格式）: 中文占比 ${(chineseRatio * 100).toFixed(1)}%`)
        } else {
          score += 2
          findings.push(`中文思考链测试未通过: 中文占比 ${(chineseRatio * 100).toFixed(1)}%`)
        }
      } else {
        findings.push('中文思考链测试: 响应中无思考块')
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      findings.push(`中文思考链测试异常: ${message.slice(0, 100)}`)
    }

    return { score, findings }
  }

  /**
   * 测试 OpenAI 兼容格式的推理功能（reasoning_content）
   */
  private async testOpenAIReasoning(
    client: SmartClient,
    model: string,
    onProgress: (message: string) => void
  ): Promise<{ score: number; findings: string[] }> {
    const findings: string[] = []
    let score = 0

    onProgress('正在测试推理能力...')
    try {
      // 对 OpenAI 格式，sendWithThinking 会发送普通请求
      // reasoning_content 会被映射到 response.thinkingText
      const response = await client.sendWithThinking(
        {
          model,
          messages: [{ role: 'user', content: '请计算 17 × 23 并解释你的思考过程。' }],
          max_tokens: 4000,
        },
        5000
      )

      const reasoningContent = response.thinkingText
      const textContent = response.text

      if (reasoningContent && reasoningContent.length > 0) {
        // 模型返回了 reasoning_content
        if (reasoningContent.length > 50) {
          score += 15
          findings.push(`推理内容验证通过: reasoning_content 包含 ${reasoningContent.length} 字符`)
        } else {
          score += 8
          findings.push(`推理内容较短: reasoning_content 仅 ${reasoningContent.length} 字符`)
        }

        // 检查推理内容质量
        if (reasoningContent.includes('17') || reasoningContent.includes('23') || reasoningContent.includes('391')) {
          score += 5
          findings.push('推理内容包含相关数学推理过程')
        }
      } else if (textContent && textContent.length > 0) {
        // 没有 reasoning_content 但有正常内容
        // 检查文本中是否包含步骤化推理
        const hasSteps = textContent.includes('步骤') ||
          textContent.includes('首先') ||
          textContent.includes('step') ||
          textContent.includes('×') ||
          textContent.includes('391')

        if (hasSteps) {
          score += 8
          findings.push('响应中无 reasoning_content 字段，但文本包含推理步骤（可能是代理过滤了推理内容）')
        } else {
          score += 3
          findings.push('响应中无 reasoning_content 字段，且文本未包含明显推理步骤')
        }
      } else {
        findings.push('响应中既无 reasoning_content 也无有效文本内容')
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      findings.push(`推理功能测试异常: ${message.slice(0, 100)}`)
    }

    return { score, findings }
  }
}
