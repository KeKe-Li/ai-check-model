'use client'

import { useState, useEffect } from 'react'
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table'
import {
  Trophy,
  Medal,
  Shield,
  ShieldAlert,
  ShieldX,
  Loader2,
  AlertCircle,
  TrendingUp,
} from 'lucide-react'

interface LeaderboardEntry {
  id: string
  endpointDomain: string
  displayName: string | null
  totalChecks: number
  avgScore: string | null
  lastCheckedAt: string | null
  modelsVerified: Array<{ model: string; score: number; checkedAt: string }> | null
  overallStatus: string | null
}

const statusConfig: Record<string, { label: string; color: string; icon: typeof Shield }> = {
  verified: { label: '已验证', color: 'bg-green-100 text-green-800 dark:bg-green-900/30 dark:text-green-400', icon: Shield },
  suspicious: { label: '可疑', color: 'bg-yellow-100 text-yellow-800 dark:bg-yellow-900/30 dark:text-yellow-400', icon: ShieldAlert },
  fake: { label: '伪造', color: 'bg-red-100 text-red-800 dark:bg-red-900/30 dark:text-red-400', icon: ShieldX },
}

function getRankIcon(rank: number) {
  if (rank === 1) return <Trophy className="h-5 w-5 text-yellow-500" />
  if (rank === 2) return <Medal className="h-5 w-5 text-gray-400" />
  if (rank === 3) return <Medal className="h-5 w-5 text-amber-600" />
  return <span className="text-sm font-mono text-muted-foreground w-5 text-center">{rank}</span>
}

function getScoreColor(score: number): string {
  if (score >= 80) return 'text-green-600 dark:text-green-400'
  if (score >= 60) return 'text-yellow-600 dark:text-yellow-400'
  if (score >= 35) return 'text-orange-600 dark:text-orange-400'
  return 'text-red-600 dark:text-red-400'
}

function formatDate(dateStr: string | null): string {
  if (!dateStr) return '-'
  const date = new Date(dateStr)
  return date.toLocaleDateString('zh-CN', {
    month: '2-digit',
    day: '2-digit',
  })
}

export default function LeaderboardPage() {
  const [entries, setEntries] = useState<LeaderboardEntry[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    async function fetchLeaderboard() {
      try {
        const res = await fetch('/api/leaderboard')
        const json = await res.json()
        if (json.success) {
          setEntries(json.data)
        } else {
          setError(json.error || '加载失败')
        }
      } catch {
        setError('网络连接失败，数据库可能未配置')
      } finally {
        setLoading(false)
      }
    }
    fetchLeaderboard()
  }, [])

  return (
    <div className="container py-8">
      <div className="max-w-6xl mx-auto space-y-6">
        <div className="flex items-center gap-3">
          <Trophy className="h-8 w-8 text-primary" />
          <div>
            <h1 className="text-3xl font-bold">中转站排行榜</h1>
            <p className="text-muted-foreground">
              基于社区验证数据的中转站信誉排名
            </p>
          </div>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
          <Card>
            <CardHeader className="pb-2">
              <CardDescription>已收录站点</CardDescription>
              <CardTitle className="text-2xl">{entries.length}</CardTitle>
            </CardHeader>
          </Card>
          <Card>
            <CardHeader className="pb-2">
              <CardDescription>已验证站点</CardDescription>
              <CardTitle className="text-2xl text-green-600 dark:text-green-400">
                {entries.filter((e) => e.overallStatus === 'verified').length}
              </CardTitle>
            </CardHeader>
          </Card>
          <Card>
            <CardHeader className="pb-2">
              <CardDescription>总检测次数</CardDescription>
              <CardTitle className="text-2xl">
                {entries.reduce((sum, e) => sum + e.totalChecks, 0)}
              </CardTitle>
            </CardHeader>
          </Card>
        </div>

        <Card>
          <CardHeader className="pb-3">
            <div className="flex items-center gap-2">
              <TrendingUp className="h-5 w-5" />
              <CardTitle className="text-lg">排名列表</CardTitle>
            </div>
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
            ) : entries.length === 0 ? (
              <div className="text-center py-16 text-muted-foreground">
                <Trophy className="h-16 w-16 mx-auto mb-4 opacity-20" />
                <p className="text-lg">暂无排行数据</p>
                <p className="text-sm mt-2">
                  完成模型验证后，结果会自动汇入排行榜
                </p>
              </div>
            ) : (
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead className="w-12">排名</TableHead>
                    <TableHead>站点</TableHead>
                    <TableHead className="text-center">平均分</TableHead>
                    <TableHead className="text-center">检测次数</TableHead>
                    <TableHead className="text-center">状态</TableHead>
                    <TableHead>已验证模型</TableHead>
                    <TableHead>最近检测</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {entries.map((entry, index) => {
                    const rank = index + 1
                    const score = entry.avgScore ? parseFloat(entry.avgScore) : 0
                    const status = statusConfig[entry.overallStatus ?? ''] ?? statusConfig.suspicious

                    return (
                      <TableRow key={entry.id}>
                        <TableCell>
                          <div className="flex items-center justify-center">
                            {getRankIcon(rank)}
                          </div>
                        </TableCell>
                        <TableCell>
                          <div>
                            <p className="font-medium">
                              {entry.displayName ?? entry.endpointDomain}
                            </p>
                            {entry.displayName && (
                              <p className="text-xs text-muted-foreground font-mono">
                                {entry.endpointDomain}
                              </p>
                            )}
                          </div>
                        </TableCell>
                        <TableCell className="text-center">
                          <span className={`text-xl font-bold ${getScoreColor(score)}`}>
                            {score.toFixed(0)}
                          </span>
                        </TableCell>
                        <TableCell className="text-center text-muted-foreground">
                          {entry.totalChecks}
                        </TableCell>
                        <TableCell className="text-center">
                          <span
                            className={`inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full text-xs font-medium ${status.color}`}
                          >
                            <status.icon className="h-3 w-3" />
                            {status.label}
                          </span>
                        </TableCell>
                        <TableCell>
                          <div className="flex flex-wrap gap-1">
                            {entry.modelsVerified && Array.isArray(entry.modelsVerified)
                              ? entry.modelsVerified.slice(0, 3).map((mv, i) => (
                                  <Badge key={i} variant="outline" className="text-xs">
                                    {mv.model.replace(/^claude-|^gpt-/, '').split('-')[0]}
                                  </Badge>
                                ))
                              : <span className="text-sm text-muted-foreground">-</span>
                            }
                          </div>
                        </TableCell>
                        <TableCell className="text-sm text-muted-foreground">
                          {formatDate(entry.lastCheckedAt)}
                        </TableCell>
                      </TableRow>
                    )
                  })}
                </TableBody>
              </Table>
            )}
          </CardContent>
        </Card>
      </div>
    </div>
  )
}
