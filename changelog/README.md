# Changelog

Shared, agent-agnostic record of what shipped to the Multi-Model Chat codebase. Any agent (CC, GPT, Codex, future agents) and any human contributor appends entries here. Per-month files keep merge conflicts manageable and per-entry conventions keep the record machine-readable.

## Folder layout

```text
changelog/
  README.md                            # this file
  MultiModelChat_<YYMM>_Changelog.md   # one file per calendar month, e.g. MultiModelChat_2611_Changelog.md
```

The current month's file is the active append target. At month-end, the file is closed (no further appends) and the next month's file becomes the new active target. Closed files are read-only history.

## Lifecycle

1. **Active month.** Append new entries to the **top** of the current month's file (newest first). The first entry is right under the file title; older entries follow.
2. **Month rollover.** On the first day of a new month, the next entry creates a new `MultiModelChat_<YYMM>_Changelog.md`. The previous month's file becomes archive — do not edit its bodies retroactively.
3. **Corrections to past entries.** If a past entry is materially wrong, do **not** rewrite the body. Append a new entry in the current month with `Status: Correction of <entry-id>` and explain the correction. Originals are append-only history.
4. **Backfilling old entries to a new template is forbidden** — see "Format evolution" below.

## Entry template

Copy this block verbatim when writing a new entry. Fields are required unless marked optional. Place the block at the top of the current month's file, separated from the previous entry by a `---` line.

```markdown
## [YYYY-MM-DD] <Concise change title>
<!-- id: YYYY-MM-DD-<kebab-slug> -->

| | |
|---|---|
| Author       | CC \| GPT \| Codex \| <human> |
| Planned by   | <author of the plan, or "—" if none> |
| Status       | <controlled value — see below> |
| Scope        | <comma-separated tags — see below> |
| Plan         | [path/to/plan.md](path/to/plan.md) or "—" |
| Branch / PR  | <branch-name> · #<pr-number> (optional, fill when known) |
| Commits      | <short SHA, comma-separated> (optional) |

### Summary
One short paragraph. What changed and why. Reader should be able to skip the rest if they only want the gist.

### Changes
- **<Layer> — <area>.** <what shipped>
- **<Layer> — <area>.** <what shipped>

### Verification
- <commands run, manual smoke tests, or "—" if N/A>

### Migration impact
<None / migration filename / data backfill required / etc>

### Deferred
- [ ] <item, written so a future agent can pick it up cold>
- [ ] <item>

---
```

### Field rules

- **`id`** (HTML comment) is the stable anchor. Format: `<implemented-date>-<kebab-slug>`. The slug should match or shorten the title. Do not change an `id` after the entry is committed — external references depend on it.
- **`Author`** is who wrote the code. **`Planned by`** is who wrote the plan, when those differ. If the same agent did both, `Planned by` may say `(self)` or repeat the author.
- **`Status`** is a controlled vocabulary (next section).
- **`Scope`** is a controlled tag set (next section). Multi-value, comma-separated.
- **`Plan`** points to the design doc at the repo root, or to a plan file if a plans folder is added later. Use `—` when the change was unplanned (in-conversation hardening, hot-fix, etc).
- **`Branch / PR`** and **`Commits`** are optional but strongly preferred. They wire the entry to git history so a reader can verify the record against the code.

### Controlled `Status` values

Pick exactly one:

- `Shipped` — merged to `develop`, no manual migration step.
- `Shipped — migration required` — merged with a schema change or data step that does not apply itself: a migration that rewrites or drops existing rows, or a backfill. Drizzle migrations in `server/drizzle/` run on server start, so a plain additive migration is just `Shipped`.
- `Partial` — some scope deferred to a later entry. Pair with a `Deferred` block.
- `Reverted` — change was rolled back. Note the reverting commit/PR.
- `Correction of <id>` — supersedes a prior entry. Reference the corrected `id`.

### Controlled `Scope` tags

Pick one or more, comma-separated:

`shared`, `api`, `services`, `providers`, `schema`, `migration`, `pages`, `components`, `styles`, `config`, `infra`, `ci`, `deploy`, `a11y`, `perf`, `security`, `tests`, `tooling`, `docs`

Tag meanings where they aren't obvious:

- `shared` — `shared/src/`: the types, Zod request schemas and turn-tree helpers that both sides import.
- `api` — `server/src/routes/`, `server/src/lib/` and the Express app in `server/src/index.ts`: routes, request checks, the SSE writer.
- `services` — `server/src/services/` apart from provider wiring: lane history, branching rules, fan-out, stop/retry, payload logging.
- `providers` — `server/src/config/models.ts`, `services/providers.ts` and `services/mockModel.ts`: the model list, prices, AI SDK clients and the mock provider.
- `schema` / `migration` — `server/src/db/schema.ts` and the generated SQL in `server/drizzle/`.
- `pages` / `components` / `styles` — `web/src/pages/`, `web/src/components/` and `web/src/index.css`. Client-side helpers in `web/src/lib/` go under `pages`.
- `config` — `.env.example`, `env.ts`, and other settings a user changes rather than code.
- `infra` — `docker-compose.yml` and the local Postgres container.

If a change genuinely needs a new tag, add it here in the README and use it consistently. Don't invent ad-hoc tags.

## Format evolution

This template is in force from the first entry. Two rules, carried forward for whenever the template next changes:

1. **Forward-only.** New entries follow the template current at the time of writing. Entries written before a template change stay in their original format. Do not rewrite them.
2. **Coexistence is fine.** Old and new format entries can sit in the same file during a transition month. A reader can tell them apart by shape; an agent reading for `Status` / `Scope` can grep on the template's table rows.

## Cross-linking conventions

- Reference past entries by `id`, not by line number. Line numbers shift as months grow; ids are stable.
- Reference the design doc by relative path: `[Multi-Model Chat — System Design & Implementation Plan.md](../Multi-Model%20Chat%20—%20System%20Design%20&%20Implementation%20Plan.md)`.
- Reference code by `path:line` and link the line via GitHub-style `#L<n>` anchors: `[server/src/services/history.ts:12](../server/src/services/history.ts#L12)`. From `changelog/` the project root is `../`.

## What does *not* go here

- **Forward-looking work specs →** the design doc, or a plans folder if one is added. If you're describing work that hasn't happened, it's a plan.
- **Findings and judgement →** a review document, not this log. A changelog entry records what shipped, not whether it was a good idea.
- **How to run and extend the app →** [`README.md`](../README.md).

## Cross-references

- [`README.md`](../README.md) — quick start, scripts, how it works, API, decisions taken
- [Multi-Model Chat — System Design & Implementation Plan.md](../Multi-Model%20Chat%20—%20System%20Design%20&%20Implementation%20Plan.md) — the design doc the MVP was built from
