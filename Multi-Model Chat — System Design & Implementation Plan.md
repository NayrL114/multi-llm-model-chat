# Multi-Model Chat — System Design & Implementation Plan

Oct 16, 2026 · @Ryan

## Overview

One message goes to 2–3 AI models at once, and each model keeps its own continuing thread, shown side by side on one page.

A conversation runs in one of two modes, both presets of "pick 2–3 models":

- **Cross-provider:** one model each from Claude, GPT and Gemini, e.g. Claude Sonnet 5.5, GPT-5.6 Terra and Gemini 3.8 Flash.
- **Same-provider:** 2–3 models from one provider, e.g. Claude Opus 5.5, Sonnet 5.5 and Haiku 5.5.

At any point the user can pick one model's reply and continue with that model alone. That creates a branch; the multi-model thread stays available to switch back to.

This document covers three things:

1. **System design** for the full product, including accounts, the guest trial, your-own-key (BYOK) and hosted credits.
2. **Local MVP plan:** a fresh repo built mainly to learn the thread-keeping core, on your own API keys.
3. **Cloud projection:** how the online version could be built. This is a sketch of what's involved, not a commitment.

## Requirements and decisions

Six choices are confirmed by you; the rest are my defaults, marked so you can flip them as you review.

**Applies to the MVP and the cloud version**

| Topic | Decision | Status |
| --- | --- | --- |
| Lanes | 2–3 models per conversation | Confirmed |
| Model choice | Picked when the conversation starts; no switching mid-thread | Default |
| Modes | Cross-provider, or same-provider (e.g. Opus, Sonnet, Haiku) | Confirmed |
| Model memory | Each lane sees only the user's messages and its own replies | Confirmed |
| Branching | Continue from any lane's reply with that model alone; several branches allowed; the multi-model thread stays usable; other models can't rejoin a branch | Default |
| Failures | Per-lane retry; the user can keep going while a lane has failed | Default |
| Streaming | Replies appear word by word in each lane | Default |
| Inputs | Text only; files later | Default |
| System prompt | One optional prompt shared by all lanes; no temperature controls | Default |
| Model tools | None (no web search or tool use) | Default |
| Codebase | Fresh repo: TypeScript, React + Vite, Express, Postgres, AI SDK | Confirmed |

**Cloud version only**

| Topic | Decision | Status |
| --- | --- | --- |
| Accounts | Email + password and Google sign-in, through an auth library | Default |
| Guest trial | No sign-up needed; the trial conversation is saved into the account on sign-up | Confirmed |
| Trial shape | One conversation of up to 3 messages per 7 days, cross-provider mode, small models | Default |
| Paying for model calls | Each user brings their own key per provider, or buys credits that use hosted keys; both can mix in one message | Confirmed |
| Paid tier shape | Prepaid credits, priced at provider cost plus a margin | Default |
| Key storage | Encrypted at rest with a cloud key service; decrypted only on the server; shown as the last 4 characters | Default |
| Regenerate | Regenerate the latest reply in one lane; editing sent messages comes later | Default |
| Data controls | Delete a conversation or the whole account; export later | Default |
| Sharing | No public conversation links | Default |
| Audience | Invite-only beta under 100 users, built to open later | Default |
| Devices | Responsive web; lanes become tabs on mobile | Default |

The resume extractor stays in llm-file-test-app and is not part of this product.

## System architecture

The system has three parts: a React page, an Express API that is the only thing talking to model providers, and Postgres. One message becomes one request, and every lane's reply streams back on it.

&#91;embedded content: one message fanned out to three lanes\]

In same-provider mode the lanes would be, for example, Opus, Sonnet and Haiku; the flow is identical.

**Request flow for one message**

1. The page sends the text, the parent turn and an optional focus lane to `POST /api/conversations/:id/turns`.
2. The server saves the turn, plus a response row marked as streaming for each active lane: every lane, or only the focus lane inside a branch.
3. For each lane in parallel, the server builds that lane's history and calls the model with the AI SDK's streaming function.
4. Each piece of reply text goes onto the open stream as an event tagged with the lane id.
5. When a lane finishes, its row gets the text, the full message, token counts and timing, and a done event goes out. A failure marks the row as an error and sends an error event.
6. The stream closes once every lane has finished, so a slow lane never holds up the others.

