import type { Lane, LaneResponse, ModelInfo, Turn } from "@mmc/shared";
import { BranchSwitcher } from "./BranchSwitcher";
import { ReplyCard } from "./ReplyCard";

interface Props {
  turn: Turn;
  index: number;
  lanes: Lane[];
  replies: Map<string, LaneResponse> | undefined;
  siblings: Turn[];
  laneLabel: (lane: Lane) => string;
  laneModel: (lane: Lane) => ModelInfo | undefined;
  branchLabel: (turn: Turn) => string;
  retryNotes: Record<string, string>;
  selectedLaneId: string | null;
  busy: boolean;
  onSelectTurn: (turnId: string) => void;
  onRetry: (responseId: string) => void;
  onContinue: (turnId: string, laneId: string) => void;
}

/** One user message and every active lane's reply to it, side by side. */
export function TurnRow(p: Props) {
  const focusLane = p.turn.focusLaneId ? p.lanes.find((l) => l.id === p.turn.focusLaneId) : undefined;
  const shown = focusLane ? [focusLane] : p.lanes;

  return (
    <section className="turn" aria-label={`Turn ${p.index + 1}`}>
      <BranchSwitcher siblings={p.siblings} currentId={p.turn.id} labelFor={p.branchLabel} onSelect={p.onSelectTurn} />
      <div className="user-msg">
        <div className="who">
          You
          {focusLane && <span className="badge">→ {p.laneLabel(focusLane)} only</span>}
        </div>
        {p.turn.userText}
      </div>
      <div className="lane-grid" style={{ gridTemplateColumns: `repeat(${p.lanes.length}, minmax(0, 1fr))` }}>
        {shown.map((lane) => {
          const response = p.replies?.get(lane.id);
          return (
            <ReplyCard
              key={lane.id}
              lane={lane}
              label={p.laneLabel(lane)}
              response={response}
              model={p.laneModel(lane)}
              full={!!focusLane}
              retryNote={response ? p.retryNotes[response.id] : undefined}
              canContinue={!focusLane}
              selected={p.selectedLaneId === lane.id}
              busy={p.busy}
              onRetry={p.onRetry}
              onContinue={(laneId) => p.onContinue(p.turn.id, laneId)}
            />
          );
        })}
      </div>
    </section>
  );
}
