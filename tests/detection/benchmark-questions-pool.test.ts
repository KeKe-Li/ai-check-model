import { describe, it, expect } from 'vitest'
import {
  BENCHMARK_QUESTION_POOL,
  BENCHMARK_SAMPLE_SIZE,
  sampleQuestions,
  instantiateQuestion,
  KNOWLEDGE_QUESTION_POOL,
  sampleKnowledgeQuestions,
} from '@/lib/detection/constants/benchmark-questions'

describe('BENCHMARK_QUESTION_POOL', () => {
  it('题库包含至少 15 道题', () => {
    expect(BENCHMARK_QUESTION_POOL.length).toBeGreaterThanOrEqual(15)
  })

  it('每道题都有唯一 ID', () => {
    const ids = BENCHMARK_QUESTION_POOL.map((q) => q.id)
    const uniqueIds = new Set(ids)
    expect(uniqueIds.size).toBe(ids.length)
  })

  it('默认抽样数量为 3', () => {
    expect(BENCHMARK_SAMPLE_SIZE).toBe(3)
  })
})

describe('sampleQuestions', () => {
  it('抽取指定数量的题目', () => {
    const questions = sampleQuestions(BENCHMARK_QUESTION_POOL, 3)
    expect(questions).toHaveLength(3)
  })

  it('抽取的题目都是有效的 BenchmarkQuestion', () => {
    const questions = sampleQuestions(BENCHMARK_QUESTION_POOL, 5)
    for (const q of questions) {
      expect(q.id).toBeDefined()
      expect(q.question).toBeDefined()
      expect(q.expectedAnswer).toBeDefined()
      expect(q.difficulty).toBeDefined()
    }
  })

  it('参数化题目被正确实例化（question 中不含 {N} 占位符）', () => {
    const parameterized = BENCHMARK_QUESTION_POOL.filter((q) => 'parameterized' in q)
    expect(parameterized.length).toBeGreaterThan(0)

    for (const q of parameterized) {
      const instance = instantiateQuestion(q)
      expect(instance.question).not.toContain('{N}')
      expect(instance.expectedAnswer).toBeDefined()
    }
  })

  it('多次抽样结果不完全相同（随机性）', () => {
    const results: string[][] = []
    for (let i = 0; i < 5; i++) {
      results.push(sampleQuestions(BENCHMARK_QUESTION_POOL, 3).map((q) => q.id))
    }
    const allSame = results.every((r) =>
      r.length === results[0].length && r.every((id, idx) => id === results[0][idx])
    )
    // 5 次中不太可能全部相同（题库 15+ 题选 3 题）
    expect(allSame).toBe(false)
  })
})

describe('KNOWLEDGE_QUESTION_POOL', () => {
  it('知识题库包含至少 5 道题', () => {
    expect(KNOWLEDGE_QUESTION_POOL.length).toBeGreaterThanOrEqual(5)
  })

  it('sampleKnowledgeQuestions 返回指定数量', () => {
    const questions = sampleKnowledgeQuestions(2)
    expect(questions).toHaveLength(2)
  })

  it('每道题都有 expectedPatterns', () => {
    for (const q of KNOWLEDGE_QUESTION_POOL) {
      expect(q.expectedPatterns).toBeDefined()
      expect(typeof q.expectedPatterns).toBe('object')
    }
  })
})
