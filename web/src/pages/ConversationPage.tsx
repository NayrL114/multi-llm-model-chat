import { useCallback, useEffect, useMemo, useReducer, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import {
  childrenByParent,
  type Conversation,
  type ConversationDetail,
  deepestLeaf,
  estimateCostUsd,
  type Lane,
  type LaneResponse,
  pathToTurn,
  type StreamEvent,
  type Turn,
} from "@mmc/shared";
import { Composer } from "../components/Composer";
import { TurnRow } from "../components/TurnRow";
import { api } from "../lib/api";
import { useAppData } from "../lib/appContext";
import { formatCost, formatTokens } from "../lib/format";
import { postEventStream } from "../lib/sse";

// ---------- state ----------

type Action =
  | { type: "load"; detail: ConversationDetail }
  | { type: "start"; turn?: Turn; responses: LaneResponse[]; conversation?: Conversation }
  | { type: "append"; chunks: Map<string, string> }
  | { type: "replace"; response: LaneResponse }
  | { type: "leaf"; leafId: string };

function upsert(list: LaneResponse[], items: LaneResponse[]): LaneResponse[] {
  const byId = new Map(items.map((r) => [r.id, r]));
  const out = list.map((r) => byId.get(r.id) ?? r);
  for (const r of items) if (!list.some((x) => x.id === r.id)) out.push(r);
  return out;
}

function reducer(state: ConversationDetail | null, action: Action): ConversationDetail | null {
  if (action.type === "load") return action.detail;
  if (!state) return state;
  switch (action.type) {
    case "start":
      return {
        ...state,
        turns: action.turn ? [...state.turns, action.turn] : state.turns,
        responses: upsert(state.responses, action.responses),
        conversation:
          action.conversation ??
          (action.turn ? { ...state.conversation, currentLeafTurnId: action.turn.id } : state.conversation),
      };
    case "append":
      return {
        ...state,
        responses: state.responses.map((r) => {
          const add = action.chunks.get(r.id);
          return add ? { ...r, text: r.text + add } : r;
        }),
      };
    case "replace":
      return { ...state, responses: upsert(state.responses, [action.response]) };
    case "leaf":
      return { ...state, conversation: { ...state.conversation, currentLeafTurnId: action.leafId } };
  }
}

// ---------- page ----------

export function ConversationPage({ id }: { id: string }) {
  const navigate = useNavigate();
  const { findModel, modelLabel, refreshConversations } = useAppData();
  const [detail, dispatch] = useReducer(reducer, null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [draft, setDraft] = useState("");
  const [composerError, setComposerError] = useState<string | null>(null);
  const [retryNotes, setRetryNotes] = useState<Record<string, string>>({});
  // "Continue with this model": the reply the next message branches from.
  const [pendingBranch, setPendingBranch] = useState<{ turnId: string; laneId: string } | null>(null);

  const streamTurnId = useRef<string | null>(null);
  const pending = useRef(new Map<string, string>());
  const frame = useRef<number | null>(null);
  const threadRef = useRef<HTMLDivElement>(null);
  const nearBottom = useRef(true);

  const reload = useCallback(async () => {
    try {
      const d = await api.conversation(id);
      dispatch({ type: "load", detail: d });
      setLoadError(null);
    } catch (e) {
      setLoadError((e as Error).message);
    }
  }, [id]);

  useEffect(() => {
    void reload();
  }, [reload]);

  // ----- derived -----
  const lanes = detail?.lanes ?? [];
  const turnsById = useMemo(() => new Map((detail?.turns ?? []).map((t) => [t.id, t])), [detail?.turns]);
  const children = useMemo(() => childrenByParent(detail?.turns ?? []), [detail?.turns]);
  const leafId = useMemo(() => {
    const saved = detail?.conversation.currentLeafTurnId;
    if (saved && turnsById.has(saved)) return saved;
    const firstRoot = children.get("")?.[0];
    return firstRoot ? deepestLeaf(children, firstRoot.id) : null;
  }, [detail?.conversation.currentLeafTurnId, turnsById, children]);
  const path = useMemo(() => pathToTurn(turnsById, leafId), [turnsById, leafId]);
  const repliesByTurn = useMemo(() => {
    const map = new Map<string, Map<string, LaneResponse>>();
    for (const r of detail?.responses ?? []) {
      let m = map.get(r.turnId);
      if (!m) map.set(r.turnId, (m = new Map()));
      m.set(r.laneId, r);
    }
    return map;
  }, [detail?.responses]);

  const laneLabel = useCallback((lane: Lane) => modelLabel(lane.provider, lane.modelId), [modelLabel]);
  const laneModel = useCallback((lane: Lane) => findModel(lane.provider, lane.modelId), [findModel]);
  const branchLabel = useCallback(
    (turn: Turn) => {
      const lane = lanes.find((l) => l.id === turn.focusLaneId);
      return lane ? `${laneLabel(lane)} only` : "All models";
    },
    [lanes, laneLabel],
  );

  // Totals across every branch, and per lane.
  const totals = useMemo(() => {
    const perLane = new Map<string, { input: number; output: number; cost: number }>();
    let input = 0;
    let output = 0;
    let cost = 0;
    let costKnown = true;
    for (const r of detail?.responses ?? []) {
      const lane = lanes.find((l) => l.id === r.laneId);
      const c = lane ? estimateCostUsd(laneModel(lane), r.inputTokens, r.outputTokens) : null;
      if (c == null && (r.inputTokens != null || r.outputTokens != null)) costKnown = false;
      input += r.inputTokens ?? 0;
      output += r.outputTokens ?? 0;
      cost += c ?? 0;
      const pl = perLane.get(r.laneId) ?? { input: 0, output: 0, cost: 0 };
      pl.input += r.inputTokens ?? 0;
      pl.output += r.outputTokens ?? 0;
      pl.cost += c ?? 0;
      perLane.set(r.laneId, pl);
    }
    return { input, output, cost: costKnown ? cost : null, perLane };
  }, [detail?.responses, lanes, laneModel]);

  // A stream started elsewhere (e.g. before navigating away and back) is still running:
  // poll until it finishes.
  const orphanStreaming = !busy && !!detail?.responses.some((r) => r.status === "streaming");
  useEffect(() => {
    if (!orphanStreaming) return;
    const t = setInterval(() => void reload(), 1500);
    return () => clearInterval(t);
  }, [orphanStreaming, reload]);

  // Keep the newest text in view while streaming, unless the user scrolled up.
  useEffect(() => {
    const el = threadRef.current;
    if (el && nearBottom.current) el.scrollTop = el.scrollHeight;
  }, [detail]);

  // ----- streaming -----
  const flush = useCallback(() => {
    frame.current = null;
    if (pending.current.size === 0) return;
    const chunks = pending.current;
    pending.current = new Map();
    dispatch({ type: "append", chunks });
  }, []);

  const handleEvent = useCallback(
    (e: StreamEvent) => {
      switch (e.type) {
        case "start":
          streamTurnId.current = e.turn?.id ?? e.responses[0]?.turnId ?? null;
          if (e.turn) {
            setDraft("");
            setPendingBranch(null);
            nearBottom.current = true;
          }
          dispatch({ type: "start", turn: e.turn, responses: e.responses, conversation: e.conversation });
          break;
        case "delta":
          pending.current.set(e.responseId, (pending.current.get(e.responseId) ?? "") + e.text);
          // Batch deltas into one render per frame.
          frame.current ??= requestAnimationFrame(flush);
          break;
        case "retrying":
          setRetryNotes((n) => ({
            ...n,
            [e.responseId]: `${e.message} — retrying in ${(e.delayMs / 1000).toFixed(1)}s (attempt ${e.attempt + 1})`,
          }));
          break;
        case "done":
        case "stopped":
        case "error":
          flush();
          dispatch({ type: "replace", response: e.response });
          setRetryNotes((n) => {
            if (!(e.responseId in n)) return n;
            const { [e.responseId]: _, ...rest } = n;
            return rest;
          });
          break;
        case "end":
          break;
      }
    },
    [flush],
  );

  const runStream = useCallback(
    async (path: string, body: unknown) => {
      setBusy(true);
      setComposerError(null);
      try {
        const ended = await postEventStream(path, body, handleEvent);
        if (!ended) await reload(); // connection dropped: resync from the database
      } catch (e) {
        setComposerError((e as Error).message);
      } finally {
        if (frame.current != null) cancelAnimationFrame(frame.current);
        flush();
        streamTurnId.current = null;
        setBusy(false);
        refreshConversations();
      }
    },
    [handleEvent, flush, reload, refreshConversations],
  );

  const send = useCallback(() => {
    const text = draft.trim();
    if (!text || busy) return;
    const body = pendingBranch
      ? { text, parentTurnId: pendingBranch.turnId, focusLaneId: pendingBranch.laneId }
      : { text, parentTurnId: leafId };
    void runStream(`/conversations/${id}/turns`, body);
  }, [draft, busy, pendingBranch, leafId, id, runStream]);

  const stop = useCallback(() => {
    const turnId = streamTurnId.current;
    if (turnId) api.stopTurn(turnId).catch((e: Error) => setComposerError(e.message));
  }, []);

  const retry = useCallback(
    (responseId: string) => {
      if (!busy) void runStream(`/responses/${responseId}/retry`, {});
    },
    [busy, runStream],
  );

  const selectTurn = useCallback(
    (turnId: string) => {
      const leaf = deepestLeaf(children, turnId);
      dispatch({ type: "leaf", leafId: leaf });
      setPendingBranch(null);
      api.updateConversation(id, { currentLeafTurnId: leaf }).catch((e: Error) => setComposerError(e.message));
    },
    [children, id],
  );

  const onContinue = useCallback((turnId: string, laneId: string) => {
    setPendingBranch((cur) => (cur?.turnId === turnId && cur.laneId === laneId ? null : { turnId, laneId }));
  }, []);

  async function onDelete() {
    if (!detail || !confirm(`Delete "${detail.conversation.title}" and all its branches?`)) return;
    try {
      await api.deleteConversation(id);
      refreshConversations();
      navigate("/");
    } catch (e) {
      setComposerError((e as Error).message);
    }
  }

  function onExport() {
    if (!detail) return;
    const blob = new Blob([JSON.stringify(detail, null, 2)], { type: "application/json" });
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = `${detail.conversation.title.replace(/[^\w-]+/g, "_").slice(0, 40) || "conversation"}.json`;
    a.click();
    setTimeout(() => URL.revokeObjectURL(a.href), 1000);
  }

  // ----- render -----
  if (loadError && !detail) {
    return (
      <div className="empty-thread">
        <p className="error-text">{loadError}</p>
        <button type="button" onClick={() => void reload()}>
          Try again
        </button>
      </div>
    );
  }
  if (!detail) return <div className="empty-thread">Loading…</div>;

  const leafTurn = leafId ? turnsById.get(leafId) : undefined;
  const leafFocusLane = leafTurn?.focusLaneId ? lanes.find((l) => l.id === leafTurn.focusLaneId) : undefined;
  const branchLane = pendingBranch ? lanes.find((l) => l.id === pendingBranch.laneId) : undefined;
  const laneColor = (lane: Lane | undefined) => (lane ? `var(--lane-${lane.position})` : undefined);

  let banner: React.ReactNode = null;
  if (branchLane) {
    banner = (
      <>
        Continuing with <strong>{laneLabel(branchLane)}</strong> alone from the selected reply. The multi-model thread
        stays available from the branch switcher.
      </>
    );
  } else if (leafFocusLane) {
    banner = (
      <>
        Branch: <strong>{laneLabel(leafFocusLane)}</strong> only. Use the switcher above to go back to the full
        multi-model thread.
      </>
    );
  }

  return (
    <>
      <header className="conv-header">
        <h2 title={detail.conversation.title}>{detail.conversation.title}</h2>
        <span className="badge">{detail.conversation.mode === "cross" ? "Cross-provider" : "Same-provider"}</span>
        <span className="header-spacer" />
        <span className="totals" title="All branches, all lanes">
          {formatTokens(totals.input)} in · {formatTokens(totals.output)} out
          {totals.cost != null && totals.cost > 0 && <> · est. {formatCost(totals.cost)}</>}
        </span>
        <span className="header-actions">
          <button type="button" className="small ghost" onClick={onExport}>
            Export JSON
          </button>
          <button type="button" className="small danger" onClick={() => void onDelete()} disabled={busy}>
            Delete
          </button>
        </span>
      </header>

      {detail.conversation.systemPrompt && (
        <details className="system-prompt">
          <summary>System prompt (shared by every lane)</summary>
          <p>{detail.conversation.systemPrompt}</p>
        </details>
      )}

      <div
        className="thread"
        ref={threadRef}
        onScroll={(e) => {
          const el = e.currentTarget;
          nearBottom.current = el.scrollHeight - el.scrollTop - el.clientHeight < 120;
        }}
      >
        <div className="lane-grid lane-heads" style={{ gridTemplateColumns: `repeat(${lanes.length}, minmax(0, 1fr))` }}>
          {lanes.map((lane) => {
            const t = totals.perLane.get(lane.id);
            return (
              <div key={lane.id} className="lane-head" style={{ "--lane-color": laneColor(lane) } as React.CSSProperties}>
                <span className="lane-dot" aria-hidden />
                <strong title={lane.modelId}>{laneLabel(lane)}</strong>
                <span className="lane-stats">
                  {formatTokens((t?.input ?? 0) + (t?.output ?? 0))} tok
                  {t && t.cost > 0 ? ` · ${formatCost(t.cost)}` : ""}
                </span>
              </div>
            );
          })}
        </div>

        {path.length === 0 && (
          <div className="empty-thread">
            Send a message to start. Each model keeps its own thread and never sees the others' replies.
          </div>
        )}

        {path.map((turn, i) => (
          <TurnRow
            key={turn.id}
            turn={turn}
            index={i}
            lanes={lanes}
            replies={repliesByTurn.get(turn.id)}
            siblings={children.get(turn.parentTurnId ?? "") ?? [turn]}
            laneLabel={laneLabel}
            laneModel={laneModel}
            branchLabel={branchLabel}
            retryNotes={retryNotes}
            selectedLaneId={pendingBranch?.turnId === turn.id ? pendingBranch.laneId : null}
            busy={busy}
            onSelectTurn={selectTurn}
            onRetry={retry}
            onContinue={onContinue}
          />
        ))}
      </div>

      <Composer
        value={draft}
        onChange={setDraft}
        onSend={send}
        onStop={stop}
        busy={busy}
        banner={banner}
        bannerLaneColor={laneColor(branchLane ?? leafFocusLane)}
        onCancelBanner={pendingBranch ? () => setPendingBranch(null) : undefined}
        error={composerError}
        placeholder={
          branchLane
            ? `Message ${laneLabel(branchLane)}…`
            : leafFocusLane
              ? `Message ${laneLabel(leafFocusLane)}…`
              : `Message all ${lanes.length} models…`
        }
      />
    </>
  );
}
