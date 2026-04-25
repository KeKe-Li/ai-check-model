import { describe, expect, it } from 'vitest'
import { analyzeOpenAIResponsesFingerprint } from '@/lib/detection/detectors/openai-responses-fingerprint'

describe('analyzeOpenAIResponsesFingerprint', () => {
  it('识别 OpenAI Responses API 的官方响应形态', () => {
    const result = analyzeOpenAIResponsesFingerprint({
      claimedModel: 'gpt-4o',
      status: 200,
      body: {
        id: 'resp_abc123',
        object: 'response',
        model: 'gpt-4o-2024-08-06',
        output: [{ type: 'message', content: [{ type: 'output_text', text: 'OK' }] }],
        usage: { input_tokens: 8, output_tokens: 2, total_tokens: 10 },
      },
      headers: {
        'x-request-id': 'req_abc',
      },
    })

    expect(result.score).toBeGreaterThanOrEqual(12)
    expect(result.signals).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          id: 'openai-responses-shape-present',
          polarity: 'positive',
        }),
      ])
    )
  })

  it('Responses API 缺失时标记为兼容但未验证，不直接当作 fatal', () => {
    const result = analyzeOpenAIResponsesFingerprint({
      claimedModel: 'gpt-4o',
      status: 404,
      body: { error: { message: 'not found' } },
      headers: {},
    })

    expect(result.score).toBe(0)
    expect(result.signals).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          id: 'openai-responses-api-unavailable',
          severity: 'strong',
          polarity: 'negative',
        }),
      ])
    )
    expect(result.signals.some((signal) => signal.severity === 'fatal')).toBe(false)
  })
})
