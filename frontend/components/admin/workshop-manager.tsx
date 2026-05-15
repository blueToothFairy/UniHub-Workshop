"use client";

import { useEffect, useMemo, useState, type FormEvent, type ReactElement, type ReactNode, type WheelEvent } from "react";
import { useRouter } from "next/navigation";
import { adminApi } from "@/lib/api";
import type { CreateWorkshopInput, UpdateWorkshopInput, Workshop } from "@/types/admin";

interface Props {
  token: string;
  workshops: Workshop[];
}

interface EditableWorkshopForm {
  title: string;
  description: string;
  speakerName: string;
  room: string;
  startsAt: string;
  endsAt: string;
  capacity: number;
  priceVnd: number;
  status: Workshop["status"];
}

interface PopupState {
  visible: boolean;
  title: string;
  message: string;
}

function Field({ label, children, fullWidth = false }: { label: string; children: ReactNode; fullWidth?: boolean }): ReactElement {
  return (
    <label style={{ display: "grid", gap: 6, ...(fullWidth ? { gridColumn: "1 / -1" } : {}) }}>
      <span className="muted">{label}</span>
      {children}
    </label>
  );
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

const emptyEditForm: EditableWorkshopForm = {
  title: "",
  description: "",
  speakerName: "",
  room: "",
  startsAt: "",
  endsAt: "",
  capacity: 0,
  priceVnd: 0,
  status: "draft"
};

function toDateTimeLocalValue(value: string): string {
  const date: Date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    return "";
  }

  const pad = (n: number): string => String(n).padStart(2, "0");
  const year = date.getFullYear();
  const month = pad(date.getMonth() + 1);
  const day = pad(date.getDate());
  const hours = pad(date.getHours());
  const minutes = pad(date.getMinutes());
  return `${year}-${month}-${day}T${hours}:${minutes}`;
}

function toEditableForm(workshop: Workshop): EditableWorkshopForm {
  return {
    title: workshop.title,
    description: workshop.description,
    speakerName: workshop.speakerName,
    room: workshop.room,
    startsAt: toDateTimeLocalValue(workshop.startsAt),
    endsAt: toDateTimeLocalValue(workshop.endsAt),
    capacity: workshop.capacity,
    priceVnd: workshop.priceVnd,
    status: workshop.status
  };
}

function toIsoOrEmpty(value: string): string {
  if (!value) return "";
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) {
    return "";
  }
  return parsed.toISOString();
}

