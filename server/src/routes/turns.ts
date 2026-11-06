import { and, eq, inArray } from "drizzle-orm";
import { Router } from "express";
import { createTurnSchema } from "@mmc/shared/schemas";
import { db } from "../db/client";
import { conversations, responses, turns } from "../db/schema";
import { HttpError, idParam, parseBody } from "../lib/http";
import { openEventStream } from "../lib/sse";
import { isStreaming, stopTurn } from "../services/activeStreams";
import {
  historyIndex,
  loadConversationRows,
  titleFrom,
  toConversation,
  toLaneResponse,
  toTurn,
} from "../services/conversations";
import { runLanes } from "../services/fanout";
import { placeNewTurn } from "../services/turnRules";

export const turnsRouter = Router();

/**
 * POST /api/conversations/:id/turns
 * Saves the turn plus a streaming response row per active lane, then streams every
 * lane's reply back on this one request as Server-Sent Events.
 */
turnsRouter.post("/conversations/:id/turns", async (req, res) => {
  const conversationId = idParam(req.params.id, "Conversation");
  const body = parseBody(createTurnSchema, req.body);
  const rows = await loadConversationRows(conversationId);
  if (!rows) throw new HttpError(404, "Conversation not found");

  const placement = placeNewTurn({
    turns: rows.turns,
    lanes: rows.lanes,
    responses: rows.responses,
    parentTurnId: body.parentTurnId,
    focusLaneId: body.focusLaneId,
  });
  const activeLanes = placement.focusLaneId ? rows.lanes.filter((l) => l.id === placement.focusLaneId) : rows.lanes;

  const { turn, responseRows, conversation } = await db.transaction(async (tx) => {
    const [turn] = await tx
      .insert(turns)
      .values({
        conversationId,
        parentTurnId: placement.parentTurnId,
        focusLaneId: placement.focusLaneId,
        userText: body.text,
      })
      .returning();
    const responseRows = await tx
      .insert(responses)
      .values(activeLanes.map((l) => ({ turnId: turn!.id, laneId: l.id, status: "streaming" as const })))
      .returning();
    const [conversation] = await tx
      .update(conversations)
      .set({
        currentLeafTurnId: turn!.id,
        updatedAt: new Date(),
        ...(rows.turns.length === 0 && { title: titleFrom(body.text) }),
      })
      .where(eq(conversations.id, conversationId))
      .returning();
    return { turn: turn!, responseRows, conversation: conversation! };
  });

  const { turnsById, replyFor } = historyIndex({
    turns: [...rows.turns, turn],
    responses: [...rows.responses, ...responseRows],
  });
  const laneById = new Map(activeLanes.map((l) => [l.id, l]));

  const events = openEventStream(res);
  events.send({
    type: "start",
    turn: toTurn(turn),
    responses: responseRows.map(toLaneResponse),
    conversation: toConversation(conversation),
  });
  await runLanes(
    { conversation, turnId: turn.id, turnsById, replyFor, events },
    responseRows.map((r) => ({ lane: laneById.get(r.laneId)!, response: r })),
  );
  events.send({ type: "end" });
  events.end();
});

/** POST /api/turns/:id/stop: cancels the turn's streaming replies; partial text is kept as "stopped". */
turnsRouter.post("/turns/:id/stop", async (req, res) => {
  const stopped = await stopTurn(idParam(req.params.id, "Turn"));
  res.json({ stopped });
});

/** POST /api/responses/:id/retry: streams a fresh attempt for one failed (or stopped) lane. */
turnsRouter.post("/responses/:id/retry", async (req, res) => {
  const id = idParam(req.params.id, "Response");
  const [found] = await db
    .select({ status: responses.status, conversationId: turns.conversationId })
    .from(responses)
    .innerJoin(turns, eq(responses.turnId, turns.id))
    .where(eq(responses.id, id));
  if (!found) throw new HttpError(404, "Response not found");
  if (found.status === "streaming" || isStreaming(id)) throw new HttpError(409, "That reply is already streaming.");
  if (found.status === "complete") throw new HttpError(409, "Only failed or stopped replies can be retried.");

  // Retry reuses the row.
  const [reset] = await db
    .update(responses)
    .set({
      status: "streaming",
      text: "",
      messageJson: null,
      error: null,
      inputTokens: null,
      outputTokens: null,
      latencyMs: null,
      updatedAt: new Date(),
    })
    .where(and(eq(responses.id, id), inArray(responses.status, ["error", "stopped"])))
    .returning();
  if (!reset) throw new HttpError(409, "That reply changed; reload and try again.");

  const rows = await loadConversationRows(found.conversationId);
  const lane = rows?.lanes.find((l) => l.id === reset.laneId);
  if (!rows || !lane) throw new HttpError(404, "Conversation not found");
  const { turnsById, replyFor } = historyIndex(rows);

  const events = openEventStream(res);
  events.send({ type: "start", responses: [toLaneResponse(reset)] });
  await runLanes({ conversation: rows.conversation, turnId: reset.turnId, turnsById, replyFor, events }, [
    { lane, response: reset },
  ]);
  events.send({ type: "end" });
  events.end();
});
