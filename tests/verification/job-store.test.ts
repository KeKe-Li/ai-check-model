import { describe, expect, it } from 'vitest'
import {
  clearVerificationJobsForTests,
  createVerificationJob,
  getVerificationJob,
} from '@/lib/verification/job-store'

describe('verification job store', () => {
  it('服务端保存敏感验证配置，只把 jobId 暴露给前端', () => {
    clearVerificationJobsForTests()

    const job = createVerificationJob({
      endpoint: 'https://relay.example.com/v1',
      apiKey: 'sk-secret',
      model: 'gpt-4o',
    })

    expect(job.jobId).toMatch(/^[0-9a-f-]{36}$/)
    expect(job.streamUrl).toBe(`/api/verify/${job.jobId}/stream`)
    expect(job.resultUrl).toBe(`/verify/${job.jobId}`)
    expect(job.streamUrl).not.toContain('sk-secret')
    expect(job.resultUrl).not.toContain('sk-secret')

    expect(getVerificationJob(job.jobId)).toEqual({
      endpoint: 'https://relay.example.com/v1',
      apiKey: 'sk-secret',
      model: 'gpt-4o',
      jobId: job.jobId,
    })
  })
})
