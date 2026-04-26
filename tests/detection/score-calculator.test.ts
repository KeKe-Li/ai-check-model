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

  it('同厂返回不同档位模型时，也按掺假封顶为极低可信', () => {
    const report = ScoreCalculator.compute(
      { ...config, model: 'gpt-5.5' },
      [
        result({
          details: {
            authenticitySignals: [
              {
                id: 'returned-model-family-mismatch',
                severity: 'fatal',
                polarity: 'negative',
                message: '响应 model 字段为 gpt-4o，和声称的 gpt-5.5 不是同一模型档位',
                evidence: {
                  returnedModel: 'gpt-4o',
                },
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
    expect(report.modelDetected).toBe('gpt-4o')
    expect(report.verdict).toContain('掺假')
  })

  it('OpenAI 官方指纹和 Responses 指纹都弱时，即使行为检测高分也封顶', () => {
    const report = ScoreCalculator.compute(
      { ...config, model: 'gpt-5.5' },
      [
        result({ detectorName: 'metadata', score: 15, maxScore: 15 }),
        result({
          detectorName: 'provider-authenticity',
          displayName: '官方来源指纹检测',
          score: 4,
          maxScore: 25,
          status: 'fail',
          findings: [],
          details: {
            authenticitySignals: [
              {
                id: 'openai-logprobs-missing',
                severity: 'strong',
                polarity: 'negative',
                message: '缺少 OpenAI 官方能力指纹',
              },
            ],
          },
        }),
        result({
          detectorName: 'openai-responses-fingerprint',
          displayName: 'OpenAI Responses 指纹检测',
          score: 0,
          maxScore: 15,
          status: 'fail',
          findings: [],
          details: {
            authenticitySignals: [
              {
                id: 'openai-responses-api-unavailable',
                severity: 'strong',
                polarity: 'negative',
                message: 'Responses API 不可用',
              },
            ],
          },
        }),
        result({ detectorName: 'identity-consistency', score: 20, maxScore: 20 }),
        result({ detectorName: 'reasoning-benchmark', score: 15, maxScore: 15 }),
      ],
      1000
    )

    expect(report.totalScore).toBeLessThanOrEqual(59)
    expect(report.confidenceLevel).not.toBe('HIGH')
    expect(report.authenticity?.scoreCapApplied).toBe(59)
    expect(report.verdict).toContain('官方')
  })

  it('缺少官方关键检测结果时，不能只靠行为高分宣称真实不掺假', () => {
    const report = ScoreCalculator.compute(
      config,
      [
        result({ detectorName: 'metadata', score: 15, maxScore: 15 }),
        result({ detectorName: 'identity-consistency', score: 20, maxScore: 20 }),
        result({ detectorName: 'reasoning-benchmark', score: 15, maxScore: 15 }),
      ],
      1000
    )

    expect(report.confidenceLevel).not.toBe('HIGH')
    expect(report.authenticity?.verdict).toBe('suspicious')
    expect(report.authenticity?.scoreCapApplied).toBe(59)
    expect(report.verdict).toContain('不能判定为不掺假')
    expect(report.verdict).not.toContain('大概率提供真实')
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
