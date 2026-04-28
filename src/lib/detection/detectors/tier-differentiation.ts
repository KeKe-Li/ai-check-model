import { BaseDetector } from './base'
import type { AuthenticitySignal, DetectorResult, VerificationConfig } from '../types'
import { getModelInfo, getProviderFromModel } from '../types'
import type { ModelTier } from '../types'
import { SmartClient } from '@/lib/api-client/smart-client'
import { CONSTRAINT_CHALLENGES, PRECISION_CHALLENGES } from '../constants/tier-challenges'

/**
 * 档位区分检测器
 *
 * 中转站最常见的掺假方式是同厂降级：声称 Opus 实际给 Sonnet/Haiku。
 * 本检测器通过梯度难度挑战和指令遵从精度测试来区分模型档位。
 *
 * 核心思路：
 * 1. 多约束构造题 — 只有旗舰模型能同时满足所有约束
 * 2. 精确字数控制 — 旗舰模型的指令遵从精度显著高于中低端
 * 3. 思考深度分析 — 旗舰模型的 thinking 更深入、有自我纠正
 */
export class TierDifferentiationDetector extends BaseDetector {
  readonly name = 'tier-differentiation'
  readonly displayName = '档位区分检测'
  readonly maxScore = 25
  readonly description = '通过梯度难度挑战和指令遵从精度检测同厂模型降级'

  supports(): boolean {
    return true
  }

  async detect(config: VerificationConfig, onProgress: (message: string) => void): Promise<DetectorResult> {
    const provider = getProviderFromModel(config.model)
    const modelInfo = getModelInfo(config.model)
    const claimedTier = modelInfo?.tier ?? 'mid'
    const apiFormat = config.apiFormat ?? 'openai'
    const client = new SmartClient(config.endpoint, config.apiKey, apiFormat)
    const findings: string[] = []
    const signals: AuthenticitySignal[] = []
    let score = 0

    try {
      // 测试1: 多约束构造题（12分）
      onProgress('正在执行多约束构造挑战...')
      const constraintResult = await this.testConstraintChallenges(client, config.model, claimedTier)
      score += constraintResult.score
      findings.push(...constraintResult.findings)
      signals.push(...constraintResult.signals)

      // 测试2: 精确控制测试（8分）
      onProgress('正在执行指令遵从精度测试...')
      const precisionResult = await this.testPrecisionControl(client, config.model, claimedTier)
      score += precisionResult.score
      findings.push(...precisionResult.findings)
      signals.push(...precisionResult.signals)

      // 测试3: 思考深度分析（5分，仅支持 thinking 的模型）
      if (modelInfo?.supportsThinking && claimedTier === 'flagship') {
        onProgress('正在分析思考深度...')
        const thinkingResult = await this.testThinkingDepth(client, config.model, apiFormat)
        score += thinkingResult.score
        findings.push(...thinkingResult.findings)
        signals.push(...thinkingResult.signals)
      }

      const details = { provider, claimedTier, authenticitySignals: signals }

      if (score >= this.maxScore * 0.7) {
        return this.pass(score, findings, details)
      }
      return this.fail(score, findings, details)
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      return this.skip(`档位区分检测无法执行: ${message}`)
    }
  }

  /**
   * 多约束构造题测试
   * 根据声称档位选择对应难度的题目
   */
  private async testConstraintChallenges(
    client: SmartClient,
    model: string,
    claimedTier: ModelTier
  ): Promise<{ score: number; findings: string[]; signals: AuthenticitySignal[] }> {
    const findings: string[] = []
    const signals: AuthenticitySignal[] = []
    let score = 0

    const challenges = claimedTier === 'flagship'
      ? CONSTRAINT_CHALLENGES.filter(c => c.difficulty === 'flagship_only')
      : CONSTRAINT_CHALLENGES.filter(c => c.difficulty === 'mid_and_above')

    const selected = challenges.slice(0, 2)
    let passCount = 0
    let totalCount = 0

    for (const challenge of selected) {
      totalCount++
      try {
        const response = await client.send({
          model,
          messages: [{ role: 'user', content: challenge.prompt }],
          max_tokens: 200,
          temperature: 0,
        })

        const result = challenge.validator(response.text)
        if (result.passed) {
          passCount++
          findings.push(`[${challenge.id}] 通过: ${result.reason}`)
        } else {
          findings.push(`[${challenge.id}] 未通过: ${result.reason}`)
        }
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error)
        findings.push(`[${challenge.id}] 执行异常: ${message.slice(0, 80)}`)
      }
    }

