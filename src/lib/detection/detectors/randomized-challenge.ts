import { SmartClient } from '@/lib/api-client/smart-client'
import { buildRandomizedChallenge, verifyRandomizedChallengeResponse } from '../randomized-challenge'
import { BaseDetector } from './base'
import type { DetectorResult, VerificationConfig } from '../types'

/**
 * 动态 nonce 挑战检测器
 * 用随机化输入识别缓存响应、固定题库白名单和忽略用户输入的伪装层。
 */
export class RandomizedChallengeDetector extends BaseDetector {
  readonly name = 'randomized-challenge'
  readonly displayName = '动态挑战反作弊检测'
  readonly maxScore = 10
  readonly description = '通过 nonce + 随机算术 JSON 挑战检测固定响应和白名单题库作弊'

  supports(): boolean {
    return true
  }

  async detect(config: VerificationConfig, onProgress: (message: string) => void): Promise<DetectorResult> {
    const client = new SmartClient(config.endpoint, config.apiKey, config.apiFormat ?? 'openai')
    const challenge = buildRandomizedChallenge(`${config.jobId}:${config.model}:${Date.now()}`)

    onProgress('正在执行动态 nonce 挑战...')

    try {
      const response = await client.send({
        model: config.model,
        messages: [{ role: 'user', content: challenge.prompt }],
        max_tokens: 200,
        temperature: 0,
      })
      const verification = verifyRandomizedChallengeResponse(challenge, response.text)
      const details = {
        nonce: challenge.nonce,
        a: challenge.a,
        b: challenge.b,
      }

      if (verification.passed) {
        return this.pass(10, verification.findings, details)
      }

      return this.fail(0, verification.findings, details)
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      return this.skip(`动态挑战检测无法执行: ${message}`)
    }
  }
}
