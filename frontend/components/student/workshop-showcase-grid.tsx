import Link from "next/link";
import type { WorkshopListItem } from "@/types/admin";

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

interface Props {
  workshops: WorkshopListItem[];
}

export default function WorkshopShowcaseGrid({ workshops }: Props): JSX.Element {
  if (workshops.length === 0) {
    return (
      <article className="card">
        <h3 style={{ marginTop: 0 }}>No workshops match your current search</h3>
        <p className="muted">Try clearing a filter, shortening your search text, or browsing the default workshop list.</p>
      </article>
    );
  }

  return (
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
            <Link href={`/workshops/${workshop.id}`} className="workshop-showcase-link">
              View details
            </Link>
          </div>
        </article>
      ))}
    </div>
  );
}

