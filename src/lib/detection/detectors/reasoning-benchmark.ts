import { BaseDetector } from './base'
import type { DetectorResult, VerificationConfig } from '../types'
import { SmartClient } from '@/lib/api-client/smart-client'
import {
  BENCHMARK_QUESTION_POOL,
  BENCHMARK_SAMPLE_SIZE,
  sampleQuestions,
} from '../constants/benchmark-questions'
import type { BenchmarkQuestion } from '../constants/benchmark-questions'

/**
 * 推理基准检测器
 * 使用已知正确答案的困难问题测试模型的真实推理能力
 * 真正的高端模型（如 Opus 4.6）能正确回答这些问题，而廉价替代模型通常会给出错误答案
 */
export class ReasoningBenchmarkDetector extends BaseDetector {
  readonly name = 'reasoning-benchmark'
  readonly displayName = '推理能力基准测试'
  readonly maxScore = 15
  readonly description = '使用高难度推理题测试模型真实能力，并对比已知正确答案'

  supports(): boolean {
    return true
  }

  async detect(config: VerificationConfig, onProgress: (message: string) => void): Promise<DetectorResult> {
    const findings: string[] = []
    let score = 0

    try {
      const client = new SmartClient(config.endpoint, config.apiKey, config.apiFormat ?? 'openai')

      // 从题库随机抽题（参数化题目会实例化为具体数值）
      const selectedQuestions = sampleQuestions(BENCHMARK_QUESTION_POOL, BENCHMARK_SAMPLE_SIZE)

      // 每道题分配的分数
      const scorePerQuestion = Math.floor(this.maxScore / selectedQuestions.length)
      const remainingScore = this.maxScore - scorePerQuestion * selectedQuestions.length

      for (let i = 0; i < selectedQuestions.length; i++) {
        const question = selectedQuestions[i]
        const questionMaxScore = scorePerQuestion + (i === 0 ? remainingScore : 0)

        onProgress(`正在测试推理题 ${i + 1}/${selectedQuestions.length}: ${question.id}...`)

        const result = await this.testQuestion(client, config.model, question, questionMaxScore)
        score += result.score
        findings.push(...result.findings)
      }

      if (score >= this.maxScore * 0.8) {
        return this.pass(score, findings, { questionsCount: selectedQuestions.length })
      }
      return this.fail(score, findings, { questionsCount: selectedQuestions.length })
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      return this.skip(`推理基准检测无法执行: ${message}`)
    }
  }

  /**
   * 测试单道推理题
   */
  private async testQuestion(
    client: SmartClient,
    model: string,
    question: BenchmarkQuestion,
    questionMaxScore: number
  ): Promise<{ score: number; findings: string[] }> {
    const findings: string[] = []
    let score = 0

    const startTime = Date.now()

    try {
      const response = await client.send({
        model,
        messages: [{ role: 'user', content: question.question }],
        max_tokens: 4000,
      })
      const elapsed = Date.now() - startTime
      const answer = response.text.trim()

      // 分析1: 答案正确性（占题目分数的 60%）
      const correctnessMaxScore = Math.ceil(questionMaxScore * 0.6)
      const correctnessResult = this.analyzeAnswer(answer, question, correctnessMaxScore)
      score += correctnessResult.score
      findings.push(...correctnessResult.findings)

      // 分析2: 响应时间合理性（占题目分数的 40%）
      const timingMaxScore = questionMaxScore - correctnessMaxScore
      const timingResult = this.analyzeResponseTime(elapsed, question, timingMaxScore)
      score += timingResult.score
      findings.push(...timingResult.findings)
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      findings.push(`推理题 ${question.id} 测试失败: ${message.slice(0, 100)}`)
    }

    return { score, findings }
  }

