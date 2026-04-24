import { NextRequest } from 'next/server'
import { DetectionOrchestrator } from '@/lib/detection/orchestrator'
import type { VerificationConfig, DetectionEvent, VerificationReport } from '@/lib/detection/types'

export const runtime = 'nodejs'
export const maxDuration = 300  // 5 分钟最大执行时间

interface LeaderboardModelRecord {
  model: string
  score: number
  checkedAt: string
}

/**
 * GET /api/verify/[jobId]/stream
 *
 * 服务器发送事件 (SSE) 端点，实时推送检测进度
 *
 * 查询参数:
 * - endpoint: API 端点 URL
 * - apiKey: API 密钥
 * - model: 声称的模型名称
 *
 * SSE 事件类型:
 * - start: 检测开始
 * - detector_start: 检测器启动
 * - detector_progress: 检测器进度更新
 * - detector_complete: 检测器完成
 * - complete: 全部检测完成
 * - error: 错误事件
 */
export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ jobId: string }> }
) {
  const { jobId } = await params
  const searchParams = request.nextUrl.searchParams
  const endpoint = searchParams.get('endpoint')
  const apiKey = searchParams.get('apiKey')
  const model = searchParams.get('model')

  if (!endpoint || !apiKey || !model) {
    return new Response('缺少必需参数', { status: 400 })
  }

  const config: VerificationConfig = { endpoint, apiKey, model, jobId }
  const orchestrator = new DetectionOrchestrator()

  const stream = new ReadableStream({
    async start(controller) {
      const encoder = new TextEncoder()

      const sendEvent = (event: DetectionEvent) => {
        const data = JSON.stringify(event)
        controller.enqueue(encoder.encode(`event: ${event.type}\ndata: ${data}\n\n`))
      }

      try {
        for await (const event of orchestrator.run(config)) {
          sendEvent(event)

          // 检测完成时尝试保存结果到数据库
          if (event.type === 'complete') {
            try {
              await saveResults(config, event.report)
            } catch (dbError) {
              // 数据库保存失败不中断流式传输
              console.error('保存结果失败:', dbError)
            }
          }
        }
      } catch (error) {
        const errorEvent: DetectionEvent = {
          type: 'error',
          message: error instanceof Error ? error.message : '检测过程发生未知错误',
        }
        sendEvent(errorEvent)
      } finally {
        controller.close()
      }
    },
  })

  return new Response(stream, {
    headers: {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache, no-transform',
      'Connection': 'keep-alive',
      'X-Accel-Buffering': 'no',
    },
  })
}

/**
 * 保存验证结果到数据库
 * 优雅降级：数据库未配置时不抛出错误
 */
async function saveResults(config: VerificationConfig, report: VerificationReport) {
  try {
    const { db } = await import('@/lib/db')
    const { verificationJobs, detectionResults, leaderboardEntries } = await import('@/lib/db/schema')
    const { and, desc, eq } = await import('drizzle-orm')

    // 从端点 URL 提取域名
    let domain = ''
    try {
      domain = new URL(config.endpoint).hostname
    } catch {
      domain = config.endpoint
    }

    // 插入验证任务记录
    await db.insert(verificationJobs).values({
      id: config.jobId,
      endpointUrl: config.endpoint,
      endpointDomain: domain,
      modelClaimed: config.model,
      modelDetected: report.modelDetected,
      totalScore: report.totalScore,
      confidenceLevel: report.confidenceLevel,
      status: 'completed',
      durationMs: report.durationMs,
      completedAt: new Date(),
    })

    // 插入各检测器结果
    for (const result of report.results) {
      await db.insert(detectionResults).values({
        jobId: config.jobId,
        detectorName: result.detectorName,
        score: result.score,
        maxScore: result.maxScore,
        status: result.status,
        details: result.details,
        findings: result.findings,
      })
    }

    const jobs = await db.select()
      .from(verificationJobs)
      .where(and(
        eq(verificationJobs.endpointDomain, domain),
        eq(verificationJobs.status, 'completed')
      ))
      .orderBy(desc(verificationJobs.completedAt), desc(verificationJobs.createdAt))

    const totalChecks = jobs.length
    const scoredJobs = jobs.filter((job) => typeof job.totalScore === 'number')
    const avgScore = scoredJobs.length > 0
      ? Number(
          (
            scoredJobs.reduce((sum, job) => sum + (job.totalScore ?? 0), 0) / scoredJobs.length
          ).toFixed(2)
        )
      : null

    const modelsVerified = buildModelsVerified(jobs)
    const lastCheckedAt = jobs[0]?.completedAt ?? jobs[0]?.createdAt ?? new Date()
    const overallStatus = getLeaderboardStatus(avgScore)

    const existingEntry = await db.select()
      .from(leaderboardEntries)
      .where(eq(leaderboardEntries.endpointDomain, domain))
      .limit(1)

    if (existingEntry.length > 0) {
      await db.update(leaderboardEntries)
        .set({
          totalChecks,
          avgScore: avgScore === null ? null : String(avgScore),
          lastCheckedAt,
          modelsVerified,
          overallStatus,
          updatedAt: new Date(),
        })
        .where(eq(leaderboardEntries.endpointDomain, domain))
    } else {
      await db.insert(leaderboardEntries).values({
        endpointDomain: domain,
        totalChecks,
        avgScore: avgScore === null ? null : String(avgScore),
        lastCheckedAt,
        modelsVerified,
        overallStatus,
      })
    }
  } catch (error) {
    // 数据库可能未配置，静默失败
    console.error('数据库保存失败:', error)
  }
}

function buildModelsVerified(
  jobs: Array<{
    modelClaimed: string
    totalScore: number | null
    completedAt: Date | null
    createdAt: Date
  }>
): LeaderboardModelRecord[] {
  const latestByModel = new Map<string, LeaderboardModelRecord>()

  for (const job of jobs) {
    if (latestByModel.has(job.modelClaimed)) {
      continue
    }

    latestByModel.set(job.modelClaimed, {
      model: job.modelClaimed,
      score: job.totalScore ?? 0,
      checkedAt: (job.completedAt ?? job.createdAt).toISOString(),
    })
  }

  return Array.from(latestByModel.values()).slice(0, 10)
}

function getLeaderboardStatus(avgScore: number | null): 'verified' | 'suspicious' | 'fake' | null {
  if (avgScore === null) return null
  if (avgScore >= 60) return 'verified'
  if (avgScore >= 35) return 'suspicious'
  return 'fake'
}
