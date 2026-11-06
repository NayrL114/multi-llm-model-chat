// End-to-end smoke test of the thread-keeping core, using the free offline mock models.
// Needs the server running with ENABLE_MOCK_MODELS=true:   npm run dev   then   npm run smoke
// Creates its own conversation and deletes it afterwards (pass --keep to keep it).
const API = process.env.SMOKE_API ?? "http://localhost:3001/api";
const keep = process.argv.includes("--keep");
let failures = 0;

const check = (label, ok, extra = "") => {
  if (!ok) failures++;
  console.log(`${ok ? "PASS" : "FAIL"}  ${label}${extra ? `  — ${extra}` : ""}`);
};
const json = (r) => r.json();
const call = (method, path, body) =>
  fetch(API + path, {
    method,
    headers: body ? { "content-type": "application/json" } : undefined,
    body: body ? JSON.stringify(body) : undefined,
  });

async function stream(path, body, { onEvent, signal } = {}) {
  const res = await fetch(API + path, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body ?? {}),
    signal,
  });
  if (!res.ok) return { status: res.status, error: (await res.json()).error, events: [] };
  const events = [];
  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let buf = "";
  try {
    for (;;) {
      const { value, done } = await reader.read();
      if (done) break;
      buf += decoder.decode(value, { stream: true });
      let i;
      while ((i = buf.indexOf("\n\n")) >= 0) {
        const block = buf.slice(0, i);
        buf = buf.slice(i + 2);
        for (const line of block.split("\n")) {
          if (!line.startsWith("data: ")) continue;
          const e = JSON.parse(line.slice(6));
          events.push(e);
          onEvent?.(e);
        }
      }
    }
  } catch (e) {
    if (!signal?.aborted) throw e;
  }
  return { status: res.status, events };
}

const finals = (r) => r.events.filter((e) => e.type === "done" || e.type === "error" || e.type === "stopped");
const counts = (r) => {
  const c = {};
  for (const e of r.events) c[e.type] = (c[e.type] ?? 0) + 1;
  return JSON.stringify(c);
};
const seen = (text) => text?.match(/\*\*\d+ messages\*\*: [^.]+/)?.[0] ?? "";

// --- setup ---
const models = await fetch(`${API}/models`)
  .then(json)
  .catch(() => null);
if (!models) {
  console.error(`Can't reach ${API}. Start the app with \`npm run dev\` first.`);
  process.exit(1);
}
if (!models.providers.some((p) => p.id === "mock" && p.available)) {
  console.error("Mock models are off. Set ENABLE_MOCK_MODELS=true in .env.");
  process.exit(1);
}
const created = await call("POST", "/conversations", {
  mode: "same",
  modelIds: ["mock-alpha", "mock-beta", "mock-flaky"],
  systemPrompt: "Be brief.",
}).then(json);
const cid = created.conversation.id;
const lane = Object.fromEntries(created.lanes.map((l) => [l.modelId, l]));
const name = Object.fromEntries(created.lanes.map((l) => [l.id, l.modelId]));
console.log(`conversation ${cid}\n`);

