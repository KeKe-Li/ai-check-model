import { neon } from '@neondatabase/serverless'
import { drizzle } from 'drizzle-orm/neon-http'
import * as schema from './schema'

/**
 * Neon HTTP 连接实例
 * 使用环境变量 DATABASE_URL 配置连接字符串
 */
const sql = neon(process.env.DATABASE_URL!)

/**
 * Drizzle ORM 数据库实例
 * 包含完整的 schema 类型定义
 */
export const db = drizzle(sql, { schema })

/**
 * 数据库类型，用于依赖注入和类型推导
 */
export type Database = typeof db
