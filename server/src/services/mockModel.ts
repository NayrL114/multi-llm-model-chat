// Offline mock models (provider "mock"). Each reply describes exactly what the lane was
// sent, and signs itself, so you can see lane separation without spending money:
// every earlier assistant message in a lane's history should carry that lane's own tag.
//
// Keywords in your latest message:
//   #long       a long reply, for testing Stop
//   #ratelimit  the first two attempts fail with a 429, to exercise automatic backoff
// "mock-flaky" fails the first attempt at every reply with a fake bad-key error (not
// retried automatically), so the Retry button can be tested.
import { APICallError, type LanguageModelV4, type LanguageModelV4Prompt, type LanguageModelV4StreamPart } from "@ai-sdk/provider";

export const MOCK_REPLY_HEADER = "x-mock-reply-id";
const attempts = new Map<string, number>();

function textOf(content: LanguageModelV4Prompt[number]["content"]): string {
  if (typeof content === "string") return content;
  return content.map((p) => ("text" in p && typeof p.text === "string" ? p.text : "")).join("");
}

function clip(s: string, n = 80): string {
  const one = s.replace(/\s+/g, " ").trim();
  return one.length > n ? `${one.slice(0, n)}…` : one;
}

function buildReply(modelId: string, prompt: LanguageModelV4Prompt): string {
  const tag = `[${modelId}]`;
  const system = prompt.find((m) => m.role === "system");
  const users = prompt.filter((m) => m.role === "user").map((m) => textOf(m.content));
  const mine = prompt.filter((m) => m.role === "assistant").map((m) => textOf(m.content));
  const foreign = mine.filter((t) => !t.startsWith(tag));
  const latest = users[users.length - 1] ?? "";

  const lines = [
    `${tag} **Lane memory check**`,
    "",
    `I was sent **${prompt.length - (system ? 1 : 0)} messages**: ${users.length} from you and ${mine.length} of my own earlier replies.`,
    `System prompt: ${system ? `"${clip(textOf(system.content), 60)}"` : "none"}.`,
    "",
    `- Your first message: "${clip(users[0] ?? "")}"`,
    `- Your latest message: "${clip(latest)}"`,
    mine.length
      ? `- My previous reply began: "${clip(mine[mine.length - 1] ?? "", 50)}"`
      : "- This is my first reply in this thread.",
    "",
    foreign.length === 0
      ? `Separation: all ${mine.length} assistant messages in my history are mine.`
      : `**Separation problem:** ${foreign.length} assistant message(s) in my history aren't mine!`,
  ];
  if (latest.includes("#long")) {
    lines.push("", "Here is a long answer so you can try Stop:", "");
    for (let i = 1; i <= 40; i++) {
      lines.push(`${i}. Lorem ipsum dolor sit amet, consectetur adipiscing elit, sed do eiusmod tempor.`);
    }
  }
  return lines.join("\n");
}

function fail(statusCode: number, message: string, isRetryable: boolean): never {
  throw new APICallError({
    message,
    url: "mock://local",
    requestBodyValues: {},
    statusCode,
    isRetryable,
    responseHeaders: statusCode === 429 ? { "retry-after": "1" } : undefined,
  });
}

const approxTokens = (s: string) => Math.max(1, Math.ceil(s.length / 4));

export function createMockModel(modelId: string): LanguageModelV4 {
  return {
    specificationVersion: "v4",
    provider: "mock",
    modelId,
    supportedUrls: {},
    async doGenerate() {
      throw new Error("Mock models only support streaming");
    },
    async doStream(options) {
      const prompt = options.prompt;
      // Attempts are counted per reply (the fan-out passes the response id as a header).
      const replyKey = `${modelId}:${options.headers?.[MOCK_REPLY_HEADER] ?? JSON.stringify(prompt)}`;
      const attempt = (attempts.get(replyKey) ?? 0) + 1;
      attempts.set(replyKey, attempt);
      const latest = textOf(prompt.filter((m) => m.role === "user").at(-1)?.content ?? "");

      if (latest.includes("#ratelimit") && attempt <= 2) {
        fail(429, "Mock: rate limited (simulated).", true);
      }
      if (modelId === "mock-flaky" && attempt === 1) {
        fail(401, "Mock: invalid API key (simulated). Press Retry to recover.", false);
      }

      const reply = buildReply(modelId, prompt);
      const words = reply.split(/(?<=\s)/);
      const inputTokens = approxTokens(prompt.map((m) => textOf(m.content)).join(" "));
      const signal = options.abortSignal;

      const stream = new ReadableStream<LanguageModelV4StreamPart>({
        async start(controller) {
          const onAbort = () => {
            try {
              controller.error(signal?.reason ?? new DOMException("Aborted", "AbortError"));
            } catch {
              /* already closed */
            }
          };
          signal?.addEventListener("abort", onAbort, { once: true });
          controller.enqueue({ type: "stream-start", warnings: [] });
          controller.enqueue({ type: "text-start", id: "t0" });
          for (const w of words) {
            if (signal?.aborted) return;
            await new Promise((r) => setTimeout(r, 18 + Math.random() * 30));
            if (signal?.aborted) return;
            controller.enqueue({ type: "text-delta", id: "t0", delta: w });
          }
          controller.enqueue({ type: "text-end", id: "t0" });
          controller.enqueue({
            type: "finish",
            finishReason: { unified: "stop", raw: "stop" },
            usage: {
              inputTokens: { total: inputTokens, noCache: inputTokens, cacheRead: 0, cacheWrite: 0 },
              outputTokens: { total: approxTokens(reply), text: approxTokens(reply), reasoning: 0 },
            },
          });
          signal?.removeEventListener("abort", onAbort);
          controller.close();
        },
      });
      return { stream };
    },
  };
}
