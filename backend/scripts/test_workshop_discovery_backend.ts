import { deepStrictEqual } from "node:assert";
import { AppError } from "../src/shared/errors/AppError.js";
import { WorkshopService } from "../src/modules/workshop/workshop.service.js";
import type { IWorkshopSearchGateway, WorkshopSearchDocument, WorkshopSearchHit, WorkshopSearchRequest } from "../src/modules/workshop/workshop.types.js";
import type { Workshop } from "../src/modules/admin/admin.types.js";

const workshops: Workshop[] = [
  {
    id: "w1",
    title: "Career Readiness",
    description: "Mock interviews and CV tips",
    speakerName: "Alice",
    room: "A101",
    startsAt: "2026-05-20T02:00:00.000Z",
    endsAt: "2026-05-20T04:00:00.000Z",
    capacity: 100,
    confirmedRegistrations: 25,
    reservedCount: 25,
    confirmedCount: 25,
    availableSeats: 75,
    priceVnd: 0,
    paymentRequired: false,
    status: "published",
    pdfUrl: null,
    aiSummary: null,
    summaryStatus: "idle",
    summaryGeneratedAt: null,
    summaryErrorCode: null,
    createdAt: "2026-05-01T00:00:00.000Z",
    updatedAt: "2026-05-01T00:00:00.000Z"
  },
  {
    id: "w2",
    title: "Paid Design Sprint",
    description: "Design sprint workshop",
    speakerName: "Bob",
    room: "B202",
    startsAt: "2026-05-22T02:00:00.000Z",
    endsAt: "2026-05-22T04:00:00.000Z",
    capacity: 30,
    confirmedRegistrations: 30,
    reservedCount: 30,
    confirmedCount: 30,
    availableSeats: 0,
    priceVnd: 100000,
    paymentRequired: true,
    status: "published",
    pdfUrl: null,
    aiSummary: null,
    summaryStatus: "idle",
    summaryGeneratedAt: null,
    summaryErrorCode: null,
    createdAt: "2026-05-01T00:00:00.000Z",
    updatedAt: "2026-05-01T00:00:00.000Z"
  },
  {
    id: "w3",
    title: "Draft Session",
    description: "Not visible",
    speakerName: "Carol",
    room: "C303",
    startsAt: "2026-05-22T02:00:00.000Z",
    endsAt: "2026-05-22T04:00:00.000Z",
    capacity: 20,
    confirmedRegistrations: 0,
    reservedCount: 0,
    confirmedCount: 0,
    availableSeats: 20,
    priceVnd: 0,
    paymentRequired: false,
    status: "draft",
    pdfUrl: null,
    aiSummary: null,
    summaryStatus: "idle",
    summaryGeneratedAt: null,
    summaryErrorCode: null,
    createdAt: "2026-05-01T00:00:00.000Z",
    updatedAt: "2026-05-01T00:00:00.000Z"
  }
];

class SearchGatewayStub implements IWorkshopSearchGateway {
  public hits: WorkshopSearchHit[] = [];
  public error: Error | null = null;

  public isConfigured(): boolean {
    return true;
  }

  public async ensureIndex(): Promise<void> {}
  public async recreateIndex(): Promise<void> {}

  public async searchWorkshops(_input: WorkshopSearchRequest): Promise<WorkshopSearchHit[]> {
    if (this.error) throw this.error;
    return this.hits;
  }

  public async upsertWorkshopDocument(_document: WorkshopSearchDocument): Promise<void> {}
  public async removeWorkshopDocument(_workshopId: string): Promise<void> {}
}

async function main(): Promise<void> {
  const service = new WorkshopService(
    { listWorkshops: async () => workshops, getWorkshopDetail: async () => workshops[0] } as never,
    new SearchGatewayStub()
  );

  let invalidQueryErrorSeen = false;
  try {
    await service.listWorkshopsForThisMonth({ payment: "vip" }, "2026-05-15T00:00:00.000Z");
  } catch (error: unknown) {
    invalidQueryErrorSeen = error instanceof AppError && error.code === "INVALID_DISCOVERY_QUERY";
  }
  if (!invalidQueryErrorSeen) {
    throw new Error("Expected INVALID_DISCOVERY_QUERY for unsupported payment filter");
  }

  const first = await service.listWorkshopsForThisMonth({ payment: "free", available_only: "true" }, "2026-05-15T00:00:00.000Z");
  const second = await service.listWorkshopsForThisMonth({ payment: "free", available_only: "true" }, "2026-05-15T00:00:00.000Z");
  deepStrictEqual(second, first);

  const unavailableGateway = new SearchGatewayStub();
  unavailableGateway.error = new AppError(503, "WORKSHOP_SEARCH_UNAVAILABLE", "Workshop search is temporarily unavailable");
  const unavailableService = new WorkshopService(
    { listWorkshops: async () => workshops, getWorkshopDetail: async () => workshops[0] } as never,
    unavailableGateway
  );

  let unavailableSeen = false;
  try {
    await unavailableService.listWorkshopsForThisMonth({ q: "career" }, "2026-05-15T00:00:00.000Z");
  } catch (error: unknown) {
    unavailableSeen = error instanceof AppError && error.code === "WORKSHOP_SEARCH_UNAVAILABLE";
  }
  if (!unavailableSeen) {
    throw new Error("Expected WORKSHOP_SEARCH_UNAVAILABLE for text search when backend search is down");
  }

  const rankedGateway = new SearchGatewayStub();
  rankedGateway.hits = [{ id: "w2", score: 9 }, { id: "w1", score: 8 }];
  const rankedService = new WorkshopService(
    { listWorkshops: async () => workshops, getWorkshopDetail: async () => workshops[0] } as never,
    rankedGateway
  );

  const rankedResult = await rankedService.listWorkshopsForThisMonth(
    { q: "workshop", available_only: "true" },
    "2026-05-15T00:00:00.000Z"
  );
  deepStrictEqual(rankedResult.workshops.map((workshop) => workshop.id), ["w1"]);

  // eslint-disable-next-line no-console
  console.log("Backend workshop discovery assertions passed.");
}

void main();