function isInCurrentMonth(isoDate: string): boolean {
  const date = new Date(isoDate);
  if (Number.isNaN(date.getTime())) {
    return false;
  }
  const now = new Date();
  return date.getFullYear() === now.getFullYear() && date.getMonth() === now.getMonth();
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function lockNumberInputWheel(event: WheelEvent<HTMLInputElement>): void {
  event.currentTarget.blur();
}

export default function WorkshopManager({ token, workshops }: Props): ReactElement {
  const router = useRouter();
  const [form, setForm] = useState<CreateWorkshopInput>(emptyForm);
  const [selectedId, setSelectedId] = useState<string>("");
  const [editForm, setEditForm] = useState<EditableWorkshopForm>(emptyEditForm);
  const [summaryOverride, setSummaryOverride] = useState<string>("");
  const [selectedFile, setSelectedFile] = useState<File | null>(null);
  const [error, setError] = useState<string>("");
  const [isUpdating, setIsUpdating] = useState<boolean>(false);
  const [isUploadingPdf, setIsUploadingPdf] = useState<boolean>(false);
  const [isSummaryProcessing, setIsSummaryProcessing] = useState<boolean>(false);
  const [popup, setPopup] = useState<PopupState>({ visible: false, title: "", message: "" });
  const [summaryText, setSummaryText] = useState<string>("");
  const [summaryStatus, setSummaryStatus] = useState<Workshop["summaryStatus"]>("idle");

  const editableWorkshops: Workshop[] = useMemo(
    () => workshops.filter((workshop) => isInCurrentMonth(workshop.createdAt)),
    [workshops]
  );

  const selected: Workshop | undefined = useMemo(
    () => editableWorkshops.find((workshop: Workshop) => workshop.id === selectedId),
    [selectedId, editableWorkshops]
  );

  useEffect(() => {
    if (!selected) {
      setEditForm(emptyEditForm);
      setSummaryText("");
      setSummaryStatus("idle");
      return;
    }
    setEditForm(toEditableForm(selected));
    setSummaryText(selected.aiSummary ?? "");
    setSummaryStatus(selected.summaryStatus);
  }, [selected]);

  useEffect(() => {
    if (!selectedId) {
      return;
    }
    const exists = editableWorkshops.some((workshop) => workshop.id === selectedId);
    if (!exists) {
      setSelectedId("");
    }
  }, [editableWorkshops, selectedId]);

  const showPopup = (title: string, message: string): void => {
    setPopup({ visible: true, title, message });
  };

  const waitForSummaryCompletion = async (workshopId: string): Promise<void> => {
    setIsSummaryProcessing(true);
    const maxAttempts = 36;
    const pollIntervalMs = 5000;

    for (let attempt = 0; attempt < maxAttempts; attempt += 1) {
      const latest = await adminApi.getWorkshop(token, workshopId);
      setSummaryStatus(latest.summaryStatus);
      setSummaryText(latest.aiSummary ?? "");

      if (latest.summaryStatus !== "processing") {
        setIsSummaryProcessing(false);
        if (latest.aiSummary) {
          showPopup("AI Summary Completed", "AI summary is ready and displayed below.");
        } else {
          showPopup("AI Summary Completed", "Processing finished, but no summary text was generated.");
        }
        router.refresh();
        return;
      }
      await sleep(pollIntervalMs);
    }

    setIsSummaryProcessing(false);
    showPopup("AI Summary Is Still Processing", "This task is taking longer than expected. Please wait and try refresh.");
  };

  useEffect(() => {
    if (!selected || selected.summaryStatus !== "processing" || isSummaryProcessing) {
      return;
    }
    void waitForSummaryCompletion(selected.id);
    // Intentionally depends on selected identity and current processing state.
  }, [selected, isSummaryProcessing]);

  const onCreate = async (event: FormEvent<HTMLFormElement>): Promise<void> => {
    event.preventDefault();
    setError("");
    try {
      await adminApi.createWorkshop(token, {
        ...form,
        startsAt: toIsoOrEmpty(form.startsAt),
        endsAt: toIsoOrEmpty(form.endsAt)
      });
      showPopup("Workshop Created", "Workshop has been created successfully.");
      setForm(emptyForm);
      router.refresh();
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : "Create failed");
    }
  };

  const onUpdate = async (): Promise<void> => {
    if (!selected) return;
    setError("");
    setIsUpdating(true);
    const payload: UpdateWorkshopInput = {
      title: editForm.title,
      description: editForm.description,
      speakerName: editForm.speakerName,
      room: editForm.room,
      startsAt: toIsoOrEmpty(editForm.startsAt),
      endsAt: toIsoOrEmpty(editForm.endsAt),
      capacity: editForm.capacity,
      priceVnd: editForm.priceVnd,
      status: editForm.status
    };

    try {
      await adminApi.updateWorkshop(token, selected.id, payload);
      showPopup("Workshop Updated", "Workshop information has been updated successfully.");
      router.refresh();
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : "Update failed");
    } finally {
      setIsUpdating(false);
    }
  };

  const onCancel = async (): Promise<void> => {
    if (!selected) return;
    setError("");
    try {
      await adminApi.cancelWorkshop(token, selected.id);
      showPopup("Workshop Cancelled", "Workshop has been cancelled successfully.");
      router.refresh();
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : "Cancel failed");
    }
  };

  const onUploadPdf = async (): Promise<void> => {
    if (!selected || !selectedFile) return;
    setError("");
    setIsUploadingPdf(true);
    try {
      await adminApi.uploadWorkshopPdf(token, selected.id, selectedFile);
      setSelectedFile(null);
      await waitForSummaryCompletion(selected.id);
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : "PDF upload failed");
    } finally {
      setIsUploadingPdf(false);
    }
  };

  const onOverrideSummary = async (): Promise<void> => {
    if (!selected) return;
    setError("");
    try {
      await adminApi.overrideSummary(token, selected.id, summaryOverride);
      showPopup("Summary Overridden", "Summary has been updated successfully.");
      setSummaryOverride("");
      router.refresh();
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : "Override failed");
    }
  };

  return (
    <section className="grid card">
      {error ? <p style={{ color: "var(--color-danger)" }}>{error}</p> : null}

      <h2 style={{ marginBottom: 0 }}>Create Workshop</h2>
      <form onSubmit={onCreate} className="form-2col">
        <Field label="Title">
          <input className="input" value={form.title} onChange={(e) => setForm({ ...form, title: e.target.value })} required />
        </Field>
        <Field label="Speaker Name">
          <input className="input" value={form.speakerName} onChange={(e) => setForm({ ...form, speakerName: e.target.value })} required />
        </Field>
        <Field label="Room">
          <input className="input" value={form.room} onChange={(e) => setForm({ ...form, room: e.target.value })} required />
        </Field>
        <Field label="Capacity">
          <input className="input" type="number" value={form.capacity} onWheel={lockNumberInputWheel} onChange={(e) => setForm({ ...form, capacity: Number(e.target.value) })} min={1} required />
        </Field>
        <Field label="Start Time">
          <input className="input" type="datetime-local" value={form.startsAt} onChange={(e) => setForm({ ...form, startsAt: e.target.value })} required />
        </Field>
        <Field label="End Time">
          <input className="input" type="datetime-local" value={form.endsAt} onChange={(e) => setForm({ ...form, endsAt: e.target.value })} required />
        </Field>
        <Field label="Price (VND)">
          <input className="input" type="number" value={form.priceVnd} onWheel={lockNumberInputWheel} onChange={(e) => setForm({ ...form, priceVnd: Number(e.target.value) })} min={0} required />
        </Field>
        <Field label="Status">
          <select className="select" value={form.status} onChange={(e) => setForm({ ...form, status: e.target.value as Workshop["status"] })}>
            <option value="draft">Draft</option>
            <option value="published">Published</option>
            <option value="cancelled">Cancelled</option>
          </select>
        </Field>
        <Field label="Description" fullWidth>
          <textarea className="textarea" value={form.description} onChange={(e) => setForm({ ...form, description: e.target.value })} required />
        </Field>
        <button className="btn btn-primary" type="submit" style={{ gridColumn: "1 / -1" }}>Create Workshop</button>
      </form>

      <Field label="Select Workshop to Edit" fullWidth>
        <select className="select" value={selectedId} onChange={(e) => setSelectedId(e.target.value)}>
          <option value="">Select Workshop</option>
          {editableWorkshops.map((workshop) => (
            <option key={workshop.id} value={workshop.id}>{workshop.title}</option>
          ))}
        </select>
      </Field>

      {selected ? (
        <div className="grid">
          <h2 style={{ marginBottom: 0 }}>Update Workshop</h2>
          <p>Selected: {selected.title} ({selected.status})</p>
          <form
            className="form-2col"
            onSubmit={(event) => {
              event.preventDefault();
              if (isUpdating) return;
              void onUpdate();
            }}
          >
            <Field label="Title">
              <input className="input" value={editForm.title} onChange={(e) => setEditForm({ ...editForm, title: e.target.value })} required />
            </Field>
            <Field label="Speaker Name">
              <input className="input" value={editForm.speakerName} onChange={(e) => setEditForm({ ...editForm, speakerName: e.target.value })} required />
            </Field>
            <Field label="Room">
              <input className="input" value={editForm.room} onChange={(e) => setEditForm({ ...editForm, room: e.target.value })} required />
            </Field>
            <Field label="Capacity">
              <input className="input" type="number" value={editForm.capacity} onWheel={lockNumberInputWheel} onChange={(e) => setEditForm({ ...editForm, capacity: Number(e.target.value) })} min={1} required />
            </Field>
            <Field label="Start Time">
              <input className="input" type="datetime-local" value={editForm.startsAt} onChange={(e) => setEditForm({ ...editForm, startsAt: e.target.value })} required />
            </Field>
            <Field label="End Time">
              <input className="input" type="datetime-local" value={editForm.endsAt} onChange={(e) => setEditForm({ ...editForm, endsAt: e.target.value })} required />
            </Field>
            <Field label="Price (VND)">
              <input className="input" type="number" value={editForm.priceVnd} onWheel={lockNumberInputWheel} onChange={(e) => setEditForm({ ...editForm, priceVnd: Number(e.target.value) })} min={0} required />
            </Field>
            <Field label="Status">
              <select className="select" value={editForm.status} onChange={(e) => setEditForm({ ...editForm, status: e.target.value as Workshop["status"] })}>
                <option value="draft">Draft</option>
                <option value="published">Published</option>
                <option value="cancelled">Cancelled</option>
              </select>
            </Field>
            <Field label="Description" fullWidth>
              <textarea className="textarea" value={editForm.description} onChange={(e) => setEditForm({ ...editForm, description: e.target.value })} required />
            </Field>
            <button className="btn btn-secondary" type="submit" style={{ gridColumn: "1 / -1" }} disabled={isUpdating}>
              {isUpdating ? "Saving Changes..." : "Save Workshop Changes"}
            </button>
          </form>

          <p>Summary Status: {summaryStatus}</p>
          {isSummaryProcessing ? <p className="muted">AI Summary is processing... Please wait...</p> : null}
          {summaryText ? <p>{summaryText}</p> : null}
          <div className="inline-actions">
            <button className="btn btn-danger" type="button" onClick={onCancel}>Cancel Workshop</button>
          </div>

          <div className="form-2col">
            <input className="input" type="file" accept="application/pdf" onChange={(e) => setSelectedFile(e.target.files?.[0] ?? null)} />
            <button className="btn btn-secondary" type="button" onClick={onUploadPdf} disabled={!selectedFile || isUploadingPdf || isSummaryProcessing}>
              {isUploadingPdf ? "Uploading PDF..." : isSummaryProcessing ? "Processing Summary..." : "Upload PDF"}
            </button>
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

      {popup.visible ? (
        <div role="alertdialog" aria-live="assertive" style={{
          position: "fixed",
          right: 20,
          bottom: 20,
          zIndex: 1000,
          maxWidth: 360,
          border: "1px solid var(--color-border)",
          borderRadius: 12,
          background: "var(--color-surface)",
          boxShadow: "0 10px 30px rgba(0,0,0,0.15)",
          padding: 16
        }}>
          <p style={{ margin: 0, fontWeight: 700 }}>{popup.title}</p>
          <p className="muted" style={{ marginTop: 8, marginBottom: 12 }}>{popup.message}</p>
          <button className="btn btn-secondary" type="button" onClick={() => setPopup({ visible: false, title: "", message: "" })}>
            Close
          </button>
        </div>
      ) : null}
    </section>
  );
}
