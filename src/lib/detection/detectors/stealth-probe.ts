import { BaseDetector } from './base'
import type { AuthenticitySignal, DetectorResult, VerificationConfig } from '../types'
import { getModelInfo, getProviderFromModel } from '../types'
import type { ModelProvider } from '../types'
import { SmartClient } from '@/lib/api-client/smart-client'

/**
 * 隐蔽探针检测器
 *
 * 聪明的中转站可以识别明显的检测请求（魔术字符串、身份提问等），
 * 只在检测时用真模型，日常使用时偷换。
 *
 * 本检测器将检测逻辑嵌入看似正常的对话请求中，
 * 让中转站无法区分这是检测请求还是普通使用。
 *
 * 策略：
 * 1. 通过自然对话提取模型自我认知的微妙差异
 * 2. 利用模型特有的风格指纹（不是问"你是谁"，而是看它怎么写）
 * 3. 多轮对话逐步缩小判断
 */
export class StealthProbeDetector extends BaseDetector {
  readonly name = 'stealth-probe'
  readonly displayName = '隐蔽探针检测'
  readonly maxScore = 15
  readonly description = '通过伪装成正常对话的隐蔽方式检测模型真实身份'

  supports(): boolean {
    return true
  }

  async detect(config: VerificationConfig, onProgress: (message: string) => void): Promise<DetectorResult> {
    const provider = getProviderFromModel(config.model)
    const modelInfo = getModelInfo(config.model)
    const apiFormat = config.apiFormat ?? 'openai'
    const client = new SmartClient(config.endpoint, config.apiKey, apiFormat)
    const findings: string[] = []
    const signals: AuthenticitySignal[] = []
    let score = 0

    try {
      // 探针1: 编程风格指纹（5分）
      onProgress('正在执行隐蔽探针 1/3...')
      const styleResult = await this.probeCodeStyle(client, config.model, provider)
      score += styleResult.score
      findings.push(...styleResult.findings)
      signals.push(...styleResult.signals)

      // 探针2: 知识边界探测（5分）
      onProgress('正在执行隐蔽探针 2/3...')
      const knowledgeResult = await this.probeKnowledgeBoundary(client, config.model, provider)
      score += knowledgeResult.score
      findings.push(...knowledgeResult.findings)
      signals.push(...knowledgeResult.signals)

      // 探针3: 多轮行为一致性（5分）
      onProgress('正在执行隐蔽探针 3/3...')
      const multiTurnResult = await this.probeMultiTurnConsistency(client, config.model, provider)
      score += multiTurnResult.score
      findings.push(...multiTurnResult.findings)
      signals.push(...multiTurnResult.signals)

      const details = { provider, authenticitySignals: signals }

      if (score >= this.maxScore * 0.6) {
        return this.pass(score, findings, details)
      }
      return this.fail(score, findings, details)
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      return this.skip(`隐蔽探针无法执行: ${message}`)
    }
  }

