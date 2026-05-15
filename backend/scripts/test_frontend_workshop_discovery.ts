import { deepStrictEqual, strictEqual } from "node:assert";
import {
  DEFAULT_WORKSHOP_DISCOVERY_QUERY,
  buildWorkshopDiscoverySearchParams,
  getWorkshopDiscoveryErrorMessage,
  normalizeWorkshopDiscoveryQuery,
  scheduleWorkshopDiscoveryRequest,
  WORKSHOP_DISCOVERY_DEBOUNCE_MS
} from "../../frontend/lib/workshop-discovery.ts";

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

  // eslint-disable-next-line no-console
  console.log("Frontend workshop discovery assertions passed.");
}

void main();
