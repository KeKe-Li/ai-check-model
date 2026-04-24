'use client'

import { use, useEffect, useState } from 'react'
import { useRouter, useSearchParams } from 'next/navigation'
import Link from 'next/link'
import { Loader2, AlertCircle, ArrowLeft } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Card, CardContent } from '@/components/ui/card'
import { useVerificationStream } from '@/hooks/useVerificationStream'
import ProgressStream from '@/components/verify/ProgressStream'
import ResultCard from '@/components/verify/ResultCard'
import DetailedReport from '@/components/verify/DetailedReport'
import type { VerificationReport } from '@/lib/detection/types'

interface PageProps {
  params: Promise<{ jobId: string }>
}

interface VerificationStartParams {
  jobId: string
  endpoint: string
  apiKey: string
  model: string
}

export default function VerifyPage({ params }: PageProps) {
  const { jobId } = use(params)
  const router = useRouter()
  const searchParams = useSearchParams()
  const [streamParams, setStreamParams] = useState<VerificationStartParams | null>(null)
  const [historyReport, setHistoryReport] = useState<VerificationReport | null>(null)
  const [bootstrapError, setBootstrapError] = useState<string | null>(null)
  const [isBootstrapping, setIsBootstrapping] = useState(true)
  const { state, start, reset } = useVerificationStream()

  useEffect(() => {
    let cancelled = false

    async function bootstrap() {
      setIsBootstrapping(true)
      setBootstrapError(null)
      setHistoryReport(null)

      const endpoint = searchParams.get('endpoint')
      const apiKey = searchParams.get('apiKey')
      const model = searchParams.get('model')
      const storageKey = `verification:${jobId}`

      if (endpoint && apiKey && model) {
        sessionStorage.setItem(storageKey, JSON.stringify({ endpoint, apiKey, model }))
        if (!cancelled) {
          setStreamParams({ jobId, endpoint, apiKey, model })
          router.replace(`/verify/${jobId}`)
        }
        setIsBootstrapping(false)
        return
      }

      const stored = sessionStorage.getItem(storageKey)
      if (stored) {
        try {
          const parsed = JSON.parse(stored) as {
            endpoint?: string
            apiKey?: string
            model?: string
          }

          if (parsed.endpoint && parsed.apiKey && parsed.model) {
            if (!cancelled) {
              setStreamParams({
                jobId,
                endpoint: parsed.endpoint,
                apiKey: parsed.apiKey,
                model: parsed.model,
              })
            }
            setIsBootstrapping(false)
            return
          }
        } catch {
          sessionStorage.removeItem(storageKey)
        }
      }

      try {
        const response = await fetch(`/api/verify/${jobId}`)
        const result = await response.json()

        if (!response.ok || !result.success || !result.data?.report) {
          throw new Error(result.error || '无法加载验证结果')
        }

        if (!cancelled) {
          setHistoryReport(result.data.report as VerificationReport)
          setStreamParams(null)
        }
      } catch (error) {
        if (!cancelled) {
          setBootstrapError(error instanceof Error ? error.message : '无法加载验证结果')
        }
      } finally {
        if (!cancelled) {
          setIsBootstrapping(false)
        }
      }
    }

    bootstrap()

    return () => {
      cancelled = true
    }
  }, [jobId, router, searchParams])

  useEffect(() => {
    if (streamParams && state.status === 'idle') {
      start(streamParams)
    }
  }, [start, state.status, streamParams])

  // 处理重试
  const handleRetry = () => {
    reset()
    setHistoryReport(null)
    setBootstrapError(null)
    if (streamParams) {
      start(streamParams)
    }
  }

  if (isBootstrapping) {
    return (
      <div className="container mx-auto px-4 py-8">
        <div className="max-w-3xl mx-auto">
          <Card className="shadow-lg">
            <CardContent className="p-12">
              <div className="flex flex-col items-center gap-4">
                <Loader2 className="h-12 w-12 animate-spin text-primary" />
                <p className="text-lg font-medium">正在加载验证任务...</p>
                <p className="text-sm text-muted-foreground">请稍候</p>
              </div>
            </CardContent>
          </Card>
        </div>
      </div>
    )
  }

  return (
    <div className="container mx-auto px-4 py-8">
      <div className="max-w-3xl mx-auto space-y-6">
        {/* 返回按钮 */}
        <Link href="/">
          <Button variant="ghost" size="sm">
            <ArrowLeft className="mr-2 h-4 w-4" />
            返回首页
          </Button>
        </Link>

        {/* 页面标题 */}
        <div className="text-center">
          <h1 className="text-3xl font-bold mb-2">模型验证</h1>
          <p className="text-muted-foreground">任务 ID: {jobId}</p>
        </div>

        {streamParams && (state.status === 'idle' || state.status === 'connecting') && (
          <Card className="shadow-lg">
            <CardContent className="p-12">
              <div className="flex flex-col items-center gap-4">
                <Loader2 className="h-12 w-12 animate-spin text-primary" />
                <p className="text-lg font-medium">正在连接检测服务...</p>
                <p className="text-sm text-muted-foreground">请稍候</p>
              </div>
            </CardContent>
          </Card>
        )}

        {/* 检测进行中 */}
        {streamParams && state.status === 'running' && (
          <ProgressStream
            totalDetectors={state.totalDetectors}
            completedDetectors={state.completedDetectors}
            currentDetector={state.currentDetector}
            currentDetectorDisplay={state.currentDetectorDisplay}
            results={state.results}
            progressMessage={state.progressMessage}
          />
        )}

        {/* 检测完成 */}
        {streamParams && state.status === 'completed' && state.report && (
          <>
            <ResultCard report={state.report} />
            <DetailedReport results={state.report.results} />
          </>
        )}

        {/* 历史结果 */}
        {!streamParams && historyReport && (
          <>
            <ResultCard report={historyReport} />
            <DetailedReport results={historyReport.results} />
          </>
        )}

        {/* 错误状态 */}
        {(state.status === 'error' || bootstrapError) && (
          <Card className="shadow-lg border-destructive">
            <CardContent className="p-6">
              <div className="flex items-center gap-3 text-destructive mb-4">
                <AlertCircle className="h-6 w-6" />
                <h2 className="text-xl font-semibold">验证失败</h2>
              </div>
              <p className="text-muted-foreground mb-4">
                {state.error || bootstrapError || '发生未知错误，请重试'}
              </p>
              <div className="flex gap-3">
                {streamParams && (
                  <Button onClick={handleRetry}>
                    重试
                  </Button>
                )}
                <Link href="/">
                  <Button variant="outline">
                    返回首页
                  </Button>
                </Link>
              </div>
            </CardContent>
          </Card>
        )}
      </div>
    </div>
  )
}
