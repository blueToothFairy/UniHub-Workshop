import { strictEqual } from "node:assert";
import type { QueryResult, QueryResultRow } from "pg";
import type { IDatabase } from "../src/shared/interfaces/IDatabase.js";
import type { IWorkshopSearchGateway, WorkshopSearchDocument, WorkshopSearchHit, WorkshopSearchRequest } from "../src/modules/workshop/workshop.types.js";
import { WorkshopSearchIndexService } from "../src/modules/workshop/workshop-search-index.service.js";

class DatabaseStub implements IDatabase {
  public constructor(private readonly rows: unknown[]) {}

  public async query<T extends QueryResultRow>(_text: string, params?: unknown[]): Promise<QueryResult<T>> {
    const workshopId = params?.[0];
    const rows = typeof workshopId === "string" ? this.rows.filter((row) => (row as { id: string }).id === workshopId) : this.rows;
    return { rows: rows as T[] } as QueryResult<T>;
  }
}

class SearchGatewayRecorder implements IWorkshopSearchGateway {
  public readonly upserts: WorkshopSearchDocument[] = [];
  public readonly removals: string[] = [];
  public recreated: number = 0;
  public failNextUpsert: boolean = false;

  public isConfigured(): boolean {
    return true;
  }

  public async ensureIndex(): Promise<void> {}

  public async recreateIndex(): Promise<void> {
    this.recreated += 1;
  }

  public async searchWorkshops(_input: WorkshopSearchRequest): Promise<WorkshopSearchHit[]> {
    return [];
  }

  public async upsertWorkshopDocument(document: WorkshopSearchDocument): Promise<void> {
    if (this.failNextUpsert) {
      this.failNextUpsert = false;
      throw new Error("temporary failure");
    }
    this.upserts.push(document);
  }

  public async removeWorkshopDocument(workshopId: string): Promise<void> {
    this.removals.push(workshopId);
  }
}

async function main(): Promise<void> {
  const rows = [
    {
      id: "w1",
      title: "Career Readiness",
      description: "Mock interviews",
      speaker_name: "Alice",
      room: "A101",
      starts_at: new Date("2026-05-20T02:00:00.000Z"),
      status: "published",
      price_vnd: 0,
      payment_required: false,
      updated_at: new Date("2026-05-01T00:00:00.000Z")
    },
    {
      id: "w2",
      title: "Draft Session",
      description: "Invisible",
      speaker_name: "Bob",
      room: "B202",
      starts_at: new Date("2026-05-21T02:00:00.000Z"),
      status: "draft",
      price_vnd: 0,
      payment_required: false,
      updated_at: new Date("2026-05-01T00:00:00.000Z")
    }
  ];

  const gateway = new SearchGatewayRecorder();
  const service = new WorkshopSearchIndexService(new DatabaseStub(rows), gateway);

  await service.syncWorkshop("w1");
  await service.syncWorkshop("w2");
  strictEqual(gateway.upserts.length, 1);
  strictEqual(gateway.removals[0], "w2");

  await service.rebuildIndex();
  strictEqual(gateway.recreated, 1);
  strictEqual(gateway.upserts.some((document) => document.id === "w1"), true);

  const retryGateway = new SearchGatewayRecorder();
  retryGateway.failNextUpsert = true;
  const retryService = new WorkshopSearchIndexService(new DatabaseStub(rows), retryGateway);
  await retryService.syncWorkshop("w1").catch(() => undefined);
  await retryService.syncWorkshop("w1");
  strictEqual(retryGateway.upserts.length, 1);

  // eslint-disable-next-line no-console
  console.log("Workshop search index assertions passed.");
}

void main();
