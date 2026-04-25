import { describe, expect, it } from 'vitest'
import { ScoreCalculator } from '@/lib/detection/score-calculator'
import type { DetectorResult, VerificationConfig } from '@/lib/detection/types'

const config: VerificationConfig = {
  endpoint: 'https://relay.example.com/v1',
  apiKey: 'sk-test',
  model: 'gpt-4o',
  jobId: 'job-1',
  apiFormat: 'openai',
}

function result(overrides: Partial<DetectorResult>): DetectorResult {
  return {
    detectorName: 'metadata',
    displayName: '响应元数据分析',
    score: 95,
    maxScore: 100,
    status: 'pass',
    findings: [],
    details: {},
    ...overrides,
  }
}

describe('ScoreCalculator authenticity caps', () => {
  it('存在 fatal 真实性信号时，即使原始分很高也封顶为极低可信', () => {
    const report = ScoreCalculator.compute(
      config,
      [
        result({
          details: {
            authenticitySignals: [
              {
                id: 'returned-model-provider-mismatch',
                severity: 'fatal',
                message: '声称 GPT，但 model 字段显示 Claude',
              },
            ],
          },
        }),
        result({
          detectorName: 'identity-consistency',
          displayName: '身份一致性检测',
        }),
      ],
      1200
    )

    expect(report.totalScore).toBeLessThanOrEqual(34)
    expect(report.confidenceLevel).toBe('VERY_LOW')
    expect(report.verdict).toContain('致命')
    expect(report.authenticity?.scoreCapApplied).toBe(34)
  })

  it('Claude 关键检测同时失败时封顶到中低可信，避免被非关键检测抬高', () => {
    const report = ScoreCalculator.compute(
      { ...config, model: 'claude-sonnet-4-20250514' },
      [
        result({
          detectorName: 'metadata',
          score: 15,
          maxScore: 15,
        }),
        result({
          detectorName: 'magic-string',
          displayName: '魔术字符串验证',
          score: 0,
          maxScore: 20,
          status: 'fail',
        }),
        result({
          detectorName: 'thinking-block',
          displayName: '扩展思考验证',
          score: 2,
          maxScore: 20,
          status: 'fail',
        }),
        result({
          detectorName: 'identity-consistency',
          score: 20,
          maxScore: 20,
        }),
      ],
      2400
    )

    expect(report.totalScore).toBeLessThanOrEqual(59)
    expect(report.confidenceLevel).not.toBe('HIGH')
    expect(report.authenticity?.scoreCapApplied).toBe(59)
  })
})
