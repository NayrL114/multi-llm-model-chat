// Zod schemas for every request body. The server validates with these;
// the page only uses the inferred types.
import { z } from "zod";

export const createConversationSchema = z.object({
  mode: z.enum(["cross", "same"]),
  /** 2–3 distinct model ids from GET /api/models, in lane order. */
  modelIds: z.array(z.string().min(1)).min(2).max(3),
  systemPrompt: z.string().max(20_000).nullish(),
});
export type CreateConversationBody = z.infer<typeof createConversationSchema>;

export const updateConversationSchema = z
  .object({
    title: z.string().trim().min(1).max(200).optional(),
    /** Which branch is on screen. Must be a turn in this conversation. */
    currentLeafTurnId: z.uuid().optional(),
  })
  .refine((b) => b.title !== undefined || b.currentLeafTurnId !== undefined, {
    message: "Nothing to update",
  });
export type UpdateConversationBody = z.infer<typeof updateConversationSchema>;

export const createTurnSchema = z.object({
  text: z.string().trim().min(1, "Message is empty").max(50_000),
  /** The turn on screen (or the turn holding the chosen reply). Null only for the first turn. */
  parentTurnId: z.uuid().nullable(),
  /**
   * Set to "continue with this model". Omit to keep the parent's focus.
   * Inside a branch it must match the parent's focus.
   */
  focusLaneId: z.uuid().nullish(),
});
export type CreateTurnBody = z.infer<typeof createTurnSchema>;
