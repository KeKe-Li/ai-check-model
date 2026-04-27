/**
 * 基准测试问题集
 * 包含社区收集的已知正确答案的问题，用于验证模型真实推理能力
 *
 * 设计原则：
 * - 题库足够大（15+题），每次随机抽取 3 题，防止白名单缓存
 * - 支持参数随机化（ParameterizedBenchmarkQuestion），同一题型每次数字不同
 * - 覆盖多维度：数学推理、逻辑谜题、编程分析、常识推理、语言理解
 */

/** 静态基准测试问题 */
export interface BenchmarkQuestion {
  id: string
  question: string
  expectedAnswer: string | number
  description: string
  difficulty: 'easy' | 'medium' | 'hard'
  expectedMinThinkingTime: number
  commonWrongAnswers: (string | number)[]
}

/** 参数化基准测试问题（每次随机生成不同参数） */
export interface ParameterizedBenchmarkQuestion {
  id: string
  parameterized: true
  generateQuestion: () => { question: string; expectedAnswer: string | number; params: Record<string, unknown> }
  description: string
  difficulty: 'easy' | 'medium' | 'hard'
  expectedMinThinkingTime: number
  commonWrongAnswers: (string | number)[]
}

export type AnyBenchmarkQuestion = BenchmarkQuestion | ParameterizedBenchmarkQuestion

function isParameterized(q: AnyBenchmarkQuestion): q is ParameterizedBenchmarkQuestion {
  return 'parameterized' in q && q.parameterized === true
}

/** 将参数化题目实例化为静态题目 */
export function instantiateQuestion(q: AnyBenchmarkQuestion): BenchmarkQuestion {
  if (!isParameterized(q)) return q

  const { question, expectedAnswer } = q.generateQuestion()
  return {
    id: q.id,
    question,
    expectedAnswer,
    description: q.description,
    difficulty: q.difficulty,
    expectedMinThinkingTime: q.expectedMinThinkingTime,
    commonWrongAnswers: q.commonWrongAnswers,
  }
}

/** 从题库中随机抽取 n 题并实例化 */
export function sampleQuestions(pool: AnyBenchmarkQuestion[], n: number): BenchmarkQuestion[] {
  const shuffled = [...pool].sort(() => Math.random() - 0.5)
  return shuffled.slice(0, n).map(instantiateQuestion)
}

/** 辅助：计算斐波那契第 n 项 */
function fibonacci(n: number): number {
  let a = 1, b = 1
  for (let i = 3; i <= n; i++) {
    const temp = a + b
    a = b
    b = temp
  }
  return b
}

/** 辅助：随机整数 [min, max] */
function randInt(min: number, max: number): number {
  return min + Math.floor(Math.random() * (max - min + 1))
}

