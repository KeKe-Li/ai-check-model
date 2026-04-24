import type { DetectorResult, VerificationConfig } from '../types'

/**
 * 检测器基类
 * 所有具体检测器必须继承此类
 */
export abstract class BaseDetector {
  /** 检测器唯一标识 */
  abstract readonly name: string
  /** 中文显示名 */
  abstract readonly displayName: string
  /** 满分值 */
  abstract readonly maxScore: number
  /** 检测器描述 */
  abstract readonly description: string

  /** 该检测器是否适用于指定模型 */
  abstract supports(model: string): boolean

  /** 执行检测 */
  abstract detect(
    config: VerificationConfig,
    onProgress: (message: string) => void
  ): Promise<DetectorResult>

  /** 构造通过结果 */
  protected pass(score: number, findings: string[], details: Record<string, unknown> = {}): DetectorResult {
    return {
      detectorName: this.name,
      displayName: this.displayName,
      score,
      maxScore: this.maxScore,
      status: score >= this.maxScore * 0.8 ? 'pass' : 'warn',
      details,
      findings,
    }
  }

  /** 构造失败结果 */
  protected fail(score: number, findings: string[], details: Record<string, unknown> = {}): DetectorResult {
    return {
      detectorName: this.name,
      displayName: this.displayName,
      score,
      maxScore: this.maxScore,
      status: 'fail',
      details,
      findings,
    }
  }

  /** 构造跳过结果 */
  protected skip(reason: string): DetectorResult {
    return {
      detectorName: this.name,
      displayName: this.displayName,
      score: 0,
      maxScore: 0,  // 跳过不计入总分
      status: 'skip',
      details: { reason },
      findings: [`跳过: ${reason}`],
    }
  }
}
