// The server-enforced rules for where a new turn goes and which lanes answer it.
//
// - Next message: parent is the turn on screen; the new turn keeps the parent's focus.
// - Continue with this model: parent is the turn holding the chosen reply; focus is that
//   reply's lane. Later turns in the branch keep the focus, so other lanes can't rejoin.
// - Turns that share a parent are alternatives (branches).
import { HttpError } from "../lib/http";

interface RuleTurn {
  id: string;
  parentTurnId: string | null;
  focusLaneId: string | null;
}
interface RuleLane {
  id: string;
}
interface RuleResponse {
  turnId: string;
  laneId: string;
  status: string;
  text: string;
}

export interface NewTurnPlacement {
  parentTurnId: string | null;
  focusLaneId: string | null;
}

export function placeNewTurn(input: {
  turns: readonly RuleTurn[];
  lanes: readonly RuleLane[];
  responses: readonly RuleResponse[];
  parentTurnId: string | null;
  focusLaneId: string | null | undefined;
}): NewTurnPlacement {
  const { turns, lanes, responses, parentTurnId } = input;
  const requestedFocus = input.focusLaneId ?? null;

  if (turns.length === 0) {
    if (parentTurnId !== null) throw new HttpError(400, "The first message can't have a parent turn.");
    if (requestedFocus !== null) throw new HttpError(400, "The first message goes to every lane.");
    return { parentTurnId: null, focusLaneId: null };
  }

  if (parentTurnId === null) throw new HttpError(400, "parentTurnId is required after the first message.");
  const parent = turns.find((t) => t.id === parentTurnId);
  if (!parent) throw new HttpError(404, "Parent turn not found in this conversation.");

  const parentReplies = responses.filter((r) => r.turnId === parent.id);
  if (parentReplies.some((r) => r.status === "streaming")) {
    throw new HttpError(409, "Replies to that turn are still streaming. Wait for them or press Stop.");
  }

  if (parent.focusLaneId) {
    if (requestedFocus !== null && requestedFocus !== parent.focusLaneId) {
      throw new HttpError(409, "This branch continues with one model; other models can't rejoin it.");
    }
    return { parentTurnId: parent.id, focusLaneId: parent.focusLaneId };
  }

  if (requestedFocus === null) return { parentTurnId: parent.id, focusLaneId: null };

  if (!lanes.some((l) => l.id === requestedFocus)) throw new HttpError(404, "Lane not found in this conversation.");
  const chosen = parentReplies.find((r) => r.laneId === requestedFocus);
  if (!chosen || (chosen.status !== "complete" && chosen.status !== "stopped") || chosen.text.trim() === "") {
    throw new HttpError(409, "You can only continue from a finished reply.");
  }
  return { parentTurnId: parent.id, focusLaneId: requestedFocus };
}
