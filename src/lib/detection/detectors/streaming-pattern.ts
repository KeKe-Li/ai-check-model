import { BaseDetector } from './base'
import type { AuthenticitySignal, DetectorResult, VerificationConfig } from '../types'
import { getProviderFromModel } from '../types'
import type { ApiFormat, ModelProvider } from '../types'

/**
 * Streaming 模式特征检测器
 *
 * 分析 streaming 响应的 chunk 大小分布、时间间隔和 SSE 事件格式。
 * 真正的模型有独特的 token 产出节奏，代理层转发会改变这些模式。
 */
export class StreamingPatternDetector extends BaseDetector {
  readonly name = 'streaming-pattern'
  readonly displayName = 'Streaming 模式特征检测'
  readonly maxScore = 12
  readonly description = '分析 streaming 响应的 chunk 模式和 SSE 事件格式'

  supports(): boolean {
    return true
  }

  async detect(config: VerificationConfig, onProgress: (message: string) => void): Promise<DetectorResult> {
    const provider = getProviderFromModel(config.model)
    const apiFormat = config.apiFormat ?? 'openai'
    const findings: string[] = []
    const signals: AuthenticitySignal[] = []
    let score = 0

    try {
      // 测试1: SSE 事件格式验证（5分）
      onProgress('正在分析 SSE 事件格式...')
      const formatResult = await this.testSSEFormat(config, provider, apiFormat)
      score += formatResult.score
      findings.push(...formatResult.findings)
      signals.push(...formatResult.signals)

      // 测试2: Token 产出节奏分析（4分）
      onProgress('正在分析 token 产出节奏...')
      const rhythmResult = await this.testTokenRhythm(config, provider, apiFormat)
      score += rhythmResult.score
      findings.push(...rhythmResult.findings)
      signals.push(...rhythmResult.signals)

      // 测试3: Chunk 大小分布（3分）
      onProgress('正在分析 chunk 大小分布...')
      score += rhythmResult.chunkScore
      findings.push(...rhythmResult.chunkFindings)

      const details = { provider, apiFormat, authenticitySignals: signals }

      if (score >= this.maxScore * 0.6) {
        return this.pass(score, findings, details)
      }
      return this.fail(score, findings, details)
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      return this.skip(`Streaming 检测无法执行: ${message}`)
    }
  }

  /** 发送 streaming 请求并收集原始 SSE 数据 */
  private async collectStreamData(
    config: VerificationConfig,
    apiFormat: ApiFormat,
    prompt: string
  ): Promise<{ chunks: Array<{ data: string; timestamp: number; size: number }>; totalTime: number } | null> {
    const baseUrl = config.endpoint.endsWith('/') ? config.endpoint.slice(0, -1) : config.endpoint
    const url = apiFormat === 'anthropic'
      ? `${baseUrl.replace(/\/v1$/, '')}/v1/messages`
      : `${baseUrl.replace(/\/v1$/, '')}/v1/chat/completions`

    const headers: Record<string, string> = { 'content-type': 'application/json' }
    if (apiFormat === 'anthropic') {
      headers['x-api-key'] = config.apiKey
      headers['anthropic-version'] = '2023-06-01'
    } else {
      headers['authorization'] = `Bearer ${config.apiKey}`
    }

    const body = apiFormat === 'anthropic'
      ? { model: config.model, messages: [{ role: 'user', content: prompt }], max_tokens: 150, stream: true }
      : { model: config.model, messages: [{ role: 'user', content: prompt }], max_tokens: 150, stream: true }

    const startTime = Date.now()
    const response = await fetch(url, { method: 'POST', headers, body: JSON.stringify(body) })

    if (!response.ok || !response.body) return null

    const reader = response.body.getReader()
    const decoder = new TextDecoder()
    const chunks: Array<{ data: string; timestamp: number; size: number }> = []
    let readCount = 0
    const maxReads = 100

    try {
      while (readCount < maxReads) {
        const { done, value } = await reader.read()
        if (done) break
        readCount++

        const text = decoder.decode(value, { stream: true })
        chunks.push({
          data: text,
          timestamp: Date.now() - startTime,
          size: value.byteLength,
        })
      }

      if (readCount >= maxReads) {
        await reader.cancel()
      }
    } catch {
      // 流读取异常不影响已收集的数据
    }

    return { chunks, totalTime: Date.now() - startTime }
  }

