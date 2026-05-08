"use client";

import { getWorkshopPublic, registrationApi, type CreateRegistrationResult, type RegistrationPaymentStatus, type RegistrationQrData } from "@/lib/api";
import type { Workshop } from "@/types/admin";
import { useEffect, useMemo, useState } from "react";

interface Props {
  params: { id: string };
}

function readCookie(name: string): string {
  if (typeof document === "undefined") return "";
  const parts = document.cookie.split(";").map((item) => item.trim());
  for (const part of parts) {
    const idx = part.indexOf("=");
    if (idx === -1) continue;
    if (part.slice(0, idx) === name) return decodeURIComponent(part.slice(idx + 1));
  }
  return "";
}

function getTokenSubject(accessToken: string): string | null {
  try {
    const segments = accessToken.split(".");
    if (segments.length !== 3) return null;
    const base64 = segments[1].replace(/-/g, "+").replace(/_/g, "/");
    const padded = base64.padEnd(base64.length + ((4 - (base64.length % 4)) % 4), "=");
    const payload = JSON.parse(atob(padded)) as { sub?: string };
    return payload.sub ?? null;
  } catch {
    return null;
  }
}

function getIdempotencyStorageKey(workshopId: string, accessToken: string): string {
  const userId = getTokenSubject(accessToken) ?? "unknown-user";
  return `registration-idempotency-${userId}-${workshopId}`;
}

function getOrCreateIdempotencyKey(workshopId: string, accessToken: string): string {
  const storageKey = getIdempotencyStorageKey(workshopId, accessToken);
  const existing = typeof window !== "undefined" ? window.localStorage.getItem(storageKey) : null;
  if (existing) return existing;
  const key = crypto.randomUUID();
  if (typeof window !== "undefined") window.localStorage.setItem(storageKey, key);
  return key;
}

function clearIdempotencyKey(workshopId: string, accessToken: string): void {
  if (typeof window === "undefined") return;
  window.localStorage.removeItem(getIdempotencyStorageKey(workshopId, accessToken));
}

