import { WorkshopService } from "../src/modules/workshop/workshop.service.js";

type SummaryStatus = "idle" | "processing" | "ready" | "fallback" | "failed";

function makeWorkshop(overrides: Partial<Record<string, unknown>> = {}) {
  const now = new Date().toISOString();
  return {
    id: (overrides.id as string) ?? "w-1",
    title: "Test Workshop",
    description: "Desc",
    speakerName: "Speaker",
    room: "R1",
    startsAt: now,
    endsAt: new Date(Date.now() + 3600_000).toISOString(),
    capacity: 10,
    confirmedRegistrations: 1,
    priceVnd: 0,
    paymentRequired: false,
    status: "published",
    pdfUrl: "http://example.com/a.pdf",
    aiSummary: (overrides.aiSummary as string) ?? "Existing summary",
    summaryStatus: (overrides.summaryStatus as SummaryStatus) ?? "idle",
    summaryGeneratedAt: (overrides.summaryGeneratedAt as string) ?? now,
    summaryErrorCode: (overrides.summaryErrorCode as string) ?? null,
    createdAt: now,
    updatedAt: now
  } as any;
}

async function run() {
  // Stub admin service that returns different workshop shapes per id
  const adminStub = {
    async getWorkshopDetail(id: string) {
      if (id === "processing") return makeWorkshop({ id, summaryStatus: "processing", aiSummary: "SHOULD_BE_HIDDEN", summaryGeneratedAt: new Date().toISOString() });
      if (id === "ready") return makeWorkshop({ id, summaryStatus: "ready", aiSummary: "READY_SUMMARY", summaryGeneratedAt: new Date().toISOString() });
      if (id === "fallback") return makeWorkshop({ id, summaryStatus: "fallback", aiSummary: "FALLBACK_SUMMARY", summaryErrorCode: "EMPTY_TEXT", summaryGeneratedAt: null });
      return makeWorkshop({ id, summaryStatus: "idle", aiSummary: null, summaryGeneratedAt: null });
    }
  } as any;

  const svc = new WorkshopService(adminStub as any);

  // Test: processing state should hide aiSummary
  const p = await svc.getWorkshopDetail("processing");
  if (p.aiSummary !== null || p.summaryGeneratedAt !== null || p.summaryErrorCode !== null) {
    console.error("[FAIL] processing: expected aiSummary,null summaryGeneratedAt=null summaryErrorCode=null", p);
    process.exit(1);
  }
  console.log("[PASS] processing state hiding aiSummary");

  // Test: ready state preserves summary
  const r = await svc.getWorkshopDetail("ready");
  if (r.aiSummary !== "READY_SUMMARY" || !r.summaryGeneratedAt) {
    console.error("[FAIL] ready: expected aiSummary and summaryGeneratedAt", r);
    process.exit(1);
  }
  console.log("[PASS] ready state preserves summary");

  // Test: fallback state preserves aiSummary and error code
  const f = await svc.getWorkshopDetail("fallback");
  if (f.aiSummary !== "FALLBACK_SUMMARY" || f.summaryErrorCode !== "EMPTY_TEXT") {
    console.error("[FAIL] fallback: expected aiSummary and summaryErrorCode", f);
    process.exit(1);
  }
  console.log("[PASS] fallback state preserves summary and error code");

  console.log("All mapping tests passed.");
}

run().catch((err) => {
  console.error(err);
  process.exit(1);
});
