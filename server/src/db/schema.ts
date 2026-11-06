// The four tables from the design doc. The cloud version adds owner columns to conversations.
import type { ModelMessage } from "ai";
import {
  type AnyPgColumn,
  index,
  integer,
  jsonb,
  pgEnum,
  pgTable,
  smallint,
  text,
  timestamp,
  unique,
  uuid,
} from "drizzle-orm/pg-core";

export const conversationMode = pgEnum("conversation_mode", ["cross", "same"]);
export const responseStatus = pgEnum("response_status", ["streaming", "complete", "stopped", "error"]);

const createdAt = () => timestamp("created_at", { withTimezone: true, mode: "date" }).notNull().defaultNow();
const updatedAt = () => timestamp("updated_at", { withTimezone: true, mode: "date" }).notNull().defaultNow();

export const conversations = pgTable("conversations", {
  id: uuid("id").primaryKey().defaultRandom(),
  title: text("title").notNull().default("New conversation"),
  mode: conversationMode("mode").notNull(),
  systemPrompt: text("system_prompt"),
  // No foreign key: it would make conversations and turns reference each other.
  currentLeafTurnId: uuid("current_leaf_turn_id"),
  createdAt: createdAt(),
  updatedAt: updatedAt(),
});

export const lanes = pgTable(
  "lanes",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    conversationId: uuid("conversation_id")
      .notNull()
      .references(() => conversations.id, { onDelete: "cascade" }),
    position: smallint("position").notNull(),
    provider: text("provider").notNull(),
    modelId: text("model_id").notNull(),
  },
  (t) => [unique("lanes_conversation_position_uq").on(t.conversationId, t.position)],
);

export const turns = pgTable(
  "turns",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    conversationId: uuid("conversation_id")
      .notNull()
      .references(() => conversations.id, { onDelete: "cascade" }),
    parentTurnId: uuid("parent_turn_id").references((): AnyPgColumn => turns.id, { onDelete: "cascade" }),
    focusLaneId: uuid("focus_lane_id").references(() => lanes.id, { onDelete: "cascade" }),
    userText: text("user_text").notNull(),
    createdAt: createdAt(),
  },
  (t) => [index("turns_conversation_idx").on(t.conversationId), index("turns_parent_idx").on(t.parentTurnId)],
);

export const responses = pgTable(
  "responses",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    turnId: uuid("turn_id")
      .notNull()
      .references(() => turns.id, { onDelete: "cascade" }),
    laneId: uuid("lane_id")
      .notNull()
      .references(() => lanes.id, { onDelete: "cascade" }),
    status: responseStatus("status").notNull().default("streaming"),
    // Display copy of the reply text.
    text: text("text").notNull().default(""),
    // The reply exactly as the AI SDK returned it (its response messages), so anything a
    // provider needs sent back later (reasoning signatures, item ids) is preserved.
    messageJson: jsonb("message_json").$type<ModelMessage[]>(),
    error: text("error"),
    inputTokens: integer("input_tokens"),
    outputTokens: integer("output_tokens"),
    latencyMs: integer("latency_ms"),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [unique("responses_turn_lane_uq").on(t.turnId, t.laneId), index("responses_lane_idx").on(t.laneId)],
);

export type ConversationRow = typeof conversations.$inferSelect;
export type LaneRow = typeof lanes.$inferSelect;
export type TurnRow = typeof turns.$inferSelect;
export type ResponseRow = typeof responses.$inferSelect;
