// Server-Sent Events over a POST response. One request out, every lane's events back.
import type { Response } from "express";
import type { StreamEvent } from "@mmc/shared";

export interface EventStream {
  send(event: StreamEvent): void;
  end(): void;
  /** True once the client has gone away (closed tab, aborted fetch). */
  readonly closed: boolean;
  onClose(fn: () => void): void;
}

export function openEventStream(res: Response): EventStream {
  res.status(200);
  res.setHeader("Content-Type", "text/event-stream; charset=utf-8");
  res.setHeader("Cache-Control", "no-cache, no-transform");
  res.setHeader("Connection", "keep-alive");
  res.setHeader("X-Accel-Buffering", "no");
  res.flushHeaders();
  res.socket?.setNoDelay(true);

  let closed = false;
  let ended = false;
  const listeners: Array<() => void> = [];
  const heartbeat = setInterval(() => {
    if (!closed) res.write(": ping\n\n");
  }, 15_000);

  res.on("close", () => {
    clearInterval(heartbeat);
    if (!ended) {
      closed = true;
      for (const fn of listeners) fn();
    }
  });

  return {
    send(event) {
      if (closed || ended) return;
      res.write(`data: ${JSON.stringify(event)}\n\n`);
    },
    end() {
      if (ended) return;
      ended = true;
      clearInterval(heartbeat);
      if (!closed) res.end();
    },
    get closed() {
      return closed;
    },
    onClose(fn) {
      listeners.push(fn);
    },
  };
}
