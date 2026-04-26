import { describe, expect, it } from 'vitest'
import { analyzeModelCatalogFingerprint } from '@/lib/detection/detectors/model-catalog'
import { SUPPORTED_MODELS } from '@/lib/detection/types'

describe('SUPPORTED_MODELS 官方模型清单', () => {
  it('包含当前主力 GPT/Claude 型号，覆盖最新高阶模型和常用稳定模型', () => {
    const modelIds = SUPPORTED_MODELS.map((model) => model.id)

    expect(modelIds).toEqual(
      expect.arrayContaining([
        'gpt-5.5',
        'gpt-5.4',
        'gpt-4o',
        'claude-opus-4-7',
        'claude-opus-4-6',
        'claude-sonnet-4-6',
      ])
    )
  })
})

describe('analyzeModelCatalogFingerprint', () => {
  it('模型目录返回同一 GPT 档位时给强正向证据', () => {
    const result = analyzeModelCatalogFingerprint({
      claimedModel: 'gpt-5.5',
      status: 200,
      body: {
        id: 'gpt-5.5-20260420',
        object: 'model',
      },
    })

    expect(result.score).toBeGreaterThanOrEqual(8)
    expect(result.signals).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          id: 'model-catalog-identity-match',
          severity: 'strong',
          polarity: 'positive',
        }),
      ])
    )
  })

  it('模型目录把高阶 GPT 解析成低档 GPT 时标记为 fatal', () => {
    const result = analyzeModelCatalogFingerprint({
      claimedModel: 'gpt-5.5',
      status: 200,
      body: {
        id: 'gpt-4o',
        object: 'model',
      },
    })

    expect(result.score).toBe(0)
    expect(result.signals).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          id: 'model-catalog-family-mismatch',
          severity: 'fatal',
          polarity: 'negative',
        }),
      ])
    )
  })

  it('模型目录不支持时只标记强疑点，不直接误杀为假模型', () => {
    const result = analyzeModelCatalogFingerprint({
      claimedModel: 'gpt-5.5',
      status: 404,
      body: {
        error: { message: 'not found' },
      },
    })

    expect(result.score).toBe(0)
    expect(result.signals).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          id: 'model-catalog-unavailable',
          severity: 'strong',
          polarity: 'negative',
        }),
      ])
    )
    expect(result.signals.some((signal) => signal.severity === 'fatal')).toBe(false)
  })
})
