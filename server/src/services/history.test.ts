import type { ModelMessage } from "ai";
import { describe, expect, it } from "vitest";
import { buildHistory, type HistoryReply, type HistoryTurn, mergeBackToBackUserMessages } from "./history";
import { placeNewTurn } from "./turnRules";

const A = "lane-a";
const B = "lane-b";

function turn(id: string, parentTurnId: string | null, userText: string, n: number): HistoryTurn {
  return { id, parentTurnId, userText, createdAt: new Date(Date.UTC(2026, 0, 1, 0, 0, n)).toISOString() };
}
const assistant = (text: string): ModelMessage[] => [{ role: "assistant", content: [{ type: "text", text }] }];
const reply = (status: HistoryReply["status"], text: string): HistoryReply => ({
  status,
  text,
  messageJson: status === "complete" || status === "stopped" ? assistant(text) : null,
});

function setup(turns: HistoryTurn[], replies: Record<string, HistoryReply>) {
  const byId = new Map(turns.map((t) => [t.id, t]));
  return (laneId: string, leaf: string) => buildHistory(laneId, leaf, byId, (t, l) => replies[`${t}:${l}`]);
}

describe("buildHistory", () => {
  const turns = [turn("t1", null, "hi", 1), turn("t2", "t1", "and?", 2), turn("t3", "t2", "third", 3)];

  it("gives each lane only the user's messages and its own replies", () => {
    const build = setup(turns, {
      "t1:lane-a": reply("complete", "A1"),
      "t1:lane-b": reply("complete", "B1"),
      "t2:lane-a": reply("complete", "A2"),
      "t2:lane-b": reply("complete", "B2"),
    });
    const a = build(A, "t3");
    expect(a).toEqual([
      { role: "user", content: "hi" },
      ...assistant("A1"),
      { role: "user", content: "and?" },
      ...assistant("A2"),
      { role: "user", content: "third" },
    ]);
    expect(JSON.stringify(a)).not.toMatch(/B1|B2/);
    expect(JSON.stringify(build(B, "t3"))).not.toMatch(/A1|A2/);
  });

  it("leaves a gap for failed replies and merges back-to-back user messages", () => {
    const build = setup(turns, {
      "t1:lane-a": reply("complete", "A1"),
      "t2:lane-a": reply("error", ""),
    });
    expect(build(A, "t3")).toEqual([
      { role: "user", content: "hi" },
      ...assistant("A1"),
      { role: "user", content: "and?\n\nthird" },
    ]);
  });

  it("counts stopped replies but skips empty and streaming ones", () => {
    const build = setup(turns, {
      "t1:lane-a": reply("stopped", "partial"),
      "t2:lane-a": reply("stopped", "   "),
    });
    expect(build(A, "t3")).toEqual([
      { role: "user", content: "hi" },
      ...assistant("partial"),
      { role: "user", content: "and?\n\nthird" },
    ]);
  });

  it("never includes the leaf turn's own reply (e.g. when retrying)", () => {
    const build = setup(turns, { "t3:lane-a": reply("complete", "old A3") });
    expect(JSON.stringify(build(A, "t3"))).not.toMatch(/old A3/);
  });

  it("follows only the path to the leaf, not sibling branches", () => {
    const branched = [...turns, turn("b1", "t2", "branch", 4)];
    const build = setup(branched, {
      "t1:lane-a": reply("complete", "A1"),
      "t2:lane-a": reply("complete", "A2"),
      "t3:lane-a": reply("complete", "A3 main"),
    });
    const hist = build(A, "b1");
    expect(hist.map((m) => m.role)).toEqual(["user", "assistant", "user", "assistant", "user"]);
    expect(JSON.stringify(hist)).not.toMatch(/third|A3 main/);
  });

  it("keeps the full message_json (e.g. provider metadata), not just text", () => {
    const withMeta: ModelMessage[] = [
      {
        role: "assistant",
        content: [
          { type: "reasoning", text: "thinking", providerOptions: { anthropic: { signature: "sig" } } },
          { type: "text", text: "answer" },
        ],
      },
    ];
    const build = setup(turns.slice(0, 2), { "t1:lane-a": { status: "complete", text: "answer", messageJson: withMeta } });
    expect(build(A, "t2")[1]).toEqual(withMeta[0]);
  });
});

describe("mergeBackToBackUserMessages", () => {
  it("merges array content too", () => {
    expect(
      mergeBackToBackUserMessages([
        { role: "user", content: "a" },
        { role: "user", content: [{ type: "text", text: "b" }] },
      ]),
    ).toEqual([{ role: "user", content: [{ type: "text", text: "a" }, { type: "text", text: "b" }] }]);
  });
});

describe("placeNewTurn", () => {
  const lanes = [{ id: A }, { id: B }];
  const turns = [
    { id: "t1", parentTurnId: null, focusLaneId: null },
    { id: "b1", parentTurnId: "t1", focusLaneId: A },
  ];
  const responses = [
    { turnId: "t1", laneId: A, status: "complete", text: "A1" },
    { turnId: "t1", laneId: B, status: "error", text: "" },
    { turnId: "b1", laneId: A, status: "complete", text: "A2" },
  ];
  const place = (parentTurnId: string | null, focusLaneId?: string | null, t = turns, r = responses) =>
    placeNewTurn({ turns: t, lanes, responses: r, parentTurnId, focusLaneId });

  it("first turn goes to every lane", () => {
    expect(place(null, undefined, [], [])).toEqual({ parentTurnId: null, focusLaneId: null });
    expect(() => place(null, A, [], [])).toThrow(/every lane/);
  });
  it("next message keeps the parent's focus", () => {
    expect(place("t1")).toEqual({ parentTurnId: "t1", focusLaneId: null });
    expect(place("b1")).toEqual({ parentTurnId: "b1", focusLaneId: A });
  });
  it("continue with this model sets the focus", () => {
    expect(place("t1", A)).toEqual({ parentTurnId: "t1", focusLaneId: A });
  });
  it("can't continue from a failed reply", () => {
    expect(() => place("t1", B)).toThrow(/finished reply/);
  });
  it("other lanes can't rejoin a branch", () => {
    expect(() => place("b1", B)).toThrow(/can't rejoin/);
  });
  it("requires a parent after the first turn, and waits for streaming replies", () => {
    expect(() => place(null)).toThrow(/parentTurnId/);
    expect(() => place("t1", null, turns, [...responses, { turnId: "t1", laneId: B, status: "streaming", text: "" }])).toThrow(
      /still streaming/,
    );
  });
});
