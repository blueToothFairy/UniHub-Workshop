"use client";

import { useMemo, useState, type FormEvent, type ReactElement } from "react";
import { useRouter } from "next/navigation";
import { adminApi } from "@/lib/api";
import type { CreateWorkshopInput, Workshop } from "@/types/admin";

interface Props {
  token: string;
  workshops: Workshop[];
}

const emptyForm: CreateWorkshopInput = {
  title: "",
  description: "",
  speakerName: "",
  room: "",
  startsAt: "",
  endsAt: "",
  capacity: 50,
  priceVnd: 0,
  status: "draft"
};

export default function WorkshopManager({ token, workshops }: Props): ReactElement {
  const router = useRouter();
  const [form, setForm] = useState<CreateWorkshopInput>(emptyForm);
  const [selectedId, setSelectedId] = useState<string>("");
  const [summaryOverride, setSummaryOverride] = useState<string>("");
  const [selectedFile, setSelectedFile] = useState<File | null>(null);
  const [error, setError] = useState<string>("");

  const selected: Workshop | undefined = useMemo(
    () => workshops.find((workshop: Workshop) => workshop.id === selectedId),
    [selectedId, workshops]
  );

  const onCreate = async (event: FormEvent<HTMLFormElement>): Promise<void> => {
    event.preventDefault();
    setError("");
    try {
      await adminApi.createWorkshop(token, form);
      setForm(emptyForm);
      router.refresh();
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : "Create failed");
    }
  };

  const onUpdate = async (): Promise<void> => {
    if (!selected) return;
    setError("");
    try {
      await adminApi.updateWorkshop(token, selected.id, {
        title: selected.title,
        description: selected.description,
        speakerName: selected.speakerName,
        room: selected.room,
        startsAt: selected.startsAt,
        endsAt: selected.endsAt,
        capacity: selected.capacity,
        priceVnd: selected.priceVnd,
        status: selected.status
      });
      router.refresh();
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : "Update failed");
    }
  };

  const onCancel = async (): Promise<void> => {
    if (!selected) return;
    setError("");
    try {
      await adminApi.cancelWorkshop(token, selected.id);
      router.refresh();
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : "Cancel failed");
    }
  };

  const onUploadPdf = async (): Promise<void> => {
    if (!selected || !selectedFile) return;
    setError("");
    try {
      await adminApi.uploadWorkshopPdf(token, selected.id, selectedFile);
      setSelectedFile(null);
      router.refresh();
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : "PDF upload failed");
    }
  };

  const onOverrideSummary = async (): Promise<void> => {
    if (!selected) return;
    setError("");
    try {
      await adminApi.overrideSummary(token, selected.id, summaryOverride);
      setSummaryOverride("");
      router.refresh();
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : "Override failed");
    }
  };

  return (
    <section className="grid card">
      {error ? <p style={{ color: "var(--color-danger)" }}>{error}</p> : null}

      <form onSubmit={onCreate} className="grid" style={{ gridTemplateColumns: "repeat(2, minmax(0,1fr))" }}>
        <input className="input" placeholder="Title" value={form.title} onChange={(e) => setForm({ ...form, title: e.target.value })} required />
        <input className="input" placeholder="Speaker" value={form.speakerName} onChange={(e) => setForm({ ...form, speakerName: e.target.value })} required />
        <input className="input" placeholder="Room" value={form.room} onChange={(e) => setForm({ ...form, room: e.target.value })} required />
        <input className="input" type="number" placeholder="Capacity" value={form.capacity} onChange={(e) => setForm({ ...form, capacity: Number(e.target.value) })} required />
        <input className="input" type="datetime-local" value={form.startsAt} onChange={(e) => setForm({ ...form, startsAt: e.target.value })} required />
        <input className="input" type="datetime-local" value={form.endsAt} onChange={(e) => setForm({ ...form, endsAt: e.target.value })} required />
        <input className="input" type="number" placeholder="Price VND" value={form.priceVnd} onChange={(e) => setForm({ ...form, priceVnd: Number(e.target.value) })} required />
        <select className="select" value={form.status} onChange={(e) => setForm({ ...form, status: e.target.value as Workshop["status"] })}>
          <option value="draft">draft</option>
          <option value="published">published</option>
          <option value="cancelled">cancelled</option>
        </select>
        <textarea className="textarea" placeholder="Description" value={form.description} onChange={(e) => setForm({ ...form, description: e.target.value })} style={{ gridColumn: "1 / -1" }} required />
        <button className="btn btn-primary" type="submit" style={{ gridColumn: "1 / -1" }}>Create workshop</button>
      </form>

      <select className="select" value={selectedId} onChange={(e) => setSelectedId(e.target.value)}>
        <option value="">Select workshop to edit/cancel</option>
        {workshops.map((workshop) => (
          <option key={workshop.id} value={workshop.id}>{workshop.title}</option>
        ))}
      </select>

      {selected ? (
        <div className="grid">
          <p>Selected: {selected.title} ({selected.status})</p>
          <p>Summary status: {selected.summaryStatus}</p>
          {selected.aiSummary ? <p>{selected.aiSummary}</p> : null}
          <div style={{ display: "flex", gap: 8 }}>
            <button className="btn btn-secondary" type="button" onClick={onUpdate}>Save selected workshop</button>
            <button className="btn" style={{ background: "#fee2e2", color: "#991b1b" }} type="button" onClick={onCancel}>Cancel selected workshop</button>
          </div>

          <div className="grid" style={{ gridTemplateColumns: "1fr auto" }}>
            <input className="input" type="file" accept="application/pdf" onChange={(e) => setSelectedFile(e.target.files?.[0] ?? null)} />
            <button className="btn btn-secondary" type="button" onClick={onUploadPdf} disabled={!selectedFile}>Upload PDF</button>
          </div>

          <textarea
            className="textarea"
            placeholder="Manual summary override"
            value={summaryOverride}
            onChange={(e) => setSummaryOverride(e.target.value)}
          />
          <button className="btn btn-secondary" type="button" onClick={onOverrideSummary} disabled={!summaryOverride.trim()}>
            Override Summary
          </button>
        </div>
      ) : null}
    </section>
  );
}
