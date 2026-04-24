import { NextRequest, NextResponse } from 'next/server'
import { ScoreCalculator } from '@/lib/detection/score-calculator'
import type { DetectorResult, VerificationReport } from '@/lib/detection/types'

const DETECTOR_DISPLAY_NAMES: Record<string, string> = {
  metadata: '响应元数据分析',
  'magic-string': '魔术字符串验证',
  'identity-consistency': '身份一致性检测',
  'knowledge-cutoff': '知识截止日期验证',
  'thinking-block': '扩展思考验证',
  'output-format': '输出格式特征分析',
  'reasoning-benchmark': '推理能力基准测试',
  'latency-profile': '延迟特征分析',
}

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
  _request: NextRequest,
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
    const normalizedResults: DetectorResult[] = results.map((result) => ({
      detectorName: result.detectorName,
      displayName: DETECTOR_DISPLAY_NAMES[result.detectorName] ?? result.detectorName,
      score: result.score,
      maxScore: result.maxScore,
      status: result.status as DetectorResult['status'],
      details: (result.details as Record<string, unknown> | null) ?? {},
      findings: Array.isArray(result.findings) ? result.findings.map(String) : [],
    }))

    const totalScore = job[0].totalScore ?? 0
    const confidenceLevel = (job[0].confidenceLevel as VerificationReport['confidenceLevel'] | null)
      ?? ScoreCalculator.classifyConfidence(totalScore)

    const report: VerificationReport = {
      jobId,
      totalScore,
      confidenceLevel,
      verdict: ScoreCalculator.generateVerdict(
        totalScore,
        confidenceLevel,
        job[0].modelClaimed,
        normalizedResults
      ),
      modelClaimed: job[0].modelClaimed,
      modelDetected: job[0].modelDetected,
      results: normalizedResults,
      durationMs: job[0].durationMs ?? 0,
    }

    return NextResponse.json({
      success: true,
      data: {
        job: job[0],
        results: normalizedResults,
        report,
      },
    })
  } catch {
    return NextResponse.json(
      { success: false, error: '查询失败，数据库可能未配置' },
      { status: 500 }
    )
  }
}
