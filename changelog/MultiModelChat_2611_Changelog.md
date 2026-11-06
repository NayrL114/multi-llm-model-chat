# Multi-Model Chat 2611 Changelog (November 2026)

<!-- New entries go at the top of this file, newest first. Entry template, field rules, and controlled Status/Scope vocabularies live in [README.md](README.md). -->

## [2026-11-06] Changelog folder, following the portfolio repo's convention
<!-- id: 2026-11-06-changelog-structure -->

| | |
|---|---|
| Author       | CC |
| Planned by   | — |
| Status       | Shipped |
| Scope        | docs |
| Plan         | — (owner request) |
| Branch / PR  | `ver1.0-req-doc-implementation` |
| Commits      | — (uncommitted at time of writing) |

### Summary
Adds `changelog/` in the same shape as the Personal Portfolio Website repo's. A README holds the entry template, field rules and controlled vocabularies, and there is one file per calendar month with the newest entry first. This is the first month's file. The entry below records the branch's one commit, `972e94f`, which was made before the changelog existed.

### Changes
- **Docs — [`changelog/README.md`](README.md).** Same sections and rules as the portfolio README: folder layout, lifecycle, entry template, field rules, Status and Scope vocabularies, format evolution, cross-linking. Adapted for this repo:
  - The file prefix is `MultiModelChat_` instead of `Portfolio_`.
  - Scope tags are redrawn around this repo's layers (`shared`, `api`, `services`, `providers`, `schema`, `migration`, `pages`, `components`, `styles`, `config`, `infra`). The generic tags (`ci`, `deploy`, `a11y`, `perf`, `security`, `tests`, `tooling`, `docs`) carry over.
  - `Shipped — migration required` is reworded, because Drizzle migrations here apply on server start rather than by hand in Supabase.
  - Links to `ccdoc/`, `gptdoc/` and `CLAUDE.md`, which this repo doesn't have, point instead at the root README and the design doc.
- **Docs — `MultiModelChat_2611_Changelog.md`.** This file.

### Verification
- Every relative link in both files resolved against the working tree.

### Migration impact
None. Documentation only.

### Deferred
- [ ] **No `ccdoc/` or `gptdoc/` folders, and no `CLAUDE.md` or `AGENTS.md`.** The portfolio repo keeps plans and reviews there. If this repo adopts them, add them to the README's "What does *not* go here" and "Cross-references" sections.

---

## [2026-11-06] Local MVP: all six build phases, verified on the mock provider
<!-- id: 2026-11-06-local-mvp -->

| | |
|---|---|
| Author       | CC |
| Planned by   | Ryan |
| Status       | Partial |
| Scope        | shared, api, services, providers, schema, migration, pages, components, styles, config, infra, tests, tooling, docs |
| Plan         | [Multi-Model Chat — System Design & Implementation Plan.md](../Multi-Model%20Chat%20—%20System%20Design%20&%20Implementation%20Plan.md) (the "Local MVP" sections) |
| Branch / PR  | `ver1.0-req-doc-implementation` |
| Commits      | `972e94f` |

> Written on 2026-11-06, after `972e94f` was committed, because the changelog did not exist at commit time. `Verification` records the checks run in the session that built the code, plus a re-run of typecheck, tests and build against `972e94f` while writing this entry.

### Summary
Builds the local MVP from the design doc, on top of the doc-only commit `28f6d8d`: 58 files in a TypeScript repo with three workspaces (`shared`, `server`, `web`) and Postgres in Docker. One message goes to 2–3 model lanes, and every lane's reply streams back on one SSE stream. Each lane is sent only the user's messages and its own replies. Any finished reply can be continued alone as a branch, and a switcher leads back to the multi-model thread. Code for all six build phases is in, and the proof checklist passes on the offline mock provider. The status is `Partial` because no real provider has been called. `.env` has no keys, so phase 2's done-condition (each provider streams a reply) and the checklist items that need real models are still open.

