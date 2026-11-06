import { memo } from "react";
import { estimateCostUsd, type Lane, type LaneResponse, type ModelInfo } from "@mmc/shared";
import { formatCost, formatLatency, formatTokens } from "../lib/format";
import { Markdown } from "./Markdown";

interface Props {
  lane: Lane;
  label: string;
  response: LaneResponse | undefined;
  model: ModelInfo | undefined;
  /** Spans every lane column (a reply inside a branch). */
  full: boolean;
  retryNote?: string;
  /** Shows the "Continue with this model" button. */
  canContinue: boolean;
  selected: boolean;
  busy: boolean;
  onRetry: (responseId: string) => void;
  onContinue: (laneId: string) => void;
}

const STATUS_TEXT = { streaming: "Streaming…", complete: "", stopped: "Stopped", error: "Error" } as const;

export const ReplyCard = memo(function ReplyCard(p: Props) {
  const r = p.response;
  const laneStyle = { "--lane-color": `var(--lane-${p.lane.position})` } as React.CSSProperties;

  if (!r) {
    return (
      <div className={`reply empty-slot${p.full ? " full" : ""}`} style={laneStyle}>
        {p.label}: no reply for this turn.
      </div>
    );
  }

  const cost = estimateCostUsd(p.model, r.inputTokens, r.outputTokens);
  const finished = r.status === "complete" || r.status === "stopped";
  const hasText = r.text.trim() !== "";

  return (
    <article
      className={`reply${p.full ? " full" : ""}${p.selected ? " selected" : ""}`}
      style={laneStyle}
      aria-label={`${p.label} reply`}
      aria-busy={r.status === "streaming"}
    >
      <div className="reply-head">
        <span className="lane-dot" aria-hidden />
        <span className="model">{p.label}</span>
        {STATUS_TEXT[r.status] && <span className={`status ${r.status}`}>{STATUS_TEXT[r.status]}</span>}
      </div>

      {p.retryNote && r.status === "streaming" && <div className="retry-note">{p.retryNote}</div>}

      {hasText ? (
        <div className="reply-body">
          <Markdown text={r.text} />
          {r.status === "streaming" && <span className="cursor" aria-hidden />}
        </div>
      ) : r.status === "streaming" ? (
        <div className="reply-body placeholder">
          Waiting for the first words… <span className="cursor" aria-hidden />
        </div>
      ) : r.status === "stopped" ? (
        <div className="reply-body placeholder">Stopped before any text arrived.</div>
      ) : null}

      {r.status === "error" && <div className="reply-error">{r.error ?? "Something went wrong."}</div>}

      {r.status !== "streaming" && (
        <div className="reply-foot">
          {r.inputTokens != null || r.outputTokens != null ? (
            <span title="Input / output tokens">
              {formatTokens(r.inputTokens)} in · {formatTokens(r.outputTokens)} out
            </span>
          ) : finished ? (
            <span title="The provider reports token counts only when a reply finishes">tokens n/a</span>
          ) : null}
          {r.latencyMs != null && <span>{formatLatency(r.latencyMs)}</span>}
          {cost != null && cost > 0 && <span title="Estimated from the price table">{formatCost(cost)}</span>}
          <span className="actions">
            {(r.status === "error" || r.status === "stopped") && (
              <button type="button" className="small ghost" disabled={p.busy} onClick={() => p.onRetry(r.id)}>
                Retry
              </button>
            )}
            {p.canContinue && finished && hasText && (
              <button
                type="button"
                className="small ghost"
                disabled={p.busy}
                aria-pressed={p.selected}
                onClick={() => p.onContinue(p.lane.id)}
                title="Branch from this reply and continue with this model alone"
              >
                {p.selected ? "Selected" : "Continue with this model"}
              </button>
            )}
          </span>
        </div>
      )}
    </article>
  );
});
