// Fan-out: one streaming model call per active lane, every piece of text forwarded to the
// page as an event tagged with the lane. Lanes run independently, so a slow or failed lane
// never holds up the others, and the stream closes once every lane has finished.
import { APICallError, type ModelMessage, streamText } from "ai";
import { eq } from "drizzle-orm";
import type { StreamEvent } from "@mmc/shared";
import { db } from "../db/client";
import { type ConversationRow, type LaneRow, type ResponseRow, responses } from "../db/schema";
import type { EventStream } from "../lib/sse";
import { registerStream } from "./activeStreams";
import { toLaneResponse } from "./conversations";
import { buildHistory, type HistoryTurn, type ReplyLookup } from "./history";
import { MOCK_REPLY_HEADER } from "./mockModel";
import { logLanePayload } from "./payloadLog";
import { getLanguageModel, ProviderUnavailableError, providerOptionsFor } from "./providers";

const MAX_AUTO_RETRIES = 3;
const RETRYABLE_STATUS = new Set([408, 409, 429, 500, 502, 503, 504, 529]);

export interface LaneJob {
  lane: LaneRow;
  response: ResponseRow;
}

export interface FanoutContext {
  conversation: ConversationRow;
  turnId: string;
  turnsById: ReadonlyMap<string, HistoryTurn>;
  replyFor: ReplyLookup;
  events: EventStream;
}

/** Streams every job's reply onto `events`; resolves when all lanes have finished and been saved. */
export async function runLanes(ctx: FanoutContext, jobs: LaneJob[]): Promise<void> {
  const controllers = jobs.map(() => new AbortController());
  // Closing the tab or aborting the request stops the lanes (and the spending).
  ctx.events.onClose(() => {
    for (const c of controllers) c.abort(new DOMException("Client disconnected", "AbortError"));
  });

  const runs = jobs.map((job, i) => {
    const controller = controllers[i]!;
    const done = runLane(ctx, job, controller.signal);
    registerStream(job.response.id, {
      conversationId: ctx.conversation.id,
      turnId: ctx.turnId,
      controller,
      done,
    });
    return done;
  });
  await Promise.allSettled(runs);
}

type Outcome =
  | { kind: "complete"; text: string; messages: ModelMessage[]; inputTokens: number | null; outputTokens: number | null }
  | { kind: "stopped"; text: string }
  | { kind: "error"; text: string; error: unknown };

async function runLane(ctx: FanoutContext, job: LaneJob, signal: AbortSignal): Promise<void> {
  const { lane, response } = job;
  const ids = { laneId: lane.id, responseId: response.id };
  const started = Date.now();
  let outcome: Outcome;

  try {
    const messages = buildHistory(lane.id, ctx.turnId, ctx.turnsById, ctx.replyFor);
    const model = getLanguageModel(lane.provider, lane.modelId);
    const instructions = ctx.conversation.systemPrompt?.trim() || undefined;

    let attempt = 0;
    for (;;) {
      attempt++;
      logLanePayload({
        conversationId: ctx.conversation.id,
        turnId: ctx.turnId,
        responseId: response.id,
        laneId: lane.id,
        position: lane.position,
        provider: lane.provider,
        modelId: lane.modelId,
        attempt,
        system: instructions ?? null,
        messages,
      });
      outcome = await streamOnce({
        model,
        instructions,
        messages,
        signal,
        provider: lane.provider,
        headers: lane.provider === "mock" ? { [MOCK_REPLY_HEADER]: response.id } : undefined,
        onDelta: (text) => ctx.events.send({ type: "delta", ...ids, text }),
      });
      // Retry automatically only if nothing reached the page yet, so text is never duplicated.
      if (outcome.kind !== "error" || outcome.text !== "" || attempt > MAX_AUTO_RETRIES || signal.aborted) break;
      if (!isRetryable(outcome.error)) break;
      const delayMs = backoffMs(attempt, outcome.error);
      ctx.events.send({ type: "retrying", ...ids, attempt, delayMs, message: describeError(outcome.error) });
      await sleep(delayMs, signal);
      if (signal.aborted) {
        outcome = { kind: "stopped", text: "" };
        break;
      }
    }
  } catch (e) {
    outcome = { kind: "error", text: "", error: e };
  }

  await saveOutcome(ctx, ids, outcome, Date.now() - started);
}

