"use client";

import { useEffect, useRef, useState, type Dispatch, type SetStateAction } from "react";
import { getWorkshopsThisMonth, type WorkshopsThisMonthResponse } from "@/lib/api";
import {
  areWorkshopDiscoveryQueriesEqual,
  DEFAULT_WORKSHOP_DISCOVERY_QUERY,
  normalizeWorkshopDiscoveryQuery,
  getWorkshopDiscoveryErrorMessage,
  scheduleWorkshopDiscoveryRequest
} from "@/lib/workshop-discovery";
import type { WorkshopDiscoveryQuery } from "@/types/admin";
import type { WorkshopListItem } from "@/types/admin";

interface Options {
  initialPayload: WorkshopsThisMonthResponse;
  initialQuery?: Partial<WorkshopDiscoveryQuery>;
  onPayloadChange?: (payload: WorkshopsThisMonthResponse) => void;
}

export interface WorkshopDiscoveryState {
  query: WorkshopDiscoveryQuery;
  setQuery: Dispatch<SetStateAction<WorkshopDiscoveryQuery>>;
  workshops: WorkshopListItem[];
  loading: boolean;
  error: string;
  hasActiveCriteria: boolean;
  clearFilters: () => void;
}

export function useWorkshopDiscovery({
  initialPayload,
  initialQuery,
  onPayloadChange
}: Options): WorkshopDiscoveryState {
  const [query, setQuery] = useState<WorkshopDiscoveryQuery>(
    normalizeWorkshopDiscoveryQuery(initialQuery ?? DEFAULT_WORKSHOP_DISCOVERY_QUERY)
  );
  const [payload, setPayload] = useState<WorkshopsThisMonthResponse>(initialPayload);
  const [loading, setLoading] = useState<boolean>(false);
  const [error, setError] = useState<string>("");
  const firstRenderRef = useRef<boolean>(true);

  const updatePayload = (nextPayload: WorkshopsThisMonthResponse): void => {
    setPayload(nextPayload);
    onPayloadChange?.(nextPayload);
  };

  useEffect(() => {
    if (firstRenderRef.current) {
      firstRenderRef.current = false;
      return;
    }

    const cancel = scheduleWorkshopDiscoveryRequest(() => {
      setLoading(true);
      void getWorkshopsThisMonth(query)
        .then((nextPayload) => {
          updatePayload(nextPayload);
          setError("");
        })
        .catch((nextError: unknown) => {
          setError(getWorkshopDiscoveryErrorMessage(nextError, typeof navigator === "undefined" ? true : navigator.onLine));
        })
        .finally(() => setLoading(false));
    });

    return cancel;
  }, [query]);

  const workshops = payload.workshops ?? [];
  const hasActiveCriteria = !areWorkshopDiscoveryQueriesEqual(query, DEFAULT_WORKSHOP_DISCOVERY_QUERY);

  const clearFilters = (): void => {
    setQuery(DEFAULT_WORKSHOP_DISCOVERY_QUERY);
    setError("");
  };

  return {
    query,
    setQuery,
    workshops,
    loading,
    error,
    hasActiveCriteria,
    clearFilters
  };
}