/** 完整题库 — 每次检测从中随机抽 3 题 */
export const BENCHMARK_QUESTION_POOL: AnyBenchmarkQuestion[] = [
  // ===== 数学推理 =====
  {
    id: 'candy-combinatorics',
    question: `在一个黑色的袋子里放有三种口味的糖果，每种糖果有两种不同的形状（圆形和五角星形，不同的形状靠手感可以分辨）。现已知不同口味的糖和不同形状的数量统计如下表。参赛者需要在活动前决定摸出的糖果数目，那么，最少取出多少个糖果才能保证手中同时拥有不同形状的苹果味和桃子味的糖？（同时手中有圆形苹果味匹配五角星桃子味糖果，或者有圆形桃子味匹配五角星苹果味糖果都满足要求）

苹果味    桃子味    西瓜味
圆形    7    9    8
五角星形    7    6    4

请给出最终答案数字。`,
    expectedAnswer: 21,
    description: '组合数学 — 最坏情况分析',
    difficulty: 'hard',
    expectedMinThinkingTime: 30000,
    commonWrongAnswers: [29, 34, 25, 28],
  },
  {
    id: 'color-blind-riddle',
    question: `有一天，一个女孩参加数学考试只得了38分。她心里对父亲的惩罚充满恐惧，于是偷偷把分数改成了88分。她的父亲看到试卷后，怒发冲冠，狠狠地给了她巴掌，怒吼道："你这8怎么一半是绿的一半是红的，你以为我是傻子吗？"女孩被打后，委屈地哭了起来，什么也没说。过了一会儿，父亲突然崩溃了。请问：这位父亲为什么过一会儿崩溃了？他意识到了什么？请用JSON格式回答。`,
    expectedAnswer: '女儿不是亲生的',
    description: '常识推理 — 红绿色盲遗传',
    difficulty: 'hard',
    expectedMinThinkingTime: 15000,
    commonWrongAnswers: ['分数是真的', '打错了', '考试太难'],
  },
  {
    id: 'fibonacci-modular',
    parameterized: true,
    generateQuestion() {
      const n = randInt(15, 25)
      const answer = fibonacci(n) % 7
      return {
        question: `斐波那契数列中，F(1)=1，F(2)=1，F(n)=F(n-1)+F(n-2)。请问 F(${n}) 除以 7 的余数是多少？请直接给出数字答案。`,
        expectedAnswer: answer,
        params: { n },
      }
    },
    description: '数学推理 — 斐波那契数列取模',
    difficulty: 'hard',
    expectedMinThinkingTime: 20000,
    commonWrongAnswers: [],
  },
  {
    id: 'sum-of-digits',
    parameterized: true,
    generateQuestion() {
      const base = randInt(100, 999)
      const power = randInt(2, 4)
      const result = Math.pow(base, power)
      const digitSum = String(result).split('').reduce((s, d) => s + Number(d), 0)
      return {
        question: `请计算 ${base} 的 ${power} 次方的各位数字之和。例如：123 的各位数字之和是 1+2+3=6。请直接给出最终数字。`,
        expectedAnswer: digitSum,
        params: { base, power, result },
      }
    },
    description: '数学推理 — 幂运算 + 数字求和',
    difficulty: 'medium',
    expectedMinThinkingTime: 15000,
    commonWrongAnswers: [],
  },
  {
    id: 'modular-arithmetic',
    parameterized: true,
    generateQuestion() {
      const a = randInt(17, 97)
      const b = randInt(13, 79)
      const m = randInt(7, 13)
      const answer = (a * b) % m
      return {
        question: `计算 ${a} × ${b} 除以 ${m} 的余数。请直接给出数字答案。`,
        expectedAnswer: answer,
        params: { a, b, m },
      }
    },
    description: '数学推理 — 模运算',
    difficulty: 'medium',
    expectedMinThinkingTime: 10000,
    commonWrongAnswers: [],
  },

  // ===== 逻辑谜题 =====
  {
    id: 'hat-puzzle-3',
    question: `三个人排成一列（A在最后能看到前面两人，B在中间能看到前面一人，C在最前面看不到任何人）。有3顶红帽子和2顶蓝帽子，每人头上随机放一顶。A说"我不知道我的帽子颜色"，B听后说"我也不知道"。请问C能否推断出自己的帽子颜色？如果能，是什么颜色？请简要说明推理过程。`,
    expectedAnswer: '红',
    description: '逻辑推理 — 经典帽子问题',
    difficulty: 'hard',
    expectedMinThinkingTime: 20000,
    commonWrongAnswers: ['蓝', '不能', '无法确定'],
  },
  {
    id: 'river-crossing',
    question: `一个农夫带着一只狼、一只羊和一棵白菜要过河。船只能装农夫和另外一样东西。如果农夫不在场，狼会吃羊，羊会吃白菜。请问农夫至少需要渡河多少次（单程算一次）才能把所有东西安全运到对岸？请直接回答数字。`,
    expectedAnswer: 7,
    description: '逻辑推理 — 经典过河问题',
    difficulty: 'medium',
    expectedMinThinkingTime: 10000,
    commonWrongAnswers: [5, 6, 8, 9],
  },
  {
    id: 'liar-truth-teller',
    question: `一个岔路口有两个守卫，一个只说真话，一个只说假话，但你不知道谁是谁。你只能问其中一个守卫一个问题来确定正确的路。如果你问"如果我问另一个守卫哪条路是正确的，他会指哪条？"，你应该走守卫指的那条路还是另一条路？请回答"指的那条"或"另一条"。`,
    expectedAnswer: '另一条',
    description: '逻辑推理 — 说谎者与诚实者',
    difficulty: 'medium',
    expectedMinThinkingTime: 12000,
    commonWrongAnswers: ['指的那条'],
  },

  // ===== 编程分析 =====
  {
    id: 'code-output-recursion',
    question: `以下 Python 代码的输出是什么？请只给出输出结果。

def f(n):
    if n <= 1:
        return n
    return f(n-1) + f(n-2)

print(f(10))`,
    expectedAnswer: 55,
    description: '编程分析 — 递归斐波那契',
    difficulty: 'easy',
    expectedMinThinkingTime: 5000,
    commonWrongAnswers: [89, 34, 10],
  },
  {
    id: 'code-output-loop',
    parameterized: true,
    generateQuestion() {
      const n = randInt(5, 12)
      let x = 0
      for (let i = 0; i < n; i++) {
        for (let j = i; j < n; j++) {
          x++
        }
      }
      return {
        question: `以下 Python 代码的输出是什么？请只给出数字。

n = ${n}
x = 0
for i in range(n):
    for j in range(i, n):
        x += 1
print(x)`,
        expectedAnswer: x,
        params: { n },
      }
    },
    description: '编程分析 — 嵌套循环计数',
    difficulty: 'medium',
    expectedMinThinkingTime: 10000,
    commonWrongAnswers: [],
  },
  {
    id: 'code-output-bitwise',
    parameterized: true,
    generateQuestion() {
      const a = randInt(10, 50)
      const b = randInt(10, 50)
      const answer = a ^ b
      return {
        question: `在编程中，^ 表示按位异或运算。请问 ${a} ^ ${b} 的结果是多少？请直接回答数字。`,
        expectedAnswer: answer,
        params: { a, b },
      }
    },
    description: '编程分析 — 位运算',
    difficulty: 'medium',
    expectedMinThinkingTime: 10000,
    commonWrongAnswers: [],
  },

  // ===== 常识推理 =====
  {
    id: 'physics-intuition',
    question: `在真空中，一根羽毛和一个铁球同时从同一高度自由下落。哪个先着地？请回答"羽毛"、"铁球"或"同时"。`,
    expectedAnswer: '同时',
    description: '常识推理 — 物理直觉（真空自由落体）',
    difficulty: 'easy',
    expectedMinThinkingTime: 3000,
    commonWrongAnswers: ['铁球', '羽毛'],
  },
  {
    id: 'calendar-reasoning',
    parameterized: true,
    generateQuestion() {
      const months31 = [1, 3, 5, 7, 8, 10, 12]
      const answer = months31.length
      return {
        question: '一年中有几个月有31天？请直接回答数字。',
        expectedAnswer: answer,
        params: {},
      }
    },
    description: '常识推理 — 日历知识',
    difficulty: 'easy',
    expectedMinThinkingTime: 3000,
    commonWrongAnswers: [6, 4, 5],
  },
  {
    id: 'survival-bias',
    question: `二战期间，军方统计了返航轰炸机上弹孔的分布，发现机翼和机身中弹最多，而引擎区域中弹最少。军方想加强飞机的装甲，应该重点加固哪个部位？请回答"机翼和机身"或"引擎区域"，并简要解释原因。`,
    expectedAnswer: '引擎区域',
    description: '常识推理 — 幸存者偏差',
    difficulty: 'medium',
    expectedMinThinkingTime: 8000,
    commonWrongAnswers: ['机翼和机身', '机翼'],
  },

  // ===== 语言理解 =====
  {
    id: 'chinese-idiom',
    question: `"朝三暮四"这个成语最初的含义是什么？请选择：A. 形容人反复无常 B. 形容用计谋欺骗别人 C. 形容早晚数量不同 D. 形容勤奋好学。请只回答选项字母。`,
    expectedAnswer: 'B',
    description: '语言理解 — 成语本义',
    difficulty: 'medium',
    expectedMinThinkingTime: 5000,
    commonWrongAnswers: ['A', 'C'],
  },
  {
    id: 'logical-negation',
    question: `"并非所有的学生都不喜欢数学"这句话等价于以下哪一句？A. 所有学生都喜欢数学 B. 有些学生喜欢数学 C. 没有学生喜欢数学 D. 有些学生不喜欢数学。请只回答选项字母。`,
    expectedAnswer: 'B',
    description: '语言理解 — 逻辑否定',
    difficulty: 'medium',
    expectedMinThinkingTime: 8000,
    commonWrongAnswers: ['A', 'D'],
  },
  {
    id: 'counting-trick',
    question: `一栋楼有20层。从1楼走到10楼需要走9段楼梯。请问从1楼走到20楼需要走几段楼梯？请直接回答数字。`,
    expectedAnswer: 19,
    description: '语言理解 — 数数陷阱',
    difficulty: 'easy',
    expectedMinThinkingTime: 3000,
    commonWrongAnswers: [20, 18],
  },
]

