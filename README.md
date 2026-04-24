# AI Check Model

一个用于检测 **API 中转站 / Relay / Proxy** 是否真的在提供目标模型的网站。

目前支持对 **Claude、GPT、Gemini** 系列模型做多维度校验，并提供：

- 实时 SSE 检测进度
- 单次验证详情页
- 历史记录
- 按域名聚合的排行榜

---

## 项目目标

很多中转站会宣称自己提供某个高端模型，但实际返回的可能是：

- 更便宜的替代模型
- 套壳后的兼容接口
- 经过额外代理、改写、过滤后的结果

本项目的目标不是只看一个字段，而是通过多种信号综合判断：

- 响应元数据是否像官方
- 身份回答是否自洽
- 能力边界是否符合目标模型
- 是否具备 thinking / reasoning 等高阶能力
- 延迟与输出风格是否可疑

---

## 当前能力

### 1. 多维度检测

当前内置 8 个检测器：

| 检测器 | 满分 | 说明 |
| --- | ---: | --- |
| Metadata | 15 | 检查响应结构、ID 格式、HTTP Header、返回 model 字段 |
| Magic String | 20 | 针对 Anthropic 模型的魔术字符串校验 |
| Identity Consistency | 20 | 多轮追问模型身份，检查是否自相矛盾或暴露代理痕迹 |
| Knowledge Cutoff | 15 | 检查知识截止日期与特定知识点 |
| Thinking Block | 20 | 检查 thinking / reasoning 能力是否真实存在 |
| Output Format | 10 | 检查引号风格、Markdown 结构等输出特征 |
| Reasoning Benchmark | 15 | 通过推理题验证模型能力和响应时间 |
| Latency Profile | 5 | 分析简单请求和流式 TTFB 的延迟模式 |

### 2. 实时流式反馈

验证过程通过 SSE 推送，前端会实时展示：

- 当前运行中的检测器
- 已完成项目
- 每项得分
- 综合评分阶段

### 3. 历史记录与排行榜

配置数据库后，系统会自动持久化：

- 单次验证任务
- 每个检测器的详细结果
- 以域名为维度的排行榜聚合数据

---

## 支持模型

当前内置模型列表来自 `src/lib/detection/types.ts`。

### Claude

- Claude Opus 4.7
- Claude Opus 4.6
- Claude Sonnet 4.5
- Claude Sonnet 4

### OpenAI

- GPT-5.4
- GPT-5.2
- GPT-4o
- o3

### Google

- Gemini 3.1 Pro
- Gemini 3 Flash
- Gemini 2.5 Pro

---

## 技术栈

- **Framework**: Next.js 16.2.4（App Router）
- **UI**: React 19 + Tailwind CSS 4 + shadcn/ui + framer-motion
- **Validation**: Zod + react-hook-form
- **Database**: Drizzle ORM + PostgreSQL
- **Testing**: Vitest + Testing Library
- **Language**: TypeScript

---

## 项目结构

```text
src/
├─ app/
│  ├─ page.tsx                     # 首页
│  ├─ history/page.tsx            # 历史记录页
│  ├─ leaderboard/page.tsx        # 排行榜页
│  ├─ verify/[jobId]/page.tsx     # 验证详情页
│  └─ api/
│     ├─ verify/route.ts          # 创建验证任务
│     ├─ verify/[jobId]/route.ts  # 获取已保存结果
│     ├─ verify/[jobId]/stream/route.ts # SSE 检测流
│     ├─ history/route.ts         # 历史记录 API
│     └─ leaderboard/route.ts     # 排行榜 API
├─ components/
│  ├─ layout/                     # Header / Footer
│  ├─ verify/                     # 验证页相关组件
│  └─ ui/                         # 通用 UI 组件
├─ hooks/
│  └─ useVerificationStream.ts    # SSE 客户端逻辑
├─ lib/
│  ├─ api-client/                 # Anthropic / OpenAI 兼容客户端
│  ├─ db/                         # Drizzle schema 与数据库实例
│  ├─ detection/                  # 检测编排、评分、检测器
│  └─ validators/                 # 输入校验
└─ types/
   └─ index.ts                    # 通用类型
```

---

## 本地开发

### 1. 安装依赖

可使用 npm 或 pnpm。

```bash
npm install
```

或：

```bash
pnpm install
```

### 2. 配置环境变量（可选）

数据库不是必需的：

- **不配置数据库**：核心检测功能可用，但历史记录 / 排行榜 / 持久化结果不可用
- **配置数据库**：验证结果会写入数据库，并参与排行榜聚合

创建 `.env.local`：

```bash
DATABASE_URL=postgresql://postgres:postgres@localhost:5432/ai_check_model
```

> `drizzle.config.ts` 会从 `.env.local` 读取 `DATABASE_URL`。
> 运行容器时，也可以通过 `.env` / `docker compose` / `-e DATABASE_URL=...` 注入该变量。

### 3. 推送数据库表结构（可选）

```bash
npx drizzle-kit push
```

或：

```bash
pnpm drizzle-kit push
```

### 4. 启动开发服务器

```bash
npm run dev
```

启动后访问：

```text
http://localhost:3000
```

---

## 可用脚本

