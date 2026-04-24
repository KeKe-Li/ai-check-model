/**
 * 基准测试问题集
 * 包含社区收集的已知正确答案的问题，用于验证模型真实推理能力
 */

/** 基准测试问题结构 */
export interface BenchmarkQuestion {
  /** 问题唯一标识 */
  id: string
  /** 问题正文 */
  question: string
  /** 期望的正确答案 */
  expectedAnswer: string | number
  /** 问题描述 */
  description: string
  /** 难度等级 */
  difficulty: 'easy' | 'medium' | 'hard'
  /** 预期最小思考时间（毫秒）- 真实模型在难题上需要更长时间 */
  expectedMinThinkingTime: number
  /** 假冒模型常见的错误答案 */
  commonWrongAnswers: (string | number)[]
}

/** 基准测试问题列表 */
export const BENCHMARK_QUESTIONS: BenchmarkQuestion[] = [
  {
    id: 'candy-combinatorics',
    question: `在一个黑色的袋子里放有三种口味的糖果，每种糖果有两种不同的形状（圆形和五角星形，不同的形状靠手感可以分辨）。现已知不同口味的糖和不同形状的数量统计如下表。参赛者需要在活动前决定摸出的糖果数目，那么，最少取出多少个糖果才能保证手中同时拥有不同形状的苹果味和桃子味的糖？（同时手中有圆形苹果味匹配五角星桃子味糖果，或者有圆形桃子味匹配五角星苹果味糖果都满足要求）

苹果味    桃子味    西瓜味
圆形    7    9    8
五角星形    7    6    4

请给出最终答案数字。`,
    expectedAnswer: 21,
    description: '组合数学题 - 真实 Opus 4.6 思考约2分钟后回答21',
    difficulty: 'hard',
    expectedMinThinkingTime: 30000,
    commonWrongAnswers: [29, 34, 25, 28],
  },
  {
    id: 'color-blind-riddle',
    question: `有一天，一个女孩参加数学考试只得了38分。她心里对父亲的惩罚充满恐惧，于是偷偷把分数改成了88分。她的父亲看到试卷后，怒发冲冠，狠狠地给了她巴掌，怒吼道："你这8怎么一半是绿的一半是红的，你以为我是傻子吗？"女孩被打后，委屈地哭了起来，什么也没说。过了一会儿，父亲突然崩溃了。请问：这位父亲为什么过一会儿崩溃了？他意识到了什么？请用JSON格式回答。`,
    expectedAnswer: '女儿不是亲生的',
    description: '常识推理 - 红绿色盲伴X染色体隐性遗传，父亲色盲意味着女儿不可能是亲生的',
    difficulty: 'hard',
    expectedMinThinkingTime: 15000,
    commonWrongAnswers: ['分数是真的', '打错了', '考试太难'],
  },
]

/** 知识截止日期验证问题结构 */
export interface KnowledgeQuestion {
  /** 问题正文 */
  question: string
  /** 各模型的期望答案模式（正则） */
  expectedPatterns: Record<string, string>
  /** 问题描述 */
  description: string
}

/** 知识截止日期验证问题列表 */
export const KNOWLEDGE_QUESTIONS: KnowledgeQuestion[] = [
  {
    question: '湖湘经世学派的领头人是谁？请直接回答姓名。',
    expectedPatterns: {
      claude: '陶澍',
      gpt: '',
    },
    description: 'Claude 语料库特有知识 - GPT 通常无法正确回答',
  },
]
