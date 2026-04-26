import { Pool, type PoolClient, type QueryResult, type QueryResultRow } from "pg";
import { env } from "../config/env";

const connectionString = env.supabaseDbUrl || env.databaseUrl;

if (!connectionString) {
  throw new Error("Missing database connection string. Set SUPABASE_DB_URL or DATABASE_URL.");
}

const ssl =
  env.nodeEnv === "production"
    ? {
        rejectUnauthorized: false
      }
    : undefined;

export const pool = new Pool({
  connectionString,
  ssl
});

export async function query<T extends QueryResultRow>(
  text: string,
  params: unknown[] = []
): Promise<QueryResult<T>> {
  return pool.query<T>(text, params);
}

export async function getClient(): Promise<PoolClient> {
  return pool.connect();
}
