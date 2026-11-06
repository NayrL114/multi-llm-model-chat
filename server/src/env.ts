// Loads the repo-root .env once. The app only reads it; nothing writes secrets to disk.
import path from "node:path";
import { fileURLToPath } from "node:url";
import dotenv from "dotenv";

const here = path.dirname(fileURLToPath(import.meta.url));
export const repoRoot = path.resolve(here, "../..");

dotenv.config({ path: path.join(repoRoot, ".env"), quiet: true });

function flag(name: string, fallback: boolean): boolean {
  const v = process.env[name]?.trim().toLowerCase();
  if (v === undefined || v === "") return fallback;
  return v === "1" || v === "true" || v === "yes";
}

function key(name: string): string | undefined {
  const v = process.env[name]?.trim();
  return v ? v : undefined;
}

export const env = {
  port: Number(process.env.PORT ?? 3001),
  databaseUrl: process.env.DATABASE_URL ?? "postgres://mmchat:mmchat@localhost:5434/mmchat",
  logPayloads: flag("LOG_PAYLOADS", true),
  enableMockModels: flag("ENABLE_MOCK_MODELS", true),
  keys: {
    anthropic: key("ANTHROPIC_API_KEY"),
    openai: key("OPENAI_API_KEY"),
    google: key("GOOGLE_API_KEY"),
  },
} as const;
