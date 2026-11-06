// Reads the Server-Sent Events stream returned by a POST (EventSource only does GET).
import type { StreamEvent } from "@mmc/shared";
import { readError } from "./api";

/**
 * POSTs `body` to `/api${path}` and calls `onEvent` for every event until the stream ends.
 * Throws ApiRequestError if the server refuses the request before streaming starts.
 * Resolves with whether the closing `end` event arrived (false = connection dropped).
 */
export async function postEventStream(
  path: string,
  body: unknown,
  onEvent: (event: StreamEvent) => void,
  signal?: AbortSignal,
): Promise<boolean> {
  const res = await fetch(`/api${path}`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Accept: "text/event-stream" },
    body: JSON.stringify(body),
    signal,
  });
  if (!res.ok || !res.body) throw await readError(res);

  const reader = res.body.pipeThrough(new TextDecoderStream()).getReader();
  let buffer = "";
  let sawEnd = false;

  const dispatch = (block: string) => {
    const data = block
      .split(/\r?\n/)
      .filter((line) => line.startsWith("data:"))
      .map((line) => line.slice(5).replace(/^ /, ""))
      .join("\n");
    if (!data) return; // comment / heartbeat
    const event = JSON.parse(data) as StreamEvent;
    if (event.type === "end") sawEnd = true;
    onEvent(event);
  };

  for (;;) {
    const { value, done } = await reader.read();
    if (done) break;
    buffer += value;
    let sep: RegExpExecArray | null;
    while ((sep = /\r?\n\r?\n/.exec(buffer))) {
      dispatch(buffer.slice(0, sep.index));
      buffer = buffer.slice(sep.index + sep[0].length);
    }
  }
  if (buffer.trim()) dispatch(buffer);
  return sawEnd;
}
