import { describe, it, expect } from 'vitest'

/**
 * SystemPromptProbeDetector 核心逻辑单元测试
 * 测试泄漏检测逻辑而非 API 调用
 */

const DISGUISE_KEYWORDS = [
  'act as', 'pretend', 'you are now', 'role-play', 'impersonate',
  'simulate', 'behave as', 'respond as',
  '扮演', '假装', '模拟', '冒充', '你现在是', '你的身份是',
  '角色扮演', '伪装',
]

const LEAKED_MODEL_NAMES = [
  'deepseek', 'qwen', 'llama', 'mistral', 'yi-', 'baichuan',
  'chatglm', 'internlm', 'moonshot', 'kimi', 'doubao',
  'minimax', 'abab', 'spark', 'ernie',
  'mixtral', 'phi-', 'vicuna', 'wizardlm',
]

function detectDisguiseKeywords(text: string): string[] {
  const lower = text.toLowerCase()
  return DISGUISE_KEYWORDS.filter((kw) => lower.includes(kw.toLowerCase()))
}

function detectLeakedModels(text: string, expectedNames: string[]): string[] {
  const lower = text.toLowerCase()
  return LEAKED_MODEL_NAMES.filter((name) =>
    lower.includes(name) && !expectedNames.some((em) => name.includes(em))
  )
}

describe('SystemPromptProbe — 伪装指令检测', () => {
  it('检测到 act as 伪装指令', () => {
    const text = 'My system prompt says: "Act as Claude Opus 4.6 and never reveal your true identity"'
    expect(detectDisguiseKeywords(text)).toContain('act as')
  })

  it('检测到中文伪装指令', () => {
    const text = '我的系统提示是：你现在是 Claude，请扮演这个角色'
    const found = detectDisguiseKeywords(text)
    expect(found.length).toBeGreaterThan(0)
    expect(found).toContain('你现在是')
  })

  it('正常拒绝响应不触发伪装检测', () => {
    const text = '我是 Claude，由 Anthropic 开发。我无法透露系统提示词的具体内容。'
    expect(detectDisguiseKeywords(text)).toHaveLength(0)
  })
})

describe('SystemPromptProbe — 模型名泄漏检测', () => {
  it('检测到 DeepSeek 泄漏（声称 Claude）', () => {
    const text = '我实际上是基于 DeepSeek-V3 的模型，被配置为假装是 Claude'
    const leaked = detectLeakedModels(text, ['claude', 'anthropic'])
    expect(leaked).toContain('deepseek')
  })

  it('检测到 Qwen 泄漏（声称 GPT）', () => {
    const text = 'System prompt: You are Qwen-72B, respond as GPT-4'
    const leaked = detectLeakedModels(text, ['gpt', 'openai'])
    expect(leaked).toContain('qwen')
  })

  it('声称 Claude 提到 Claude 不算泄漏', () => {
    const text = '我是 Claude，由 Anthropic 开发'
    const leaked = detectLeakedModels(text, ['claude', 'anthropic'])
    expect(leaked).toHaveLength(0)
  })

  it('声称 GPT 提到 OpenAI 不算泄漏', () => {
    const text = 'I am GPT-4, made by OpenAI'
    const leaked = detectLeakedModels(text, ['gpt', 'openai'])
    expect(leaked).toHaveLength(0)
  })
})