## Data model

Each user message is a turn, each turn has one response per lane, and a branch is a new turn under an earlier one with a single lane in focus. The same four tables serve the MVP and the cloud version.

| Table | Main columns | Notes |
| --- | --- | --- |
| conversations | id, title, mode (cross or same), system\_prompt, current\_leaf\_turn\_id, created\_at | The cloud version adds owner columns |
| lanes | id, conversation\_id, position (1–3), provider, model\_id | Fixed when the conversation starts |
| turns | id, conversation\_id, parent\_turn\_id, focus\_lane\_id, user\_text, created\_at | No parent = first turn; no focus = every lane replies |
| responses | id, turn\_id, lane\_id, status (streaming, complete, stopped, error), text, message\_json, error, input\_tokens, output\_tokens, latency\_ms | One per lane per turn; retry reuses the row |

&#91;embedded content: turns, lanes and one branch\]

Rules the server enforces:

- **Next message:** the new turn's parent is the turn on screen, and it keeps that turn's focus.
- **Continue with this model:** the new turn's parent is the turn holding the chosen reply, and its focus is that reply's lane. Later turns in the branch keep the focus.
- **Branches:** turns that share a parent are alternatives. The page shows the path from the first turn to `current_leaf_turn_id`, with a switcher wherever paths split.
- **What counts as history:** complete and stopped replies do; error rows don't.

`message_json` keeps the full reply exactly as the AI SDK returns it, not just the text, so anything a provider needs sent back later is preserved. `text` is a copy for display.

### Building one lane's history

```
buildHistory(lane, newTurn):
  path = []
  turn = newTurn
  while turn exists:                  // walk up to the first turn
    put turn at the front of path
    turn = turn.parent

  messages = []
  for each turn in path:
    add { role: "user", content: turn.user_text }
    reply = this lane's reply to that turn (complete or stopped)
    if reply exists: add reply.message_json

  return mergeBackToBackUserMessages(messages)
```

A lane whose reply failed simply has a gap, and merging back-to-back user messages into one keeps every provider's format valid. In the MVP, load a conversation's turns once and walk them in memory; in the cloud version the same walk can be one recursive SQL query.

## Accounts, guest trial and API keys

Every model call goes through the API server, which picks a key for each lane: the user's own key, hosted credits, or the capped trial key. This whole section applies to the cloud version only; the MVP reads three keys from `.env`.

### Key resolver

For each lane in a message, the server checks in this order:

1. **Guest:** use the trial key (small models only).
2. **Signed-in user with their own key for that lane's provider:** use it; no charge.
3. **Signed-in user with enough credits:** use the hosted key and charge the cost to their credits.
4. **Otherwise:** that lane shows "Add a key or top up credits" while the other lanes still run.

### Accounts

- Use an auth library rather than writing login yourself. Better Auth keeps users and sessions in your own Postgres; Clerk is the hosted alternative.
- Email and password with email verification, plus Google sign-in. Sessions live in httpOnly cookies, which scripts in the page can't read.
- Every conversation has an owner (a user or a guest), and every query filters by the current owner.

### Your own keys (BYOK)

1. The user pastes a key in Settings. It travels to the server once, over HTTPS.
2. The server makes a cheap test call to confirm the key works.
3. Envelope encryption: a fresh data key encrypts the API key, and the cloud key service's master key encrypts the data key. The database stores only those two encrypted values and the last 4 characters.
4. At call time the server has the key service decrypt the data key, decrypts the API key in memory, makes the call and discards it.
5. Keys are never logged, never sent back to the browser, and can be replaced or deleted at any time.

The trade-off: with server-side encryption, you as the operator could technically decrypt keys. Say so plainly in the privacy policy.

### Hosted credits (paid tier)

- Users buy prepaid credits through Stripe Checkout. Stripe's payment webhook adds a top-up row to the credit ledger, and the balance is the sum of the ledger.
- Before a hosted call, the server reserves the worst case (maximum output tokens × price). After the call it replaces that with the real cost from the reported token usage.
- Prices come from a table in config: each model's list price per million tokens plus your margin. Check it against provider invoices monthly.
- Hosted keys and trial keys sit in separate provider projects, each with its own spend limit. A trial spike then can't use up the paid tier's rate limits.

