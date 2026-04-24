import { BaseDetector } from './base'
import type { DetectorResult, VerificationConfig } from '../types'
import { getProviderFromModel } from '../types'
import type { ModelProvider } from '../types'
import { SmartClient } from '@/lib/api-client/smart-client'

/** 已知提供商的典型延迟范围（毫秒） */
const LATENCY_BASELINES: Record<ModelProvider, { ttfbMin: number; ttfbMax: number; ttfbSuspiciousHigh: number }> = {
  anthropic: { ttfbMin: 300, ttfbMax: 3000, ttfbSuspiciousHigh: 10000 },
  openai: { ttfbMin: 200, ttfbMax: 2000, ttfbSuspiciousHigh: 8000 },
  gemini: { ttfbMin: 200, ttfbMax: 2500, ttfbSuspiciousHigh: 8000 },
}

/**
 * 延迟特征检测器
 * 通过测量请求延迟特征来检测代理中间层
 * 异常高的延迟暗示请求经过了额外的代理转发
 * 异常低的复杂任务延迟暗示使用了缓存/预计算响应
 */
export class LatencyProfileDetector extends BaseDetector {
  readonly name = 'latency-profile'
  readonly displayName = '延迟特征分析'
  readonly maxScore = 5
  readonly description = '测量 TTFB 和总响应时间，检测异常延迟模式'

  supports(): boolean {
    return true
  }

  async detect(config: VerificationConfig, onProgress: (message: string) => void): Promise<DetectorResult> {
    const provider = getProviderFromModel(config.model)
    const findings: string[] = []
    let score = 0

    try {
      const client = new SmartClient(config.endpoint, config.apiKey, config.apiFormat ?? 'openai')

      // 测试1: 简单请求延迟（3分）
      onProgress('正在测量简单请求延迟...')
      const simpleResult = await this.measureSimpleRequest(client, config.model, provider)
      score += simpleResult.score
      findings.push(...simpleResult.findings)

      // 测试2: 流式请求 TTFB 测量（2分）
      onProgress('正在测量流式请求 TTFB...')
      const streamResult = await this.measureStreamingTTFB(client, config.model, provider)
      score += streamResult.score
      findings.push(...streamResult.findings)

      if (score >= this.maxScore * 0.8) {
        return this.pass(score, findings, { provider })
      }
      return this.fail(score, findings, { provider })
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      return this.skip(`延迟检测无法执行: ${message}`)
    }
  }

  /**
   * 测量简单请求的往返延迟（3分）
   */
  private async measureSimpleRequest(
    client: SmartClient,
    model: string,
    provider: ModelProvider
  ): Promise<{ score: number; findings: string[] }> {
    const findings: string[] = []
    let score = 0
    const baseline = LATENCY_BASELINES[provider]

    const startTime = Date.now()

    try {
      await client.send({
        model,
        messages: [{ role: 'user', content: '回复OK' }],
        max_tokens: 10,
      })

      const elapsed = Date.now() - startTime

      if (elapsed <= baseline.ttfbMax) {
        score += 3
        findings.push(`简单请求延迟正常: ${elapsed}ms（正常范围 ${baseline.ttfbMin}-${baseline.ttfbMax}ms）`)
      } else if (elapsed <= baseline.ttfbSuspiciousHigh) {
        score += 2
        findings.push(`简单请求延迟偏高: ${elapsed}ms（正常范围 ${baseline.ttfbMin}-${baseline.ttfbMax}ms），可能存在额外网络跳转`)
      } else {
        findings.push(`简单请求延迟异常: ${elapsed}ms（超过警戒线 ${baseline.ttfbSuspiciousHigh}ms）\u2014 存在重度代理中间层`)
      }

      // 极低延迟也可疑（可能是本地缓存）
      if (elapsed < 100) {
        score = Math.max(0, score - 1)
        findings.push(`注意: 延迟极低（${elapsed}ms），可能是缓存响应`)
      }
    } catch (error) {
      const elapsed = Date.now() - startTime
      const message = error instanceof Error ? error.message : String(error)
      findings.push(`简单请求失败（${elapsed}ms）: ${message.slice(0, 80)}`)
    }

    return { score, findings }
  }

  /**
   * 测量流式请求的 TTFB（2分）
   */
  private async measureStreamingTTFB(
    client: SmartClient,
    model: string,
    provider: ModelProvider
  ): Promise<{ score: number; findings: string[] }> {
    const findings: string[] = []
    let score = 0
    const baseline = LATENCY_BASELINES[provider]

    try {
      // 使用流式模式发送请求
      const response = await client.send({
        model,
        messages: [{ role: 'user', content: '说"你好"' }],
        max_tokens: 50,
        stream: true,
      })

      // 从 raw Response 读取流来测量真实 TTFB
      const ttfbResult = await this.readStreamTTFB(response.raw)
      const ttfbMs = ttfbResult.ttfbMs

      if (ttfbMs <= baseline.ttfbMax) {
        score += 2
        findings.push(`流式 TTFB 正常: ${ttfbMs}ms`)
      } else if (ttfbMs <= baseline.ttfbSuspiciousHigh) {
        score += 1
        findings.push(`流式 TTFB 偏高: ${ttfbMs}ms（可能有额外代理层）`)
      } else {
        findings.push(`流式 TTFB 异常: ${ttfbMs}ms \u2014 严重代理开销`)
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      // 流式不支持不应严重扣分
      score += 1
      findings.push(`流式 TTFB 测量失败（可能端点不支持流式）: ${message.slice(0, 80)}`)
    }

    return { score, findings }
  }

  /**
   * 从原始 Response 读取流并测量 TTFB
   */
  private async readStreamTTFB(response: Response): Promise<{ ttfbMs: number }> {
    const startTime = Date.now()

    if (!response.body) {
      // 如果没有 body（非流式响应被当作流式处理），直接返回
      return { ttfbMs: Date.now() - startTime }
    }

    const reader = response.body.getReader()

    try {
      // 读取第一个 chunk 即可得到 TTFB
      const { done } = await reader.read()
      const ttfbMs = Date.now() - startTime

      if (done) {
        return { ttfbMs }
      }

      // 消费剩余数据以释放连接（使用有限循环防止无限读取）
      let chunks = 0
      const maxChunks = 200
      while (chunks < maxChunks) {
        const result = await reader.read()
        if (result.done) break
        chunks++
      }

      // 如果还未读完则取消
      if (chunks >= maxChunks) {
        await reader.cancel()
      }

      return { ttfbMs }
    } catch {
      return { ttfbMs: Date.now() - startTime }
    }
  }
}
