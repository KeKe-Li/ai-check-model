'use client'

import { useState, useCallback, useRef, useEffect } from 'react'
import type { DetectorResult, VerificationReport, DetectionEvent } from '@/lib/detection/types'

interface StreamState {
  status: 'idle' | 'connecting' | 'running' | 'completed' | 'error'
  totalDetectors: number
  completedDetectors: number
  currentDetector: string | null
  currentDetectorDisplay: string | null
  progressMessage: string | null
  results: DetectorResult[]
  report: VerificationReport | null
  error: string | null
}

interface UseVerificationStreamParams {
  jobId: string
}

export function useVerificationStream() {
  const [state, setState] = useState<StreamState>({
    status: 'idle',
    totalDetectors: 0,
    completedDetectors: 0,
    currentDetector: null,
    currentDetectorDisplay: null,
    progressMessage: null,
    results: [],
    report: null,
    error: null,
  })

  const eventSourceRef = useRef<EventSource | null>(null)

  const start = useCallback((params: UseVerificationStreamParams) => {
    const { jobId } = params

    // 先关闭已有连接，防止 React Strict Mode 双重 mount 导致连接泄漏
    if (eventSourceRef.current) {
      eventSourceRef.current.close()
      eventSourceRef.current = null
    }

    // 重置状态
    setState({
      status: 'connecting',
      totalDetectors: 0,
      completedDetectors: 0,
      currentDetector: null,
      currentDetectorDisplay: null,
      progressMessage: '正在连接检测服务...',
      results: [],
      report: null,
      error: null,
    })

    // 构建 SSE URL：只包含 jobId，敏感 API Key 不进入查询参数。
    const url = `/api/verify/${jobId}/stream`

    // 创建 EventSource 连接
    const eventSource = new EventSource(url)
    eventSourceRef.current = eventSource

    // 监听 started 事件
    eventSource.addEventListener('started', (e: MessageEvent) => {
      try {
        const data = JSON.parse(e.data) as DetectionEvent & { type: 'started' }
        setState((prev) => ({
          ...prev,
          status: 'running',
          totalDetectors: data.totalDetectors,
          progressMessage: `开始检测，共 ${data.totalDetectors} 个检测器`,
        }))
      } catch (error) {
        console.error('解析 started 事件失败:', error)
      }
    })

    // 监听 detector:start 事件
    eventSource.addEventListener('detector:start', (e: MessageEvent) => {
      try {
        const data = JSON.parse(e.data) as DetectionEvent & { type: 'detector:start' }
        setState((prev) => ({
          ...prev,
          currentDetector: data.detector,
          currentDetectorDisplay: data.displayName,
          progressMessage: `正在运行: ${data.displayName}`,
        }))
      } catch (error) {
        console.error('解析 detector:start 事件失败:', error)
      }
    })

    // 监听 detector:progress 事件
    eventSource.addEventListener('detector:progress', (e: MessageEvent) => {
      try {
        const data = JSON.parse(e.data) as DetectionEvent & { type: 'detector:progress' }
        setState((prev) => ({
          ...prev,
          progressMessage: data.message,
        }))
      } catch (error) {
        console.error('解析 detector:progress 事件失败:', error)
      }
    })

    // 监听 detector:complete 事件
    eventSource.addEventListener('detector:complete', (e: MessageEvent) => {
      try {
        const data = JSON.parse(e.data) as DetectionEvent & { type: 'detector:complete' }
        setState((prev) => ({
          ...prev,
          completedDetectors: prev.completedDetectors + 1,
          results: [...prev.results, data.result],
          progressMessage: `完成: ${data.result.displayName} (${data.result.score}/${data.result.maxScore})`,
        }))
      } catch (error) {
        console.error('解析 detector:complete 事件失败:', error)
      }
    })

    // 监听 scoring 事件
    eventSource.addEventListener('scoring', (e: MessageEvent) => {
      try {
        const data = JSON.parse(e.data) as DetectionEvent & { type: 'scoring' }
        setState((prev) => ({
          ...prev,
          currentDetector: null,
          currentDetectorDisplay: null,
          progressMessage: data.message,
        }))
      } catch (error) {
        console.error('解析 scoring 事件失败:', error)
      }
    })

    // 监听 complete 事件
    eventSource.addEventListener('complete', (e: MessageEvent) => {
      try {
        const data = JSON.parse(e.data) as DetectionEvent & { type: 'complete' }
        setState((prev) => ({
          ...prev,
          status: 'completed',
          report: data.report,
          progressMessage: '检测完成',
        }))
        eventSource.close()
      } catch (error) {
        console.error('解析 complete 事件失败:', error)
      }
    })

    // 监听服务端发送的 SSE error 事件（带 data 字段）
    eventSource.addEventListener('error', (e: Event) => {
      // 区分服务端 SSE error 事件和浏览器原生连接错误：
      // 服务端事件是 MessageEvent，有 data 属性；原生错误是 Event，无 data。
      const me = e as MessageEvent
      if (typeof me.data !== 'string') return // 原生连接错误，由 onerror 处理

      try {
        const data = JSON.parse(me.data) as DetectionEvent & { type: 'error' }
        setState((prev) => ({
          ...prev,
          status: 'error',
          error: data.message,
          progressMessage: null,
        }))
        eventSource.close()
      } catch {
        // data 不是有效 JSON，忽略
      }
    })

    // 监听浏览器原生连接错误（网络断开、服务端返回非 SSE 响应等）
    eventSource.onerror = () => {
      // 连接已关闭或服务端拒绝连接
      if (eventSource.readyState === EventSource.CLOSED) {
        setState((prev) => {
          if (prev.status === 'completed' || prev.status === 'error') {
            return prev
          }
          return {
            ...prev,
            status: 'error',
            error: '检测服务连接断开，请检查网络后重试',
            progressMessage: null,
          }
        })
      }
      // readyState === CONNECTING 时 EventSource 会自动重连，暂不干预
    }
  }, [])

  const reset = useCallback(() => {
    if (eventSourceRef.current) {
      eventSourceRef.current.close()
      eventSourceRef.current = null
    }
    setState({
      status: 'idle',
      totalDetectors: 0,
      completedDetectors: 0,
      currentDetector: null,
      currentDetectorDisplay: null,
      progressMessage: null,
      results: [],
      report: null,
      error: null,
    })
  }, [])

  // 组件卸载时清理
  useEffect(() => {
    return () => {
      if (eventSourceRef.current) {
        eventSourceRef.current.close()
      }
    }
  }, [])

  return { state, start, reset }
}
