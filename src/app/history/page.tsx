'use client'

import { useState, useEffect, useCallback } from 'react'
import Link from 'next/link'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table'
import {
  History,
  Search,
  ChevronLeft,
  ChevronRight,
  ExternalLink,
  Loader2,
  AlertCircle,
} from 'lucide-react'

interface VerificationJob {
  id: string
  endpointUrl: string
  endpointDomain: string
  modelClaimed: string
  modelDetected: string | null
  totalScore: number | null
  confidenceLevel: string | null
  status: string
  durationMs: number | null
  createdAt: string
}

interface PaginationInfo {
  page: number
  limit: number
  total: number
  totalPages: number
}

const confidenceBadgeVariant: Record<string, string> = {
  HIGH: 'bg-green-100 text-green-800 dark:bg-green-900/30 dark:text-green-400',
  MEDIUM: 'bg-yellow-100 text-yellow-800 dark:bg-yellow-900/30 dark:text-yellow-400',
  LOW: 'bg-orange-100 text-orange-800 dark:bg-orange-900/30 dark:text-orange-400',
  VERY_LOW: 'bg-red-100 text-red-800 dark:bg-red-900/30 dark:text-red-400',
}

const confidenceLabel: Record<string, string> = {
  HIGH: '高可信',
  MEDIUM: '中等',
  LOW: '可疑',
  VERY_LOW: '极可疑',
}

function formatDuration(ms: number | null): string {
  if (!ms) return '-'
  return `${(ms / 1000).toFixed(1)}s`
}

function formatDate(dateStr: string): string {
  const date = new Date(dateStr)
  return date.toLocaleDateString('zh-CN', {
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
  })
}

export default function HistoryPage() {
  const [jobs, setJobs] = useState<VerificationJob[]>([])
  const [pagination, setPagination] = useState<PaginationInfo>({
    page: 1,
    limit: 15,
    total: 0,
    totalPages: 0,
  })
  const [modelFilter, setModelFilter] = useState('')
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  const fetchHistory = useCallback(async (page: number, model: string) => {
    setLoading(true)
    setError(null)
    try {
      const params = new URLSearchParams({ page: String(page), limit: '15' })
      if (model) params.set('model', model)

      const res = await fetch(`/api/history?${params}`)
      const json = await res.json()

      if (json.success) {
        setJobs(json.data.data)
        setPagination(json.data.pagination)
      } else {
        setError(json.error || '加载失败')
      }
    } catch {
      setError('网络连接失败，数据库可能未配置')
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    const timer = window.setTimeout(() => {
      void fetchHistory(1, modelFilter)
    }, 0)

    return () => window.clearTimeout(timer)
  }, [fetchHistory, modelFilter])

  const handlePageChange = (newPage: number) => {
    fetchHistory(newPage, modelFilter)
  }

  return (
    <div className="container py-8">
      <div className="max-w-6xl mx-auto space-y-6">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-3">
            <History className="h-8 w-8 text-primary" />
            <div>
              <h1 className="text-3xl font-bold">验证历史</h1>
              <p className="text-muted-foreground">查看所有历史验证记录</p>
            </div>
          </div>
          <div className="relative w-64">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
            <Input
              placeholder="搜索模型名称..."
              value={modelFilter}
              onChange={(e) => setModelFilter(e.target.value)}
              className="pl-10"
            />
          </div>
        </div>

        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="text-lg">
              共 {pagination.total} 条记录
            </CardTitle>
          </CardHeader>
          <CardContent>
            {loading ? (
              <div className="flex items-center justify-center py-16">
                <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
                <span className="ml-3 text-muted-foreground">加载中...</span>
              </div>
            ) : error ? (
              <div className="flex flex-col items-center justify-center py-16 text-muted-foreground">
                <AlertCircle className="h-12 w-12 mb-4" />
                <p>{error}</p>
                <p className="text-sm mt-2">请确认数据库已正确配置</p>
              </div>
            ) : jobs.length === 0 ? (
              <div className="text-center py-16 text-muted-foreground">
                <p className="text-lg">暂无验证记录</p>
                <p className="text-sm mt-2">
                  前往
                  <Link href="/" className="text-primary hover:underline mx-1">
                    首页
                  </Link>
                  开始你的第一次模型验证
                </p>
              </div>
            ) : (
              <>
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>端点</TableHead>
                      <TableHead>声称模型</TableHead>
                      <TableHead>检测结果</TableHead>
                      <TableHead className="text-center">评分</TableHead>
                      <TableHead className="text-center">置信度</TableHead>
                      <TableHead className="text-center">耗时</TableHead>
                      <TableHead>时间</TableHead>
                      <TableHead />
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {jobs.map((job) => (
                      <TableRow key={job.id}>
                        <TableCell className="font-mono text-sm max-w-[200px] truncate">
                          {job.endpointDomain}
                        </TableCell>
                        <TableCell>
                          <Badge variant="outline">{job.modelClaimed}</Badge>
                        </TableCell>
                        <TableCell>
                          {job.modelDetected ? (
                            <Badge variant="secondary">{job.modelDetected}</Badge>
                          ) : (
                            <span className="text-muted-foreground text-sm">未确定</span>
                          )}
                        </TableCell>
                        <TableCell className="text-center">
                          <span className="font-bold text-lg">
                            {job.totalScore ?? '-'}
                          </span>
                        </TableCell>
                        <TableCell className="text-center">
                          {job.confidenceLevel ? (
                            <span
                              className={`inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium ${
                                confidenceBadgeVariant[job.confidenceLevel] ?? ''
                              }`}
                            >
                              {confidenceLabel[job.confidenceLevel] ?? job.confidenceLevel}
                            </span>
                          ) : (
                            '-'
                          )}
                        </TableCell>
                        <TableCell className="text-center text-sm text-muted-foreground">
                          {formatDuration(job.durationMs)}
                        </TableCell>
                        <TableCell className="text-sm text-muted-foreground">
                          {formatDate(job.createdAt)}
                        </TableCell>
                        <TableCell>
                          <Link href={`/verify/${job.id}`}>
                            <Button variant="ghost" size="sm">
                              <ExternalLink className="h-4 w-4" />
                            </Button>
                          </Link>
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>

                {pagination.totalPages > 1 && (
                  <div className="flex items-center justify-between mt-4 pt-4 border-t">
                    <p className="text-sm text-muted-foreground">
                      第 {pagination.page} / {pagination.totalPages} 页
                    </p>
                    <div className="flex gap-2">
                      <Button
                        variant="outline"
                        size="sm"
                        disabled={pagination.page <= 1}
                        onClick={() => handlePageChange(pagination.page - 1)}
                      >
                        <ChevronLeft className="h-4 w-4 mr-1" />
                        上一页
                      </Button>
                      <Button
                        variant="outline"
                        size="sm"
                        disabled={pagination.page >= pagination.totalPages}
                        onClick={() => handlePageChange(pagination.page + 1)}
                      >
                        下一页
                        <ChevronRight className="h-4 w-4 ml-1" />
                      </Button>
                    </div>
                  </div>
                )}
              </>
            )}
          </CardContent>
        </Card>
      </div>
    </div>
  )
}
