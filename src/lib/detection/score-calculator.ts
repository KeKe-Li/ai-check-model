import type { VerificationConfig, VerificationReport, DetectorResult, ConfidenceLevel } from './types'
import { getModelInfo } from './types'
import { assessAuthenticity, collectAuthenticitySignals } from './authenticity-signals'

/**
 * 评分计算器
 * 负责汇总检测结果并生成最终报告
 */
export class ScoreCalculator {
  /**
   * 计算综合评分和生成验证报告
   * 跳过的检测器不计入总分
   */
  static compute(
    config: VerificationConfig,
    results: DetectorResult[],
    durationMs: number
  ): VerificationReport {
    // 只计算非跳过的结果
    const scoredResults = results.filter(r => r.status !== 'skip')

    const totalScore = scoredResults.reduce((sum, r) => sum + r.score, 0)
    const totalMaxScore = scoredResults.reduce((sum, r) => sum + r.maxScore, 0)

    // 归一化到 0-100
    const normalizedScore = totalMaxScore > 0
      ? Math.round((totalScore / totalMaxScore) * 100)
      : 0

    const { finalScore, assessment } = assessAuthenticity(config, results, normalizedScore)
    const confidenceLevel = this.classifyConfidence(finalScore)
    const verdict = this.generateVerdict(finalScore, confidenceLevel, config.model, results)
    const modelDetected = this.inferModel(results, config.model)

    return {
      jobId: config.jobId,
      totalScore: finalScore,
      confidenceLevel,
      verdict,
      modelClaimed: config.model,
      modelDetected,
      results,
      durationMs,
      authenticity: assessment,
    }
  }

  /** 置信度分级 */
  static classifyConfidence(score: number): ConfidenceLevel {
    if (score >= 80) return 'HIGH'
    if (score >= 60) return 'MEDIUM'
    if (score >= 35) return 'LOW'
    return 'VERY_LOW'
  }

  /** 生成人类可读的判定 */
  static generateVerdict(
    score: number,
    confidence: ConfidenceLevel,
    modelClaimed: string,
    results: DetectorResult[]
  ): string {
    const modelInfo = getModelInfo(modelClaimed)
    const modelName = modelInfo?.name ?? modelClaimed

    const failedDetectors = results.filter(r => r.status === 'fail')
    const fatalSignals = collectAuthenticitySignals(results).filter((signal) =>
      signal.severity === 'fatal' && signal.polarity !== 'positive' && signal.polarity !== 'neutral'
    )

    if (fatalSignals.length > 0) {
      return `该端点存在致命真实性矛盾，极可能不是真实的 ${modelName}：${fatalSignals[0].message}`
    }

    switch (confidence) {
      case 'HIGH':
        return `该端点大概率提供真实的 ${modelName}，${results.filter(r => r.status === 'pass').length} 项检测通过`
      case 'MEDIUM':
        return `该端点基本可信，但存在 ${failedDetectors.length} 项疑点，建议关注`
      case 'LOW':
        return `该端点可疑，${failedDetectors.length} 项检测未通过，可能不是真实的 ${modelName}`
      case 'VERY_LOW':
        return `该端点极可能不是真实的 ${modelName}，多项关键检测失败`
    }
  }

  /** 从检测结果推断实际模型 */
  static inferModel(results: DetectorResult[], claimed: string): string | null {
    const mismatchSignal = collectAuthenticitySignals(results).find((signal) =>
      signal.id === 'returned-model-provider-mismatch' &&
      typeof signal.evidence?.returnedModel === 'string'
    )
    if (mismatchSignal?.evidence?.returnedModel) {
      return mismatchSignal.evidence.returnedModel as string
    }

    // 查找身份一致性检测器的结果
    const identityResult = results.find(r => r.detectorName === 'identity-consistency')
    if (identityResult?.details?.detectedModel) {
      return identityResult.details.detectedModel as string
    }

    // 如果所有关键检测器都通过，很可能就是声称的模型
    const keyDetectors = ['magic-string', 'thinking-block', 'identity-consistency']
    const keyResults = results.filter(r => keyDetectors.includes(r.detectorName))
    const allKeyPassed = keyResults.length > 0 && keyResults.every(r => r.status === 'pass' || r.status === 'skip')

    if (allKeyPassed) return claimed

    return null  // 无法确定
  }
}
