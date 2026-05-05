import { getWorkshopPublic } from "@/lib/api";
import type { ReactElement } from "react";

interface Props {
  params: { id: string };
}

export default async function StudentWorkshopDetailPage({ params }: Props): Promise<ReactElement> {
  const workshop = await getWorkshopPublic(params.id);

  return (
    <main className="section">
      <div className="container grid">
        <h1>{workshop.title}</h1>
        <p>{workshop.description}</p>
        <p><strong>Speaker:</strong> {workshop.speakerName}</p>
        <p><strong>Status:</strong> {workshop.summaryStatus}</p>
        {workshop.summaryStatus === "processing" ? <p>Summary is processing...</p> : null}
        {workshop.summaryStatus === "fallback" ? <p>Auto summary unavailable. Please read workshop description.</p> : null}
        {workshop.aiSummary ? <article className="card"><h3>AI Summary</h3><p>{workshop.aiSummary}</p></article> : null}
      </div>
    </main>
  );
}
