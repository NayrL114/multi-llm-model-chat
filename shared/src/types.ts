// Types shared by the server and the web page.
// Rows are serialised as JSON, so timestamps are ISO strings here.

export type Provider = "anthropic" | "openai" | "google" | "mock";
export type ConversationMode = "cross" | "same";
export type ResponseStatus = "streaming" | "complete" | "stopped" | "error";

export interface ProviderInfo {
  id: Provider;
  label: string;
  available: boolean;
  /** Why the provider can't be used, e.g. a missing key. */
  unavailableReason?: string;
}

export interface ModelInfo {
  /** The provider's API model id. Also what a lane stores in `model_id`. */
  id: string;
  provider: Provider;
  label: string;
  /** Rough size, used to order pickers and to pick small models for trials later. */
  tier: "large" | "medium" | "small";
  /** US$ per million tokens, for estimates only. Null when unknown. */
  inputPricePerMTok: number | null;
  outputPricePerMTok: number | null;
  available: boolean;
  unavailableReason?: string;
}

export interface ModelsResponse {
  providers: ProviderInfo[];
  models: ModelInfo[];
}

export interface Conversation {
  id: string;
  title: string;
  mode: ConversationMode;
  systemPrompt: string | null;
  currentLeafTurnId: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface Lane {
  id: string;
  conversationId: string;
  /** 1–3, left to right. */
  position: number;
  provider: Provider;
  modelId: string;
}

export interface Turn {
  id: string;
  conversationId: string;
  /** Null for the first turn. */
  parentTurnId: string | null;
  /** Null means every lane replies; otherwise only this lane (a branch). */
  focusLaneId: string | null;
  userText: string;
  createdAt: string;
}

/** One lane's reply to one turn (a row of the `responses` table, minus message_json). */
export interface LaneResponse {
  id: string;
  turnId: string;
  laneId: string;
  status: ResponseStatus;
  text: string;
  error: string | null;
  inputTokens: number | null;
  outputTokens: number | null;
  latencyMs: number | null;
  createdAt: string;
  updatedAt: string;
}

export interface ConversationSummary {
  id: string;
  title: string;
  mode: ConversationMode;
  createdAt: string;
  updatedAt: string;
  lanes: Pick<Lane, "position" | "provider" | "modelId">[];
}

export interface ConversationDetail {
  conversation: Conversation;
  lanes: Lane[];
  turns: Turn[];
  responses: LaneResponse[];
}

/**
 * Every event on a turn or retry stream. The page needs one reader for all of them.
 *
 * - `start` is always first: the response rows now streaming, plus (for a new message) the saved
 *   turn and the updated conversation (new leaf, title).
 * - Lane events carry both laneId and responseId. `done`, `stopped` and `error` include the final row.
 * - `end` is always last.
 */
export type StreamEvent =
  | { type: "start"; turn?: Turn; responses: LaneResponse[]; conversation?: Conversation }
  | { type: "delta"; laneId: string; responseId: string; text: string }
  | {
      type: "retrying";
      laneId: string;
      responseId: string;
      attempt: number;
      delayMs: number;
      message: string;
    }
  | {
      type: "done";
      laneId: string;
      responseId: string;
      inputTokens: number | null;
      outputTokens: number | null;
      response: LaneResponse;
    }
  | { type: "stopped"; laneId: string; responseId: string; response: LaneResponse }
  | { type: "error"; laneId: string; responseId: string; message: string; response: LaneResponse }
  | { type: "end" };

export interface ApiError {
  error: string;
  details?: unknown;
}
