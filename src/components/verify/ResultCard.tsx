'use client'

import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import ScoreGauge from './ScoreGauge'
import type { VerificationReport } from '@/lib/detection/types'

interface ResultCardProps {
  report: VerificationReport
}

export default function ResultCard({ report }: ResultCardProps) {
  // 置信度徽章颜色
  const getConfidenceBadgeVariant = () => {
    switch (report.confidenceLevel) {
      case 'HIGH':
        return 'default' // 绿色
      case 'MEDIUM':
        return 'secondary' // 黄色
      case 'LOW':
        return 'outline' // 橙色
      case 'VERY_LOW':
        return 'destructive' // 红色
      default:
        return 'outline'
    }
  }

  // 格式化耗时
  const formatDuration = (ms: number) => {
    if (ms < 1000) {
      return `${ms} 毫秒`
    }
    const seconds = (ms / 1000).toFixed(2)
    return `${seconds} 秒`
  }

  return (
    <Card className="shadow-lg">
      <CardHeader>
        <CardTitle className="text-center">验证结果</CardTitle>
      </CardHeader>
      <CardContent className="space-y-6">
        {/* 分数仪表盘 */}
        <div className="flex justify-center py-4">
          <ScoreGauge score={report.totalScore} confidenceLevel={report.confidenceLevel} />
        </div>

        {/* 判定结果 */}
        <div className="text-center">
          <p className="text-lg font-medium text-muted-foreground mb-2">判定结果</p>
          <p className="text-xl font-semibold">{report.verdict}</p>
        </div>

        {/* 真实性评估 */}
        {report.authenticity && (
          <div className="rounded-lg border bg-muted/30 p-4 space-y-3">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <div>
                <p className="text-sm text-muted-foreground">真实性评估</p>
                <p className="font-medium">
                  {formatAuthenticityVerdict(report.authenticity.verdict)}
                </p>
              </div>
              {report.authenticity.scoreCapApplied !== undefined && (
                <Badge variant="destructive">
                  已封顶 ≤ {report.authenticity.scoreCapApplied}
                </Badge>
              )}
            </div>

            {report.authenticity.summary.length > 0 && (
              <ul className="space-y-1 text-sm text-muted-foreground">
                {report.authenticity.summary.slice(0, 3).map((item, index) => (
                  <li key={index}>- {item}</li>
                ))}
              </ul>
            )}
          </div>
        )}

        {/* 信息网格 */}
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4 pt-4 border-t">
          {/* 声称模型 */}
          <div className="space-y-1">
            <p className="text-sm text-muted-foreground">声称模型</p>
            <p className="font-medium">{report.modelClaimed}</p>
          </div>

          {/* 检测结果 */}
          <div className="space-y-1">
            <p className="text-sm text-muted-foreground">检测结果</p>
            <p className="font-medium">{report.modelDetected || '无法确定'}</p>
          </div>

          {/* 置信度 */}
          <div className="space-y-1">
            <p className="text-sm text-muted-foreground">置信度</p>
            <div>
              <Badge variant={getConfidenceBadgeVariant()}>
                {report.confidenceLevel}
              </Badge>
            </div>
          </div>

          {/* 检测耗时 */}
          <div className="space-y-1">
            <p className="text-sm text-muted-foreground">检测耗时</p>
            <p className="font-medium">{formatDuration(report.durationMs)}</p>
          </div>
        </div>
      </CardContent>
    </Card>
  )
}

function formatAuthenticityVerdict(verdict: NonNullable<VerificationReport['authenticity']>['verdict']) {
  switch (verdict) {
    case 'likely_genuine':
      return '高概率真实，未发现关键掺假证据'
    case 'compatible_but_unverified':
      return '接口兼容但官方能力证据不足，不能判定完全不掺假'
    case 'inconclusive':
      return '证据不足，无法裁决真伪'
    case 'needs_review':
      return '需要人工复核，证据不足以下强结论'
    case 'suspicious':
      return '存在关键疑点，不能判为不掺假'
    case 'likely_fake':
      return '高度疑似掺假或跨供应商套壳'
  }
}
