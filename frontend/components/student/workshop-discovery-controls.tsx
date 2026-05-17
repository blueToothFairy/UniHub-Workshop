"use client";

import { useMemo, useState } from "react";
import type { WorkshopDiscoveryState } from "@/components/student/use-workshop-discovery";
import {
  buildWorkshopSearchQuickSuggestions,
  buildWorkshopSearchSuggestions
} from "@/lib/workshop-search-suggestions";
import type { WorkshopDiscoveryQuery, WorkshopListItem } from "@/types/admin";

interface Props {
  discovery: WorkshopDiscoveryState;
  suggestionWorkshops?: WorkshopListItem[];
}

const PAYMENT_OPTIONS: Array<{ value: WorkshopDiscoveryQuery["payment"]; label: string }> = [
  { value: "all", label: "Any" },
  { value: "free", label: "Free" },
  { value: "paid", label: "Paid" }
];

export default function WorkshopDiscoveryControls({ discovery, suggestionWorkshops = [] }: Props): JSX.Element {
  const { query, setQuery, workshops, loading, error, hasActiveCriteria, clearFilters } = discovery;
  const [isSearchFocused, setIsSearchFocused] = useState(false);

  const quickSuggestions = useMemo(
    () => buildWorkshopSearchQuickSuggestions(suggestionWorkshops),
    [suggestionWorkshops]
  );

  const typeaheadSuggestions = useMemo(() => {
    if (!isSearchFocused || !query.q.trim()) return [];
    return buildWorkshopSearchSuggestions(suggestionWorkshops, query.q).filter(
      (suggestion) => normalize(suggestion) !== normalize(query.q)
    );
  }, [isSearchFocused, query.q, suggestionWorkshops]);

  const showTypeahead = isSearchFocused && typeaheadSuggestions.length > 0;
  const showQuickSuggestions = (isSearchFocused || !query.q) && quickSuggestions.length > 0 && !showTypeahead;

  const applySuggestion = (value: string): void => {
    setQuery((current) => ({ ...current, q: value }));
    setIsSearchFocused(false);
  };

  return (
    <section className="card workshop-discovery-controls">
      <label className="workshop-discovery-field workshop-search-field">
        <span>Search workshops</span>
        <p className="workshop-search-hint muted">Search by title, speaker, description, or room.</p>
        <div className="workshop-search-input-wrap">
          <input
            className="input"
            type="text"
            value={query.q}
            placeholder="e.g. Peak, A101, career readiness"
            autoComplete="off"
            aria-autocomplete="list"
            aria-expanded={showTypeahead}
            onFocus={() => setIsSearchFocused(true)}
            onBlur={() => {
              globalThis.setTimeout(() => setIsSearchFocused(false), 120);
            }}
            onChange={(event) => setQuery((current) => ({ ...current, q: event.target.value }))}
            onKeyDown={(event) => {
              if (event.key === "Escape") {
                setIsSearchFocused(false);
              }
            }}
          />
          {showTypeahead ? (
            <ul className="workshop-search-typeahead" role="listbox" aria-label="Search suggestions">
              {typeaheadSuggestions.map((suggestion) => (
                <li key={suggestion} role="presentation">
                  <button
                    type="button"
                    className="workshop-search-typeahead-option"
                    role="option"
                    onMouseDown={(event) => event.preventDefault()}
                    onClick={() => applySuggestion(suggestion)}
                  >
                    {suggestion}
                  </button>
                </li>
              ))}
            </ul>
          ) : null}
        </div>
        {showQuickSuggestions ? (
          <div className="workshop-search-quick-suggestions" aria-label="Suggested searches">
            <span className="workshop-search-quick-label">Suggestions:</span>
            {quickSuggestions.map((suggestion) => (
              <button
                key={suggestion}
                type="button"
                className="workshop-search-suggestion-chip"
                onMouseDown={(event) => event.preventDefault()}
                onClick={() => applySuggestion(suggestion)}
              >
                {suggestion}
              </button>
            ))}
          </div>
        ) : null}
      </label>

      <div className="workshop-discovery-filters-bar">
        <div className="workshop-payment-field">
          <span className="workshop-filter-label">Price</span>
          <div className="workshop-payment-filter" role="group" aria-label="Filter by ticket price">
            {PAYMENT_OPTIONS.map((option) => {
              const isActive = query.payment === option.value;
              return (
                <button
                  key={option.value}
                  type="button"
                  className="workshop-payment-option"
                  aria-pressed={isActive}
                  onClick={() => setQuery((current) => ({ ...current, payment: option.value }))}
                >
                  {option.label}
                </button>
              );
            })}
          </div>
        </div>

        <label className="workshop-discovery-toggle workshop-discovery-toggle--inline">
          <input
            type="checkbox"
            checked={query.availableOnly}
            onChange={(event) => setQuery((current) => ({ ...current, availableOnly: event.target.checked }))}
          />
          <span>Open seats only</span>
        </label>
      </div>

      <div className="workshop-discovery-summary">
        <span className="muted workshop-discovery-count">
          {loading ? "Refreshing results..." : `${workshops.length} workshop${workshops.length === 1 ? "" : "s"} found`}
        </span>
        {hasActiveCriteria ? (
          <button className="btn btn-secondary" type="button" onClick={clearFilters}>
            Clear filters
          </button>
        ) : null}
      </div>

      {error ? <p className="notification-error" style={{ marginBottom: 0 }}>{error}</p> : null}
    </section>
  );
}

function normalize(value: string): string {
  return value.trim().toLowerCase();
}

