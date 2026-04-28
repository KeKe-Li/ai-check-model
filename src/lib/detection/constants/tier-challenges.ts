import type { ModelTier } from '../types'

export interface TierChallenge {
  id: string
  difficulty: 'flagship_only' | 'mid_and_above' | 'all'
  prompt: string
  validator: (response: string) => { passed: boolean; reason: string }
  expectedTier: ModelTier
}

/**
 * 多约束构造题
 * 旗舰模型能同时满足所有约束，中低端模型通常只能满足部分
 */
export const CONSTRAINT_CHALLENGES: TierChallenge[] = [
  {
    id: 'five-word-constraint',
    difficulty: 'flagship_only',
    prompt: `请严格按照以下所有约束，构造一个恰好包含5个英文单词的句子：
1. 第一个单词必须以字母 S 开头（大写）
2. 最后一个单词必须以字母 y 结尾
3. 整个句子不能超过30个字符（含空格）
4. 不能包含字母 z
5. 句子必须是语法正确的陈述句

只输出这个句子，不要任何解释或标点以外的内容。`,
    validator: (response: string) => {
      const cleaned = response.trim().replace(/[.!?]$/, '').trim()
      const words = cleaned.split(/\s+/)
      if (words.length !== 5) return { passed: false, reason: `单词数 ${words.length} ≠ 5` }
      if (!words[0].startsWith('S')) return { passed: false, reason: `首词不以 S 开头: "${words[0]}"` }
      if (!words[4].toLowerCase().endsWith('y')) return { passed: false, reason: `末词不以 y 结尾: "${words[4]}"` }
      if (cleaned.length > 30) return { passed: false, reason: `长度 ${cleaned.length} > 30` }
      if (/z/i.test(cleaned)) return { passed: false, reason: '包含字母 z' }
      return { passed: true, reason: '所有约束均满足' }
    },
    expectedTier: 'flagship',
  },
  {
    id: 'number-sequence-constraint',
    difficulty: 'flagship_only',
    prompt: `请生成一个恰好包含6个整数的序列，满足以下所有条件：
1. 所有数字都是两位数（10-99）
2. 序列严格递增
3. 相邻两数之差都不相同（即差值序列无重复）
4. 所有数字之和恰好等于 297
5. 序列中不包含任何偶数

只输出数字序列，用英文逗号分隔，不要有空格或其他文字。`,
    validator: (response: string) => {
      const nums = response.trim().split(',').map(s => parseInt(s.trim(), 10))
      if (nums.length !== 6) return { passed: false, reason: `数量 ${nums.length} ≠ 6` }
      if (nums.some(n => isNaN(n) || n < 10 || n > 99)) return { passed: false, reason: '包含非两位数' }
      if (nums.some(n => n % 2 === 0)) return { passed: false, reason: '包含偶数' }
      for (let i = 1; i < nums.length; i++) {
        if (nums[i] <= nums[i - 1]) return { passed: false, reason: '非严格递增' }
      }
      const diffs = []
      for (let i = 1; i < nums.length; i++) diffs.push(nums[i] - nums[i - 1])
      if (new Set(diffs).size !== diffs.length) return { passed: false, reason: '差值有重复' }
      const sum = nums.reduce((a, b) => a + b, 0)
      if (sum !== 297) return { passed: false, reason: `和 ${sum} ≠ 297` }
      return { passed: true, reason: '所有约束均满足' }
    },
    expectedTier: 'flagship',
  },
  {
    id: 'pattern-constraint',
    difficulty: 'mid_and_above',
    prompt: `请生成一个恰好8个字符的字符串，满足：
1. 只包含小写字母和数字
2. 恰好有3个数字和5个字母
3. 数字不能相邻
4. 第一个字符必须是字母
5. 最后一个字符必须是数字

只输出这个字符串，不要其他内容。`,
    validator: (response: string) => {
      const s = response.trim()
      if (s.length !== 8) return { passed: false, reason: `长度 ${s.length} ≠ 8` }
      if (!/^[a-z0-9]+$/.test(s)) return { passed: false, reason: '包含非法字符' }
      const digits = s.replace(/[^0-9]/g, '').length
      const letters = s.replace(/[^a-z]/g, '').length
      if (digits !== 3 || letters !== 5) return { passed: false, reason: `数字 ${digits} 个，字母 ${letters} 个` }
      if (/\d{2}/.test(s)) return { passed: false, reason: '数字相邻' }
      if (!/^[a-z]/.test(s)) return { passed: false, reason: '首字符非字母' }
      if (!/\d$/.test(s)) return { passed: false, reason: '末字符非数字' }
      return { passed: true, reason: '所有约束均满足' }
    },
    expectedTier: 'mid',
  },
]

/**
 * 精确字数控制测试
 * 旗舰模型能精确控制输出字数，中低端模型偏差较大
 */
export interface PrecisionChallenge {
  id: string
  getPrompt: () => { prompt: string; targetLength: number }
  tolerance: Record<ModelTier, number>
}

export const PRECISION_CHALLENGES: PrecisionChallenge[] = [
  {
    id: 'exact-char-count',
    getPrompt: () => {
      const targetLength = 30 + Math.floor(Math.random() * 30)
      return {
        prompt: `请用恰好 ${targetLength} 个中文字符（不含标点）回答：什么是人工智能？只输出回答内容，不要标点符号。`,
        targetLength,
      }
    },
    tolerance: { flagship: 3, mid: 8, low: 20 },
  },
  {
    id: 'exact-word-count',
    getPrompt: () => {
      const targetLength = 12 + Math.floor(Math.random() * 8)
      return {
        prompt: `Please write exactly ${targetLength} English words about the weather. Output only the words, no punctuation.`,
        targetLength,
      }
    },
    tolerance: { flagship: 1, mid: 3, low: 8 },
  },
]
