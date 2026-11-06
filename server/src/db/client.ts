import path from "node:path";
import { fileURLToPath } from "node:url";
import { drizzle } from "drizzle-orm/node-postgres";
import { migrate } from "drizzle-orm/node-postgres/migrator";
import pg from "pg";
import { env } from "../env";
import * as schema from "./schema";

export const pool = new pg.Pool({ connectionString: env.databaseUrl, max: 10 });
export const db = drizzle({ client: pool, schema });
export type Db = typeof db;

const migrationsFolder = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../drizzle");

/** Applies any pending migrations from server/drizzle. Safe to run on every start. */
export async function runMigrations(): Promise<void> {
  await migrate(db, { migrationsFolder });
}
