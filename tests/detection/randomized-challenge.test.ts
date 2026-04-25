import { describe, expect, it } from 'vitest'
import {
  buildRandomizedChallenge,
  verifyRandomizedChallengeResponse,
} from '@/lib/detection/randomized-challenge'

describe('randomized challenge probe', () => {
  it('生成带 nonce 的随机挑战，防止固定题库白名单作弊', () => {
    const first = buildRandomizedChallenge('job-a')
    const second = buildRandomizedChallenge('job-b')

    expect(first.nonce).not.toBe(second.nonce)
    expect(first.prompt).toContain(first.nonce)
    expect(first.prompt).toContain('"sum"')
    expect(first.prompt).toContain('"product"')
  })

  it('严格校验 JSON、nonce、sum 和 product', () => {
    const challenge = buildRandomizedChallenge('job-fixed')
    const response = JSON.stringify({
      nonce: challenge.nonce,
      sum: challenge.a + challenge.b,
      product: challenge.a * challenge.b,
    })

    expect(verifyRandomizedChallengeResponse(challenge, response).passed).toBe(true)
    expect(verifyRandomizedChallengeResponse(challenge, '{"nonce":"wrong","sum":1,"product":2}').passed).toBe(false)
  })
})
