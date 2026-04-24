import { z } from 'zod'

/**
 * 验证输入 Schema
 * 用于验证用户提交的 API 端点验证请求
 */
export const verifyInputSchema = z.object({
  endpoint: z.string().url('请提供有效的 URL').describe('API 端点 URL'),
  apiKey: z.string().min(1, 'API Key 不能为空').describe('API 密钥'),
  model: z.string().min(1, '请选择模型').describe('要验证的模型'),
})

/**
 * 验证输入类型
 * 从 Schema 推导的 TypeScript 类型
 */
export type VerifyInput = z.infer<typeof verifyInputSchema>
