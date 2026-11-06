// Loading a conversation's rows and turning them into API shapes.
// In the MVP a conversation is loaded whole and walked in memory.
import { asc, eq } from "drizzle-orm";
import type { Conversation, ConversationDetail, Lane, LaneResponse, Provider, Turn } from "@mmc/shared";
import { db } from "../db/client";
import {
  type ConversationRow,
  conversations,
  type LaneRow,
  lanes,
  type ResponseRow,
  responses,
  type TurnRow,
  turns,
} from "../db/schema";
import type { HistoryTurn, ReplyLookup } from "./history";

export interface ConversationRows {
  conversation: ConversationRow;
  lanes: LaneRow[];
  turns: TurnRow[];
  responses: ResponseRow[];
}

export async function loadConversationRows(id: string): Promise<ConversationRows | null> {
  const [conversation] = await db.select().from(conversations).where(eq(conversations.id, id));
  if (!conversation) return null;
  const [laneRows, turnRows, responseRows] = await Promise.all([
    db.select().from(lanes).where(eq(lanes.conversationId, id)).orderBy(asc(lanes.position)),
    db.select().from(turns).where(eq(turns.conversationId, id)).orderBy(asc(turns.createdAt)),
    db
      .select({ r: responses })
      .from(responses)
      .innerJoin(turns, eq(responses.turnId, turns.id))
      .where(eq(turns.conversationId, id))
      .then((rows) => rows.map((x) => x.r)),
  ]);
  return { conversation, lanes: laneRows, turns: turnRows, responses: responseRows };
}

const iso = (d: Date) => d.toISOString();

export function toConversation(c: ConversationRow): Conversation {
  return {
    id: c.id,
    title: c.title,
    mode: c.mode,
    systemPrompt: c.systemPrompt,
    currentLeafTurnId: c.currentLeafTurnId,
    createdAt: iso(c.createdAt),
    updatedAt: iso(c.updatedAt),
  };
}

export function toLane(l: LaneRow): Lane {
  return {
    id: l.id,
    conversationId: l.conversationId,
    position: l.position,
    provider: l.provider as Provider,
    modelId: l.modelId,
  };
}

export function toTurn(t: TurnRow): Turn {
  return {
    id: t.id,
    conversationId: t.conversationId,
    parentTurnId: t.parentTurnId,
    focusLaneId: t.focusLaneId,
    userText: t.userText,
    createdAt: iso(t.createdAt),
  };
}

/** message_json stays on the server; the page only needs the display text. */
export function toLaneResponse(r: ResponseRow): LaneResponse {
  return {
    id: r.id,
    turnId: r.turnId,
    laneId: r.laneId,
    status: r.status,
    text: r.text,
    error: r.error,
    inputTokens: r.inputTokens,
    outputTokens: r.outputTokens,
    latencyMs: r.latencyMs,
    createdAt: iso(r.createdAt),
    updatedAt: iso(r.updatedAt),
  };
}

export function toDetail(rows: ConversationRows): ConversationDetail {
  return {
    conversation: toConversation(rows.conversation),
    lanes: rows.lanes.map(toLane),
    turns: rows.turns.map(toTurn),
    responses: rows.responses.map(toLaneResponse),
  };
}

/** In-memory lookups for buildHistory over one loaded conversation. */
export function historyIndex(rows: Pick<ConversationRows, "turns" | "responses">): {
  turnsById: Map<string, HistoryTurn>;
  replyFor: ReplyLookup;
} {
  const turnsById = new Map<string, HistoryTurn>(
    rows.turns.map((t) => [
      t.id,
      { id: t.id, parentTurnId: t.parentTurnId, userText: t.userText, createdAt: iso(t.createdAt) },
    ]),
  );
  const replies = new Map(rows.responses.map((r) => [`${r.turnId}:${r.laneId}`, r]));
  return { turnsById, replyFor: (turnId, laneId) => replies.get(`${turnId}:${laneId}`) };
}

/** First line of the first message, trimmed to a title. */
export function titleFrom(text: string): string {
  const line = text.trim().split(/\r?\n/)[0] ?? "";
  return line.length > 60 ? `${line.slice(0, 57)}…` : line || "New conversation";
}