async function streamOnce(args: {
  model: ReturnType<typeof getLanguageModel>;
  instructions: string | undefined;
  messages: ModelMessage[];
  signal: AbortSignal;
  provider: string;
  headers: Record<string, string> | undefined;
  onDelta: (text: string) => void;
}): Promise<Outcome> {
  const result = streamText({
    model: args.model,
    instructions: args.instructions,
    messages: args.messages,
    abortSignal: args.signal,
    headers: args.headers,
    maxRetries: 0, // retries are handled above so the page can show them
    providerOptions: providerOptionsFor(args.provider),
    onError: () => {}, // errors are handled from the stream below
  });

  let text = "";
  let error: unknown;
  let finishReason: string | undefined;
  let inputTokens: number | null = null;
  let outputTokens: number | null = null;

  try {
    for await (const part of result.fullStream) {
      if (part.type === "text-delta") {
        text += part.text;
        args.onDelta(part.text);
      } else if (part.type === "error") {
        error = part.error;
        break;
      } else if (part.type === "abort") {
        break;
      } else if (part.type === "finish") {
        finishReason = part.finishReason;
        inputTokens = part.totalUsage.inputTokens ?? null;
        outputTokens = part.totalUsage.outputTokens ?? null;
      }
    }
  } catch (e) {
    if (!args.signal.aborted) error = e;
  }

  if (args.signal.aborted) return { kind: "stopped", text };
  if (error !== undefined) return { kind: "error", text, error };
  if (text.trim() === "") {
    return { kind: "error", text, error: new Error(`The model returned no text (finish reason: ${finishReason ?? "unknown"}).`) };
  }
  const messages = (await result.responseMessages) as ModelMessage[];
  return { kind: "complete", text, messages, inputTokens, outputTokens };
}

async function saveOutcome(
  ctx: FanoutContext,
  ids: { laneId: string; responseId: string },
  outcome: Outcome,
  latencyMs: number,
): Promise<void> {
  const base = { text: outcome.text, latencyMs, updatedAt: new Date() };
  let values: Partial<typeof responses.$inferInsert>;
  if (outcome.kind === "complete") {
    values = {
      ...base,
      status: "complete",
      messageJson: outcome.messages,
      error: null,
      inputTokens: outcome.inputTokens,
      outputTokens: outcome.outputTokens,
    };
  } else if (outcome.kind === "stopped") {
    // A stopped reply still counts as history, so keep its partial text as an assistant message.
    values = {
      ...base,
      status: "stopped",
      messageJson: outcome.text.trim() ? [{ role: "assistant", content: [{ type: "text", text: outcome.text }] }] : null,
      error: null,
      inputTokens: null,
      outputTokens: null,
    };
  } else {
    const message = describeError(outcome.error);
    console.warn(`[lane ${ids.laneId.slice(0, 8)}] error: ${message}`);
    values = { ...base, status: "error", messageJson: null, error: message, inputTokens: null, outputTokens: null };
  }

  let row: ResponseRow | undefined;
  try {
    [row] = await db.update(responses).set(values).where(eq(responses.id, ids.responseId)).returning();
  } catch (e) {
    console.error("Failed to save reply", ids.responseId, e);
  }
  if (!row) return; // conversation was deleted mid-stream

  const dto = toLaneResponse(row);
  let event: StreamEvent;
  if (row.status === "complete") {
    event = { type: "done", ...ids, inputTokens: row.inputTokens, outputTokens: row.outputTokens, response: dto };
  } else if (row.status === "stopped") {
    event = { type: "stopped", ...ids, response: dto };
  } else {
    event = { type: "error", ...ids, message: row.error ?? "Unknown error", response: dto };
  }
  ctx.events.send(event);
}

function rootError(e: unknown): unknown {
  // AI SDK wraps some errors (e.g. RetryError.lastError, or `cause`).
  if (e && typeof e === "object") {
    if ("lastError" in e && e.lastError) return rootError(e.lastError);
  }
  return e;
}

export function isRetryable(e: unknown): boolean {
  const err = rootError(e);
  if (APICallError.isInstance(err)) return err.isRetryable || RETRYABLE_STATUS.has(err.statusCode ?? 0);
  if (err instanceof Error) return /fetch failed|ECONNRESET|ETIMEDOUT|EAI_AGAIN|socket hang up/i.test(err.message);
  return false;
}

function backoffMs(attempt: number, e: unknown): number {
  const err = rootError(e);
  if (APICallError.isInstance(err)) {
    const h = err.responseHeaders ?? {};
    const ms = Number(h["retry-after-ms"]);
    if (Number.isFinite(ms) && ms > 0) return Math.min(ms, 30_000);
    const s = Number(h["retry-after"]);
    if (Number.isFinite(s) && s > 0) return Math.min(s * 1000, 30_000);
  }
  return 1000 * 2 ** (attempt - 1) + Math.floor(Math.random() * 250);
}

export function describeError(e: unknown): string {
  const err = rootError(e);
  let msg: string;
  if (err instanceof ProviderUnavailableError) msg = err.message;
  else if (APICallError.isInstance(err)) msg = `${err.statusCode ? `${err.statusCode}: ` : ""}${err.message}`;
  else if (err instanceof Error) msg = err.message;
  else msg = "Unknown error";
  return msg.length > 600 ? `${msg.slice(0, 600)}…` : msg;
}

function sleep(ms: number, signal: AbortSignal): Promise<void> {
  return new Promise((resolve) => {
    if (signal.aborted) return resolve();
    const t = setTimeout(done, ms);
    signal.addEventListener("abort", done, { once: true });
    function done() {
      clearTimeout(t);
      signal.removeEventListener("abort", done);
      resolve();
    }
  });
}
