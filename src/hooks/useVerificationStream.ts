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

    // 监听 error 事件
    eventSource.addEventListener('error', (e: MessageEvent) => {
      try {
        const data = JSON.parse(e.data) as DetectionEvent & { type: 'error' }
        setState((prev) => ({
          ...prev,
          status: 'error',
          error: data.message,
          progressMessage: null,
        }))
        eventSource.close()
      } catch (error) {
        console.error('解析 error 事件失败:', error)
        setState((prev) => ({
          ...prev,
          status: 'error',
          error: '连接失败，请重试',
          progressMessage: null,
        }))
        eventSource.close()
      }
    })

    // 监听连接错误
    eventSource.onerror = () => {
      if (eventSource.readyState === EventSource.CLOSED) {
        // 连接已关闭，检查是否是正常完成
        setState((prev) => {
          if (prev.status === 'completed') {
            return prev
          }
          return {
            ...prev,
            status: 'error',
            error: '连接意外断开',
            progressMessage: null,
          }
        })
      }
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
