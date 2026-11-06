import { desc, eq, inArray } from "drizzle-orm";
import { Router } from "express";
import type { ConversationSummary, Provider } from "@mmc/shared";
import { createConversationSchema, updateConversationSchema } from "@mmc/shared/schemas";
import { MODELS } from "../config/models";
import { db } from "../db/client";
import { conversations, lanes, turns } from "../db/schema";
import { HttpError, idParam, parseBody } from "../lib/http";
import { stopConversation } from "../services/activeStreams";
import { loadConversationRows, toConversation, toDetail } from "../services/conversations";
import { providerAvailability } from "../services/providers";

export const conversationsRouter = Router();

/** GET /api/conversations: newest activity first, with each conversation's lanes. */
conversationsRouter.get("/conversations", async (_req, res) => {
  const rows = await db.select().from(conversations).orderBy(desc(conversations.updatedAt)).limit(500);
  const laneRows = rows.length
    ? await db
        .select()
        .from(lanes)
        .where(inArray(lanes.conversationId, rows.map((r) => r.id)))
    : [];
  const body: ConversationSummary[] = rows.map((c) => {
    const conv = toConversation(c);
    return {
      id: conv.id,
      title: conv.title,
      mode: conv.mode,
      createdAt: conv.createdAt,
      updatedAt: conv.updatedAt,
      lanes: laneRows
        .filter((l) => l.conversationId === c.id)
        .sort((a, b) => a.position - b.position)
        .map((l) => ({ position: l.position, provider: l.provider as Provider, modelId: l.modelId })),
    };
  });
  res.json(body);
});

/** POST /api/conversations: picks 2–3 models (fixed for the conversation's life). */
conversationsRouter.post("/conversations", async (req, res) => {
  const body = parseBody(createConversationSchema, req.body);

  if (new Set(body.modelIds).size !== body.modelIds.length) throw new HttpError(400, "Pick each model only once.");
  const picked = body.modelIds.map((id) => {
    const model = MODELS.find((m) => m.id === id);
    if (!model) throw new HttpError(400, `Unknown model "${id}".`);
    const a = providerAvailability(model.provider);
    if (!a.available) throw new HttpError(400, `${model.label} is unavailable: ${a.reason}`);
    return model;
  });
  const providers = new Set(picked.map((m) => m.provider));
  if (body.mode === "cross" && providers.size !== picked.length) {
    throw new HttpError(400, "Cross-provider mode takes one model from each provider.");
  }
  if (body.mode === "same" && providers.size !== 1) {
    throw new HttpError(400, "Same-provider mode takes 2–3 models from one provider.");
  }

  const id = await db.transaction(async (tx) => {
    const [conv] = await tx
      .insert(conversations)
      .values({ mode: body.mode, systemPrompt: body.systemPrompt?.trim() || null })
      .returning({ id: conversations.id });
    await tx.insert(lanes).values(
      picked.map((m, i) => ({ conversationId: conv!.id, position: i + 1, provider: m.provider, modelId: m.id })),
    );
    return conv!.id;
  });

  const rows = await loadConversationRows(id);
  res.status(201).json(toDetail(rows!));
});

/** GET /api/conversations/:id: lanes, every turn (all branches) and every response. */
conversationsRouter.get("/conversations/:id", async (req, res) => {
  const rows = await loadConversationRows(idParam(req.params.id, "Conversation"));
  if (!rows) throw new HttpError(404, "Conversation not found");
  res.json(toDetail(rows));
});

/** PATCH /api/conversations/:id: rename, or remember which branch is on screen. */
conversationsRouter.patch("/conversations/:id", async (req, res) => {
  const id = idParam(req.params.id, "Conversation");
  const body = parseBody(updateConversationSchema, req.body);
  if (body.currentLeafTurnId) {
    const [turn] = await db.select({ conversationId: turns.conversationId }).from(turns).where(eq(turns.id, body.currentLeafTurnId));
    if (!turn || turn.conversationId !== id) throw new HttpError(404, "Turn not found in this conversation.");
  }
  const [row] = await db
    .update(conversations)
    .set({
      ...(body.title !== undefined && { title: body.title }),
      ...(body.currentLeafTurnId !== undefined && { currentLeafTurnId: body.currentLeafTurnId }),
    })
    .where(eq(conversations.id, id))
    .returning();
  if (!row) throw new HttpError(404, "Conversation not found");
  res.json(toConversation(row));
});

/** DELETE /api/conversations/:id: the conversation and everything under it. */
conversationsRouter.delete("/conversations/:id", async (req, res) => {
  const id = idParam(req.params.id, "Conversation");
  await stopConversation(id);
  const deleted = await db.delete(conversations).where(eq(conversations.id, id)).returning({ id: conversations.id });
  if (deleted.length === 0) throw new HttpError(404, "Conversation not found");
  res.status(204).end();
});
