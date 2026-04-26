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

  it('声称高阶 GPT 但同厂返回更低档 GPT 时标记为致命掺假信号', () => {
    const signals = analyzeProviderMetadata({
      claimedModel: 'gpt-5.5',
      apiFormat: 'openai',
      body: {
        id: 'chatcmpl-123',
        object: 'chat.completion',
        model: 'gpt-4o',
        choices: [{ message: { content: 'OK' } }],
      },
      headers: {
        'x-request-id': 'req_abc',
      },
    })

    expect(signals).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          id: 'returned-model-family-mismatch',
          severity: 'fatal',
        }),
      ])
    )
  })

  it('Claude 最新别名和快照模型号一致时不误判为掺假', () => {
    const signals = analyzeProviderMetadata({
      claimedModel: 'claude-sonnet-4-6',
      apiFormat: 'anthropic',
      body: {
        id: 'msg_01ABC',
        type: 'message',
        model: 'claude-sonnet-4-6-20260210',
        content: [{ type: 'text', text: 'OK' }],
        stop_reason: 'end_turn',
        usage: { input_tokens: 8, output_tokens: 2 },
      },
      headers: {
        'request-id': 'req_abc',
      },
    })

    expect(signals.some((signal) => signal.id === 'returned-model-family-mismatch')).toBe(false)
    expect(signals).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          id: 'returned-model-identity-match',
          severity: 'strong',
          polarity: 'positive',
        }),
      ])
    )
  })

  it('声称 Claude Opus 但同厂返回 Claude Sonnet 时标记为致命掺假信号', () => {
    const signals = analyzeProviderMetadata({
      claimedModel: 'claude-opus-4-7',
      apiFormat: 'anthropic',
      body: {
        id: 'msg_01ABC',
        type: 'message',
        model: 'claude-sonnet-4-5-20250929',
        content: [{ type: 'text', text: 'OK' }],
        stop_reason: 'end_turn',
        usage: { input_tokens: 8, output_tokens: 2 },
      },
      headers: {
        'request-id': 'req_abc',
      },
    })

    expect(signals).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          id: 'returned-model-family-mismatch',
          severity: 'fatal',
        }),
      ])
    )
  })

  it('官方快照模型号与基础模型一致时不误判为掺假', () => {
    const signals = analyzeProviderMetadata({
      claimedModel: 'gpt-4o',
      apiFormat: 'openai',
      body: {
        id: 'chatcmpl-123',
        object: 'chat.completion',
        model: 'gpt-4o-2024-08-06',
        choices: [{ message: { content: 'OK' } }],
      },
      headers: {
        'x-request-id': 'req_abc',
      },
    })

    expect(signals.some((signal) => signal.id === 'returned-model-family-mismatch')).toBe(false)
    expect(signals).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          id: 'returned-model-identity-match',
          severity: 'strong',
          polarity: 'positive',
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
