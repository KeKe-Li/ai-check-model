import { NextRequest, NextResponse } from 'next/server'

/**
 * GET /api/leaderboard
 *
 * 获取模型排行榜数据
 * 按平均分数降序排列，最多返回 50 条记录
 *
 * 响应:
 * - data: 排行榜条目列表
 */
export async function GET(request: NextRequest) {
  try {
    const { db } = await import('@/lib/db')
    const { leaderboardEntries } = await import('@/lib/db/schema')
    const { desc } = await import('drizzle-orm')

    const data = await db.select()
      .from(leaderboardEntries)
      .orderBy(desc(leaderboardEntries.avgScore))
      .limit(50)

    return NextResponse.json({ success: true, data })
  } catch {
    return NextResponse.json(
      { success: false, error: '查询失败，数据库可能未配置' },
      { status: 500 }
    )
  }
}
