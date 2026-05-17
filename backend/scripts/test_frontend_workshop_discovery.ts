import { deepStrictEqual, strictEqual } from "node:assert";
import {
  DEFAULT_WORKSHOP_DISCOVERY_QUERY,
  buildWorkshopDiscoverySearchParams,
  getWorkshopDiscoveryErrorMessage,
  normalizeWorkshopDiscoveryQuery,
  scheduleWorkshopDiscoveryRequest,
  WORKSHOP_DISCOVERY_DEBOUNCE_MS
} from "../../frontend/lib/workshop-discovery.ts";
import {
  buildWorkshopSearchQuickSuggestions,
  buildWorkshopSearchSuggestions
} from "../../frontend/lib/workshop-search-suggestions.ts";

async function main(): Promise<void> {
  deepStrictEqual(normalizeWorkshopDiscoveryQuery({ q: "  career  ", payment: "paid" }), {
    q: "career",
    payment: "paid",
    availableOnly: false
  });

  const params = buildWorkshopDiscoverySearchParams({
    q: "design",
    payment: "paid",
    availableOnly: true
  });

  strictEqual(params.toString(), "q=design&payment=paid&available_only=true");

  strictEqual(
    getWorkshopDiscoveryErrorMessage(new Error("Failed to fetch"), false),
    "Search is unavailable while you are offline. Reconnect and try again."
  );
  strictEqual(
    getWorkshopDiscoveryErrorMessage({ code: "WORKSHOP_SEARCH_UNAVAILABLE" }, true),
    "Search is temporarily unavailable. You can still browse the default workshop list."
  );

  let triggered = 0;
  await new Promise<void>((resolve) => {
    const cancel = scheduleWorkshopDiscoveryRequest(() => {
      triggered += 1;
      resolve();
    }, 10);
    strictEqual(typeof cancel, "function");
  });
  strictEqual(triggered, 1);

  let cancelledTriggered = 0;
  const cancel = scheduleWorkshopDiscoveryRequest(() => {
    cancelledTriggered += 1;
  }, 10);
  cancel();
  await new Promise((resolve) => setTimeout(resolve, 20));
  strictEqual(cancelledTriggered, 0);
  strictEqual(WORKSHOP_DISCOVERY_DEBOUNCE_MS, 300);
  deepStrictEqual(DEFAULT_WORKSHOP_DISCOVERY_QUERY, { q: "", payment: "all", availableOnly: false });

  const workshops = [
    {
      id: "w1",
      title: "Career Readiness Workshop",
      description: "CV and interview tips",
      speakerName: "Alice Nguyen",
      room: "A101",
      startsAt: "2026-05-20T02:00:00.000Z",
      endsAt: "2026-05-20T04:00:00.000Z",
      capacity: 100,
      confirmedRegistrations: 10,
      reservedCount: 10,
      confirmedCount: 10,
      availableSeats: 90,
      priceVnd: 0,
      paymentRequired: false,
      status: "published",
      pdfUrl: null,
      aiSummary: null,
      summaryStatus: "idle",
      summaryGeneratedAt: null,
      summaryErrorCode: null,
      createdAt: "2026-05-01T00:00:00.000Z",
      updatedAt: "2026-05-01T00:00:00.000Z",
      location: "A101"
    },
    {
      id: "w2",
      title: "Peak Scale Design Sprint",
      description: "Design sprint",
      speakerName: "Bob Tran",
      room: "B202",
      startsAt: "2026-05-22T02:00:00.000Z",
      endsAt: "2026-05-22T04:00:00.000Z",
      capacity: 30,
      confirmedRegistrations: 5,
      reservedCount: 5,
      confirmedCount: 5,
      availableSeats: 25,
      priceVnd: 100000,
      paymentRequired: true,
      status: "published",
      pdfUrl: null,
      aiSummary: null,
      summaryStatus: "idle",
      summaryGeneratedAt: null,
      summaryErrorCode: null,
      createdAt: "2026-05-01T00:00:00.000Z",
      updatedAt: "2026-05-01T00:00:00.000Z",
      location: "B202"
    }
  ] as const;

  const quick = buildWorkshopSearchQuickSuggestions([...workshops]);
  strictEqual(quick.includes("Alice Nguyen"), true);
  strictEqual(quick.includes("B202"), true);

  const filtered = buildWorkshopSearchSuggestions([...workshops], "care");
  strictEqual(filtered[0]?.toLowerCase().includes("care"), true);

  // eslint-disable-next-line no-console
  console.log("Frontend workshop discovery assertions passed.");
}

void main();