export default function StudentWorkshopDetailPage({ params }: Props) {
  const [workshop, setWorkshop] = useState<Workshop | null>(null);
  const [registration, setRegistration] = useState<CreateRegistrationResult | null>(null);
  const [paymentStatus, setPaymentStatus] = useState<RegistrationPaymentStatus | null>(null);
  const [qrData, setQrData] = useState<RegistrationQrData | null>(null);
  const [error, setError] = useState<string>("");
  const [loading, setLoading] = useState<boolean>(true);
  const [submitting, setSubmitting] = useState<boolean>(false);
  const [isPolling, setIsPolling] = useState<boolean>(false);

  useEffect(() => {
    let mounted = true;
    (async () => {
      try {
        const data = await getWorkshopPublic(params.id);
        if (mounted) setWorkshop(data);

        const token = readCookie("access_token");
        if (token) {
          try {
            const current = await registrationApi.getCurrentRegistrationByWorkshop(token, params.id);
            if (!mounted) return;

            if (current.registration_status === "confirmed") {
              setRegistration({
                registration_id: current.registration_id,
                registration_status: "confirmed",
                payment_required: false,
                qr_available: true
              });
              setPaymentStatus({
                registration_id: current.registration_id,
                registration_status: "confirmed",
                payment_status: "completed",
                qr_available: true
              });
              const qr = await registrationApi.getRegistrationQr(token, current.registration_id);
              if (mounted) setQrData(qr);
            } else {
              const pendingStatus = current.payment_status === "unknown" ? "unknown" : "pending_provider";
              setRegistration({
                registration_id: current.registration_id,
                registration_status: "pending_payment",
                payment_required: true,
                payment_id: current.registration_id,
                payment_status: pendingStatus,
                payment_url: current.payment_url,
                next_action: "redirect_to_payment"
              });
              setPaymentStatus({
                registration_id: current.registration_id,
                registration_status: "pending_payment",
                payment_status: pendingStatus,
                payment_url: current.payment_url,
                next_action: pendingStatus === "unknown" ? "wait_for_confirmation" : "redirect_to_payment"
              });
            }
          } catch (regErr) {
            const msg = regErr instanceof Error ? regErr.message : "";
            if (!msg.includes("REGISTRATION_NOT_FOUND")) {
              throw regErr;
            }
          }
        }
      } catch (e) {
        if (mounted) setError(e instanceof Error ? e.message : "Failed to load workshop");
      } finally {
        if (mounted) setLoading(false);
      }
    })();
    return () => {
      mounted = false;
    };
  }, [params.id]);

  const hasActiveRegistration = useMemo(
    () => registration?.registration_status === "confirmed" || registration?.registration_status === "pending_payment",
    [registration]
  );
  const canRegister = useMemo(() => Boolean(workshop && workshop.availableSeats > 0 && !hasActiveRegistration), [workshop, hasActiveRegistration]);
  const hasPendingPayment = registration?.registration_status === "pending_payment";

  async function pollPaymentStatus(registrationId: string): Promise<void> {
    const token = readCookie("access_token");
    if (!token) return;
    setIsPolling(true);
    try {
      const status = await registrationApi.getPaymentStatus(token, registrationId);
      setPaymentStatus(status);
      if (status.registration_status === "confirmed") {
        const qr = await registrationApi.getRegistrationQr(token, registrationId);
        setQrData(qr);
        clearIdempotencyKey(params.id, token);
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to refresh payment status");
    } finally {
      setIsPolling(false);
    }
  }

  async function handleRegister(): Promise<void> {
    setError("");
    setSubmitting(true);
    try {
      const token = readCookie("access_token");
      if (!token) throw new Error("Please login as student first");
      const idempotencyKey = getOrCreateIdempotencyKey(params.id, token);
      const created = await registrationApi.createRegistration(token, params.id, idempotencyKey);
      setRegistration(created);
      if (created.registration_status === "confirmed") {
        clearIdempotencyKey(params.id, token);
      } else {
        setPaymentStatus({
          registration_id: created.registration_id,
          registration_status: "pending_payment",
          payment_status: created.payment_status,
          payment_url: created.payment_url,
          next_action: created.payment_status === "unknown" ? "wait_for_confirmation" : "redirect_to_payment"
        });
        if (created.payment_url && typeof window !== "undefined") {
          window.location.href = created.payment_url;
          return;
        }
      }
    } catch (e) {
      if (e instanceof Error && e.message.includes("IDEMPOTENCY_KEY_REUSED_WITH_DIFFERENT_REQUEST")) {
        setError("Registration session conflict detected for this account. Please refresh the page and try registering again.");
        return;
      }
      setError(e instanceof Error ? e.message : "Failed to register");
    } finally {
      setSubmitting(false);
    }
  }

  async function handleContinuePayment(): Promise<void> {
    const url = registration?.registration_status === "pending_payment" ? registration.payment_url : paymentStatus?.payment_url;
    if (!url || typeof window === "undefined") return;
    window.location.href = url;
  }

  useEffect(() => {
    if (!registration || registration.registration_status !== "pending_payment") return;
    const token = readCookie("access_token");
    if (!token) return;

    const search = typeof window !== "undefined" ? new URLSearchParams(window.location.search) : null;
    const shouldPollImmediately = Boolean(search?.get("payment_return"));
    let interval: ReturnType<typeof setInterval> | null = null;

    const invokePoll = () => {
      void pollPaymentStatus(registration.registration_id);
    };

    if (shouldPollImmediately) {
      invokePoll();
    }

    interval = setInterval(invokePoll, 5000);
    return () => {
      if (interval) clearInterval(interval);
    };
  }, [registration]);

  useEffect(() => {
    if (!registration || registration.registration_status !== "confirmed") return;
    let mounted = true;
    (async () => {
      try {
        const token = readCookie("access_token");
        if (!token) return;
        const qr = await registrationApi.getRegistrationQr(token, registration.registration_id);
        if (mounted) setQrData(qr);
      } catch {
        // Keep UI resilient; confirmation can still be shown even if QR fetch fails once.
      }
    })();
    return () => {
      mounted = false;
    };
  }, [registration]);

  if (loading) {
    return <main className="section"><div className="container grid"><div className="card"><p>Loading workshop...</p></div></div></main>;
  }

  if (!workshop) {
    return <main className="section"><div className="container grid"><div className="card"><p>{error || "Workshop not found"}</p></div></div></main>;
  }

  const confirmed = paymentStatus?.registration_status === "confirmed" || registration?.registration_status === "confirmed";
  const pendingPayment = hasPendingPayment && !confirmed;
  const qrImageUrl = qrData ? `https://api.qrserver.com/v1/create-qr-code/?size=240x240&data=${encodeURIComponent(qrData.qr_token)}` : null;

  return (
    <main className="section">
      <div className="container grid">
        <article className="card grid">
          <h1 style={{ margin: 0 }}>{workshop.title}</h1>
          <p>{workshop.description}</p>
          <p><strong>Speaker:</strong> {workshop.speakerName}</p>
          <p>
            <strong>Summary status:</strong>{" "}
            <span className={`status-pill ${workshop.summaryStatus === "ready" ? "status-success" : workshop.summaryStatus === "processing" ? "status-pending" : "status-fallback"}`}>
              {workshop.summaryStatus}
            </span>
          </p>
          <p><strong>Seats:</strong> {workshop.availableSeats} available / {workshop.capacity}</p>
          <p><strong>Type:</strong> {workshop.paymentRequired ? "Paid" : "Free"}</p>

          {workshop.summaryStatus === "processing" ? <p>Summary is processing...</p> : null}
          {workshop.summaryStatus === "fallback" ? <p>Auto summary unavailable. Please read workshop description.</p> : null}
          {workshop.aiSummary ? <article className="card"><h3>AI Summary</h3><p>{workshop.aiSummary}</p></article> : null}

          {!confirmed && (
            <button className="btn btn-primary" disabled={!canRegister || submitting} onClick={() => void handleRegister()}>
              {submitting ? "Submitting..." : canRegister ? "Register workshop" : hasActiveRegistration ? "Already registered" : "Workshop full"}
            </button>
          )}

          {pendingPayment && workshop.paymentRequired ? (
            <article className="card">
              <h3>Payment in progress</h3>
              <p>
                {paymentStatus?.payment_status === "unknown"
                  ? "Payment is being verified. Please wait while we reconcile the final result."
                  : "Continue checkout on MoMo to complete your registration."}
              </p>
              {paymentStatus?.payment_url || (registration?.registration_status === "pending_payment" && registration.payment_url) ? (
                <button className="btn btn-secondary" disabled={submitting} onClick={() => void handleContinuePayment()}>
                  Continue to MoMo Checkout
                </button>
              ) : null}
              <button className="btn" disabled={isPolling} onClick={() => void pollPaymentStatus(registration!.registration_id)}>
                {isPolling ? "Refreshing..." : "Refresh payment status"}
              </button>
            </article>
          ) : null}

          {paymentStatus?.registration_status === "cancelled" ? (
            <p>Payment failed or was cancelled. You can register again if seats are still available.</p>
          ) : null}
          {paymentStatus?.payment_status === "requires_review" ? (
            <p>Payment was received after reservation expiry. Our team will review and contact you.</p>
          ) : null}

          {confirmed ? <p>Registration confirmed. QR is available.</p> : null}
          {qrImageUrl ? (
            <article className="card">
              <h3>Your Check-in QR</h3>
              <img src={qrImageUrl} alt="Workshop check-in QR code" width={240} height={240} />
              <p className="muted">Issued at: {new Date(qrData!.qr_issued_at).toLocaleString()}</p>
            </article>
          ) : null}
          {error ? <p style={{ color: "var(--color-danger)" }}>{error}</p> : null}
        </article>
      </div>
    </main>
  );
}