    if (totalCount === 0) {
      return { score: 4, findings: ['无可用约束题'], signals }
    }

    const passRate = passCount / totalCount

    if (claimedTier === 'flagship') {
      if (passRate >= 0.5) {
        score += 12
        findings.push(`约束题: ${passCount}/${totalCount} 通过（符合旗舰模型预期）`)
        signals.push({
          id: 'tier-constraint-flagship-pass',
          severity: 'strong',
          polarity: 'positive',
          message: `旗舰级多约束题通过率 ${(passRate * 100).toFixed(0)}%，符合声称档位`,
        })
      } else {
        score += 2
        findings.push(`约束题: ${passCount}/${totalCount} 通过（旗舰模型预期至少50%通过率）`)
        signals.push({
          id: 'tier-constraint-flagship-fail',
          severity: 'critical',
          polarity: 'negative',
          message: `声称旗舰但旗舰级约束题通过率仅 ${(passRate * 100).toFixed(0)}%，极可能被降级`,
          evidence: { passCount, totalCount, passRate, claimedTier },
        })
      }
    } else {
      if (passRate >= 0.5) {
        score += 12
        findings.push(`约束题: ${passCount}/${totalCount} 通过（符合中端模型预期）`)
      } else {
        score += 5
        findings.push(`约束题: ${passCount}/${totalCount} 通过（中端模型表现偏弱）`)
        signals.push({
          id: 'tier-constraint-mid-weak',
          severity: 'weak',
          polarity: 'negative',
          message: `中端级约束题通过率较低 (${(passRate * 100).toFixed(0)}%)`,
        })
      }
    }

