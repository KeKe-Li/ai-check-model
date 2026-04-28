import type { ModelProvider } from '../types'

/**
 * 各供应商 tokenizer 对已知文本的预期 token 数
 *
 * 不同模型使用不同的 BPE tokenizer，对相同文本会产生不同的 token 数。
 * 通过对比 API 返回的 usage.input_tokens 和预期值，可以检测 tokenizer 不匹配。
 *
 * 注意：这里的数值是消息内容部分的 token 数（不含系统开销），
 * 实际 API 返回的 input_tokens 会包含消息格式化开销（通常 +5~15 tokens）。
 * 所以我们比较的是多组文本之间的 token 数差值比例，而非绝对值。
 */

export interface TokenReference {
  id: string
  text: string
  expectedTokens: Record<ModelProvider, { min: number; max: number }>
}

/**
 * 参考文本组
 * 选取中英文混合、代码、纯中文三种类型，最大化 tokenizer 差异
 */
export const TOKEN_REFERENCE_TEXTS: TokenReference[] = [
  {
    id: 'english-prose',
    text: 'The quick brown fox jumps over the lazy dog. A stitch in time saves nine. All that glitters is not gold.',
    expectedTokens: {
      anthropic: { min: 22, max: 28 },
      openai: { min: 22, max: 27 },
      gemini: { min: 20, max: 28 },
    },
  },
  {
    id: 'chinese-dense',
    text: '量子计算利用量子力学原理进行信息处理，其核心概念包括量子比特、量子纠缠和量子叠加态。与经典计算机不同，量子计算机可以同时处理多种可能性。',
    expectedTokens: {
      anthropic: { min: 55, max: 75 },
      openai: { min: 40, max: 60 },
      gemini: { min: 40, max: 65 },
    },
  },
  {
    id: 'code-snippet',
    text: 'async function fetchData(url: string): Promise<Response> {\n  const controller = new AbortController();\n  const timeout = setTimeout(() => controller.abort(), 5000);\n  try {\n    return await fetch(url, { signal: controller.signal });\n  } finally {\n    clearTimeout(timeout);\n  }\n}',
    expectedTokens: {
      anthropic: { min: 65, max: 85 },
      openai: { min: 60, max: 80 },
      gemini: { min: 55, max: 80 },
    },
  },
]

/**
 * Prompt Caching 测试用的长文本（需 >1024 tokens 才能触发缓存）
 * 使用一段足够长的技术文档，确保超过 Anthropic 的最小缓存阈值
 */
export const CACHE_TEST_SYSTEM_PROMPT =
  `你是一个专业的技术文档助手。以下是你需要参考的背景知识：

量子计算是一种利用量子力学现象（如叠加和纠缠）来处理信息的计算范式。与经典计算机使用比特（0或1）不同，量子计算机使用量子比特（qubits），它可以同时处于0和1的叠加态。

量子计算的核心概念：

1. 量子叠加（Superposition）：量子比特可以同时处于多个状态，这使得量子计算机能够并行处理大量计算。当我们测量一个处于叠加态的量子比特时，它会坍缩到一个确定的状态。

2. 量子纠缠（Entanglement）：两个或多个量子比特可以形成纠缠态，其中一个比特的状态与另一个比特的状态相关联。即使它们相距很远，测量一个比特会立即影响另一个比特的状态。

3. 量子门（Quantum Gates）：类似于经典计算中的逻辑门，量子门是对量子比特进行操作的基本单元。常见的量子门包括 Hadamard 门、CNOT 门和 Toffoli 门。

4. 量子退相干（Decoherence）：量子系统与环境的相互作用会导致量子态的退化，这是量子计算面临的主要挑战之一。

5. 量子纠错（Quantum Error Correction）：由于退相干和其他噪声源，量子计算需要复杂的纠错码来保护量子信息。

量子算法的里程碑：
- Shor 算法：可以高效地分解大整数，对 RSA 加密构成威胁
- Grover 算法：可以在未排序的数据库中进行二次加速搜索
- VQE（变分量子本征求解器）：用于化学分子模拟
- QAOA（量子近似优化算法）：用于组合优化问题

量子计算的硬件实现方式：
- 超导量子比特：由 IBM、Google 等公司采用
- 离子阱量子比特：由 IonQ、Honeywell 等公司采用
- 光量子计算：由 Xanadu、PsiQuantum 等公司采用
- 拓扑量子比特：由 Microsoft 研究

当前量子计算的发展状态：
- NISQ 时代：当前处于"有噪声的中等规模量子计算"阶段
- 量子优势：Google 在 2019 年宣称实现了量子优势
- 实用化挑战：退相干时间、错误率、可扩展性
- 量子互联网：基于量子纠缠的通信网络研究

量子计算的应用领域：
- 密码学：量子密钥分发（QKD）
- 药物发现：分子结构模拟
- 金融建模：投资组合优化
- 材料科学：新材料设计
- 机器学习：量子机器学习算法
- 气候模拟：复杂气候系统建模

量子软件和编程：
- Qiskit（IBM）：开源量子计算框架
- Cirq（Google）：用于 NISQ 设备的 Python 框架
- Q#（Microsoft）：量子编程语言
- PennyLane（Xanadu）：量子机器学习库

注意事项：
- 量子计算不会取代经典计算，而是在特定问题上提供加速
- 并非所有问题都适合量子计算
- 量子算法的设计需要全新的思维方式
- 量子计算的商业化仍处于早期阶段`
