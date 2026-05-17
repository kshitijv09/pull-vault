/**
 * Structured logging for the B5 platform health dashboard.
 * Surfaces PostgreSQL error codes/columns so schema drift is obvious in dev.
 */

export interface PlatformHealthLogContext {
  operation: string;
  panel?: string;
  step?: string;
  range?: string | null;
  fromIso?: string | null;
  toIso?: string | null;
  [key: string]: unknown;
}

interface PgErrorFields {
  code?: string;
  message?: string;
  detail?: string;
  hint?: string;
  column?: string;
  table?: string;
  schema?: string;
  position?: string;
  routine?: string;
  severity?: string;
}

function extractPgError(error: unknown): PgErrorFields | null {
  if (!error || typeof error !== "object") return null;
  const e = error as Record<string, unknown>;
  if (typeof e.code !== "string" || !e.code.startsWith("4")) return null;
  return {
    code: e.code,
    message: typeof e.message === "string" ? e.message : undefined,
    detail: typeof e.detail === "string" ? e.detail : undefined,
    hint: typeof e.hint === "string" ? e.hint : undefined,
    column: typeof e.column === "string" ? e.column : undefined,
    table: typeof e.table === "string" ? e.table : undefined,
    schema: typeof e.schema === "string" ? e.schema : undefined,
    position: e.position !== undefined ? String(e.position) : undefined,
    routine: typeof e.routine === "string" ? e.routine : undefined,
    severity: typeof e.severity === "string" ? e.severity : undefined
  };
}

export function logPlatformHealthError(
  context: PlatformHealthLogContext,
  error: unknown
): void {
  const pg = extractPgError(error);
  const payload: Record<string, unknown> = { ...context };

  if (pg) {
    payload.pg = pg;
    if (pg.code === "42703") {
      payload.hint =
        "Missing column — run `npm run db:migrate` or align the query with the live schema.";
    }
  }

  if (error instanceof Error && error.stack) {
    payload.stack = error.stack;
  }

  console.error("[platformHealth]", payload);
}
