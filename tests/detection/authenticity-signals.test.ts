import { describe, expect, it } from 'vitest'
import {
  analyzeProviderMetadata,
  summarizeSignals,
} from '@/lib/detection/authenticity-signals'

describe('analyzeProviderMetadata', () => {
  it('声称 GPT 但返回 Claude 元数据时标记为致命伪装信号', () => {
    const signals = analyzeProviderMetadata({
      claimedModel: 'gpt-4o',
      apiFormat: 'openai',
      body: {
        id: 'msg_01ABC',
        object: 'chat.completion',
        model: 'claude-sonnet-4-20250514',
        choices: [{ message: { content: 'OK' } }],
      },
      headers: {
        'request-id': 'req_abc',
      },
    })

    expect(signals).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          id: 'returned-model-provider-mismatch',
          severity: 'fatal',
        }),
        expect.objectContaining({
          id: 'response-id-provider-mismatch',
          severity: 'critical',
        }),
      ])
    )
  })

  it('声称 Claude 且经过 OpenAI 兼容层但模型字段仍为 Claude 时不直接误杀', () => {
    const signals = analyzeProviderMetadata({
      claimedModel: 'claude-sonnet-4-20250514',
      apiFormat: 'openai',
      body: {
        id: 'chatcmpl-proxy-123',
        object: 'chat.completion',
        model: 'claude-sonnet-4-20250514',
        choices: [{ message: { content: 'OK' } }],
      },
      headers: {
        'x-request-id': 'req_proxy',
      },
    })

    expect(signals.some((signal) => signal.severity === 'fatal')).toBe(false)
    expect(signals).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          id: 'compatibility-wrapper',
          severity: 'info',
        }),
      ])
    )
  })

  it('摘要只保留强信号以上，便于最终报告展示', () => {
    const summary = summarizeSignals([
      { id: 'a', severity: 'info', message: '普通信息' },
      { id: 'b', severity: 'strong', message: '强阳性/强疑点' },
      { id: 'c', severity: 'fatal', message: '致命证据' },
    ])

    expect(summary).toEqual(['强阳性/强疑点', '致命证据'])
  })
})