  /** 测试1: SSE 事件格式 */
  private async testSSEFormat(
    config: VerificationConfig,
    provider: ModelProvider,
    apiFormat: ApiFormat
  ): Promise<{ score: number; findings: string[]; signals: AuthenticitySignal[] }> {
    const findings: string[] = []
    const signals: AuthenticitySignal[] = []
    let score = 0

    const streamData = await this.collectStreamData(config, apiFormat, '请用3句话介绍自己。')
    if (!streamData || streamData.chunks.length < 3) {
      findings.push('SSE 格式测试: 无法收集足够的流式数据')
      return { score: 2, findings, signals }
    }

    const allText = streamData.chunks.map(c => c.data).join('')
    const events = allText.split('\n').filter(line => line.startsWith('data:'))

    if (events.length === 0) {
      findings.push('SSE 格式测试: 响应中未找到 data: 事件行')
      return { score: 0, findings, signals }
    }

    if (apiFormat === 'anthropic') {
      // Anthropic 格式应包含 event: 行和特定事件类型
      const eventTypes = allText.match(/event:\s*(\w+)/g)?.map(e => e.replace('event:', '').trim()) ?? []
      const hasMessageStart = eventTypes.includes('message_start')
      const hasContentDelta = eventTypes.includes('content_block_delta')
      const hasMessageStop = eventTypes.includes('message_stop') || eventTypes.includes('message_delta')

      if (hasMessageStart && hasContentDelta) {
        score += 5
        findings.push(`SSE 格式: Anthropic 事件类型齐全 (${[...new Set(eventTypes)].join(', ')})`)
        signals.push({
          id: 'streaming-sse-anthropic-valid',
          severity: 'strong',
          polarity: 'positive',
          message: 'Streaming SSE 事件格式完全符合 Anthropic 原生规范',
          evidence: { eventTypes: [...new Set(eventTypes)] },
        })
      } else if (hasContentDelta) {
        score += 3
        findings.push(`SSE 格式: 部分 Anthropic 事件类型 (缺少 message_start)`)
      } else {
        score += 1
        findings.push(`SSE 格式: 未检测到 Anthropic 特有事件类型`)
        signals.push({
          id: 'streaming-sse-anthropic-missing',
          severity: 'weak',
          polarity: 'negative',
          message: 'Streaming 缺少 Anthropic 特有事件类型，可能是兼容层转发',
        })
      }
    } else {
      // OpenAI 格式的 data: 应包含 JSON 对象
      const hasValidJson = events.some(e => {
        const jsonStr = e.replace('data:', '').trim()
        if (jsonStr === '[DONE]') return true
        try {
          const parsed = JSON.parse(jsonStr) as Record<string, unknown>
          return 'choices' in parsed || 'id' in parsed
        } catch {
          return false
        }
      })
      const hasDone = allText.includes('data: [DONE]')

      if (hasValidJson && hasDone) {
        score += 5
        findings.push('SSE 格式: OpenAI 格式完整（有效 JSON + [DONE] 终止符）')
        signals.push({
          id: 'streaming-sse-openai-valid',
          severity: 'strong',
          polarity: 'positive',
          message: 'Streaming SSE 事件格式符合 OpenAI 规范',
        })
      } else if (hasValidJson) {
        score += 3
        findings.push('SSE 格式: 有效 JSON 但缺少 [DONE] 终止符')
      } else {
        score += 1
        findings.push('SSE 格式: 数据格式不符合 OpenAI 规范')
      }
    }

    return { score, findings, signals }
  }

