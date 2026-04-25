export interface RandomizedChallenge {
  nonce: string
  a: number
  b: number
  prompt: string
}

export interface RandomizedChallengeVerification {
  passed: boolean
  findings: string[]
}

function hashString(input: string): number {
  let hash = 2166136261
  for (const char of input) {
    hash ^= char.charCodeAt(0)
    hash = Math.imul(hash, 16777619)
  }
  return hash >>> 0
}

function numberFromHash(hash: number, offset: number, min: number, max: number): number {
  const span = max - min + 1
  return min + ((hash >>> offset) % span)
}

/**
 * 构建带 nonce 的动态挑战。
 *
 * 检测目标不是“难题能力”，而是确认中转站没有返回固定缓存、
 * 白名单题库答案或忽略用户输入。
 */
export function buildRandomizedChallenge(seed = `${Date.now()}-${crypto.randomUUID()}`): RandomizedChallenge {
  const hash = hashString(seed)
  const a = numberFromHash(hash, 0, 17, 97)
  const b = numberFromHash(hash, 8, 19, 89)
  const nonce = `nonce_${hash.toString(16).padStart(8, '0')}_${numberFromHash(hash, 16, 1000, 9999)}`

  return {
    nonce,
    a,
    b,
    prompt: [
      '请严格只输出一个 JSON 对象，不要使用 Markdown，不要解释。',
      `nonce 是 "${nonce}"。`,
      `请计算 a=${a}, b=${b}。`,
      '输出格式必须为 {"nonce":"...","sum":数字,"product":数字}。',
    ].join('\n'),
  }
}

function extractJsonObject(text: string): Record<string, unknown> | null {
  const trimmed = text.trim()
  const fenced = trimmed.match(/```(?:json)?\s*([\s\S]*?)\s*```/)
  const candidate = fenced?.[1] ?? trimmed
  const start = candidate.indexOf('{')
  const end = candidate.lastIndexOf('}')

  if (start === -1 || end === -1 || end <= start) return null

  try {
    const parsed = JSON.parse(candidate.slice(start, end + 1))
    return parsed && typeof parsed === 'object'
      ? parsed as Record<string, unknown>
      : null
  } catch {
    return null
  }
}

export function verifyRandomizedChallengeResponse(
  challenge: RandomizedChallenge,
  responseText: string
): RandomizedChallengeVerification {
  const findings: string[] = []
  const parsed = extractJsonObject(responseText)

  if (!parsed) {
    return {
      passed: false,
      findings: ['动态挑战失败: 响应不是可解析的 JSON 对象'],
    }
  }

  if (parsed.nonce !== challenge.nonce) {
    findings.push(`动态挑战失败: nonce 不匹配，期望 ${challenge.nonce}`)
  }

  if (parsed.sum !== challenge.a + challenge.b) {
    findings.push(`动态挑战失败: sum 不正确，期望 ${challenge.a + challenge.b}`)
  }

  if (parsed.product !== challenge.a * challenge.b) {
    findings.push(`动态挑战失败: product 不正确，期望 ${challenge.a * challenge.b}`)
  }

  if (findings.length === 0) {
    findings.push('动态 nonce 挑战通过: JSON、nonce、sum、product 全部匹配')
  }

  return {
    passed: findings.length === 1 && findings[0].startsWith('动态 nonce 挑战通过'),
    findings,
  }
}
