'use client'

import { useState } from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import { CheckCircle2, AlertTriangle, XCircle, MinusCircle, ChevronDown, ChevronRight } from 'lucide-react'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { Separator } from '@/components/ui/separator'
import type { DetectorResult } from '@/lib/detection/types'

interface DetailedReportProps {
  results: DetectorResult[]
}

export default function DetailedReport({ results }: DetailedReportProps) {
  const [expandedDetectors, setExpandedDetectors] = useState<Set<string>>(new Set())

  const toggleDetector = (detectorName: string) => {
    setExpandedDetectors((prev) => {
      const next = new Set(prev)
      if (next.has(detectorName)) {
        next.delete(detectorName)
      } else {
        next.add(detectorName)
      }
      return next
    })
  }

  // 获取状态图标
  const getStatusIcon = (status: DetectorResult['status']) => {
    switch (status) {
      case 'pass':
        return <CheckCircle2 className="h-5 w-5 text-green-500" />
      case 'warn':
        return <AlertTriangle className="h-5 w-5 text-yellow-500" />
      case 'fail':
        return <XCircle className="h-5 w-5 text-red-500" />
      case 'skip':
        return <MinusCircle className="h-5 w-5 text-gray-400" />
      default:
        return null
    }
  }

  // 获取状态徽章
  const getStatusBadge = (status: DetectorResult['status']) => {
    const statusText: Record<DetectorResult['status'], string> = {
      pass: '通过',
      warn: '警告',
      fail: '失败',
      skip: '跳过',
    }

    const statusVariant: Record<DetectorResult['status'], 'default' | 'secondary' | 'destructive' | 'outline'> = {
      pass: 'default',
      warn: 'secondary',
      fail: 'destructive',
      skip: 'outline',
    }

    return (
      <Badge variant={statusVariant[status]}>
        {statusText[status]}
      </Badge>
    )
  }

  // 获取分数徽章颜色
  const getScoreBadgeVariant = (score: number, maxScore: number) => {
    const percentage = (score / maxScore) * 100
    if (percentage >= 80) return 'default'
    if (percentage >= 50) return 'secondary'
    return 'destructive'
  }

  return (
    <Card className="shadow-lg">
      <CardHeader>
        <CardTitle>检测详情</CardTitle>
      </CardHeader>
      <CardContent className="space-y-3">
        {results.map((result) => {
          const isExpanded = expandedDetectors.has(result.detectorName)

          return (
            <Card key={result.detectorName} className="overflow-hidden">
              {/* 检测器标题（可点击） */}
              <button
                onClick={() => toggleDetector(result.detectorName)}
                className="w-full text-left p-4 hover:bg-muted/50 transition-colors"
              >
                <div className="flex items-center gap-3">
                  {getStatusIcon(result.status)}
                  <span className="font-medium flex-1">{result.displayName}</span>
                  <Badge variant={getScoreBadgeVariant(result.score, result.maxScore)}>
                    {result.score}/{result.maxScore}
                  </Badge>
                  {getStatusBadge(result.status)}
                  <motion.div
                    animate={{ rotate: isExpanded ? 180 : 0 }}
                    transition={{ duration: 0.2 }}
                  >
                    <ChevronDown className="h-4 w-4 text-muted-foreground" />
                  </motion.div>
                </div>
              </button>

              {/* 展开的内容 */}
              <AnimatePresence>
                {isExpanded && (
                  <motion.div
                    initial={{ height: 0, opacity: 0 }}
                    animate={{ height: 'auto', opacity: 1 }}
                    exit={{ height: 0, opacity: 0 }}
                    transition={{ duration: 0.2 }}
                  >
                    <Separator />
                    <div className="p-4 space-y-4 bg-muted/30">
                      {/* 发现列表 */}
                      {result.findings && result.findings.length > 0 && (
                        <div>
                          <h4 className="text-sm font-semibold mb-2">检测发现</h4>
                          <ul className="space-y-1 text-sm">
                            {result.findings.map((finding, idx) => (
                              <li key={idx} className="flex items-start gap-2">
                                <ChevronRight className="h-4 w-4 text-muted-foreground mt-0.5 flex-shrink-0" />
                                <span>{finding}</span>
                              </li>
                            ))}
                          </ul>
                        </div>
                      )}

                      {/* 详细信息 */}
                      {result.details && Object.keys(result.details).length > 0 && (
                        <div>
                          <h4 className="text-sm font-semibold mb-2">详细信息</h4>
                          <div className="bg-background rounded-md p-3 text-xs font-mono overflow-x-auto">
                            <pre className="whitespace-pre-wrap break-words">
                              {JSON.stringify(result.details, null, 2)}
                            </pre>
                          </div>
                        </div>
                      )}
                    </div>
                  </motion.div>
                )}
              </AnimatePresence>
            </Card>
          )
        })}
      </CardContent>
    </Card>
  )
}
