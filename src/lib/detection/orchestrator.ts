import type { DetectionEvent, VerificationConfig, DetectorResult } from './types'
import { BaseDetector } from './detectors/base'
import { ScoreCalculator } from './score-calculator'
import { detectApiFormat } from '@/lib/api-client/smart-client'

// 导入所有检测器
import { MetadataDetector } from './detectors/metadata'
import { ProviderAuthenticityDetector } from './detectors/provider-authenticity'
import { ModelCatalogDetector } from './detectors/model-catalog'
import { OpenAIResponsesFingerprintDetector } from './detectors/openai-responses-fingerprint'
import { RandomizedChallengeDetector } from './detectors/randomized-challenge'
import { IdentityConsistencyDetector } from './detectors/identity-consistency'
import { KnowledgeCutoffDetector } from './detectors/knowledge-cutoff'
import { MagicStringDetector } from './detectors/magic-string'
import { ThinkingBlockDetector } from './detectors/thinking-block'
import { OutputFormatDetector } from './detectors/output-format'
import { ReasoningBenchmarkDetector } from './detectors/reasoning-benchmark'
import { LatencyProfileDetector } from './detectors/latency-profile'

/**
 * 检测编排器
 * 负责协调所有检测器的执行和结果汇总
 */
export class DetectionOrchestrator {
  private readonly detectors: BaseDetector[]

  constructor() {
    this.detectors = [
      new MetadataDetector(),
      new ProviderAuthenticityDetector(),
      new ModelCatalogDetector(),
      new OpenAIResponsesFingerprintDetector(),
      new RandomizedChallengeDetector(),
      new MagicStringDetector(),
      new IdentityConsistencyDetector(),
      new KnowledgeCutoffDetector(),
      new ThinkingBlockDetector(),
      new OutputFormatDetector(),
      new ReasoningBenchmarkDetector(),
      new LatencyProfileDetector(),
    ]
  }

  /**
   * 运行所有适用的检测器
   * 先自动探测 API 格式，再逐一执行检测器
   */
  async *run(config: VerificationConfig): AsyncGenerator<DetectionEvent> {
    const startTime = Date.now()

    // 自动探测 API 格式
    yield { type: 'detector:progress', detector: 'system', message: '正在探测 API 格式...' }
    try {
      const detectedFormat = await detectApiFormat(config.endpoint, config.apiKey, config.model)
      config.apiFormat = detectedFormat
      yield {
        type: 'detector:progress',
        detector: 'system',
        message: `API 格式探测完成: ${detectedFormat === 'anthropic' ? 'Anthropic 原生格式' : 'OpenAI 兼容格式'}`,
      }
    } catch {
      config.apiFormat = 'openai' // 默认使用 OpenAI 兼容格式
      yield {
        type: 'detector:progress',
        detector: 'system',
        message: 'API 格式探测失败，使用默认 OpenAI 兼容格式',
      }
    }

    const applicable = this.detectors.filter(d => d.supports(config.model))

    yield { type: 'started', totalDetectors: applicable.length }

    const results: DetectorResult[] = []

    for (let i = 0; i < applicable.length; i++) {
      const detector = applicable[i]

      yield {
        type: 'detector:start',
        detector: detector.name,
        displayName: detector.displayName,
        index: i + 1,
      }

      try {
        const result = await detector.detect(config, () => {
          // 进度回调 - 检测器可以通过此回调报告内部进度
          // 如需实时反馈，可扩展为 yield { type: 'detector:progress', message }
        })
        results.push(result)
        yield { type: 'detector:complete', result }
      } catch (error) {
        // 检测器执行异常，记录为跳过（不计入总分）
        const errorResult: DetectorResult = {
          detectorName: detector.name,
          displayName: detector.displayName,
          score: 0,
          maxScore: 0,  // skip 不计入分母
          status: 'skip',
          details: { error: error instanceof Error ? error.message : String(error) },
          findings: [`检测器执行异常，已跳过: ${error instanceof Error ? error.message : '未知错误'}`],
        }
        results.push(errorResult)
        yield { type: 'detector:complete', result: errorResult }
      }
    }

    yield { type: 'scoring', message: '正在计算综合评分...' }

    const durationMs = Date.now() - startTime
    const report = ScoreCalculator.compute(config, results, durationMs)

    yield { type: 'complete', report }
  }
}
