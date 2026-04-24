import { NextRequest, NextResponse } from 'next/server'

/**
 * GET /api/verify/[jobId]
 *
 * 获取已完成的验证任务结果
 *
 * 响应:
 * - job: 验证任务信息
 * - results: 各检测器详细结果
 */
export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ jobId: string }> }
) {
  const { jobId } = await params

  try {
    const { db } = await import('@/lib/db')
    const { verificationJobs, detectionResults } = await import('@/lib/db/schema')
    const { eq } = await import('drizzle-orm')

    const job = await db.select().from(verificationJobs).where(eq(verificationJobs.id, jobId)).limit(1)

    if (job.length === 0) {
      return NextResponse.json({ success: false, error: '验证任务不存在' }, { status: 404 })
    }

    const results = await db.select().from(detectionResults).where(eq(detectionResults.jobId, jobId))

    return NextResponse.json({
      success: true,
      data: {
        job: job[0],
        results,
      },
    })
  } catch (error) {
    return NextResponse.json(
      { success: false, error: '查询失败，数据库可能未配置' },
      { status: 500 }
    )
  }
}
