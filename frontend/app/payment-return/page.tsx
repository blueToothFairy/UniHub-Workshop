"use client";

import { registrationApi, type RegistrationPaymentStatus, type RegistrationQrData } from "@/lib/api";
import Link from "next/link";
import { useEffect, useMemo, useState } from "react";

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

function extractRegistrationId(orderId: string | null): string | null {
  if (!orderId) return null;
  if (!orderId.startsWith("momo-")) return null;
  const registrationId = orderId.slice("momo-".length);
  return registrationId.length > 0 ? registrationId : null;
}

export default function PaymentReturnPage() {
  const [status, setStatus] = useState<RegistrationPaymentStatus | null>(null);
  const [qr, setQr] = useState<RegistrationQrData | null>(null);
  const [error, setError] = useState<string>("");
  const [loading, setLoading] = useState<boolean>(true);

  const registrationId = useMemo(() => {
    if (typeof window === "undefined") return null;
    const search = new URLSearchParams(window.location.search);
    const orderId = search.get("orderId");
    return extractRegistrationId(orderId);
  }, []);

  useEffect(() => {
    let mounted = true;
    const token = readCookie("access_token");
    if (!token) {
      setError("Bạn cần đăng nhập để kiểm tra trạng thái thanh toán.");
      setLoading(false);
      return () => {
        mounted = false;
      };
    }
    if (!registrationId) {
      setError("Không tìm thấy thông tin đơn hàng trả về từ MoMo.");
      setLoading(false);
      return () => {
        mounted = false;
      };
    }

    const poll = async () => {
      try {
        const s = await registrationApi.getPaymentStatus(token, registrationId);
        if (!mounted) return;
        setStatus(s);
        if (s.registration_status === "confirmed") {
          const qrData = await registrationApi.getRegistrationQr(token, registrationId);
          if (mounted) setQr(qrData);
        }
      } catch (e) {
        if (mounted) setError(e instanceof Error ? e.message : "Không thể tải trạng thái thanh toán");
      } finally {
        if (mounted) setLoading(false);
      }
    };

    void poll();
    const timer = setInterval(() => {
      if (!mounted) return;
      if (status?.registration_status === "confirmed" || status?.registration_status === "cancelled" || status?.registration_status === "expired") {
        return;
      }
      void poll();
    }, 5000);

    return () => {
      mounted = false;
      clearInterval(timer);
    };
  }, [registrationId, status?.registration_status]);

  const qrImageUrl = qr ? `https://api.qrserver.com/v1/create-qr-code/?size=240x240&data=${encodeURIComponent(qr.qr_token)}` : null;

  return (
    <main className="section">
      <div className="container grid">
        <article className="card grid">
          <h1 style={{ margin: 0 }}>MoMo Payment Result</h1>
          {loading ? <p>Checking payment status...</p> : null}
          {error ? <p style={{ color: "var(--color-danger)" }}>{error}</p> : null}

          {status ? (
            <>
              <p><strong>Registration ID:</strong> {status.registration_id}</p>
              <p><strong>Registration Status:</strong> {status.registration_status}</p>
              <p><strong>Payment Status:</strong> {status.payment_status}</p>
            </>
          ) : null}

          {status?.registration_status === "pending_payment" ? (
            <p>The system is waiting for a callback or reconciliation. You can wait a few minutes and then reload the page.</p>
          ) : null}
          {status?.registration_status === "cancelled" ? (
            <p>Payment failed or was cancelled. You can try registering again if the workshop still has availability.</p>
          ) : null}
          {status?.payment_status === "requires_review" ? (
            <p>Payment succeeded but after the booking expired. The system has moved the application to the review status.</p>
          ) : null}

          {qrImageUrl ? (
            <article className="card">
              <h3>QR Check-in</h3>
              <img src={qrImageUrl} alt="Workshop check-in QR code" width={240} height={240} />
              <p className="muted">Issued at: {new Date(qr!.qr_issued_at).toLocaleString()}</p>
            </article>
          ) : null}

          <p>
            <Link href="/" className="btn btn-primary">Về trang workshops</Link>
          </p>
        </article>
      </div>
    </main>
  );
}
