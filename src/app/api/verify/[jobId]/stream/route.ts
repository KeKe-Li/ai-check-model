import { NextRequest } from 'next/server'
import { DetectionOrchestrator } from '@/lib/detection/orchestrator'
import type { VerificationConfig, DetectionEvent, VerificationReport } from '@/lib/detection/types'
import { getVerificationJob } from '@/lib/verification/job-store'

export const runtime = 'nodejs'
export const maxDuration = 300  // 5 分钟最大执行时间

/**
 * GET /api/verify/[jobId]/stream
 *
 * 服务器发送事件 (SSE) 端点，实时推送检测进度
 *
 * 安全说明:
 * - 仅从路径读取 jobId
 * - endpoint/apiKey/model 从服务端临时任务读取
 * - API Key 不进入 URL 查询参数
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
  // 读取 request.url，确保该 Route Handler 明确保持动态执行。
  void request.url

  const storedConfig = getVerificationJob(jobId)

  if (!storedConfig) {
    return new Response('验证任务不存在或已过期，请返回首页重新提交', { status: 404 })
  }

  const config: VerificationConfig = storedConfig
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
    if (!db) return // DATABASE_URL 未配置，跳过保存

    const { verificationJobs, detectionResults } = await import('@/lib/db/schema')

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
  } catch (error) {
    // 数据库可能未配置，静默失败
    console.error('数据库保存失败:', error)
  }
}
