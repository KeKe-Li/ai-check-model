import { BaseDetector } from './base'
import type { AuthenticitySignal, DetectorResult, VerificationConfig } from '../types'
import { SmartClient } from '@/lib/api-client/smart-client'

/** 用于一致性测试的确定性提示词（要求精确、短小、无歧义） */
const DETERMINISTIC_PROMPTS = [
  '列出前10个质数，用英文逗号分隔，不要有空格和其他任何文字。',
  '从1到10的平方分别是多少？用英文逗号分隔，不要有空格和其他任何文字。',
  '请输出26个英文小写字母，不要有空格和其他任何文字。',
]

/**
 * 确定性一致性检测器
 *
 * 检测中转站是否使用多模型负载均衡或轮换策略。
 * 在 temperature=0 下发送相同 prompt 3次，比较：
 * 1. 文本响应的一致性（相同模型在 temp=0 下应高度一致）
 * 2. 响应头中 model 字段的一致性
 * 3. 响应 ID 前缀的一致性
 */
export class DeterministicConsistencyDetector extends BaseDetector {
  readonly name = 'deterministic-consistency'
  readonly displayName = '确定性一致性检测'
  readonly maxScore = 10
  readonly description = '同一 prompt 发送3次检测多模型轮换和负载均衡掺假'

  supports(): boolean {
    return true
  }

  async detect(config: VerificationConfig, onProgress: (message: string) => void): Promise<DetectorResult> {
    const client = new SmartClient(config.endpoint, config.apiKey, config.apiFormat ?? 'openai')
    const findings: string[] = []
    const signals: AuthenticitySignal[] = []
    let score = 0

    try {
      // 随机选一个确定性 prompt
      const prompt = DETERMINISTIC_PROMPTS[Math.floor(Math.random() * DETERMINISTIC_PROMPTS.length)]

      onProgress('正在执行确定性一致性测试（发送3次相同请求）...')

      const responses = await Promise.all(
        [1, 2, 3].map(async (i) => {
          onProgress(`正在发送第 ${i}/3 次请求...`)
          const response = await client.send({
            model: config.model,
            messages: [{ role: 'user', content: prompt }],
            max_tokens: 200,
            temperature: 0,
          })
          return {
            text: response.text.trim(),
            model: typeof response.body.model === 'string' ? response.body.model : null,
            idPrefix: typeof response.body.id === 'string'
              ? (response.body.id as string).split(/[-_]/)[0]
              : null,
          }
        })
      )

      onProgress('正在分析响应一致性...')

      // 检查1: 文本一致性（5分）
      const texts = responses.map((r) => r.text)
      const textConsistency = this.analyzeTextConsistency(texts)
      score += textConsistency.score
      findings.push(...textConsistency.findings)

      // 检查2: model 字段一致性（3分）
      const models = responses.map((r) => r.model).filter(Boolean) as string[]
      const modelConsistency = this.analyzeModelConsistency(models)
      score += modelConsistency.score
      findings.push(...modelConsistency.findings)
      signals.push(...modelConsistency.signals)

      // 检查3: 响应 ID 前缀一致性（2分）
      const prefixes = responses.map((r) => r.idPrefix).filter(Boolean) as string[]
      const prefixConsistency = this.analyzePrefixConsistency(prefixes)
      score += prefixConsistency.score
      findings.push(...prefixConsistency.findings)

      const details = { authenticitySignals: signals }

      if (score >= this.maxScore * 0.8) {
        return this.pass(score, findings, details)
      }
      return this.fail(score, findings, details)
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      return this.skip(`确定性一致性检测无法执行: ${message}`)
    }
  }

  /** 分析3次文本响应的一致性 */
  private analyzeTextConsistency(texts: string[]): { score: number; findings: string[] } {
    const findings: string[] = []

    // 计算两两相似度
    const similarities = [
      this.textSimilarity(texts[0], texts[1]),
      this.textSimilarity(texts[1], texts[2]),
      this.textSimilarity(texts[0], texts[2]),
    ]
    const avgSimilarity = similarities.reduce((a, b) => a + b, 0) / similarities.length

    // 完全一致
    if (texts[0] === texts[1] && texts[1] === texts[2]) {
      findings.push(`文本一致性: 3次响应完全相同（temperature=0 下预期行为）`)
      return { score: 5, findings }
    }

    if (avgSimilarity > 0.9) {
      findings.push(`文本一致性: 3次响应高度相似（平均相似度 ${(avgSimilarity * 100).toFixed(1)}%）`)
      return { score: 4, findings }
    }

    if (avgSimilarity > 0.6) {
      findings.push(`文本一致性偏低: 平均相似度 ${(avgSimilarity * 100).toFixed(1)}%（temperature=0 下不应有此差异）`)
      return { score: 2, findings }
    }

    findings.push(`文本一致性异常: 平均相似度仅 ${(avgSimilarity * 100).toFixed(1)}% — 高度怀疑多模型轮换`)
    return { score: 0, findings }
  }

  /** 分析 model 字段一致性 */
  private analyzeModelConsistency(
    models: string[]
  ): { score: number; findings: string[]; signals: AuthenticitySignal[] } {
    const findings: string[] = []
    const signals: AuthenticitySignal[] = []

    if (models.length < 2) {
      findings.push('model 字段一致性: 响应中缺少 model 字段，无法比较')
      return { score: 1, findings, signals }
    }

    const uniqueModels = [...new Set(models)]

    if (uniqueModels.length === 1) {
      findings.push(`model 字段一致: 3次返回均为 ${uniqueModels[0]}`)
      return { score: 3, findings, signals }
    }

    findings.push(`model 字段不一致! 3次返回了不同模型: ${uniqueModels.join(', ')} — 多模型轮换证据`)
    signals.push({
      id: 'deterministic-model-rotation',
      severity: 'fatal',
      polarity: 'negative',
      message: `同一请求3次返回不同 model 字段: ${uniqueModels.join(', ')}，存在多模型轮换`,
      evidence: { models, uniqueModels },
    })
    return { score: 0, findings, signals }
  }

  /** 分析响应 ID 前缀一致性 */
  private analyzePrefixConsistency(prefixes: string[]): { score: number; findings: string[] } {
    const findings: string[] = []

    if (prefixes.length < 2) {
      findings.push('响应 ID 前缀: 数据不足，无法比较')
      return { score: 1, findings }
    }

    const uniquePrefixes = [...new Set(prefixes)]

    if (uniquePrefixes.length === 1) {
      findings.push(`响应 ID 前缀一致: ${uniquePrefixes[0]}`)
      return { score: 2, findings }
    }

    findings.push(`响应 ID 前缀不一致: ${uniquePrefixes.join(', ')} — 可能经过不同代理路径`)
    return { score: 0, findings }
  }

  /** 简单文本相似度（基于 token 重叠） */
  private textSimilarity(a: string, b: string): number {
    if (a === b) return 1
    if (a.length === 0 || b.length === 0) return 0

    const tokensA = new Set(a.split(/\s+/))
    const tokensB = new Set(b.split(/\s+/))
    const intersection = [...tokensA].filter((t) => tokensB.has(t)).length
    const union = new Set([...tokensA, ...tokensB]).size

    return union > 0 ? intersection / union : 0
  }
}