### Changes
- **Tooling — workspaces.** npm workspaces `shared`, `server` and `web`. Strict TypeScript 7 with Bundler resolution and no emit. `shared` is imported as source, not built. Root scripts: `dev` (API and page together), `db:up` / `db:down`, `db:generate` / `db:migrate` / `db:studio`, `typecheck`, `test`, `build`, `smoke`. Needs Node 22 or later.
- **Infra — Postgres.** [`docker-compose.yml`](../docker-compose.yml) runs `postgres:17-alpine` in a dedicated container, `multi-model-chat-db`, on host port **5434**. On this machine 5432 is held by another project's container and 5433 by a native Postgres 15. A `pg_isready` healthcheck lets `db:up` wait until the database is ready.
- **Config.** [`.env.example`](../.env.example): the three provider keys, `DATABASE_URL`, `PORT`, `LOG_PAYLOADS` and `ENABLE_MOCK_MODELS`. [`env.ts`](../server/src/env.ts) only reads `.env`; nothing writes to it. The dev server restarts when `.env` changes.
- **Schema + migration.** [`schema.ts`](../server/src/db/schema.ts) defines the doc's four tables: `conversations`, `lanes`, `turns`, `responses`.
  - A turn's `parent_turn_id` builds the tree, and `focus_lane_id` marks a branch.
  - `responses` has one row per turn and lane, and stores the AI SDK's response messages in `message_json` (jsonb).
  - [`0000_init.sql`](../server/drizzle/0000_init.sql) is applied when the server starts.
- **Shared.**
  - [`types.ts`](../shared/src/types.ts): the row types and `StreamEvent`.
  - [`schemas.ts`](../shared/src/schemas.ts): Zod request bodies, imported through a separate `@mmc/shared/schemas` entry so Zod stays out of the page bundle.
  - [`tree.ts`](../shared/src/tree.ts): the path to a turn, a turn's children, and its deepest leaf.
- **Services — lane history.** [`history.ts`](../server/src/services/history.ts) `buildHistory` walks from the first turn to the one being answered. It adds the user's text and this lane's own complete or stopped replies. A failed reply leaves a gap, and back-to-back user messages are merged into one.
- **Services — branching rules.** [`turnRules.ts`](../server/src/services/turnRules.ts) places each new turn. It keeps the parent's focus, and answers 409 to three cases:
  - another lane trying to rejoin a branch
  - continuing from a reply that isn't finished
  - replying under a turn that is still streaming
- **Services — fan-out.** [`fanout.ts`](../server/src/services/fanout.ts) makes one `streamText` call per lane in parallel and forwards each piece of text on the stream, tagged with its lane.
  - Each lane fails on its own.
  - Before any text has streamed, it retries automatically with backoff on 408, 409, 429, 500, 502, 503, 504, 529 and network errors: up to 3 times, honouring `retry-after`.
  - Stop and client disconnect abort the lanes through [`activeStreams.ts`](../server/src/services/activeStreams.ts), and partial text is saved as `stopped`.
  - On startup, rows a crash left as `streaming` are marked as errors.
- **Providers.**
  - [`models.ts`](../server/src/config/models.ts): nine real models with list prices (Claude Opus, Sonnet and Haiku 5.5; GPT-5.6 Sol, Terra and Luna; Gemini 3.1 Pro preview, 3.8 Flash and 3.5 Flash-Lite), plus three mock models at $0.
  - [`providers.ts`](../server/src/services/providers.ts) makes AI SDK clients only for providers that have a key. Gemini's key is sent in the `x-goog-api-key` header. OpenAI calls use `store: false` with encrypted reasoning, so each saved `message_json` is self-contained.
  - [`mockModel.ts`](../server/src/services/mockModel.ts) is an offline provider whose replies describe the history it received. Mock Flaky fails the first attempt at every reply. A message containing `#long` gets a long reply, and `#ratelimit` gets two 429s first.
- **Services — payload log.** [`payloadLog.ts`](../server/src/services/payloadLog.ts): with `LOG_PAYLOADS=true`, the exact messages sent to every lane go to the console (a `U A U` summary) and to `server/logs/lane-payloads.jsonl`, which git ignores.
- **API.** [`routes/`](../server/src/routes/) has the doc's seven routes, plus:
  - `PATCH /api/conversations/:id` (title, and the branch on screen)
  - `POST /api/turns/:id/stop`
  - `GET /api/health`

  The stream sends the doc's `delta`, `done` and `error` events, plus `start`, `retrying`, `stopped` and `end`. Every final event carries the saved row, and a heartbeat goes out every 15s.
