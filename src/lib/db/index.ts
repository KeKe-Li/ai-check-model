import { neon } from '@neondatabase/serverless'
import { drizzle } from 'drizzle-orm/neon-http'
import * as schema from './schema'

/**
 * 数据库连接（可选）
 *
 * DATABASE_URL 未设置时返回 null，调用方应先判空再操作。
 * 这样在本地开发或未配置数据库的环境中，检测流程不受影响。
 */
function createDb() {
  const url = process.env.DATABASE_URL
  if (!url) return null

  const sql = neon(url)
  return drizzle(sql, { schema })
}

export const db = createDb()

/**
 * 数据库类型，用于依赖注入和类型推导
 */
export type Database = NonNullable<typeof db>