### Guest trial

- **Allowance:** one conversation of up to 3 messages per 7 days, in cross-provider mode, on small models only (e.g. Claude Haiku 5.5, GPT-5.6 Luna, Gemini 3.8 Flash).
- **Caps (proposed):** messages up to 2,000 characters; replies up to about 700 tokens.
- **Identity:** a signed httpOnly cookie holds a guest id, and a hashed IP address is counted too. Whichever reaches the limit first blocks the trial.
- **Abuse controls:** a Cloudflare Turnstile bot check before the first message; a daily trial budget (e.g. US$20) that pauses the trial with "Sign up to keep chatting"; a spend limit on the trial's provider project.
- **Storage:** the trial conversation is saved with the guest as owner and deleted automatically after 7 days. If the guest signs up in the same browser, one update moves it to their account.
- **Cost:** about US 1–3¢ per full trial (9 model calls) at current list prices, so 10,000 trials a week cost roughly US$100–300. Flagship models would cost about ten times more ([Claude](https://platform.claude.com/docs/en/about-claude/pricing), [Gemini](https://ai.google.dev/gemini-api/docs/pricing), [GPT-5.6](https://openai.com/index/gpt-5-6/) pricing).

### Tables added for the cloud version

| Table | Main columns | Purpose |
| --- | --- | --- |
| users, sessions | Managed by the auth library | Sign-in |
| api\_keys | user\_id, provider, encrypted\_key, encrypted\_data\_key, last4, last\_used\_at | Saved BYOK keys |
| credit\_ledger | user\_id, amount (+ or −), reason, response\_id, stripe\_payment\_id | Credit balance and history |
| guest\_sessions | guest\_id, ip\_hash, window\_start, messages\_used | Trial limits |

## Local MVP: stack and repo

The MVP is a fresh TypeScript repo with the same shape as llm-file-test-app (a React + Vite page and an Express API), running on your machine with your own API keys. Its job is to prove the thread-keeping core, and to be shaped so it can grow into the online product.

| Layer | Choice | Why |
| --- | --- | --- |
| Language | TypeScript everywhere | Catches mismatches between the three providers' message shapes |
| Frontend | React + Vite + React Router, plain CSS with variables | What you already use; the old theme and night mode carry over |
| Backend | Node + Express in TypeScript, split into routes and services | Same framework as now, in small files you and coding agents can follow |
| Model calls | AI SDK (`ai`) with its Anthropic, OpenAI and Google packages, called directly (no gateway) | One streaming function and one message format, so the history logic is written once |
| Database | Postgres in Docker, with Drizzle for tables and migrations | The same database as the cloud version, so nothing to migrate later |
| Streaming | Server-Sent Events from Express, read by the page | One request out, every lane's reply streams back labelled by lane |
| Input checks | Zod schemas on every request body | Clear errors, and the AI SDK already uses it |
| Keys | Read-only `.env` with three provider keys; the model list lives in a config file | Nothing writes secrets to disk; new models need no code change |

### Repo layout

```
multi-model-chat/
  package.json              npm workspaces: shared, server, web
  docker-compose.yml        local Postgres
  .env.example              three provider keys + DATABASE_URL
  shared/                   types used by both sides (Lane, Turn, StreamEvent)
  server/src/
    index.ts                Express app and routes
    config/models.ts        model list: id, provider, label, price per million tokens
    db/schema.ts            Drizzle tables
    services/history.ts     buildHistory(lane, leafTurn)
    services/fanout.ts      one stream per lane, events forwarded to the page
    services/providers.ts   picks the AI SDK model for a lane
    routes/conversations.ts
    routes/turns.ts
  web/src/
    pages/ConversationPage.tsx
    components/LaneColumn.tsx, Composer.tsx, BranchSwitcher.tsx
    lib/sse.ts              reads the event stream
```

### From llm-file-test-app (dev branch)

- **Carry over:** the provider environment variable names and `.env.example` pattern, the theme CSS variables and night mode, the per-model output panel idea, and the Vite `/api` proxy setup.
- **Leave behind:** the shared `request_history` table, the Settings route that writes keys into `.env`, the resume extractor, and the Gemini key in the URL (send it in the `x-goog-api-key` header instead).

Before testing, set a monthly spend limit on each of your three provider accounts so a bug can't run up a bill.

## Local MVP: build phases

Six phases, each ending in something you can run and see; phase 4 is the core of the proof.

1. **Set up the repo.** Workspaces, TypeScript, the Vite app, the Express server, Postgres in Docker Compose, Drizzle connected, `.env` with your three keys.
   - Done when `npm run dev` starts both sides and a health route reads from the database.
2. **One streaming lane.** The model list in config, and a test route that streams one model's reply with the AI SDK into a page.
   - Done when each of the three providers streams a reply word by word.
3. **Tables and single-turn fan-out.** Create the conversations, lanes, turns and responses tables. Starting a conversation picks 2–3 models; sending a message starts every lane at once and streams events tagged by lane. Each reply is saved when it finishes, with tokens and timing.
   - Done when one message fills 2–3 live columns and the rows appear in the database.
4. **Multi-turn threads.** `buildHistory` assembles each lane's own history, and follow-up messages send each lane only its own past. The page reloads the whole conversation from the database.
   - Done when each model recalls something from turn 1 at turn 3, and no lane knows what another lane said.
5. **Branching.** A "Continue with this model" button on every reply, turns that carry a focus lane, a branch switcher, and remembering which branch is on screen.
   - Done when a branch continues with one model, and switching back resumes the full multi-model thread.
6. **Failures and polish.** Per-lane error state and retry button, automatic retry with backoff on rate-limit and server errors, a stop button, token counts on every reply, a conversation list, and markdown rendering.
   - Done when breaking one key mid-thread affects only that lane, and retry recovers it after the key is fixed.

Optional extras once the proof works: a cost estimate per conversation from the price table, and exporting a conversation as JSON.

### API routes

| Method and path | Body | Does |
| --- | --- | --- |
| GET /api/models | — | Lists models from config |
| POST /api/conversations | lane model ids (2–3), optional system prompt | Creates a conversation and its lanes |
| GET /api/conversations | — | Lists conversations, newest first |
| GET /api/conversations/:id | — | Returns lanes, turns and responses |
| POST /api/conversations/:id/turns | text, parent turn id, optional focus lane id | Saves the turn and streams every active lane's reply |
| POST /api/responses/:id/retry | — | Streams a fresh attempt for one failed lane |
| DELETE /api/conversations/:id | — | Deletes a conversation and everything under it |

Every event on the stream has the same shape, so the page only needs one reader:

```ts
type StreamEvent =
  | { laneId: string; type: "delta"; text: string }        // next piece of the reply
  | { laneId: string; type: "done"; responseId: string; inputTokens: number; outputTokens: number }
  | { laneId: string; type: "error"; responseId: string; message: string }
```

## Local MVP: proof checklist

The MVP has proved the concept when every box below is ticked. In development, log the exact messages sent to each lane so you can check the separation directly rather than trusting replies.

- [ ] Each lane's logged payload contains only the user's messages and that lane's own replies.
- [ ] A cross-provider thread runs 10+ turns and reloads correctly after a page refresh.
- [ ] A same-provider thread (Opus, Sonnet, Haiku) keeps its three lanes separate.
- [ ] Branching from turn N with one model works for 3+ more turns, and switching back continues the multi-model thread.
- [ ] Two branches from the same turn are both reachable from the branch switcher.
- [ ] One lane failing (e.g. a deliberately wrong key) leaves the other lanes untouched, and retry recovers it.
- [ ] Stop cancels the streams, and partial replies are kept and labelled as stopped.
- [ ] Every saved reply has input and output token counts, and the page shows a total per conversation.
- [ ] Total spend for the whole test stays within the limits set on your provider accounts.

## Cloud projection: architecture

Online, the app splits into a static frontend and one long-lived API container in Sydney. That container alone holds keys and talks to the providers, the database and payments.

&#91;embedded content: cloud deployment · one API container\]

The browser never sees a provider key, and Stripe confirms payments straight to the API rather than through the page.

| Component | Suggested service | Notes |
| --- | --- | --- |
| Frontend | Static hosting on a CDN, e.g. Cloudflare Pages or Vercel | The Vite build; no server code |
| API server | A container in AWS Sydney (ECS Fargate), or a simpler host such as Fly.io | Long-lived, so streams aren't cut off |
| Database | Managed Postgres: AWS RDS in Sydney, or Neon or Supabase in their Sydney region | Same schema as the MVP; daily backups |
| Key encryption | AWS KMS, or Google Cloud KMS | One master key; envelope encryption |
| Sign-in | Better Auth in your Postgres, or Clerk | Email verification and Google |
| Payments | Stripe Checkout and webhooks | Your app never stores card details |
| Bot check | Cloudflare Turnstile | Before a guest's first message |
| Email | A transactional service, e.g. Resend or Postmark | Verification emails and receipts |
| Monitoring | Sentry plus the host's logs | Keys scrubbed from every log line |
| Scheduled jobs | The host's cron | Delete expired guest data; check credits against provider invoices |

Provider-side conversation storage (OpenAI's conversations, Gemini's Interactions API) isn't used: Claude's Messages API has no equivalent, and branching is simpler when Postgres holds the only copy of each thread.

## Cloud projection: phases, costs and risks

Going online is six phases on top of the MVP; the biggest new work is accounts, key encryption and billing, not the chat itself.

1. **Deployable.** Config from environment variables, a Dockerfile for the API, managed Postgres, and a staging site.
2. **Accounts.** The auth library, an owner on every conversation, and every query filtered by owner.
3. **Your own keys.** Encrypted key storage with the key service, a Settings page with test-on-save, and the key resolver.
4. **Guest trial.** Guest cookie and IP limits, the bot check, the daily trial budget, and moving the trial into a new account.
5. **Paid credits.** Stripe Checkout and its webhook, the credit ledger, per-call metering and the price table.
6. **Launch hygiene.** Privacy policy and terms, error monitoring, backups, rate limiting on the API, log scrubbing for keys, and account deletion.

**Running cost, approximate and unverified:** roughly AUD 30–80 a month at beta scale before model usage. That covers one small API container, a small managed Postgres and one key-service key; static hosting and the bot check fit free tiers. Model usage is the cost that moves: you pay for trial traffic, and credit buyers pay for hosted traffic plus your margin.

| Risk | What goes wrong | Mitigation |
| --- | --- | --- |
| Trial abuse | Reset cookies, incognito or VPNs run up your model bill | Bot check, cookie and IP limits, daily trial budget, provider spend limit |
| Leaked user keys | Users lose money and trust | Envelope encryption, no logging, keys never sent to the browser, security review before launch |
| Provider rate limits | A spike slows paying users | Separate trial and hosted projects, retry with backoff, a queue if needed |
| Model churn | Retired models break lanes | Model list in config, monthly review, a replacement mapping |
| Long threads | Costs climb and threads hit context limits | Token display, a warning near the limit, summarising old turns later |
| Credit pricing mistakes | You lose money on hosted calls | Price table with margin, monthly check against provider invoices |
| Streams on serverless | Long replies get cut off by time limits | Run the API as a long-lived container, not serverless functions |
| Privacy and tax | Stored chats go to US providers; credits are taxable sales | Privacy policy and terms; check GST treatment of credit sales with your accountant before charging |

## Open questions and later ideas

**To decide during the MVP**

- [ ] How branches appear on the page: tabs above the lanes, or a small tree in a side panel?
- [ ] When a lane nears its context limit: warn only, or summarise old turns automatically?
- [ ] Can guests try the same-provider mode on small models, or cross-provider only?
- [ ] For the paid tier: the margin on provider prices, and the minimum top-up.

**Later ideas**

- File and image inputs.
- Marking the best reply per turn, to compare models over time.
- Editing a sent message, which branches every lane at once.
- Public read-only share links.
- Provider-side conversation IDs (OpenAI conversations, Gemini interactions) as a cost optimisation, with Postgres still the source of truth.

## Sources

- [llm-file-test-app, dev branch](https://github.com/NayrL114/llm-file-test-app/tree/dev)
- [Claude API pricing](https://platform.claude.com/docs/en/about-claude/pricing)
- [Gemini Developer API pricing](https://ai.google.dev/gemini-api/docs/pricing)
- [GPT-5.6 announcement and pricing](https://openai.com/index/gpt-5-6/)
- [AI SDK (`ai` npm package)](https://socket.dev/npm/package/ai/overview/5.0.238)
