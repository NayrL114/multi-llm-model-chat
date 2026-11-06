import { env } from "./env";
import { count, eq, sql } from "drizzle-orm";
import express from "express";
import { db, pool, runMigrations } from "./db/client";
import { conversations, responses } from "./db/schema";
import { errorHandler } from "./lib/http";
import { conversationsRouter } from "./routes/conversations";
import { modelsRouter } from "./routes/models";
import { turnsRouter } from "./routes/turns";
import { stopAll } from "./services/activeStreams";

const app = express();
app.disable("x-powered-by");
app.use(express.json({ limit: "1mb" }));

/** GET /api/health: proves the server is up and can read the database. */
app.get("/api/health", async (_req, res) => {
  const [{ now }] = (await db.execute<{ now: string }>(sql`select now()::text as now`)).rows as [{ now: string }];
  const [{ n }] = (await db.select({ n: count() }).from(conversations)) as [{ n: number }];
  res.json({ ok: true, db: { now, conversations: n } });
});

app.use("/api", modelsRouter, conversationsRouter, turnsRouter);
app.use("/api", (_req, res) => {
  res.status(404).json({ error: "Not found" });
});
app.use(errorHandler);

async function main() {
  await runMigrations();
  // Replies that were streaming when the server last stopped can never finish.
  const stale = await db
    .update(responses)
    .set({ status: "error", error: "Interrupted: the server restarted while this reply was streaming.", updatedAt: new Date() })
    .where(eq(responses.status, "streaming"))
    .returning({ id: responses.id });
  if (stale.length) console.log(`Marked ${stale.length} interrupted repl${stale.length === 1 ? "y" : "ies"} as errors.`);

  const server = app.listen(env.port, () => {
    const keys = Object.entries(env.keys)
      .map(([p, k]) => `${p}:${k ? "yes" : "no"}`)
      .join(" ");
    console.log(`API on http://localhost:${env.port}  (keys ${keys}; mock models ${env.enableMockModels ? "on" : "off"})`);
  });

  let shuttingDown = false;
  const shutdown = async () => {
    if (shuttingDown) return;
    shuttingDown = true;
    await stopAll(3000); // saves in-flight replies as "stopped"
    server.close();
    server.closeAllConnections();
    await pool.end().catch(() => {});
    process.exit(0);
  };
  process.on("SIGINT", shutdown);
  process.on("SIGTERM", shutdown);
}

main().catch((e) => {
  console.error("Failed to start:", e instanceof Error ? e.message : e);
  if (String(e).includes("ECONNREFUSED")) {
    console.error(`Is Postgres running? Try \`npm run db:up\`. DATABASE_URL=${env.databaseUrl.replace(/:[^:@/]+@/, ":***@")}`);
  }
  process.exit(1);
});