try {
  // Turn 1: all lanes stream; the flaky lane fails.
  let r = await stream(`/conversations/${cid}/turns`, { text: "My name is Ryan and my favourite colour is teal.", parentTurnId: null });
  const t1 = r.events[0].turn;
  const t1Flaky = finals(r).find((e) => e.laneId === lane["mock-flaky"].id);
  check("turn 1 streams every lane; one failing lane leaves the others untouched", finals(r).filter((e) => e.type === "done").length === 2 && t1Flaky?.type === "error", counts(r));
  check("every saved reply has input and output token counts", finals(r).filter((e) => e.type === "done").every((e) => e.inputTokens > 0 && e.outputTokens > 0));

  // Turn 2 while the flaky lane has a gap.
  r = await stream(`/conversations/${cid}/turns`, { text: "What's my favourite colour?", parentTurnId: t1.id });
  const t2 = r.events[0].turn;
  check("the user can keep going while a lane has failed", r.events[0].responses.length === 3 && finals(r).length === 3);

  // Retry the failed lane at turn 1.
  r = await stream(`/responses/${t1Flaky.responseId}/retry`, {});
  check("retry recovers the failed lane", finals(r)[0]?.type === "done", counts(r));
  check("the retried reply saw only turn 1", /1 from you and 0 of my own/.test(finals(r)[0]?.response.text ?? ""), seen(finals(r)[0]?.response.text));
  const completeRetry = await call("POST", `/responses/${finals(r)[0].responseId}/retry`);
  check("a complete reply can't be retried", completeRetry.status === 409);

  // Turn 3: every lane recalls turn 1 and sees only its own replies.
  r = await stream(`/conversations/${cid}/turns`, { text: "Remind me of my name.", parentTurnId: t2.id });
  const t3 = r.events[0].turn;
  const t3done = finals(r).filter((e) => e.type === "done");
  check(
    "at turn 3 each lane recalls turn 1, and no lane sees another lane's replies",
    t3done.length >= 2 && t3done.every((e) => /first message: "My name is Ryan/.test(e.response.text) && /are mine\./.test(e.response.text)),
  );

  // Branch: continue with mock-beta from turn 2.
  r = await stream(`/conversations/${cid}/turns`, { text: "Branch: just you and me.", parentTurnId: t2.id, focusLaneId: lane["mock-beta"].id });
  const b1 = r.events[0].turn;
  check("continue with this model: only that lane replies", r.events[0].responses.length === 1 && finals(r)[0]?.laneId === lane["mock-beta"].id);
  r = await stream(`/conversations/${cid}/turns`, { text: "Second branch message.", parentTurnId: b1.id });
  const b2 = r.events[0].turn;
  check("the next message in a branch keeps its focus", b2.focusLaneId === lane["mock-beta"].id && r.events[0].responses.length === 1);
  r = await stream(`/conversations/${cid}/turns`, { text: "Third branch message.", parentTurnId: b2.id });
  const branchText = finals(r)[0]?.response.text ?? "";
  check("branch continues for 3+ turns with its own history", /5 from you and 4 of my own/.test(branchText), seen(branchText));

  const rejoin = await call("POST", `/conversations/${cid}/turns`, { text: "x", parentTurnId: b2.id, focusLaneId: lane["mock-alpha"].id });
  check("other models can't rejoin a branch", rejoin.status === 409);
  const fromFailed = await call("POST", `/conversations/${cid}/turns`, { text: "x", parentTurnId: t2.id, focusLaneId: lane["mock-flaky"].id });
  check("you can't continue from a failed reply", fromFailed.status === 409);

  // A second branch from the same turn.
  r = await stream(`/conversations/${cid}/turns`, { text: "Alpha branch.", parentTurnId: t2.id, focusLaneId: lane["mock-alpha"].id });
  let detail = await fetch(`${API}/conversations/${cid}`).then(json);
  check("two branches from the same turn are both kept (3 alternatives after turn 2)", detail.turns.filter((t) => t.parentTurnId === t2.id).length === 3);

  // Switch back to the main thread and continue with every lane.
  const patched = await call("PATCH", `/conversations/${cid}`, { currentLeafTurnId: t3.id }).then(json);
  check("the branch on screen is remembered", patched.currentLeafTurnId === t3.id);
  r = await stream(`/conversations/${cid}/turns`, { text: "Back on the main thread.", parentTurnId: t3.id });
  const t4 = r.events[0].turn;
  const mainAlpha = finals(r).find((e) => e.laneId === lane["mock-alpha"].id)?.response.text ?? "";
  check("switching back continues the multi-model thread", r.events[0].responses.length === 3);
  check("the main thread never sees branch messages", !/branch/i.test(mainAlpha) && /4 from you and 3 of my own/.test(mainAlpha), seen(mainAlpha));

  // Stop mid-stream.
  let turnId;
  let deltas = 0;
  r = await stream(
    `/conversations/${cid}/turns`,
    { text: "Tell me everything #long", parentTurnId: t4.id },
    {
      onEvent: (e) => {
        if (e.type === "start") turnId = e.turn.id;
        if (e.type === "delta" && ++deltas === 30) void call("POST", `/turns/${turnId}/stop`);
      },
    },
  );
  const stops = finals(r).filter((e) => e.type === "stopped");
  check("stop cancels the streams and keeps partial replies, labelled stopped", stops.length >= 2 && stops.every((e) => e.response.text.length > 0), counts(r));

  // Stopped replies count as history; rate limits back off automatically.
  const t5 = r.events[0].turn;
  r = await stream(`/conversations/${cid}/turns`, { text: "After the stop. #ratelimit", parentTurnId: t5.id });
  const afterStop = finals(r).find((e) => e.laneId === lane["mock-alpha"].id)?.response.text ?? "";
  check("rate-limit errors retry automatically with backoff", r.events.some((e) => e.type === "retrying") && finals(r).every((e) => e.type === "done"), counts(r));
  check("a stopped reply counts as history", /6 from you and 5 of my own/.test(afterStop), seen(afterStop));

  // Closing the request stops the lanes.
  const ac = new AbortController();
  let n = 0;
  await stream(`/conversations/${cid}/turns`, { text: "Disconnect test #long", parentTurnId: r.events[0].turn.id }, {
    signal: ac.signal,
    onEvent: (e) => {
      if (e.type === "delta" && ++n === 20) ac.abort();
    },
  });
  await new Promise((res) => setTimeout(res, 1000));
  detail = await fetch(`${API}/conversations/${cid}`).then(json);
  const leafReplies = detail.responses.filter((x) => x.turnId === detail.conversation.currentLeafTurnId);
  check("closing the page mid-stream stops the lanes (saved as stopped)", leafReplies.length > 0 && leafReplies.every((x) => x.status !== "streaming"), leafReplies.map((x) => x.status).join(","));

  const total = detail.responses.reduce((a, x) => a + (x.inputTokens ?? 0) + (x.outputTokens ?? 0), 0);
  console.log(`\n${detail.turns.length} turns, ${detail.responses.length} replies, ${total} tokens (mock).`);
  console.log(`Lane payloads: server/logs/lane-payloads.jsonl (lane names: ${Object.values(name).join(", ")})`);
} finally {
  if (!keep) await call("DELETE", `/conversations/${cid}`);
}

console.log(failures ? `\n${failures} check(s) failed.` : "\nAll checks passed.");
process.exit(failures ? 1 : 0);
