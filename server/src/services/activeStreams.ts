// In-memory registry of replies currently streaming, so Stop (and deletes, and shutdown)
// can cancel them. One AbortController per lane reply.

interface ActiveStream {
  conversationId: string;
  turnId: string;
  controller: AbortController;
  done: Promise<void>;
}

const active = new Map<string, ActiveStream>(); // keyed by response id

export function registerStream(responseId: string, entry: ActiveStream): void {
  active.set(responseId, entry);
  void entry.done.finally(() => {
    if (active.get(responseId) === entry) active.delete(responseId);
  });
}

export function isStreaming(responseId: string): boolean {
  return active.has(responseId);
}

function abortWhere(pred: (s: ActiveStream) => boolean, reason: string): Promise<void>[] {
  const waits: Promise<void>[] = [];
  for (const s of active.values()) {
    if (pred(s)) {
      s.controller.abort(new DOMException(reason, "AbortError"));
      waits.push(s.done);
    }
  }
  return waits;
}

/** Stops every streaming reply of a turn. Resolves once they have been saved as stopped. */
export async function stopTurn(turnId: string): Promise<number> {
  const waits = abortWhere((s) => s.turnId === turnId, "Stopped by user");
  await Promise.allSettled(waits);
  return waits.length;
}

export async function stopConversation(conversationId: string): Promise<void> {
  await Promise.allSettled(abortWhere((s) => s.conversationId === conversationId, "Conversation deleted"));
}

export async function stopAll(timeoutMs: number): Promise<void> {
  const waits = abortWhere(() => true, "Server shutting down");
  await Promise.race([Promise.allSettled(waits), new Promise((r) => setTimeout(r, timeoutMs))]);
}
