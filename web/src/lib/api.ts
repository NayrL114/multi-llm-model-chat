import type { Conversation, ConversationDetail, ConversationSummary, ModelsResponse } from "@mmc/shared";
import type { CreateConversationBody, UpdateConversationBody } from "@mmc/shared/schemas";

export class ApiRequestError extends Error {
  constructor(
    readonly status: number,
    message: string,
  ) {
    super(message);
  }
}

export async function readError(res: globalThis.Response): Promise<ApiRequestError> {
  let message = `Request failed (${res.status})`;
  try {
    const body = await res.json();
    if (body?.error) message = body.error;
  } catch {
    /* not JSON */
  }
  return new ApiRequestError(res.status, message);
}

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(`/api${path}`, {
    ...init,
    headers: init?.body ? { "Content-Type": "application/json", ...init.headers } : init?.headers,
  });
  if (!res.ok) throw await readError(res);
  if (res.status === 204) return undefined as T;
  return (await res.json()) as T;
}

export const api = {
  models: () => request<ModelsResponse>("/models"),
  conversations: () => request<ConversationSummary[]>("/conversations"),
  conversation: (id: string) => request<ConversationDetail>(`/conversations/${id}`),
  createConversation: (body: CreateConversationBody) =>
    request<ConversationDetail>("/conversations", { method: "POST", body: JSON.stringify(body) }),
  updateConversation: (id: string, body: UpdateConversationBody) =>
    request<Conversation>(`/conversations/${id}`, { method: "PATCH", body: JSON.stringify(body) }),
  deleteConversation: (id: string) => request<void>(`/conversations/${id}`, { method: "DELETE" }),
  stopTurn: (turnId: string) => request<{ stopped: number }>(`/turns/${turnId}/stop`, { method: "POST" }),
};
