import type { WorkshopDiscoveryPaymentFilter, WorkshopDiscoveryQuery } from "@/types/admin";

export const DEFAULT_WORKSHOP_DISCOVERY_QUERY: WorkshopDiscoveryQuery = {
  q: "",
  payment: "all",
  availableOnly: false
};
export const WORKSHOP_DISCOVERY_DEBOUNCE_MS = 300;

export function normalizeWorkshopDiscoveryQuery(input?: Partial<WorkshopDiscoveryQuery>): WorkshopDiscoveryQuery {
  return {
    q: input?.q?.trim() ?? "",
    payment: input?.payment ?? "all",
    availableOnly: Boolean(input?.availableOnly)
  };
}

export function buildWorkshopDiscoverySearchParams(query: WorkshopDiscoveryQuery): URLSearchParams {
  const params = new URLSearchParams();
  if (query.q) params.set("q", query.q);
  if (query.payment !== "all") params.set("payment", query.payment);
  if (query.availableOnly) params.set("available_only", "true");
  return params;
}

export function areWorkshopDiscoveryQueriesEqual(a: WorkshopDiscoveryQuery, b: WorkshopDiscoveryQuery): boolean {
  return a.q === b.q && a.payment === b.payment && a.availableOnly === b.availableOnly;
}

export function isWorkshopDiscoveryPaymentFilter(value: string): value is WorkshopDiscoveryPaymentFilter {
  return value === "all" || value === "free" || value === "paid";
}

export function scheduleWorkshopDiscoveryRequest(callback: () => void, delayMs: number = WORKSHOP_DISCOVERY_DEBOUNCE_MS): () => void {
  const timeoutId = globalThis.setTimeout(callback, delayMs);
  return () => globalThis.clearTimeout(timeoutId);
}

export function getWorkshopDiscoveryErrorMessage(error: unknown, isOnline: boolean): string {
  if (!isOnline) {
    return "Search is unavailable while you are offline. Reconnect and try again.";
  }
  if (error && typeof error === "object" && "code" in error && error.code === "WORKSHOP_SEARCH_UNAVAILABLE") {
    return "Search is temporarily unavailable. You can still browse the default workshop list.";
  }
  if (error instanceof Error) {
    return error.message;
  }
  return "Failed to refresh workshop discovery results.";
}