    return { score, findings, signals }
  }

  /**
   * 精确控制测试
   * 测试模型对精确字数/字符数要求的遵从能力
   */
  private async testPrecisionControl(
    client: SmartClient,
    model: string,
    claimedTier: ModelTier
  ): Promise<{ score: number; findings: string[]; signals: AuthenticitySignal[] }> {
    const findings: string[] = []
    const signals: AuthenticitySignal[] = []
    let score = 0
    const deviations: number[] = []

    for (const challenge of PRECISION_CHALLENGES) {
      const { prompt, targetLength } = challenge.getPrompt()

      try {
        const response = await client.send({
          model,
          messages: [{ role: 'user', content: prompt }],
          max_tokens: 500,
          temperature: 0,
        })

        const text = response.text.trim()
        let actualLength: number

        if (challenge.id === 'exact-char-count') {
          actualLength = (text.match(/[\u4e00-\u9fff]/g) ?? []).length
        } else {
          actualLength = text.split(/\s+/).filter(Boolean).length
        }

        const deviation = Math.abs(actualLength - targetLength)
        deviations.push(deviation)
        const tolerance = challenge.tolerance[claimedTier]

        findings.push(`[${challenge.id}] 目标 ${targetLength}，实际 ${actualLength}，偏差 ${deviation}（${claimedTier} 容忍 ≤${tolerance}）`)
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error)
        findings.push(`[${challenge.id}] 执行异常: ${message.slice(0, 80)}`)
      }
    }

    if (deviations.length === 0) {
      return { score: 3, findings, signals }
    }

    const avgDeviation = deviations.reduce((a, b) => a + b, 0) / deviations.length
    const expectedTolerance = claimedTier === 'flagship' ? 3 : claimedTier === 'mid' ? 8 : 20

    if (avgDeviation <= expectedTolerance) {
      score += 8
      findings.push(`指令遵从精度: 平均偏差 ${avgDeviation.toFixed(1)}（符合 ${claimedTier} 档位预期 ≤${expectedTolerance}）`)
      signals.push({
        id: 'tier-precision-match',
        severity: 'strong',
        polarity: 'positive',
        message: `指令遵从精度匹配声称档位 ${claimedTier}（偏差 ${avgDeviation.toFixed(1)}）`,
      })
    } else if (avgDeviation <= expectedTolerance * 2) {
      score += 4
      findings.push(`指令遵从精度偏低: 平均偏差 ${avgDeviation.toFixed(1)}（${claimedTier} 预期 ≤${expectedTolerance}）`)
      signals.push({
        id: 'tier-precision-weak',
        severity: 'weak',
        polarity: 'negative',
        message: `指令遵从精度略低于声称档位 ${claimedTier} 的预期`,
        evidence: { avgDeviation, expectedTolerance },
      })
    } else {
      score += 1
      findings.push(`指令遵从精度严重不足: 平均偏差 ${avgDeviation.toFixed(1)}（${claimedTier} 预期 ≤${expectedTolerance}）— 疑似降级`)
      signals.push({
        id: 'tier-precision-mismatch',
        severity: 'critical',
        polarity: 'negative',
        message: `声称 ${claimedTier} 但指令遵从精度远低于该档位预期（偏差 ${avgDeviation.toFixed(1)} vs 容忍 ${expectedTolerance}），疑似同厂降级`,
        evidence: { avgDeviation, expectedTolerance, claimedTier },
      })
    }

    return { score, findings, signals }
  }

  /**
   * 思考深度分析
   * 旗舰模型的 thinking 应更深入，包含多个推理步骤和自我质疑
   */
  private async testThinkingDepth(
    client: SmartClient,
    model: string,
    apiFormat: string
  ): Promise<{ score: number; findings: string[]; signals: AuthenticitySignal[] }> {
    const findings: string[] = []
    const signals: AuthenticitySignal[] = []
    let score = 0

    const complexPrompt = `一个房间里有100个柜子和100个学生。第1个学生打开所有柜子，第2个学生关闭所有编号为2的倍数的柜子，第3个学生切换所有编号为3的倍数的柜子状态（开变关、关变开），以此类推直到第100个学生。最终有多少个柜子是打开的？请给出答案和简要推理过程。`

    try {
      const response = await client.sendWithThinking(
        { model, messages: [{ role: 'user', content: complexPrompt }], max_tokens: 8000 },
        8000
      )

      const thinkingText = response.thinkingText ?? ''
      const thinkingLength = thinkingText.length

      if (thinkingLength === 0) {
        findings.push('思考深度: 无思考内容')
        return { score: 1, findings, signals }
      }

      // 量化分析思考深度
      const stepMarkers = (thinkingText.match(/(?:首先|其次|然后|接下来|最后|第[一二三四五六七八九十\d]+|step|first|second|then|next|finally)/gi) ?? []).length
      const selfCorrections = (thinkingText.match(/(?:不对|错了|wait|actually|correction|重新|修正|但是.*不对)/gi) ?? []).length
      const mathExpressions = (thinkingText.match(/\d+[×*÷/+\-=]\d+/g) ?? []).length

      // 检查答案正确性（正确答案是10个）
      const hasCorrectAnswer = response.text.includes('10') && !response.text.includes('100个')

      if (thinkingLength > 500 && stepMarkers >= 3) {
        score += 5
        findings.push(`思考深度: ${thinkingLength} 字符, ${stepMarkers} 个步骤标记, ${selfCorrections} 次自我纠正, ${mathExpressions} 个数学表达式 — 符合旗舰模型`)
        signals.push({
          id: 'tier-thinking-deep',
          severity: 'strong',
          polarity: 'positive',
          message: `思考深度符合旗舰模型特征: ${thinkingLength} 字符，${stepMarkers} 步推理`,
          evidence: { thinkingLength, stepMarkers, selfCorrections },
        })
      } else if (thinkingLength > 200) {
        score += 3
        findings.push(`思考深度: ${thinkingLength} 字符, ${stepMarkers} 个步骤 — 中端水平`)
        if (!hasCorrectAnswer) {
          signals.push({
            id: 'tier-thinking-shallow',
            severity: 'weak',
            polarity: 'negative',
            message: '思考深度不足且答案可能错误，可能是中端模型而非旗舰',
          })
        }
      } else {
        score += 1
        findings.push(`思考深度不足: 仅 ${thinkingLength} 字符 — 与旗舰模型不符`)
        signals.push({
          id: 'tier-thinking-insufficient',
          severity: 'critical',
          polarity: 'negative',
          message: `声称旗舰但思考深度仅 ${thinkingLength} 字符，${stepMarkers} 个推理步骤，远低于预期`,
          evidence: { thinkingLength, stepMarkers },
        })
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      findings.push(`思考深度测试异常: ${message.slice(0, 100)}`)
    }

    return { score, findings, signals }
  }
}
