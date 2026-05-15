"use client";

import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import { getWorkshopsThisMonth, type WorkshopsThisMonthResponse } from "@/lib/api";
import {
  areWorkshopDiscoveryQueriesEqual,
  DEFAULT_WORKSHOP_DISCOVERY_QUERY,
  normalizeWorkshopDiscoveryQuery,
  getWorkshopDiscoveryErrorMessage,
  scheduleWorkshopDiscoveryRequest
} from "@/lib/workshop-discovery";
import type { WorkshopDiscoveryQuery } from "@/types/admin";

interface Props {
  initialPayload: WorkshopsThisMonthResponse;
  initialQuery?: Partial<WorkshopDiscoveryQuery>;
}

function formatDateLabel(at?: string): string {
  if (!at) return "Date unavailable";
  try {
    return new Date(at).toLocaleDateString(undefined, { weekday: "short", month: "short", day: "2-digit", year: "numeric" });
  } catch {
    return at;
  }
}

function formatTimeLabel(at?: string): string {
  if (!at) return "Time TBD";
  try {
    return new Date(at).toLocaleTimeString(undefined, { hour: "2-digit", minute: "2-digit" });
  } catch {
    return at;
  }
}

export default function WorkshopDiscoveryPanel({ initialPayload, initialQuery }: Props): JSX.Element {
  const [query, setQuery] = useState<WorkshopDiscoveryQuery>(
    normalizeWorkshopDiscoveryQuery(initialQuery ?? DEFAULT_WORKSHOP_DISCOVERY_QUERY)
  );
  const [payload, setPayload] = useState<WorkshopsThisMonthResponse>(initialPayload);
  const [loading, setLoading] = useState<boolean>(false);
  const [error, setError] = useState<string>("");
  const firstRenderRef = useRef<boolean>(true);
  const initialNormalizedRef = useRef<WorkshopDiscoveryQuery>(
    normalizeWorkshopDiscoveryQuery(initialQuery ?? DEFAULT_WORKSHOP_DISCOVERY_QUERY)
  );

  useEffect(() => {
    if (firstRenderRef.current) {
      firstRenderRef.current = false;
      return;
    }

    const cancel = scheduleWorkshopDiscoveryRequest(() => {
      setLoading(true);
      void getWorkshopsThisMonth(query)
        .then((nextPayload) => {
          setPayload(nextPayload);
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

  return (
    <div className="grid" style={{ gap: 20 }}>
      <section className="card workshop-discovery-controls">
        <div className="workshop-discovery-controls-row">
          <label className="workshop-discovery-field">
            <span>Search workshops</span>
            <input
              className="input"
              type="search"
              value={query.q}
              placeholder="Search by title, speaker, description, or room"
              onChange={(event) => setQuery((current) => ({ ...current, q: event.target.value }))}
            />
          </label>

          <label className="workshop-discovery-field">
            <span>Payment</span>
            <select
              className="select"
              value={query.payment}
              onChange={(event) =>
                setQuery((current) => ({
                  ...current,
                  payment: event.target.value as WorkshopDiscoveryQuery["payment"]
                }))
              }
            >
              <option value="all">All workshops</option>
              <option value="free">Free only</option>
              <option value="paid">Paid only</option>
            </select>
          </label>
        </div>

        <div className="workshop-discovery-summary">
          <label className="workshop-discovery-toggle">
            <input
              type="checkbox"
              checked={query.availableOnly}
              onChange={(event) => setQuery((current) => ({ ...current, availableOnly: event.target.checked }))}
            />
            <span>Show only workshops with open seats</span>
          </label>

          <div className="inline-actions">
            <span className="muted">
              {loading ? "Refreshing results..." : `${workshops.length} workshop${workshops.length === 1 ? "" : "s"} found`}
            </span>
            {hasActiveCriteria ? (
              <button
                className="btn btn-secondary"
                type="button"
                onClick={() => {
                  setQuery(DEFAULT_WORKSHOP_DISCOVERY_QUERY);
                  if (areWorkshopDiscoveryQueriesEqual(initialNormalizedRef.current, DEFAULT_WORKSHOP_DISCOVERY_QUERY)) {
                    setPayload(initialPayload);
                  }
                  setError("");
                }}
              >
                Clear filters
              </button>
            ) : null}
          </div>
        </div>

        {error ? <p className="notification-error" style={{ marginBottom: 0 }}>{error}</p> : null}
      </section>

      {workshops.length === 0 ? (
        <article className="card">
          <h3 style={{ marginTop: 0 }}>No workshops match your current search</h3>
          <p className="muted">Try clearing a filter, shortening your search text, or browsing the default workshop list.</p>
        </article>
      ) : (
        <div className="card-grid workshop-showcase-grid">
          {workshops.map((workshop) => (
            <article key={workshop.id} className="workshop-showcase-card">
              <p className="workshop-showcase-date">{formatDateLabel(workshop.startsAt)}</p>
              <h3 className="workshop-showcase-title">{workshop.title}</h3>
              <div className="workshop-showcase-meta">
                <p><strong>Time:</strong> {formatTimeLabel(workshop.startsAt)}</p>
                <p><strong>Speaker:</strong> {workshop.speakerName}</p>
                <p><strong>Room:</strong> {workshop.room}</p>
              </div>
              <div className="workshop-showcase-footer">
                <p className="workshop-seat-availability">{workshop.availableSeats} seats available</p>
                <Link href={`/workshops/${workshop.id}`} className="workshop-showcase-link">View details</Link>
              </div>
            </article>
          ))}
        </div>
      )}
    </div>
  );
}
