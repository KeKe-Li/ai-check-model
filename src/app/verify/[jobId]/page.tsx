'use client'

import { use, useEffect } from 'react'
import { useSearchParams } from 'next/navigation'
import Link from 'next/link'
import { Loader2, AlertCircle, ArrowLeft } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Card, CardContent } from '@/components/ui/card'
import { useVerificationStream } from '@/hooks/useVerificationStream'
import ProgressStream from '@/components/verify/ProgressStream'
import ResultCard from '@/components/verify/ResultCard'
import DetailedReport from '@/components/verify/DetailedReport'

interface PageProps {
  params: Promise<{ jobId: string }>
}

export default function VerifyPage({ params }: PageProps) {
  const { jobId } = use(params)
  const searchParams = useSearchParams()

  const endpoint = searchParams.get('endpoint')
  const apiKey = searchParams.get('apiKey')
  const model = searchParams.get('model')

  const { state, start, reset } = useVerificationStream()

  // 自动开始验证
  useEffect(() => {
    if (endpoint && apiKey && model && state.status === 'idle') {
      start({ jobId, endpoint, apiKey, model })
    }
  }, [endpoint, apiKey, model, jobId, state.status, start])

  // 处理重试
  const handleRetry = () => {
    reset()
    if (endpoint && apiKey && model) {
      start({ jobId, endpoint, apiKey, model })
    }
  }

  // 检查参数完整性
  if (!endpoint || !apiKey || !model) {
    return (
      <div className="container mx-auto px-4 py-8">
        <div className="max-w-3xl mx-auto">
          <Card className="shadow-lg border-destructive">
            <CardContent className="p-6">
              <div className="flex items-center gap-3 text-destructive mb-4">
                <AlertCircle className="h-6 w-6" />
                <h2 className="text-xl font-semibold">参数缺失</h2>
              </div>
              <p className="text-muted-foreground mb-4">
                缺少必需的验证参数，请返回首页重新提交。
              </p>
              <Link href="/">
                <Button>
                  <ArrowLeft className="mr-2 h-4 w-4" />
                  返回首页
                </Button>
              </Link>
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

        {/* 连接中状态 */}
        {state.status === 'connecting' && (
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
        {state.status === 'running' && (
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
        {state.status === 'completed' && state.report && (
          <>
            <ResultCard report={state.report} />
            <DetailedReport results={state.report.results} />
          </>
        )}

        {/* 错误状态 */}
        {state.status === 'error' && (
          <Card className="shadow-lg border-destructive">
            <CardContent className="p-6">
              <div className="flex items-center gap-3 text-destructive mb-4">
                <AlertCircle className="h-6 w-6" />
                <h2 className="text-xl font-semibold">验证失败</h2>
              </div>
              <p className="text-muted-foreground mb-4">
                {state.error || '发生未知错误，请重试'}
              </p>
              <div className="flex gap-3">
                <Button onClick={handleRetry}>
                  重试
                </Button>
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
