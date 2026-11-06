// buildHistory: the messages one lane sees for one turn.
//
// Each lane sees only the user's messages and its own replies, along the path from the
// first turn down to the turn being answered. A reply counts as history when it is
// complete or stopped (and not empty); error and streaming rows leave a gap, and
// back-to-back user messages are merged so every provider's format stays valid.
import type { ModelMessage, UserModelMessage } from "ai";
import { pathToTurn } from "@mmc/shared";

export interface HistoryTurn {
  id: string;
  parentTurnId: string | null;
  userText: string;
  createdAt: string;
}

export interface HistoryReply {
  status: "streaming" | "complete" | "stopped" | "error";
  text: string;
  messageJson: ModelMessage[] | null;
}

/** Looks up a lane's reply to a turn. */
export type ReplyLookup = (turnId: string, laneId: string) => HistoryReply | undefined;

export function countsAsHistory(reply: HistoryReply | undefined): reply is HistoryReply & { messageJson: ModelMessage[] } {
  return (
    !!reply &&
    (reply.status === "complete" || reply.status === "stopped") &&
    reply.text.trim() !== "" &&
    Array.isArray(reply.messageJson) &&
    reply.messageJson.length > 0
  );
}

export function buildHistory(
  laneId: string,
  leafTurnId: string,
  turnsById: ReadonlyMap<string, HistoryTurn>,
  replyFor: ReplyLookup,
): ModelMessage[] {
  const path = pathToTurn(turnsById, leafTurnId);
  if (path.length === 0) throw new Error(`Turn ${leafTurnId} not found`);

  const messages: ModelMessage[] = [];
  for (const turn of path) {
    messages.push({ role: "user", content: turn.userText });
    // The leaf's own reply is the one being generated now, so it never counts.
    if (turn.id === leafTurnId) continue;
    const reply = replyFor(turn.id, laneId);
    if (countsAsHistory(reply)) messages.push(...reply.messageJson);
  }
  return mergeBackToBackUserMessages(messages);
}

type UserParts = Exclude<UserModelMessage["content"], string>;

function toParts(content: UserModelMessage["content"]): UserParts {
  return typeof content === "string" ? [{ type: "text", text: content }] : content;
}

/** Joins consecutive user messages into one (text joined by a blank line). */
export function mergeBackToBackUserMessages(messages: readonly ModelMessage[]): ModelMessage[] {
  const out: ModelMessage[] = [];
  for (const msg of messages) {
    const prev = out[out.length - 1];
    if (msg.role === "user" && prev?.role === "user") {
      const merged: UserModelMessage =
        typeof prev.content === "string" && typeof msg.content === "string"
          ? { role: "user", content: `${prev.content}\n\n${msg.content}` }
          : { role: "user", content: [...toParts(prev.content), ...toParts(msg.content)] };
      out[out.length - 1] = merged;
    } else {
      out.push(msg);
    }
  }
  return out;
}
