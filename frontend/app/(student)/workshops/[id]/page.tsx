"use client";

import {
  ApiRequestError,
  getWorkshopPublic,
  registrationApi,
  type CreateRegistrationResult,
  type RegistrationGateResponse,
  type RegistrationPaymentStatus,
  type RegistrationQrData
} from "@/lib/api";
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

function formatWorkshopDateTimeRange(startsAt: string, endsAt: string): string {
  try {
    const start = new Date(startsAt);
    const end = new Date(endsAt);
    const dateLabel = start.toLocaleDateString(undefined, {
      weekday: "long",
      month: "long",
      day: "2-digit",
      year: "numeric"
    });
    const startTimeLabel = start.toLocaleTimeString(undefined, { hour: "2-digit", minute: "2-digit" });
    const endTimeLabel = end.toLocaleTimeString(undefined, { hour: "2-digit", minute: "2-digit" });
    return `${dateLabel}, ${startTimeLabel} - ${endTimeLabel}`;
  } catch {
    return `${startsAt} - ${endsAt}`;
  }
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
  const [gateState, setGateState] = useState<RegistrationGateResponse | null>(null);
  const [admissionToken, setAdmissionToken] = useState<string | null>(null);

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
          try {
            const gate = await registrationApi.getRegistrationGate(token, params.id);
            if (mounted) {
              setGateState(gate);
            }
          } catch {
            // Gate checks are best-effort; registration flow can still handle server responses.
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
  const isGateWaiting = gateState?.status === "waiting";
  const canRegister = useMemo(
    () => Boolean(workshop && workshop.availableSeats > 0 && !hasActiveRegistration && !isGateWaiting),
    [workshop, hasActiveRegistration, isGateWaiting]
  );
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
      let tokenToUse = admissionToken;
      if (!tokenToUse) {
        const admission = await registrationApi.requestAdmission(token, params.id);
        setGateState(admission as RegistrationGateResponse);
        if (admission.status === "full") {
          setError("Workshop is full.");
          return;
        }
        if (admission.status === "waiting") {
          setError(`You are in queue (position ${admission.queue_position}). Please wait for admission.`);
          return;
        }
        if (admission.status === "admitted") {
          tokenToUse = admission.admission_token;
          setAdmissionToken(admission.admission_token);
        }
      }

      const created = tokenToUse
        ? await registrationApi.createRegistrationWithAdmission(token, params.id, idempotencyKey, tokenToUse)
        : await registrationApi.createRegistration(token, params.id, idempotencyKey);
      setRegistration(created);
      setGateState({ status: "open" });
      if (created.registration_status === "confirmed") {
        clearIdempotencyKey(params.id, token);
        setAdmissionToken(null);
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
      if (e instanceof ApiRequestError && e.code === "PAYMENT_GATEWAY_UNAVAILABLE") {
        const retryText = e.retryAfterSeconds ? ` Please try again in about ${e.retryAfterSeconds} seconds.` : "";
        setError(`${e.message}.${retryText}`);
        return;
      }
      if (e instanceof ApiRequestError && e.code === "RATE_LIMITED") {
        const retryText = e.retryAfterSeconds ? ` Retry in about ${e.retryAfterSeconds} seconds.` : "";
        setError(`You are sending requests too quickly.${retryText}`);
        return;
      }
      if (e instanceof ApiRequestError && e.code === "REGISTRATION_BUSY") {
        const retryText = e.retryAfterSeconds ? ` Retry in about ${e.retryAfterSeconds} seconds.` : "";
        setError(`System is busy handling peak registrations.${retryText}`);
        return;
      }
      setError(e instanceof Error ? e.message : "Failed to register");
    } finally {
      setSubmitting(false);
    }
  }

  useEffect(() => {
    if (!gateState || gateState.status !== "waiting") return;
    if (hasActiveRegistration) return;
    const token = readCookie("access_token");
    if (!token) return;

    let cancelled = false;
    let timeout: ReturnType<typeof setTimeout> | null = null;

    const poll = async () => {
      try {
        const admission = await registrationApi.requestAdmission(token, params.id);
        if (cancelled) return;
        setGateState(admission as RegistrationGateResponse);
        if (admission.status === "admitted") {
          setAdmissionToken(admission.admission_token);
          return;
        }
      } catch {
        // keep waiting UI resilient; manual retry remains available
      }
      const baseMs = (gateState.retry_after ?? 5) * 1000;
      const jitterMs = Math.floor(Math.random() * 1200);
      timeout = setTimeout(() => {
        void poll();
      }, baseMs + jitterMs);
    };

    void poll();
    return () => {
      cancelled = true;
      if (timeout) clearTimeout(timeout);
    };
  }, [gateState, hasActiveRegistration, params.id]);

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
          <p><strong>Schedule:</strong> {formatWorkshopDateTimeRange(workshop.startsAt, workshop.endsAt)}</p>
          <p><strong>Room:</strong> {workshop.room}</p>
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
              {submitting
                ? "Submitting..."
                : isGateWaiting
                  ? "Waiting for admission"
                  : canRegister
                    ? "Register workshop"
                    : hasActiveRegistration
                      ? "Already registered"
                      : "Workshop full"}
            </button>
          )}

          {gateState?.status === "waiting" ? (
            <article className="card">
              <h3>Waiting Room</h3>
              <p>Queue position: {gateState.queue_position}</p>
              <p>We will check again every {gateState.retry_after} seconds.</p>
              <button
                className="btn"
                disabled={submitting}
                onClick={() => {
                  const token = readCookie("access_token");
                  if (!token) return;
                  void (async () => {
                    const admission = await registrationApi.requestAdmission(token, params.id);
                    setGateState(admission as RegistrationGateResponse);
                    if (admission.status === "admitted") {
                      setAdmissionToken(admission.admission_token);
                    }
                  })();
                }}
              >
                Refresh queue status
              </button>
            </article>
          ) : null}

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
