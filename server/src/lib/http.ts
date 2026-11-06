import type { ErrorRequestHandler } from "express";
import type { z } from "zod";

export class HttpError extends Error {
  constructor(
    readonly status: number,
    message: string,
    readonly details?: unknown,
  ) {
    super(message);
  }
}

/** Validates a request body with a Zod schema, or throws a 400 with the issues. */
export function parseBody<S extends z.ZodType>(schema: S, body: unknown): z.infer<S> {
  const result = schema.safeParse(body ?? {});
  if (!result.success) {
    const first = result.error.issues[0];
    const where = first?.path.length ? `${first.path.join(".")}: ` : "";
    throw new HttpError(400, `${where}${first?.message ?? "Invalid request"}`, result.error.issues);
  }
  return result.data;
}

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** Route ids must be UUIDs; anything else is a 404 rather than a database error. */
export function idParam(value: string | string[] | undefined, what = "Resource"): string {
  if (typeof value !== "string" || !UUID_RE.test(value)) throw new HttpError(404, `${what} not found`);
  return value;
}

export const errorHandler: ErrorRequestHandler = (err, _req, res, _next) => {
  if (res.headersSent) {
    res.end();
    return;
  }
  if (err instanceof HttpError) {
    res.status(err.status).json({ error: err.message, details: err.details });
    return;
  }
  if (err?.type === "entity.parse.failed") {
    res.status(400).json({ error: "Request body is not valid JSON" });
    return;
  }
  console.error(err);
  res.status(500).json({ error: "Internal server error" });
};