- **Pages + components.**
  - [`NewConversationPage`](../web/src/pages/NewConversationPage.tsx): a cross-provider/same-provider toggle with sensible default models, and an optional system prompt.
  - [`ConversationPage`](../web/src/pages/ConversationPage.tsx): one row per turn, with that turn's replies side by side ([`TurnRow`](../web/src/components/TurnRow.tsx), [`ReplyCard`](../web/src/components/ReplyCard.tsx)). An inline [`BranchSwitcher`](../web/src/components/BranchSwitcher.tsx) sits wherever paths split.
  - The page also has the [`Composer`](../web/src/components/Composer.tsx) with Send and Stop, tokens and cost per lane and in total, JSON export and delete. Streamed text is batched per animation frame.
  - The [`Sidebar`](../web/src/components/Sidebar.tsx) lists conversations, and replies render as markdown (react-markdown with remark-gfm).
- **Styles.** [`index.css`](../web/src/index.css) carries over the old app's theme variables and night mode, adds three lane colours, and stacks the lanes below 860px.
- **Tests.** [`history.test.ts`](../server/src/services/history.test.ts) has 13 vitest cases for `buildHistory`, message merging and `placeNewTurn`. [`smoke.mjs`](../scripts/smoke.mjs) runs 20 end-to-end checks, mapped to the proof checklist, against the running app using mock models, and deletes its conversation afterwards.
- **Docs.** [`README.md`](../README.md): quick start, scripts, how it works, API, mock models, adding models, and decisions taken.
- **Departures from the doc.**
  - There is no separate phase-2 test route; single-lane streaming is covered by a branch turn.
  - `TurnRow` and `ReplyCard` replace `LaneColumn`, because a row per turn lines replies up for comparison.
  - Stopped replies have no token counts, because providers report usage only when a reply finishes.

### Verification
- **In the build session, before the commit:**
  - `npm run typecheck` clean.
  - `npm test`: 13 passed.
  - `npm run build` clean.
  - `npm run smoke`: 20/20 against `npm run dev` with mock models.
- **Headless Chrome (puppeteer-core) on the real page:**
  - send, retry, branch, switch back, stop and reload
  - night mode, and no horizontal overflow at 420px
  - zero console errors
- **Payload log read by hand:** every lane's payload held only the user's messages and its own replies, and gaps were merged.
- **Re-run against `972e94f` while writing this entry:**
  - Typecheck clean and 13/13 tests passing.
  - Build: JS 445.03 kB (138.54 kB gzip), CSS 10.26 kB (2.97 kB gzip).
  - Smoke was not re-run.
- **Proof checklist** (design doc, "Local MVP: proof checklist"):
  - Ticked on mock models:
    - lane payload separation
    - a branch continues for 3+ turns, and switching back continues the multi-model thread
    - two branches from one turn are both reachable
    - one failing lane (Mock Flaky) leaves the others untouched, and Retry recovers it
    - Stop keeps partial replies, labelled stopped
    - token counts on every saved reply, with a total per conversation
  - Not yet ticked:
    - a cross-provider thread of 10+ turns that reloads correctly (reload was checked only with mocks)
    - a same-provider Opus/Sonnet/Haiku thread
    - a failure caused by a deliberately wrong real key
    - spend within the provider limits
- **Not done:** no call to Anthropic, OpenAI or Google.

### Migration impact
`0000_init.sql` creates the four tables and two enums. It applies itself the first time the server starts against an empty database. There is no existing data.

### Deferred
- [ ] **Run against real providers (phase 2's done-condition).** Put the three keys in `.env` and set a monthly spend limit on each provider account. Send one short cross-provider message and confirm that each lane streams. Then work through the unticked checklist items:
  - a cross-provider thread of 10+ turns, with a page reload
  - an Opus/Sonnet/Haiku thread with `LOG_PAYLOADS=true`
  - one lane given a wrong key mid-thread, the key fixed, then Retry

  Watch the OpenAI lane at turn 2. It is the first call that sends back a saved `message_json` with encrypted reasoning under `store: false`.
- [ ] **Model ids and prices are unchecked against the live APIs.** They come from public sources read in November 2026. `gemini-3.1-pro-preview` is a preview id and may be renamed. A wrong id shows up as an error on that lane; a wrong price affects only the cost estimate.
- [ ] **Stopped replies don't count toward the conversation's token total,** so the total undercounts whatever stopped replies used.
- [ ] **No CI.** Typecheck, tests and build run only by hand, and smoke needs the server and database running.

---