```bash
npm run dev
npm run build
npm run start
npm run lint
npm run docker:build
npm run docker:run
npm run docker:up
npm run docker:down
npm run docker:logs
npm run docker:dev:up
npm run docker:dev:down
npm run docker:dev:logs
```

---

## Docker

项目已内置：

- `Dockerfile`
- `compose.yaml`

并使用 Next.js 的 `output: "standalone"` 生成最小运行时镜像。
默认情况下，`compose.yaml` 和 `compose.dev.yaml` 都会启动一个本地 Postgres 服务。

### 1. 直接构建镜像

```bash
docker build -t ai-check-model .
```

或：

```bash
npm run docker:build
```

### 2. 运行容器

不带数据库：

```bash
docker run -p 3000:3000 ai-check-model
```

或：

```bash
npm run docker:run
```

带外部数据库连接串：

```bash
docker run -p 3000:3000 -e DATABASE_URL=your_postgres_database_url ai-check-model
```

### 3. 使用 Docker Compose

先准备 `.env` 文件（可选）：

```bash
POSTGRES_DB=ai_check_model
POSTGRES_USER=postgres
POSTGRES_PASSWORD=postgres
```

然后启动：

```bash
docker compose up --build
```

或：

```bash
npm run docker:up
```

停止容器：

```bash
npm run docker:down
```

查看日志：

```bash
npm run docker:logs
```

### 4. 注意事项

- 默认 compose 会自动启动本地 Postgres，并通过 `docker/postgres/init.sql` 初始化表结构
- 如果你提供 `DATABASE_URL`，应用会优先连接外部数据库
- 生产镜像已内置 `HEALTHCHECK`
- 如果不提供 `DATABASE_URL`，应用仍可运行，但：
  - 历史记录不可用
  - 排行榜不可用
  - 验证结果不会持久化

### 5. Docker 开发模式

如果你确实希望在容器里跑开发环境，可以使用：

```bash
npm run docker:dev:up
```

查看日志：

```bash
npm run docker:dev:logs
```

停止：

```bash
npm run docker:dev:down
```

> 注意：根据 Next.js 文档，在 Mac / Windows 上 Docker 开发模式通常会比本地 `npm run dev` 更慢。开发期仍然优先推荐本地运行。

---

## 部署到服务器（示例）

如果你要部署到一台普通 Linux 服务器，推荐流程：

1. 安装 Docker / Docker Compose
2. 准备 `.env`
3. 执行：

```bash
docker compose up --build -d
```

4. 查看日志：

```bash
docker compose logs -f app
```

5. 验证服务：

```bash
curl http://127.0.0.1:3000
```

更推荐在服务器前面再挂一层反向代理（如 nginx / Caddy）来处理：

- HTTPS
- 域名接入
- 限流
- 请求大小限制
- 反向代理缓冲与 SSE 转发

---

## 使用方式

1. 输入中转站 API Endpoint，例如 `https://api.example.com/v1`
2. 输入 API Key
3. 选择要验证的模型
4. 点击“开始验证”
5. 在验证详情页查看实时进度与最终报告

### 结果页说明

- 新发起的验证：会直接进入实时 SSE 检测页
- 已完成的验证：如果数据库已配置，可通过 `/verify/[jobId]` 回看历史结果

---

## 评分规则

综合分数会按 **已参与计分的检测器** 归一化到 `0 ~ 100`。

- `>= 80` → `HIGH`
- `>= 60` → `MEDIUM`
- `>= 35` → `LOW`
- `< 35` → `VERY_LOW`

> `skip` 状态的检测器不会计入分母。

---

## 排行榜规则

数据库开启后，系统会以 **端点域名** 为维度自动聚合排行榜。

当前聚合内容包括：

- `totalChecks`: 该域名累计验证次数
- `avgScore`: 已完成任务的平均分
- `modelsVerified`: 最近记录到的模型集合
- `overallStatus`: 排行榜状态

当前状态映射：

- `avgScore >= 60` → `verified`
- `avgScore >= 35` → `suspicious`
- 否则 → `fake`

---

## API 概览

### `POST /api/verify`

创建一个新的验证任务，返回：

- `jobId`
- `streamUrl`

### `GET /api/verify/[jobId]/stream`

启动实际检测流程，并通过 SSE 持续推送：

- `started`
- `detector:start`
- `detector:progress`
- `detector:complete`
- `scoring`
- `complete`
- `error`

### `GET /api/verify/[jobId]`

获取已持久化的验证结果。

### `GET /api/history`

分页获取历史验证记录。

### `GET /api/leaderboard`

获取排行榜列表。

---

## 当前实现说明

### 数据库降级策略

项目对数据库做了“尽力而为”的处理：

- 如果数据库未配置，验证流程本身不会因此中断
- 但历史记录、结果回看、排行榜不会生效

### API Key 处理

- 前端发起新验证时，会在当前浏览器会话中临时保存参数以继续 SSE 流程
- 验证结果写库时不会持久化 API Key

---

## 后续可扩展方向

- 增加更多模型和检测器
- 为排行榜加入更细粒度的统计逻辑
- 增加自动化测试覆盖率
- 增加更严格的反代理 / 反套壳信号

---

## 致谢

部分检测思路来自社区经验总结，包括但不限于：

- 魔术字符串测试
- 中文引号特征
- 数学 / 推理题校验
- thinking 能力检测
- 知识截止日期校验

---

## License

MIT
