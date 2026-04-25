import { describe, expect, it } from 'vitest'
import {
  analyzeClaudeThinkingBlocks,
  analyzeClaudeRedactedThinking,
} from '@/lib/detection/claude-thinking-analysis'

describe('Claude thinking analysis', () => {
  it('识别带 signature 的 Claude thinking block', () => {
    const result = analyzeClaudeThinkingBlocks([
      {
        type: 'thinking',
        thinking: '我需要先计算 17 × 23，然后给出答案 391。',
        signature: 'EqQBCgIYAhIM1h2long-signature-for-test',
      },
    ])

    expect(result.hasThinking).toBe(true)
    expect(result.hasSignature).toBe(true)
    expect(result.score).toBeGreaterThanOrEqual(8)
    expect(result.findings).toEqual(
      expect.arrayContaining([
        expect.stringContaining('signature'),
      ])
    )
  })

  it('识别 redacted_thinking 块，而不是只匹配文本 [redacted]', () => {
    const result = analyzeClaudeRedactedThinking([
      {
        type: 'redacted_thinking',
        data: 'EmwKAhgBEgy3redacted-data-for-test',
      },
    ])

    expect(result.hasRedactedThinking).toBe(true)
    expect(result.score).toBe(8)
  })
})
