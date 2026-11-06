# Multi-Model Chat (local MVP)

One message goes to 2–3 AI models at once. Each model keeps its own thread, and the threads are shown side by side. You can pick any reply and **continue with that model alone**. That creates a branch, and the multi-model thread stays available to switch back to.

This is the local MVP from [the design doc](./Multi-Model%20Chat%20—%20System%20Design%20&%20Implementation%20Plan.md). It runs on your machine with your own API keys and exists to prove the thread-keeping core.

## Quick start

You need Node 22+ and Docker Desktop.

```bash
npm install
cp .env.example .env      # add your keys, or leave them blank and use the Mock models
npm run db:up             # Postgres 17 in Docker, on localhost:5434
npm run dev               # API on :3001, page on http://localhost:5173
```

Migrations run automatically when the server starts. Editing `.env` while `npm run dev` is running restarts the server.

> Before testing with real keys, set a monthly spend limit on each provider account so a bug can't run up a bill.

**No keys yet?** Leave them blank. The **Mock (offline)** provider is on by default (`ENABLE_MOCK_MODELS=true`). Its three models reply by describing exactly what they were sent, so you can check threads, branching, stop and retry for free.

## Scripts

| Command | What it does |
| --- | --- |
| `npm run dev` | Starts the API (tsx watch) and the Vite page together |
| `npm run db:up` / `db:down` | Starts or stops the Postgres container |
| `npm test` | Unit tests for `buildHistory` and the branching rules |
| `npm run smoke` | End-to-end check of the proof checklist against the running app, using mock models (free). Cleans up after itself |
| `npm run typecheck` | TypeScript across `shared`, `server` and `web` |
| `npm run db:generate` | Creates a migration after editing `server/src/db/schema.ts` |
| `npm run db:studio` | Drizzle Studio, for browsing the tables |
| `npm run build` | Production build of the page |

## How it works

- **Data model:** four tables (`conversations`, `lanes`, `turns`, `responses`) in [server/src/db/schema.ts](server/src/db/schema.ts). Each user message is a turn, each turn has one response per lane, and a branch is a turn with a `focus_lane_id`.
- **Lane memory:** [services/history.ts](server/src/services/history.ts) walks from the first turn to the turn being answered. It adds the user's messages plus *this lane's own* complete or stopped replies. Failed replies leave a gap, and back-to-back user messages are merged.
- **Branching rules:** [services/turnRules.ts](server/src/services/turnRules.ts). A new message keeps its parent's focus. "Continue with this model" sets the focus. Other lanes can't rejoin a branch, and you can only continue from a finished reply.
- **Fan-out:** [services/fanout.ts](server/src/services/fanout.ts) makes one AI SDK `streamText` call per lane in parallel. Each piece of text goes onto one SSE stream tagged with its lane. When a lane finishes, its row gets the text, the full `message_json` (the AI SDK's response messages), token counts and latency.
- **Failures:** each lane fails on its own. Rate-limit, 5xx and network errors retry automatically with backoff (up to 3 times, honouring `retry-after`), but only before any text has streamed, so text is never duplicated. Anything else becomes an error with a Retry button. Stop, or closing the tab, cancels the streams and keeps partial text as `stopped`.
- **Checking separation:** with `LOG_PAYLOADS=true`, the exact messages sent to every lane are logged: a summary to the console and the full payload to `server/logs/lane-payloads.jsonl`.

```
shared/src/        types, Zod request schemas (@mmc/shared/schemas), turn-tree helpers
server/src/
  index.ts         Express app, /api/health, startup (migrations, interrupted replies)
  config/models.ts model list: id, provider, label, tier, price per million tokens
  db/              Drizzle schema and client
  services/        history, turnRules, fanout, providers, mockModel, activeStreams, payloadLog
  routes/          models, conversations, turns (also stop and retry)
web/src/
  pages/           NewConversationPage, ConversationPage
  components/      TurnRow, ReplyCard, BranchSwitcher, Composer, Sidebar, Markdown
  lib/sse.ts       reads the event stream
scripts/smoke.mjs  end-to-end proof checklist (mock models)
```

### API

| Route | Does |
| --- | --- |
| `GET /api/models` | Model list from config, with which providers have keys |
| `GET/POST /api/conversations` | Lists conversations (most recent activity first), or creates one with 2–3 lanes |
| `GET/PATCH/DELETE /api/conversations/:id` | Full detail (every branch); rename or set the branch on screen; delete |
| `POST /api/conversations/:id/turns` | `{ text, parentTurnId, focusLaneId? }`; streams every active lane's reply (SSE) |
| `POST /api/responses/:id/retry` | Streams a fresh attempt for one failed or stopped lane |
| `POST /api/turns/:id/stop` | Stops a turn's streaming replies |
| `GET /api/health` | Server and database check |

Stream events: `start` (turn, rows, updated conversation) → `delta` / `retrying` → `done` / `stopped` / `error` (each with the final row) → `end`. See `StreamEvent` in [shared/src/types.ts](shared/src/types.ts).

## Mock models

| Model | Behaviour |
| --- | --- |
| Mock Alpha, Mock Beta | Reply with what they received: message counts, your first and latest message, the start of their previous reply, and whether every assistant message in their history is their own |
| Mock Flaky | Fails the first attempt at every reply with a fake "invalid API key" error. Press Retry to recover |

Put `#long` in a message to get a long reply (for testing Stop), or `#ratelimit` to make the first two attempts fail with a 429 (to watch the automatic backoff).

## Adding or changing models

Edit [server/src/config/models.ts](server/src/config/models.ts). The `id` is the provider's API model id, and lanes store it, so add a new entry rather than renaming one that existing conversations use. Prices are list prices checked in Nov 2026 and are used only for the cost estimate on the page; check them against your invoices.

## Decisions taken where the doc left room

- **Branch UI:** an inline switcher (`‹ 2 / 3 Claude Sonnet only ›`) above the turn where paths split, rather than tabs or a tree panel.
- **Layout:** each turn is a row, with the user message full-width and the lanes' replies side by side underneath, so replies line up turn by turn. Inside a branch the single reply spans the full width.
- **Postgres** listens on host port **5434**, because 5432 and 5433 are already in use on this machine.
- **OpenAI** calls use `store: false` with encrypted reasoning, so each saved reply is self-contained and Postgres stays the only copy of the thread.
- **Stopped replies** have no token counts, because providers report usage only when a reply finishes. Retry also works on stopped replies.
- **Added to the doc's API:** `PATCH /api/conversations/:id` (remembers the branch on screen), `POST /api/turns/:id/stop`, and the `start`, `retrying`, `stopped` and `end` events.
