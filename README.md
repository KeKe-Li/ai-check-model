# AI Model Verify

Detect whether API proxy/relay stations are serving genuine Claude, GPT, and Gemini models.

## Background

Many API relay stations proxy AI model APIs, but some engage in bait-and-switch — claiming to serve Claude Opus 4.7 while actually returning responses from cheaper models. This project provides an online tool to verify model authenticity through multi-dimensional detection.

## Key Features

- **Multi-dimensional Detection** — 12 independent detectors covering metadata, model catalog, official capability fingerprints, behavioral fingerprinting, and capability testing
- **Real-time Progress** — SSE streaming shows each detection step as it completes
- **Hard to Fake** — Deep verification based on model-specific capabilities (thinking blocks, logprobs, magic strings)
- **Leaderboard** — Community-driven relay station reputation ranking

## Detection Methods

Incorporates battle-tested detection techniques from the community:

| Detector | Score | Method |
|----------|-------|--------|
| Metadata Verification | 15 | HTTP response headers, response ID format (`msg_` vs `chatcmpl-`), model field |
| Provider Authenticity | 25 | Cross-check response metadata, provider-specific capabilities, and relay traces |
| Model Catalog | 10 | Query `/v1/models/{model}` to verify the claimed model at the catalog/routing layer |
| OpenAI Responses Fingerprint | 15 | Verify official Responses API response shape for GPT/OpenAI models |
| Randomized Challenge | 10 | Nonce + random JSON arithmetic challenge to detect cached or hard-coded answers |
| Magic String | 20 | Anthropic's official trigger strings for refusal/redacted thinking tests (impossible to fake) |
| Identity Consistency | 20 | Multi-angle identity probing, proxy identifier detection (kiro/openclaw etc.), contradiction analysis |
| Knowledge Cutoff | 15 | Knowledge boundary probing + corpus-specific verification |
| Thinking Chain | 20 | Extended thinking block structure + Chinese thinking chain instruction following (Opus-exclusive) |
| Output Format | 10 | Chinese quotation mark test (real Claude never outputs `""`) + style analysis |
| Reasoning Benchmark | 15 | Hard math problems (expected answer: 21) + common sense riddles + response time analysis |
| Latency Profile | 5 | TTFB and throughput comparison against known baselines |

> Detection methods are inspired by real-world testing shared by the [linux.do community](https://linux.do/), including magic string tests, Chinese quote detection, math problem verification, and knowledge cutoff probing.

## Supported Models

**Claude**: Opus 4.7, Opus 4.6, Sonnet 4.6, Haiku 4.5, Sonnet 4

**OpenAI**: GPT-5.5, GPT-5.4, GPT-5.4 mini, GPT-4o, o3

**Google**: Gemini 3.1 Pro, Gemini 3 Flash, Gemini 2.5 Pro

## Tech Stack

- **Framework**: Next.js 16 (App Router)
- **UI**: shadcn/ui + Tailwind CSS 4 + framer-motion
- **Database**: Drizzle ORM + PostgreSQL (Neon Serverless)
- **Validation**: Zod + react-hook-form
- **Testing**: Vitest + Testing Library

## Getting Started

### 1. Install Dependencies

```bash
pnpm install
```

### 2. Configure Environment Variables (Optional)

The database is optional — core detection works without it; results just won't be persisted.

```bash
cp .env.example .env.local
# Edit .env.local and fill in DATABASE_URL (Neon PostgreSQL connection string)
```

### 3. Database Migration (Optional)

```bash
pnpm drizzle-kit push
```

### 4. Start Development Server

```bash
pnpm dev
```

Visit http://localhost:3000

### 5. Usage

1. Enter the relay station API endpoint URL (e.g., `https://api.example.com/v1`)
2. Enter an API Key
3. Select the model to verify
4. Click "Start Verification" and watch real-time detection progress and results

## Project Structure

```
src/
├── app/                        # Pages and API routes
│   ├── page.tsx                # Homepage (verification form)
│   ├── verify/[jobId]/         # Verification result page (real-time progress)
│   ├── history/                # Verification history
│   ├── leaderboard/            # Leaderboard
│   └── api/                    # API endpoints
│       ├── verify/             # POST to start, GET SSE stream
│       ├── history/            # Paginated history query
│       └── leaderboard/        # Leaderboard data
├── components/
│   ├── layout/                 # Header, Footer
│   ├── verify/                 # VerifyForm, ProgressStream, ScoreGauge, ResultCard
│   └── ui/                     # shadcn/ui components
└── lib/
    ├── detection/              # Detection engine
    │   ├── orchestrator.ts     # Detection orchestrator (AsyncGenerator + SSE)
    │   ├── score-calculator.ts # Score calculator
    │   ├── detectors/          # 12 detector implementations
    │   └── constants/          # Keywords, magic strings, benchmark questions
    ├── api-client/             # Anthropic / OpenAI-compatible API clients
    ├── db/                     # Drizzle ORM schema + queries
    └── validators/             # Zod input validation
```

## Deployment

### Vercel (Recommended)

```bash
vercel
```

### Docker

```bash
docker build -t ai-check-model .
docker run -p 3000:3000 -e DATABASE_URL=your_db_url ai-check-model
```

## Scoring Rules

- Sum of all detector scores / total max score × 100 = overall score (0-100)
- **≥80 HIGH** — Very likely a genuine model
- **≥60 MEDIUM** — Generally credible, with some concerns
- **≥35 LOW** — Suspicious
- **<35 VERY_LOW** — Very likely fake

## Contributing

Issues and Pull Requests are welcome.

If you discover new effective detection methods, feel free to contribute them as detectors.

## Acknowledgments

Detection methods are inspired by community members at [linux.do](https://linux.do/), including but not limited to:

- Magic string refusal test
- Chinese quotation mark detection
- Combinatorics math problem / color blindness riddle verification
- Chinese thinking chain instruction following test
- Corpus-specific knowledge verification

## License

MIT
