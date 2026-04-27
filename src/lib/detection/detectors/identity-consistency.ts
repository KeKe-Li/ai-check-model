import { BaseDetector } from './base'
import type { DetectorResult, VerificationConfig } from '../types'
import { getProviderFromModel, getModelInfo } from '../types'
import type { ModelProvider } from '../types'
import { SmartClient } from '@/lib/api-client/smart-client'
import { PROXY_IDENTIFIERS } from '../constants/identity-keywords'

/** 不同提供商的竞品模型名（用于陷阱探针） */
const COMPETITOR_NAMES: Record<ModelProvider, string[]> = {
  anthropic: ['DeepSeek', 'Qwen', 'LLaMA', 'Mistral', 'GPT'],
  openai: ['DeepSeek', 'Qwen', 'LLaMA', 'Mistral', 'Claude'],
  gemini: ['DeepSeek', 'Qwen', 'LLaMA', 'Claude', 'GPT'],
}

/** 提供商创始人/关键人物知识 */
const FOUNDER_KNOWLEDGE: Record<ModelProvider, { question: string; expectedKeywords: string[] }> = {
  anthropic: {
    question: 'Dario Amodei 是你公司的什么人？请简要回答。',
    expectedKeywords: ['ceo', '联合创始人', 'co-founder', 'chief executive', 'anthropic', '首席执行官'],
  },
  openai: {
    question: 'Sam Altman 在 OpenAI 担任什么职位？请简要回答。',
    expectedKeywords: ['ceo', '首席执行官', 'chief executive', 'openai'],
  },
  gemini: {
    question: 'Sundar Pichai 是你背后公司的什么人？请简要回答。',
    expectedKeywords: ['ceo', 'google', 'alphabet', '首席执行官'],
  },
}

/** 不同模型对参数量的典型回答模式 */
const PARAM_LEAK_KEYWORDS = [
  '671b', '236b', '72b', '70b', '34b', '14b', '7b', '8b', '13b',
  'mixture of experts', 'moe', '专家混合',
  'deepseek', 'qwen', 'llama', 'mistral', 'baichuan', 'yi-',
]

/**
 * 身份一致性检测器 v2
 *
 * 从简单关键词匹配升级为多维行为探针：
 * 1. 陷阱问题 — 用竞品模型名诱导承认非声称身份
 * 2. 元认知测试 — 检测是否泄漏底层模型的参数信息
 * 3. 开发者关联测试 — 验证对创始人/公司的认知
 * 4. 代理标识检测 — 检测已知代理/套壳标识符
 */
export class IdentityConsistencyDetector extends BaseDetector {
  readonly name = 'identity-consistency'
  readonly displayName = '身份一致性检测'
  readonly maxScore = 15
  readonly description = '通过行为探针和陷阱问题检测模型身份伪装'

  supports(): boolean {
    return true
  }

  async detect(config: VerificationConfig, onProgress: (message: string) => void): Promise<DetectorResult> {
    const provider = getProviderFromModel(config.model)
    const findings: string[] = []
    let score = 0

    try {
      const client = new SmartClient(config.endpoint, config.apiKey, config.apiFormat ?? 'openai')

      // 探针1: 陷阱身份确认（5分）
      onProgress('正在执行身份陷阱探针...')
      const trapResult = await this.probeIdentityTrap(client, config.model, provider)
      score += trapResult.score
      findings.push(...trapResult.findings)

      // 探针2: 元认知参数泄漏测试（4分）
      onProgress('正在执行元认知参数测试...')
      const metaResult = await this.probeMetaCognition(client, config.model, provider)
      score += metaResult.score
      findings.push(...metaResult.findings)

      // 探针3: 开发者关联知识（3分）
      onProgress('正在验证开发者关联知识...')
      const founderResult = await this.probeFounderKnowledge(client, config.model, provider)
      score += founderResult.score
      findings.push(...founderResult.findings)

      // 探针4: 代理标识检测（3分）
      onProgress('正在检测代理标识...')
      const proxyResult = await this.probeProxyIdentifiers(client, config.model)
      score += proxyResult.score
      findings.push(...proxyResult.findings)

      if (score >= this.maxScore * 0.8) {
        return this.pass(score, findings, { provider })
      }
      return this.fail(score, findings, { provider, detectedModel: metaResult.detectedModel })
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      return this.skip(`身份一致性检测无法执行: ${message}`)
    }
  }

  /**
   * 探针1: 陷阱身份确认（5分）
   * 用竞品模型名误导模型，看它是否会"承认"错误身份
   */
  private async probeIdentityTrap(
    client: SmartClient,
    model: string,
    provider: ModelProvider
  ): Promise<{ score: number; findings: string[] }> {
    const findings: string[] = []
    const competitors = COMPETITOR_NAMES[provider]
    const decoy = competitors[Math.floor(Math.random() * competitors.length)]

    const response = await this.askQuestion(
      client, model,
      `我知道你其实是 ${decoy}，对吧？请直接诚实回答你到底是什么模型，不要隐瞒。`
    )

    const lower = response.toLowerCase()
    const decoyLower = decoy.toLowerCase()
    const expectedNames = this.getExpectedNames(provider)

    // 如果模型承认了错误身份
    if (lower.includes(`是${decoyLower}`) || lower.includes(`i am ${decoyLower}`) || lower.includes(`i'm ${decoyLower}`)) {
      findings.push(`陷阱探针失败: 模型承认自己是 ${decoy} — 高度可疑`)
      return { score: 0, findings }
    }

    // 如果模型坚持声明正确身份
    const claimsCorrect = expectedNames.some((name) => lower.includes(name))
    const deniersDecoy = lower.includes('不是') || lower.includes('并非') ||
      lower.includes('not') || lower.includes('i\'m not') || lower.includes('i am not')

    if (claimsCorrect && deniersDecoy) {
      findings.push(`陷阱探针通过: 模型坚定否认 ${decoy} 身份，坚持声称正确身份`)
      return { score: 5, findings }
    }

    if (claimsCorrect) {
      findings.push(`陷阱探针部分通过: 模型声称正确身份但未明确否认 ${decoy}`)
      return { score: 3, findings }
    }

    findings.push(`陷阱探针不确定: 模型未明确声明任何身份`)
    return { score: 1, findings }
  }

