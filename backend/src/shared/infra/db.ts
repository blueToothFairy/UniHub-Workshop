import { Pool, type QueryResult, type QueryResultRow } from "pg";

const connectionString: string = process.env.SUPABASE_POOLER_URL ?? "";

if (!connectionString) {
  throw new Error("SUPABASE_POOLER_URL is required. Please configure Supabase pooler connection string.");
}

export const dbPool: Pool = new Pool({
  connectionString,
  max: 10,
  idleTimeoutMillis: 30_000,
  connectionTimeoutMillis: 10_000
});

export async function query<T extends QueryResultRow>(text: string, params: unknown[] = []): Promise<QueryResult<T>> {
  return dbPool.query<T>(text, params);
}

