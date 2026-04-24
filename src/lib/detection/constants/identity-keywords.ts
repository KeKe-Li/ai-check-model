/**
 * 模型身份关键词常量
 * 用于识别模型自我声明和检测身份矛盾
 */

/** Claude 系列模型身份关键词 */
export const CLAUDE_KEYWORDS = ['claude', 'anthropic', 'constitutional ai']

/** GPT 系列模型身份关键词 */
export const GPT_KEYWORDS = ['gpt', 'openai', 'chatgpt']

/** Gemini 系列模型身份关键词 */
export const GEMINI_KEYWORDS = ['gemini', 'google', 'bard']

/**
 * 反向关键词集合
 * 如果声称是某模型但出现这些关键词，则高度可疑
 */

/** 声称是 Claude 时不应出现的关键词 */
export const NON_CLAUDE_KEYWORDS = [
  'openai', 'gpt', 'chatgpt', 'gemini', 'google', 'bard',
  'llama', 'meta', 'mistral', 'kiro', 'openclaw', 'deepseek',
]

/** 声称是 GPT 时不应出现的关键词 */
export const NON_GPT_KEYWORDS = [
  'claude', 'anthropic', 'gemini', 'google', 'bard',
  'llama', 'meta', 'mistral', 'deepseek',
]

/** 声称是 Gemini 时不应出现的关键词 */
export const NON_GEMINI_KEYWORDS = [
  'claude', 'anthropic', 'openai', 'gpt', 'chatgpt',
  'llama', 'meta', 'mistral', 'deepseek',
]

/** 已知代理 / 套壳标识符 */
export const PROXY_IDENTIFIERS = [
  'kiro', 'openclaw', '反重力', 'poe', 'forefront',
  'you.com', 'perplexity', 'phind',
]