  /** 测试2+3: Token 产出节奏和 Chunk 大小分析 */
  private async testTokenRhythm(
    config: VerificationConfig,
    provider: ModelProvider,
    apiFormat: ApiFormat
  ): Promise<{ score: number; findings: string[]; signals: AuthenticitySignal[]; chunkScore: number; chunkFindings: string[] }> {
    const findings: string[] = []
    const chunkFindings: string[] = []
    const signals: AuthenticitySignal[] = []
    let score = 0
    let chunkScore = 0

    const streamData = await this.collectStreamData(config, apiFormat, '请写一首关于春天的五言绝句，然后解释每句的含义。')
    if (!streamData || streamData.chunks.length < 5) {
      findings.push('Token 节奏分析: 数据不足')
      return { score: 2, findings, signals, chunkScore: 1, chunkFindings: ['Chunk 分析: 数据不足'] }
    }

    const { chunks, totalTime } = streamData

    // 计算 inter-chunk 间隔
    const intervals: number[] = []
    for (let i = 1; i < chunks.length; i++) {
      intervals.push(chunks[i].timestamp - chunks[i - 1].timestamp)
    }

    if (intervals.length < 3) {
      findings.push('Token 节奏分析: 间隔数据不足')
      return { score: 2, findings, signals, chunkScore: 1, chunkFindings: ['Chunk 分析: 数据不足'] }
    }

    // 首 chunk 延迟（TTFB）
    const ttfb = chunks[0].timestamp
    // 后续 chunk 的平均间隔
    const avgInterval = intervals.slice(1).reduce((a, b) => a + b, 0) / (intervals.length - 1)
    // 间隔标准差（节奏稳定性）
    const intervalStd = Math.sqrt(
      intervals.slice(1).reduce((sum, v) => sum + (v - avgInterval) ** 2, 0) / (intervals.length - 1)
    )
    // TTFB 与平均间隔的比值（真模型 TTFB 通常远大于后续间隔）
    const ttfbRatio = avgInterval > 0 ? ttfb / avgInterval : 0

    // Token 产出节奏分析（4分）
    if (ttfbRatio > 2 && avgInterval > 5 && avgInterval < 500) {
      score += 4
      findings.push(`Token 节奏正常: TTFB ${ttfb}ms, 平均间隔 ${avgInterval.toFixed(0)}ms, TTFB比 ${ttfbRatio.toFixed(1)}x`)
      signals.push({
        id: 'streaming-rhythm-normal',
        severity: 'weak',
        polarity: 'positive',
        message: `Token 产出节奏符合真实模型特征 (TTFB ${ttfb}ms, 间隔 ${avgInterval.toFixed(0)}ms)`,
      })
    } else if (avgInterval < 5 && chunks.length > 10) {
      score += 1
      findings.push(`Token 节奏异常: 平均间隔极低 (${avgInterval.toFixed(1)}ms) — 可能是批量转发而非逐 token 流式`)
      signals.push({
        id: 'streaming-rhythm-batch',
        severity: 'strong',
        polarity: 'negative',
        message: `Streaming chunk 间隔极低 (${avgInterval.toFixed(1)}ms)，疑似批量转发而非真实逐 token 生成`,
        evidence: { avgInterval, ttfb, chunkCount: chunks.length },
      })
    } else {
      score += 2
      findings.push(`Token 节奏: TTFB ${ttfb}ms, 平均间隔 ${avgInterval.toFixed(0)}ms`)
    }

    // Chunk 大小分布分析（3分）
    const sizes = chunks.map(c => c.size)
    const avgSize = sizes.reduce((a, b) => a + b, 0) / sizes.length
    const maxSize = Math.max(...sizes)
    const minSize = Math.min(...sizes)

    if (avgSize > 10 && avgSize < 2000 && maxSize < 10000) {
      chunkScore += 3
      chunkFindings.push(`Chunk 大小分布正常: 平均 ${avgSize.toFixed(0)} bytes, 范围 ${minSize}-${maxSize}`)
    } else if (avgSize >= 2000) {
      chunkScore += 1
      chunkFindings.push(`Chunk 偏大: 平均 ${avgSize.toFixed(0)} bytes — 可能合并了多个 token (代理行为)`)
      signals.push({
        id: 'streaming-chunk-large',
        severity: 'weak',
        polarity: 'negative',
        message: `Streaming chunk 平均大小 ${avgSize.toFixed(0)} bytes，可能是代理合并转发`,
      })
    } else {
      chunkScore += 2
      chunkFindings.push(`Chunk 大小: 平均 ${avgSize.toFixed(0)} bytes, 总时间 ${totalTime}ms`)
    }

    return { score, findings, signals, chunkScore, chunkFindings }
  }
}
