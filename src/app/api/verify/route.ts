import { NextRequest, NextResponse } from 'next/server'
import { v4 as uuidv4 } from 'uuid'
import { verifyInputSchema } from '@/lib/validators/verify-input'

/**
 * POST /api/verify
 *
 * 创建新的验证任务并返回 jobId
 *
 * 请求体:
 * - endpoint: API 端点 URL
 * - apiKey: API 密钥
 * - model: 声称的模型名称
 *
 * 响应:
 * - jobId: 任务唯一标识符
 * - streamUrl: SSE 流式接口 URL
 */
export async function POST(request: NextRequest) {
  try {
    const body = await request.json()
    const result = verifyInputSchema.safeParse(body)

    if (!result.success) {
      return NextResponse.json(
        { success: false, error: result.error.issues[0].message },
        { status: 400 }
      )
    }

    const jobId = uuidv4()

    return NextResponse.json({
      success: true,
      data: {
        jobId,
        streamUrl: `/api/verify/${jobId}/stream`,
      },
    })
  } catch {
    return NextResponse.json(
      { success: false, error: '请求格式错误' },
      { status: 400 }
    )
  }
}
