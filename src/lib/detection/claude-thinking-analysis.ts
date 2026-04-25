export interface ClaudeThinkingBlock {
  type: string
  thinking?: string
  text?: string
  signature?: string
  data?: string
}

export interface ClaudeThinkingAnalysis {
  score: number
  hasThinking: boolean
  hasSignature: boolean
  findings: string[]
}

export interface ClaudeRedactedThinkingAnalysis {
  score: number
  hasRedactedThinking: boolean
  findings: string[]
}

export function analyzeClaudeThinkingBlocks(
  blocks: ClaudeThinkingBlock[] | null | undefined
): ClaudeThinkingAnalysis {
  const thinkingBlocks = blocks?.filter((block) => block.type === 'thinking') ?? []
  const thinkingText = thinkingBlocks
    .map((block) => block.thinking ?? block.text ?? '')
    .join('\n')
  const hasThinking = thinkingText.trim().length > 0
  const hasSignature = thinkingBlocks.some((block) =>
    typeof block.signature === 'string' && block.signature.length >= 20
  )
  const findings: string[] = []
  let score = 0

  if (thinkingBlocks.length === 0) {
    return {
      score,
      hasThinking: false,
      hasSignature: false,
      findings: ['响应中未发现 Claude thinking block'],
    }
  }

  if (thinkingText.length > 80) {
    score += 6
    findings.push(`Claude thinking block 内容有效: ${thinkingBlocks.length} 个块，共 ${thinkingText.length} 字符`)
  } else if (thinkingText.length > 0) {
    score += 4
    findings.push(`Claude thinking block 内容较短: ${thinkingText.length} 字符`)
  } else {
    findings.push('Claude thinking block 存在但内容为空')
  }

  if (hasSignature) {
    score += 4
    findings.push('Claude thinking block 包含 signature 字段，符合 Anthropic extended thinking 指纹')
  } else {
    findings.push('Claude thinking block 未暴露 signature 字段，可能被中转层剥离')
  }

  return {
    score,
    hasThinking,
    hasSignature,
    findings,
  }
}

export function analyzeClaudeRedactedThinking(
  blocks: ClaudeThinkingBlock[] | null | undefined
): ClaudeRedactedThinkingAnalysis {
  const redactedBlocks = blocks?.filter((block) =>
    block.type === 'redacted_thinking' ||
    Boolean(block.data) ||
    (block.thinking ?? block.text ?? '').toLowerCase().includes('redacted')
  ) ?? []
  const findings: string[] = []

  if (redactedBlocks.length > 0) {
    findings.push(`redacted_thinking 验证通过: 捕获 ${redactedBlocks.length} 个被编辑思考块`)
    return {
      score: 8,
      hasRedactedThinking: true,
      findings,
    }
  }

  findings.push('未捕获 redacted_thinking 块或 redacted 文本')
  return {
    score: 0,
    hasRedactedThinking: false,
    findings,
  }
}