  /**
   * 分析答案正确性
   */
  private analyzeAnswer(
    answer: string,
    question: BenchmarkQuestion,
    maxScore: number
  ): { score: number; findings: string[] } {
    const findings: string[] = []
    let score = 0
    const expectedStr = String(question.expectedAnswer)

    if (typeof question.expectedAnswer === 'number') {
      // 数值型答案 - 从响应中提取数字
      const numbers = answer.match(/\d+/g)?.map(Number) ?? []
      const containsCorrect = numbers.includes(question.expectedAnswer)

      // 检查最终答案位置（通常在最后提到的数字）
      const lastNumber = numbers.length > 0 ? numbers[numbers.length - 1] : null
      const isLastCorrect = lastNumber === question.expectedAnswer

      if (isLastCorrect) {
        score += maxScore
        findings.push(`推理题 [${question.id}] 正确: 最终答案 ${lastNumber} = 期望值 ${question.expectedAnswer}`)
      } else if (containsCorrect) {
        score += Math.ceil(maxScore * 0.7)
        findings.push(`推理题 [${question.id}] 部分正确: 响应中包含正确答案 ${question.expectedAnswer}，但最终答案为 ${lastNumber}`)
      } else {
        // 检查是否给出了常见错误答案
        const gaveCommonWrong = question.commonWrongAnswers.some((wrong) =>
          numbers.includes(Number(wrong))
        )

        if (gaveCommonWrong) {
          findings.push(`推理题 [${question.id}] 错误: 给出了已知的常见错误答案（期望 ${question.expectedAnswer}）\u2014 模型可能是较弱的替代品`)
        } else {
          findings.push(`推理题 [${question.id}] 错误: 答案不匹配（期望 ${question.expectedAnswer}，响应中的数字: ${numbers.slice(0, 5).join(', ')}）`)
        }
      }
    } else {
      // 字符串型答案 - 模糊匹配
      const lowerAnswer = answer.toLowerCase()
      const lowerExpected = expectedStr.toLowerCase()

      if (lowerAnswer.includes(lowerExpected)) {
        score += maxScore
        findings.push(`推理题 [${question.id}] 正确: 响应包含期望关键词"${expectedStr}"`)
      } else {
        // 检查关键概念
        const keyTerms = this.extractKeyTerms(question)
        const matchedTerms = keyTerms.filter((term) => lowerAnswer.includes(term.toLowerCase()))

        if (matchedTerms.length > 0) {
          score += Math.ceil(maxScore * 0.5)
          findings.push(`推理题 [${question.id}] 部分正确: 包含相关概念 [${matchedTerms.join(', ')}]，但未包含核心答案"${expectedStr}"`)
        } else {
          // 检查常见错误答案
          const gaveCommonWrong = question.commonWrongAnswers.some((wrong) =>
            lowerAnswer.includes(String(wrong).toLowerCase())
          )

          if (gaveCommonWrong) {
            findings.push(`推理题 [${question.id}] 错误: 给出了常见错误答案 \u2014 模型推理能力不足`)
          } else {
            findings.push(`推理题 [${question.id}] 错误: 未包含期望答案"${expectedStr}"`)
          }
        }
      }
    }

    return { score, findings }
  }

  /**
   * 分析响应时间合理性
   */
  private analyzeResponseTime(
    elapsedMs: number,
    question: BenchmarkQuestion,
    maxScore: number
  ): { score: number; findings: string[] } {
    const findings: string[] = []
    let score = 0

    if (question.difficulty === 'hard') {
      // 困难题目，真正的模型应该需要较长思考时间
      if (elapsedMs >= question.expectedMinThinkingTime) {
        score += maxScore
        findings.push(`响应时间合理: ${(elapsedMs / 1000).toFixed(1)}s（困难题期望 \u2265${(question.expectedMinThinkingTime / 1000).toFixed(0)}s）`)
      } else if (elapsedMs >= question.expectedMinThinkingTime * 0.3) {
        score += Math.ceil(maxScore * 0.5)
        findings.push(`响应时间偏短: ${(elapsedMs / 1000).toFixed(1)}s（困难题期望 \u2265${(question.expectedMinThinkingTime / 1000).toFixed(0)}s），可能使用了较简单的推理路径`)
      } else {
        findings.push(`响应时间过短: ${(elapsedMs / 1000).toFixed(1)}s（困难题期望 \u2265${(question.expectedMinThinkingTime / 1000).toFixed(0)}s）\u2014 可能是缓存/预计算的响应`)
      }
    } else {
      // 简单/中等题目，时间要求较宽松
      if (elapsedMs >= 1000) {
        score += maxScore
        findings.push(`响应时间: ${(elapsedMs / 1000).toFixed(1)}s`)
      } else {
        score += Math.ceil(maxScore * 0.5)
        findings.push(`响应时间较短: ${elapsedMs}ms`)
      }
    }

    return { score, findings }
  }

  /** 从问题中提取关键概念词 */
  private extractKeyTerms(question: BenchmarkQuestion): string[] {
    switch (question.id) {
      case 'color-blind-riddle':
        return ['色盲', 'X染色体', '隐性遗传', '不是亲生', '遗传', 'X-linked']
      case 'candy-combinatorics':
        return ['抽屉原理', '最坏情况', '鸽巢']
      default:
        return []
    }
  }
}