/** 每次检测抽取的题目数量 */
export const BENCHMARK_SAMPLE_SIZE = 3

/**
 * 兼容旧接口：导出原有的 BENCHMARK_QUESTIONS
 * 但推荐使用 sampleQuestions(BENCHMARK_QUESTION_POOL, BENCHMARK_SAMPLE_SIZE)
 */
export const BENCHMARK_QUESTIONS: BenchmarkQuestion[] = BENCHMARK_QUESTION_POOL
  .filter((q): q is BenchmarkQuestion => !('parameterized' in q))
  .slice(0, 2)

/** 知识截止日期验证问题结构 */
export interface KnowledgeQuestion {
  question: string
  expectedPatterns: Record<string, string>
  description: string
}

/** 知识截止日期验证问题列表（扩充至多题，每次随机抽 2 题） */
export const KNOWLEDGE_QUESTION_POOL: KnowledgeQuestion[] = [
  {
    question: '湖湘经世学派的领头人是谁？请直接回答姓名。',
    expectedPatterns: { claude: '陶澍', gpt: '' },
    description: 'Claude 语料库特有知识 — 陶澍',
  },
  {
    question: 'Anthropic 公司的两位联合创始人是谁？请回答他们的全名。',
    expectedPatterns: { claude: 'dario', gpt: 'dario' },
    description: '模型相关知识 — Anthropic 创始人',
  },
  {
    question: 'Claude 模型的名字来源是什么？是以谁命名的？',
    expectedPatterns: { claude: 'shannon', gpt: '' },
    description: 'Claude 特有知识 — Claude Shannon 命名来源',
  },
  {
    question: '"Constitutional AI"（宪法AI）这个概念是由哪家公司提出的？请回答公司名称。',
    expectedPatterns: { claude: 'anthropic', gpt: 'anthropic' },
    description: '模型相关知识 — Constitutional AI',
  },
  {
    question: 'OpenAI 的第一任 CEO 是谁？',
    expectedPatterns: { claude: '', gpt: 'sam altman' },
    description: 'GPT 相关知识 — OpenAI CEO',
  },
  {
    question: 'GPT-4 的技术报告中提到的 MMLU 基准测试得分大约是多少百分比？',
    expectedPatterns: { claude: '', gpt: '86' },
    description: 'GPT 特有知识 — GPT-4 基准分数',
  },
  {
    question: '请问"紫斑风铃草"的花语是什么？',
    expectedPatterns: { claude: '感谢', gpt: '' },
    description: 'Claude 语料库深层知识测试',
  },
  {
    question: 'RLHF 的全称是什么？它在 AI 训练中的作用是什么？请用一句话概括。',
    expectedPatterns: { claude: 'reinforcement learning from human feedback', gpt: 'reinforcement learning from human feedback' },
    description: '通用 AI 知识',
  },
]

export const KNOWLEDGE_SAMPLE_SIZE = 2

/** 兼容旧接口 */
export const KNOWLEDGE_QUESTIONS: KnowledgeQuestion[] = KNOWLEDGE_QUESTION_POOL.slice(0, 1)

/** 从知识题库随机抽取 */
export function sampleKnowledgeQuestions(n: number = KNOWLEDGE_SAMPLE_SIZE): KnowledgeQuestion[] {
  const shuffled = [...KNOWLEDGE_QUESTION_POOL].sort(() => Math.random() - 0.5)
  return shuffled.slice(0, n)
}