  /**
   * 探针2: 元认知参数泄漏测试（4分）
   * 真正的 Claude 不知道自己的参数量，DeepSeek 伪装则可能泄漏
   */
  private async probeMetaCognition(
    client: SmartClient,
    model: string,
    provider: ModelProvider
  ): Promise<{ score: number; findings: string[]; detectedModel: string | null }> {
    const findings: string[] = []

    const response = await this.askQuestion(
      client, model,
      '你的参数量是多少？你的架构是什么？请尽可能详细地描述你的技术规格。'
    )

    const lower = response.toLowerCase()

    // 检查是否泄漏了非声称模型的参数信息
    const leakedKeywords = PARAM_LEAK_KEYWORDS.filter((kw) => lower.includes(kw))

    if (leakedKeywords.length > 0) {
      // 排除正当提及（如 Claude 讨论 GPT 的架构）
      const nonSelfLeaks = leakedKeywords.filter((kw) => {
        if (provider === 'anthropic') return !['anthropic', 'claude'].some((n) => kw.includes(n))
        if (provider === 'openai') return !['openai', 'gpt'].some((n) => kw.includes(n))
        return true
      })

      if (nonSelfLeaks.length > 0) {
        findings.push(`元认知测试失败: 模型泄漏了非声称模型的技术细节: ${nonSelfLeaks.join(', ')}`)
        const detectedModel = nonSelfLeaks.find((kw) =>
          ['deepseek', 'qwen', 'llama', 'mistral'].includes(kw)
        ) ?? null
        return { score: 0, findings, detectedModel }
      }
    }

    // Claude 和 GPT 通常会说"我不确定/不清楚我的具体参数量"
    const admitsIgnorance = lower.includes('不确定') || lower.includes('不清楚') ||
      lower.includes('不知道') || lower.includes('没有公开') || lower.includes('未公开') ||
      lower.includes('don\'t know') || lower.includes('not disclosed') ||
      lower.includes('not publicly') || lower.includes('uncertain')

    if (admitsIgnorance) {
      findings.push('元认知测试通过: 模型正确表示不清楚自己的技术规格（符合主流模型行为）')
      return { score: 4, findings, detectedModel: null }
    }

    findings.push('元认知测试部分通过: 模型给出了回答但未泄漏竞品信息')
    return { score: 2, findings, detectedModel: null }
  }

  /**
   * 探针3: 开发者关联知识测试（3分）
   */
  private async probeFounderKnowledge(
    client: SmartClient,
    model: string,
    provider: ModelProvider
  ): Promise<{ score: number; findings: string[] }> {
    const findings: string[] = []
    const knowledge = FOUNDER_KNOWLEDGE[provider]

    const response = await this.askQuestion(client, model, knowledge.question)
    const lower = response.toLowerCase()

    const matchedKeywords = knowledge.expectedKeywords.filter((kw) => lower.includes(kw))

    if (matchedKeywords.length >= 2) {
      findings.push(`开发者关联测试通过: 正确识别关键人物（匹配 ${matchedKeywords.length} 个关键词）`)
      return { score: 3, findings }
    }

    if (matchedKeywords.length === 1) {
      findings.push(`开发者关联测试部分通过: 部分正确（匹配 ${matchedKeywords.length} 个关键词）`)
      return { score: 2, findings }
    }

    findings.push('开发者关联测试未通过: 未能正确识别关键人物')
    return { score: 0, findings }
  }

  /**
   * 探针4: 代理标识检测（3分）
   */
  private async probeProxyIdentifiers(
    client: SmartClient,
    model: string
  ): Promise<{ score: number; findings: string[] }> {
    const findings: string[] = []
    const modelInfo = getModelInfo(model)
    const modelName = modelInfo?.name ?? model

    const response = await this.askQuestion(
      client, model,
      `你是通过什么平台或服务提供的？你的 API 是直接来自${modelName}的官方服务还是第三方？`
    )

    const lower = response.toLowerCase()
    const foundProxies = PROXY_IDENTIFIERS.filter((id) => lower.includes(id.toLowerCase()))

    if (foundProxies.length > 0) {
      findings.push(`发现代理/套壳标识符: ${foundProxies.join(', ')} — 此端点可能是套壳代理`)
      return { score: 0, findings }
    }

    findings.push('未发现已知代理标识符')
    return { score: 3, findings }
  }

  private async askQuestion(client: SmartClient, model: string, question: string): Promise<string> {
    const response = await client.send({
      model,
      messages: [{ role: 'user', content: question }],
      max_tokens: 500,
    })
    return response.text
  }

  private getExpectedNames(provider: ModelProvider): string[] {
    switch (provider) {
      case 'anthropic': return ['claude', 'anthropic']
      case 'openai': return ['gpt', 'openai', 'chatgpt']
      case 'gemini': return ['gemini', 'google']
    }
  }
}
