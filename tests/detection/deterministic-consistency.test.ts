import { describe, it, expect } from 'vitest'

/** 复刻 DeterministicConsistencyDetector 的文本相似度算法 */
function textSimilarity(a: string, b: string): number {
  if (a === b) return 1
  if (a.length === 0 || b.length === 0) return 0

  const tokensA = new Set(a.split(/\s+/))
  const tokensB = new Set(b.split(/\s+/))
  const intersection = [...tokensA].filter((t) => tokensB.has(t)).length
  const union = new Set([...tokensA, ...tokensB]).size

  return union > 0 ? intersection / union : 0
}

describe('textSimilarity', () => {
  it('完全相同返回 1', () => {
    expect(textSimilarity('2, 3, 5, 7, 11', '2, 3, 5, 7, 11')).toBe(1)
  })

  it('完全不同返回 0', () => {
    expect(textSimilarity('hello world', 'foo bar baz')).toBe(0)
  })

  it('部分重叠返回 0-1 之间的值', () => {
    const sim = textSimilarity('the quick brown fox', 'the slow brown dog')
    expect(sim).toBeGreaterThan(0)
    expect(sim).toBeLessThan(1)
  })

  it('空字符串返回 0', () => {
    expect(textSimilarity('', 'hello')).toBe(0)
    expect(textSimilarity('hello', '')).toBe(0)
    expect(textSimilarity('', '')).toBe(1)
  })
})

describe('model 字段一致性分析', () => {
  function analyzeModelConsistency(models: string[]): { consistent: boolean; uniqueModels: string[] } {
    const uniqueModels = [...new Set(models)]
    return { consistent: uniqueModels.length <= 1, uniqueModels }
  }

  it('3次相同模型名 — 一致', () => {
    const result = analyzeModelConsistency(['gpt-4o', 'gpt-4o', 'gpt-4o'])
    expect(result.consistent).toBe(true)
  })

  it('出现不同模型名 — 不一致（负载均衡嫌疑）', () => {
    const result = analyzeModelConsistency(['gpt-4o', 'gpt-4o-mini', 'gpt-4o'])
    expect(result.consistent).toBe(false)
    expect(result.uniqueModels).toContain('gpt-4o-mini')
  })

  it('完全不同模型 — 严重不一致', () => {
    const result = analyzeModelConsistency(['claude-opus-4-6', 'deepseek-v3', 'gpt-4o'])
    expect(result.consistent).toBe(false)
    expect(result.uniqueModels).toHaveLength(3)
  })
})