  /**
   * 探针1: 编程风格指纹（5分）
   *
   * 要求模型写一段代码，分析其编码风格特征。
   * 不同模型有固定的风格偏好（缩进、变量命名、注释风格、错误处理模式）。
   * 这看起来就是一个普通的编程请求，中转站无法识别为检测。
   */
  private async probeCodeStyle(
    client: SmartClient,
    model: string,
    provider: ModelProvider
  ): Promise<{ score: number; findings: string[]; signals: AuthenticitySignal[] }> {
    const findings: string[] = []
    const signals: AuthenticitySignal[] = []
    let score = 0

    const response = await client.send({
      model,
      messages: [{
        role: 'user',
        content: '请用 Python 写一个函数，实现从一个 URL 下载文件并保存到本地，要求有超时处理和重试机制。直接给代码，不需要解释。',
      }],
      max_tokens: 1500,
    })

    const code = response.text

    // 分析代码风格特征
    const styleSignals = {
      usesTypeHints: /def\s+\w+\(.*:\s*(str|int|bool|Path|Optional)/.test(code),
      usesDocstring: /"""[\s\S]*?"""/.test(code) || /'''[\s\S]*?'''/.test(code),
      usesPathlib: /pathlib|Path\(/.test(code),
      usesContextManager: /with\s+/.test(code),
      usesLogging: /logging|logger/.test(code),
      usesRequests: /requests\./.test(code),
      usesUrllib: /urllib/.test(code),
      hasRetryLoop: /for\s+.*(?:retry|attempt|try_count|range\(\d+\))/.test(code) || /while\s+.*(?:retry|attempt|tries)/.test(code),
      hasErrorHandling: /try\s*:[\s\S]*?except/.test(code),
      usesF_string: /f["']/.test(code),
    }

    const trueCount = Object.values(styleSignals).filter(Boolean).length

    if (provider === 'anthropic') {
      // Claude 的典型风格：type hints、docstring、pathlib、context manager
      const claudeSignature = [
        styleSignals.usesTypeHints,
        styleSignals.usesDocstring,
        styleSignals.hasErrorHandling,
        styleSignals.hasRetryLoop,
      ].filter(Boolean).length

      if (claudeSignature >= 3) {
        score += 5
        findings.push(`编程风格: 匹配 Claude 特征 (${claudeSignature}/4 关键特征)`)
        signals.push({
          id: 'stealth-code-style-match',
          severity: 'weak',
          polarity: 'positive',
          message: '编程输出风格符合 Claude 模型特征',
        })
      } else if (claudeSignature >= 2) {
        score += 3
        findings.push(`编程风格: 部分匹配 Claude 特征 (${claudeSignature}/4)`)
      } else {
        score += 1
        findings.push(`编程风格: 与 Claude 典型风格差异较大 (${claudeSignature}/4)`)
        signals.push({
          id: 'stealth-code-style-mismatch',
          severity: 'weak',
          polarity: 'negative',
          message: '编程输出风格与 Claude 模型特征不符',
        })
      }
    } else {
      // GPT 的编程风格通常也有 error handling 和清晰结构
      if (trueCount >= 4) {
        score += 5
        findings.push(`编程风格: 代码质量较高，${trueCount}/10 项风格特征`)
      } else if (trueCount >= 2) {
        score += 3
        findings.push(`编程风格: 代码质量一般，${trueCount}/10 项风格特征`)
      } else {
        score += 1
        findings.push(`编程风格: 代码质量偏低，${trueCount}/10 项风格特征`)
      }
    }

    return { score, findings, signals }
  }

  /**
   * 探针2: 知识边界探测（5分）
   *
   * 提问只有特定模型（或特定训练时间段的模型）才知道的事实。
   * 伪装模型的知识边界往往与声称模型不一致。
   */
  private async probeKnowledgeBoundary(
    client: SmartClient,
    model: string,
    provider: ModelProvider
  ): Promise<{ score: number; findings: string[]; signals: AuthenticitySignal[] }> {
    const findings: string[] = []
    const signals: AuthenticitySignal[] = []
    let score = 0

    // 问一个关于自身能力的隐蔽问题
    const selfAwarenessPrompt = provider === 'anthropic'
      ? '我在用一个 AI 助手写代码，它支持 artifacts 功能。你觉得用 artifacts 展示代码好还是直接在对话中给代码好？简要回答。'
      : '我在比较几个 AI 助手。有些支持 canvas 功能来编辑代码。你觉得 canvas 编辑和直接在对话中给代码各有什么优劣？简要回答。'

    const response = await client.send({
      model,
      messages: [{ role: 'user', content: selfAwarenessPrompt }],
      max_tokens: 500,
    })

    const text = response.text.toLowerCase()

    if (provider === 'anthropic') {
      // Claude 应该对 artifacts 有自然的了解（因为它就有这个功能）
      const knowsArtifacts = text.includes('artifact') || text.includes('代码块') ||
        text.includes('独立窗口') || text.includes('单独展示')
      const selfReference = text.includes('我') && (text.includes('支持') || text.includes('可以') || text.includes('能够'))

      if (knowsArtifacts && selfReference) {
        score += 5
        findings.push('知识边界: 对 artifacts 功能有自然的第一人称认知（符合 Claude 预期）')
      } else if (knowsArtifacts) {
        score += 3
        findings.push('知识边界: 了解 artifacts 但未以第一人称描述')
      } else {
        score += 1
        findings.push('知识边界: 对 artifacts 功能缺乏认知 — 可能不是真正的 Claude')
        signals.push({
          id: 'stealth-knowledge-gap',
          severity: 'weak',
          polarity: 'negative',
          message: '模型对 Claude artifacts 功能缺乏预期中的认知',
        })
      }
    } else {
      // GPT 应该对 canvas 有自然的了解
      const knowsCanvas = text.includes('canvas') || text.includes('画布') ||
        text.includes('编辑器') || text.includes('协作')

      if (knowsCanvas) {
        score += 5
        findings.push('知识边界: 对 canvas 功能有自然认知（符合 GPT 预期）')
      } else {
        score += 2
        findings.push('知识边界: 对 canvas 功能认知不足')
      }
    }

    return { score, findings, signals }
  }

  /**
   * 探针3: 多轮对话行为一致性（5分）
   *
   * 在多轮对话中检测模型行为是否一致。
   * 伪装模型在多轮中更容易暴露不一致。
   */
  private async probeMultiTurnConsistency(
    client: SmartClient,
    model: string,
    provider: ModelProvider
  ): Promise<{ score: number; findings: string[]; signals: AuthenticitySignal[] }> {
    const findings: string[] = []
    const signals: AuthenticitySignal[] = []
    let score = 0

    // 第一轮：建立基线
    const resp1 = await client.send({
      model,
      messages: [{ role: 'user', content: '请用一个比喻来解释什么是神经网络。要求简洁，不超过50字。' }],
      max_tokens: 200,
      temperature: 0,
    })

    // 第二轮：引用第一轮内容，测试一致性
    const resp2 = await client.send({
      model,
      messages: [
        { role: 'user', content: '请用一个比喻来解释什么是神经网络。要求简洁，不超过50字。' },
        { role: 'assistant', content: resp1.text },
        { role: 'user', content: '很好。现在请扩展你刚才的比喻，再加两句话。注意必须和上面的比喻保持一致。' },
      ],
      max_tokens: 300,
      temperature: 0,
    })

    const text1 = resp1.text.toLowerCase()
    const text2 = resp2.text.toLowerCase()

    // 检查第二轮是否引用了第一轮的核心概念
    const words1 = new Set(text1.split(/\s+/).filter(w => w.length > 1))
    const words2 = new Set(text2.split(/\s+/).filter(w => w.length > 1))
    const overlap = [...words1].filter(w => words2.has(w)).length
    const overlapRatio = words1.size > 0 ? overlap / words1.size : 0

    // 同时检查两次响应的 model 字段是否一致
    const model1 = typeof resp1.body.model === 'string' ? resp1.body.model : null
    const model2 = typeof resp2.body.model === 'string' ? resp2.body.model : null
    const modelConsistent = model1 === model2 || model1 === null || model2 === null

    if (overlapRatio > 0.2 && modelConsistent) {
      score += 5
      findings.push(`多轮一致性: 词汇重叠率 ${(overlapRatio * 100).toFixed(0)}%，model 字段一致`)
      signals.push({
        id: 'stealth-multiturn-consistent',
        severity: 'weak',
        polarity: 'positive',
        message: '多轮对话中模型表现一致',
      })
    } else if (!modelConsistent) {
      findings.push(`多轮一致性: model 字段不一致 (${model1} vs ${model2}) — 存在模型轮换`)
      signals.push({
        id: 'stealth-multiturn-model-switch',
        severity: 'fatal',
        polarity: 'negative',
        message: `多轮对话中 model 字段发生变化: ${model1} → ${model2}`,
        evidence: { model1, model2 },
      })
    } else if (overlapRatio < 0.05) {
      score += 1
      findings.push(`多轮一致性: 词汇重叠率极低 (${(overlapRatio * 100).toFixed(0)}%) — 模型可能无法正确延续上下文`)
      signals.push({
        id: 'stealth-multiturn-incoherent',
        severity: 'weak',
        polarity: 'negative',
        message: '多轮对话中模型未能延续上下文，可能使用了无状态代理',
      })
    } else {
      score += 3
      findings.push(`多轮一致性: 词汇重叠率 ${(overlapRatio * 100).toFixed(0)}%`)
    }

    return { score, findings, signals }
  }
}
