import type { WorkshopListItem } from "@/types/admin";

const STOP_WORDS = new Set(["the", "a", "an", "for", "and", "or", "with", "workshop", "session", "scale"]);

function normalize(value: string): string {
  return value.trim().toLowerCase();
}

function rankSuggestion(candidate: string, query: string): number {
  const normalizedCandidate = normalize(candidate);
  const normalizedQuery = normalize(query);
  if (!normalizedQuery) return 0;
  if (normalizedCandidate === normalizedQuery) return -1;
  if (normalizedCandidate.startsWith(normalizedQuery)) return 0;
  if (normalizedCandidate.includes(normalizedQuery)) return 1;
  return 2;
}

function collectCandidates(workshops: WorkshopListItem[]): string[] {
  const seen = new Set<string>();
  const candidates: string[] = [];

  const add = (value?: string | null): void => {
    const trimmed = value?.trim();
    if (!trimmed) return;
    const key = normalize(trimmed);
    if (seen.has(key)) return;
    seen.add(key);
    candidates.push(trimmed);
  };

  for (const workshop of workshops) {
    add(workshop.title);
    add(workshop.speakerName);
    add(workshop.room);
    for (const token of workshop.title.split(/\s+/)) {
      const cleaned = token.replace(/[^a-zA-Z0-9À-ỹ_-]/g, "");
      if (cleaned.length >= 3 && !STOP_WORDS.has(cleaned.toLowerCase())) {
        add(cleaned);
      }
    }
  }

  return candidates;
}

export function buildWorkshopSearchSuggestions(
  workshops: WorkshopListItem[],
  query: string,
  limit = 8
): string[] {
  const candidates = collectCandidates(workshops);
  const normalizedQuery = normalize(query);

  const filtered = normalizedQuery
    ? candidates.filter((candidate) => normalize(candidate).includes(normalizedQuery))
    : candidates;

  return filtered
    .sort((left, right) => {
      const rankDiff = rankSuggestion(left, query) - rankSuggestion(right, query);
      if (rankDiff !== 0) return rankDiff;
      return left.localeCompare(right, undefined, { sensitivity: "base" });
    })
    .filter((candidate, index, list) => list.indexOf(candidate) === index)
    .slice(0, limit);
}

export function buildWorkshopSearchQuickSuggestions(workshops: WorkshopListItem[], limit = 6): string[] {
  const speakers: string[] = [];
  const rooms: string[] = [];
  const titles: string[] = [];
  const seen = new Set<string>();

  const addUnique = (bucket: string[], value?: string | null): void => {
    const trimmed = value?.trim();
    if (!trimmed) return;
    const key = normalize(trimmed);
    if (seen.has(key)) return;
    seen.add(key);
    bucket.push(trimmed);
  };

  for (const workshop of workshops) {
    addUnique(speakers, workshop.speakerName);
    addUnique(rooms, workshop.room);
    addUnique(titles, workshop.title);
  }

  const picks: string[] = [];
  for (const speaker of speakers.slice(0, 2)) picks.push(speaker);
  for (const room of rooms.slice(0, 2)) picks.push(room);
  for (const title of titles.slice(0, 2)) picks.push(title);

  if (picks.length >= limit) {
    return picks.slice(0, limit);
  }

  return [...picks, ...buildWorkshopSearchSuggestions(workshops, "", limit)].slice(0, limit);
}
