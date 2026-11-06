// Development logging of the exact messages sent to each lane (LOG_PAYLOADS=true), so lane
// separation can be checked directly. A one-line summary goes to the console and the full
// payload to server/logs/lane-payloads.jsonl. Keys are never part of the payload.
import fs from "node:fs";
import path from "node:path";
import type { ModelMessage } from "ai";
import { env, repoRoot } from "../env";

const logDir = path.join(repoRoot, "server", "logs");
const logFile = path.join(logDir, "lane-payloads.jsonl");

export interface LanePayload {
  conversationId: string;
  turnId: string;
  responseId: string;
  laneId: string;
  position: number;
  provider: string;
  modelId: string;
  attempt: number;
  system: string | null;
  messages: ModelMessage[];
}

export function logLanePayload(p: LanePayload): void {
  if (!env.logPayloads) return;
  const roles = p.messages.map((m) => (m.role === "assistant" ? "A" : m.role === "user" ? "U" : m.role)).join(" ");
  console.log(
    `[lane ${p.position} ${p.provider}/${p.modelId}] turn ${p.turnId.slice(0, 8)} attempt ${p.attempt}: ` +
      `${p.messages.length} messages (${roles})${p.system ? " + system" : ""}`,
  );
  try {
    fs.mkdirSync(logDir, { recursive: true });
    fs.appendFileSync(logFile, `${JSON.stringify({ at: new Date().toISOString(), ...p })}\n`);
  } catch (e) {
    console.warn("Could not write payload log:", e);
  }
}
