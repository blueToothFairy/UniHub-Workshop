import type { QueryResult, QueryResultRow } from "pg";
import { dbPool } from "./db.js";
import type { IDatabase } from "../interfaces/IDatabase.js";

export class PgDatabase implements IDatabase {
  public async query<T extends QueryResultRow>(text: string, params: unknown[] = []): Promise<QueryResult<T>> {
    return dbPool.query<T>(text, params);
  }
}
