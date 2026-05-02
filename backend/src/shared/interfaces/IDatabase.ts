import type { QueryResult, QueryResultRow } from "pg";

export interface IDatabase {
  query<T extends QueryResultRow>(text: string, params?: unknown[]): Promise<QueryResult<T>>;
}
