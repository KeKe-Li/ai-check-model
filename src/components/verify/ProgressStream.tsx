'use client'

import { motion, AnimatePresence } from 'framer-motion'
import { Loader2, CheckCircle2, AlertTriangle, XCircle, Circle } from 'lucide-react'
import { Progress } from '@/components/ui/progress'
import { Badge } from '@/components/ui/badge'
import { Card, CardContent } from '@/components/ui/card'
import type { DetectorResult } from '@/lib/detection/types'

interface ProgressStreamProps {
  totalDetectors: number
  completedDetectors: number
  currentDetector: string | null
  currentDetectorDisplay: string | null
  results: DetectorResult[]
  progressMessage: string | null
}

export default function ProgressStream({
  totalDetectors,
  completedDetectors,
  currentDetector,
  currentDetectorDisplay,
  results,
  progressMessage,
}: ProgressStreamProps) {
  const progressPercentage = totalDetectors > 0 ? (completedDetectors / totalDetectors) * 100 : 0

  // 构建检测器状态映射
  const detectorStatusMap = new Map<string, DetectorResult>()
  results.forEach((result) => {
    detectorStatusMap.set(result.detectorName, result)
  })

  // 获取检测器状态
  const getDetectorStatus = (detectorName: string) => {
    if (detectorStatusMap.has(detectorName)) {
      return detectorStatusMap.get(detectorName)!
    }
    if (detectorName === currentDetector) {
      return 'running'
    }
    return 'pending'
  }

  // 获取检测器图标
  const getDetectorIcon = (detectorName: string) => {
    const status = getDetectorStatus(detectorName)

    if (status === 'running') {
      return <Loader2 className="h-5 w-5 animate-spin text-blue-500" />
    }

    if (status === 'pending') {
      return <Circle className="h-5 w-5 text-gray-300" />
    }

    const result = status as DetectorResult
    switch (result.status) {
      case 'pass':
        return <CheckCircle2 className="h-5 w-5 text-green-500" />
      case 'warn':
        return <AlertTriangle className="h-5 w-5 text-yellow-500" />
      case 'fail':
        return <XCircle className="h-5 w-5 text-red-500" />
      case 'skip':
        return <Circle className="h-5 w-5 text-gray-400" />
      default:
        return <Circle className="h-5 w-5 text-gray-300" />
    }
  }

  // 获取分数徽章
  const getScoreBadge = (result: DetectorResult) => {
    if (result.status === 'skip' || result.maxScore === 0) {
      return (
        <Badge variant="outline" className="ml-auto">
          跳过
        </Badge>
      )
    }

    const percentage = (result.score / result.maxScore) * 100
    let variant: 'default' | 'secondary' | 'destructive' | 'outline' = 'default'

    if (percentage >= 80) {
      variant = 'default' // 绿色
    } else if (percentage >= 50) {
      variant = 'secondary' // 黄色
    } else {
      variant = 'destructive' // 红色
    }

    return (
      <Badge variant={variant} className="ml-auto">
        {result.score}/{result.maxScore}
      </Badge>
    )
  }

  // 所有检测器列表（已完成 + 当前 + 待处理）
  const allDetectors = [
    ...results.map((r) => ({ name: r.detectorName, display: r.displayName })),
  ]

  // 添加当前检测器（如果不在结果中）
  if (currentDetector && !detectorStatusMap.has(currentDetector)) {
    allDetectors.push({ name: currentDetector, display: currentDetectorDisplay || currentDetector })
  }

  return (
    <Card className="shadow-lg">
      <CardContent className="p-6 space-y-6">
        {/* 整体进度 */}
        <div className="space-y-2">
          <div className="flex items-center justify-between text-sm">
            <span className="font-medium">检测进度</span>
            <span className="text-muted-foreground">
              {completedDetectors}/{totalDetectors}
            </span>
          </div>
          <Progress value={progressPercentage} className="h-2" />
        </div>

        {/* 检测器列表 */}
        <div className="space-y-3">
          <AnimatePresence mode="popLayout">
            {allDetectors.map((detector, index) => {
              const status = getDetectorStatus(detector.name)
              const isCompleted = status !== 'running' && status !== 'pending'

              return (
                <motion.div
                  key={detector.name}
                  initial={{ opacity: 0, y: -10 }}
                  animate={{ opacity: 1, y: 0 }}
                  exit={{ opacity: 0, y: 10 }}
                  transition={{ duration: 0.2, delay: index * 0.05 }}
                  className="flex items-center gap-3 p-3 rounded-lg bg-muted/50"
                >
                  {getDetectorIcon(detector.name)}
                  <span className="font-medium text-sm flex-1">{detector.display}</span>
                  {isCompleted && getScoreBadge(status as DetectorResult)}
                </motion.div>
              )
            })}
          </AnimatePresence>
        </div>

        {/* 当前进度消息 */}
        {progressMessage && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            className="text-sm text-muted-foreground text-center pt-2 border-t"
          >
            {progressMessage}
          </motion.div>
        )}
      </CardContent>
    </Card>
  )
}
