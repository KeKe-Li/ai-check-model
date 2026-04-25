import { v4 as uuidv4 } from 'uuid'
import type { VerificationConfig } from '@/lib/detection/types'

interface VerificationJobRecord {
  config: VerificationConfig
  expiresAt: number
}

interface CreateVerificationJobInput {
  endpoint: string
  apiKey: string
  model: string
}

interface CreateVerificationJobResult {
  jobId: string
  streamUrl: string
  resultUrl: string
}

const DEFAULT_TTL_MS = 30 * 60 * 1000

const globalStore = globalThis as typeof globalThis & {
  __aiCheckModelVerificationJobs?: Map<string, VerificationJobRecord>
}

function getStore(): Map<string, VerificationJobRecord> {
  if (!globalStore.__aiCheckModelVerificationJobs) {
    globalStore.__aiCheckModelVerificationJobs = new Map()
  }
  return globalStore.__aiCheckModelVerificationJobs
}

function cleanupExpiredJobs(now = Date.now()) {
  const store = getStore()
  for (const [jobId, record] of store.entries()) {
    if (record.expiresAt <= now) {
      store.delete(jobId)
    }
  }
}

/**
 * 创建服务端临时验证任务。
 *
 * 关键安全点：API Key 只保存在服务端内存，不进入 URL 查询参数。
 * 多实例 / Serverless 生产环境应替换为 Redis、加密 KV 或数据库临时表。
 */
export function createVerificationJob(
  input: CreateVerificationJobInput,
  ttlMs = DEFAULT_TTL_MS
): CreateVerificationJobResult {
  cleanupExpiredJobs()

  const jobId = uuidv4()
  const config: VerificationConfig = {
    jobId,
    endpoint: input.endpoint,
    apiKey: input.apiKey,
    model: input.model,
  }

  getStore().set(jobId, {
    config,
    expiresAt: Date.now() + ttlMs,
  })

  return {
    jobId,
    streamUrl: `/api/verify/${jobId}/stream`,
    resultUrl: `/verify/${jobId}`,
  }
}

/** 获取验证任务配置，任务不存在或过期时返回 null。 */
export function getVerificationJob(jobId: string): VerificationConfig | null {
  cleanupExpiredJobs()

  const record = getStore().get(jobId)
  if (!record) return null

  return { ...record.config }
}

/** 测试专用：清空内存任务。 */
export function clearVerificationJobsForTests() {
  getStore().clear()
}
