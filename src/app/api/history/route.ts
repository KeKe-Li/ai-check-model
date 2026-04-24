import { NextRequest, NextResponse } from 'next/server'

/**
 * GET /api/history
 *
 * 分页查询验证历史记录
 *
 * 查询参数:
 * - page: 页码（默认 1）
 * - limit: 每页数量（默认 20）
 * - model: 模型名称过滤（可选）
 *
 * 响应:
 * - data: 验证任务列表
 * - pagination: 分页信息（page, limit, total, totalPages）
 */
export async function GET(request: NextRequest) {
  const searchParams = request.nextUrl.searchParams
  const page = parseInt(searchParams.get('page') || '1')
  const limit = parseInt(searchParams.get('limit') || '20')
  const model = searchParams.get('model')
  const offset = (page - 1) * limit

  try {
    const { db } = await import('@/lib/db')
    const { verificationJobs } = await import('@/lib/db/schema')
    const { desc, eq, sql, and } = await import('drizzle-orm')

    // 构建查询条件
    const conditions = [eq(verificationJobs.status, 'completed')]
    if (model) {
      conditions.push(sql`${verificationJobs.modelClaimed} LIKE ${`%${model}%`}`)
    }

    const whereClause = conditions.length > 1 ? and(...conditions) : conditions[0]

    const [data, countResult] = await Promise.all([
      db.select()
        .from(verificationJobs)
        .where(whereClause)
        .orderBy(desc(verificationJobs.createdAt))
        .limit(limit)
        .offset(offset),
      db.select({ count: sql<number>`count(*)` })
        .from(verificationJobs)
        .where(whereClause),
    ])

    const total = Number(countResult[0]?.count ?? 0)

    return NextResponse.json({
      success: true,
      data: {
        data,
        pagination: { page, limit, total, totalPages: Math.ceil(total / limit) },
      },
    })
  } catch {
    return NextResponse.json(
      { success: false, error: '查询失败，数据库可能未配置' },
      { status: 500 }
    )
  }
}
