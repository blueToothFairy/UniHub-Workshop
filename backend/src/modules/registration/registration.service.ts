import { createHash, randomUUID } from "node:crypto";
import jwt from "jsonwebtoken";
import type { PoolClient } from "pg";
import { AppError } from "../../shared/errors/AppError.js";
import { dbPool } from "../../shared/infra/db.js";
import type { IQueue } from "../../shared/interfaces/IQueue.js";
import type { IMomoAdapter } from "../payment/momo.adapter.js";
import { isTerminalPaymentStatus, type InternalPaymentStatus, type MomoCallbackPayload } from "../payment/payment.types.js";
import type { CircuitState, IPaymentCircuitBreaker } from "../payment/payment-circuit-breaker.types.js";
import { PaymentGatewayUnavailableError } from "../payment/payment-circuit-breaker.service.js";
import type {
  CreateRegistrationResponse,
  CurrentRegistrationResponse,
  PaymentStatusResponse,
  RegistrationQrResponse
} from "./registration.types.js";

type RegistrationStatus = "pending_payment" | "confirmed" | "cancelled" | "expired";

interface WorkshopRow {
  id: string;
  capacity: number;
  reserved_count: number;
  confirmed_count: number;
  price_vnd: number;
  payment_required: boolean;
  status: "draft" | "published" | "cancelled";
  ends_at: Date;
}

interface ExistingIdempotentRow {
  id: string;
  request_hash: string;
  registration_id: string;
  registration_status: RegistrationStatus;
}

interface RegistrationRow {
  id: string;
  user_id: string;
  workshop_id: string;
  status: RegistrationStatus;
  reservation_expires_at: Date | null;
  qr_token: string | null;
}

interface PaymentRow {
  id: string;
  registration_id: string;
  workshop_id: string;
  user_id: string;
  amount_vnd: number;
  currency: string;
  status: InternalPaymentStatus;
  payment_url: string | null;
  provider_order_id: string | null;
}

interface RegistrationWithPaymentRow {
  registration_id: string;
  workshop_id: string;
  user_id: string;
  registration_status: RegistrationStatus;
  payment_id: string;
  payment_status: InternalPaymentStatus;
  payment_url: string | null;
  amount_vnd: number;
  currency: string;
  qr_token: string | null;
}

interface RegistrationServiceOptions {
  momoAdapter?: IMomoAdapter;
  paymentGatewayMode?: "momo_sandbox" | "simulation";
  paymentCircuitBreaker?: IPaymentCircuitBreaker;
  reservationTtlMinutes?: number;
  now?: () => Date;
}

interface ConfirmationEventPayload {
  registrationId: string;
  workshopId: string;
  userId: string;
  confirmedAt: string;
}

export class RegistrationService {
  private readonly momoAdapter?: IMomoAdapter;
  private readonly paymentGatewayMode: "momo_sandbox" | "simulation";
  private readonly paymentCircuitBreaker?: IPaymentCircuitBreaker;
  private readonly reservationTtlMinutes: number;
  private readonly now: () => Date;

  public constructor(
    private readonly queue: IQueue,
    options: RegistrationServiceOptions = {}
  ) {
    this.momoAdapter = options.momoAdapter;
    this.paymentGatewayMode = options.paymentGatewayMode ?? "momo_sandbox";
    this.paymentCircuitBreaker = options.paymentCircuitBreaker;
    this.reservationTtlMinutes = options.reservationTtlMinutes ?? 10;
    this.now = options.now ?? (() => new Date());
  }

  public async createRegistration(params: {
    workshopId: string;
    userId: string;
    idempotencyKey: string;
  }): Promise<CreateRegistrationResponse> {
    await this.expireStaleRegistrations();
    const requestHash = this.computeRequestHash(params.userId, params.workshopId);

    const existing = await dbPool.query<ExistingIdempotentRow>(
      `SELECT p.id, p.request_hash, p.registration_id, r.status AS registration_status
       FROM payments p
       JOIN registrations r ON r.id = p.registration_id
       WHERE p.idempotency_key=$1
       LIMIT 1`,
      [params.idempotencyKey]
    );
    const existingRow = existing.rows[0];
    if (existingRow) {
      if (existingRow.request_hash !== requestHash) {
        throw new AppError(409, "IDEMPOTENCY_KEY_REUSED_WITH_DIFFERENT_REQUEST", "Idempotency-Key reused for a different request");
      }
      if (existingRow.registration_status === "pending_payment" || existingRow.registration_status === "confirmed") {
        return this.getReplayResponse(existingRow.registration_id);
      }
      await this.releaseTerminalIdempotencyKey(existingRow.id, params.idempotencyKey);
    }

    const client = await dbPool.connect();
    let paidAdmissionState: CircuitState = "CLOSED";
    let created: {
      registrationId: string;
      paymentId: string | null;
      paymentRequired: boolean;
      workshopId: string;
      userId: string;
      confirmedAt: string | null;
      providerOrderId: string | null;
      amountVnd: number | null;
    } | null = null;
    try {
      await client.query("BEGIN");
      const workshop = await this.lockPublishedWorkshop(client, params.workshopId);

      const active = await client.query<RegistrationRow>(
        `SELECT id, user_id, workshop_id, status, reservation_expires_at, qr_token
         FROM registrations
         WHERE user_id=$1 AND workshop_id=$2 AND status IN ('pending_payment','confirmed')
         LIMIT 1
         FOR UPDATE`,
        [params.userId, params.workshopId]
      );
      const activeRow = active.rows[0];
      if (activeRow) {
        if (activeRow.status === "confirmed") {
          throw new AppError(409, "ALREADY_REGISTERED", "You have already registered for this workshop");
        }
        const payment = await client.query<PaymentRow>(
          "SELECT id, registration_id, workshop_id, user_id, amount_vnd, currency, status, payment_url, provider_order_id FROM payments WHERE registration_id=$1 LIMIT 1",
          [activeRow.id]
        );
        const paymentRow = payment.rows[0];
        if (!paymentRow) {
          throw new AppError(500, "PAYMENT_NOT_FOUND", "Active pending registration is missing payment state");
        }
        await client.query("ROLLBACK");
        const recovered = await this.recoverPaymentUrlIfMissing({
          paymentId: paymentRow.id,
          registrationId: activeRow.id,
          workshopId: activeRow.workshop_id,
          providerOrderId: paymentRow.provider_order_id,
          amountVnd: paymentRow.amount_vnd,
          paymentStatus: paymentRow.status,
          paymentUrl: paymentRow.payment_url
        });
        return {
          registration_id: activeRow.id,
          registration_status: "pending_payment",
          payment_required: true,
          payment_id: paymentRow.id,
          payment_status: recovered.paymentStatus,
          payment_url: recovered.paymentUrl,
          next_action: "redirect_to_payment"
        };
      }

      const registrationId = randomUUID();
      const now = this.now();
      const nowIso = now.toISOString();
      const reservationExpiry = new Date(now.getTime() + this.reservationTtlMinutes * 60 * 1000).toISOString();

      if (!workshop.payment_required) {
        await client.query("UPDATE workshops SET reserved_count = reserved_count + 1 WHERE id=$1", [params.workshopId]);
        const qrToken = this.signQrToken({
          registrationId,
          workshopId: params.workshopId,
          userId: params.userId,
          endsAtIso: workshop.ends_at.toISOString()
        });
        const qrHash = this.computeQrHash(qrToken);
        await client.query(
          `INSERT INTO registrations (
            id, user_id, workshop_id, status, reservation_expires_at, confirmed_at, qr_token, qr_token_hash, qr_issued_at, created_at, updated_at
          ) VALUES ($1,$2,$3,'confirmed',NULL,$4,$5,$6,$4,$4,$4)`,
          [registrationId, params.userId, params.workshopId, nowIso, qrToken, qrHash]
        );
        await client.query("UPDATE workshops SET confirmed_count = confirmed_count + 1 WHERE id=$1", [params.workshopId]);

        const paymentId = randomUUID();
        await client.query(
          `INSERT INTO payments (
            id, registration_id, user_id, workshop_id, idempotency_key, request_hash,
            merchant_order_id, provider_order_id, gateway, amount_vnd, currency, status,
            paid_at, provider_result_code, provider_message, created_at, updated_at
          ) VALUES ($1,$2,$3,$4,$5,$6,$7,$7,'simulation',$8,'VND','completed',$9,'SIMULATION','Free workshop registration',$9,$9)`,
          [
            paymentId,
            registrationId,
            params.userId,
            params.workshopId,
            params.idempotencyKey,
            requestHash,
            `sim-${registrationId}`,
            workshop.price_vnd,
            nowIso
          ]
        );

        await client.query("COMMIT");

        await this.queue.enqueueRegistrationConfirmed({
          registrationId,
          workshopId: params.workshopId,
          userId: params.userId,
          confirmedAt: nowIso
        });

        return {
          registration_id: registrationId,
          registration_status: "confirmed",
          payment_required: false,
          qr_available: true
        };
      }
      paidAdmissionState = await this.acquirePaidGatewayAdmission();
      await client.query("UPDATE workshops SET reserved_count = reserved_count + 1 WHERE id=$1", [params.workshopId]);

      const providerOrderId = `momo-${registrationId}`;
      const paymentId = randomUUID();
      await client.query(
        `INSERT INTO registrations (
          id, user_id, workshop_id, status, reservation_expires_at, created_at, updated_at
        ) VALUES ($1,$2,$3,'pending_payment',$4,$5,$5)`,
        [registrationId, params.userId, params.workshopId, reservationExpiry, nowIso]
      );

      const initialStatus: InternalPaymentStatus = this.paymentGatewayMode === "momo_sandbox" ? "pending_provider" : "pending_simulation";
      await client.query(
        `INSERT INTO payments (
          id, registration_id, user_id, workshop_id, idempotency_key, request_hash, merchant_order_id,
          provider_order_id, gateway, amount_vnd, currency, status, created_at, updated_at
        ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,'VND',$11,$12,$12)`,
        [
          paymentId,
          registrationId,
          params.userId,
          params.workshopId,
          params.idempotencyKey,
          requestHash,
          providerOrderId,
          providerOrderId,
          this.paymentGatewayMode,
          workshop.price_vnd,
          initialStatus,
          nowIso
        ]
      );

      await client.query("COMMIT");
      created = {
        registrationId,
        paymentId,
        paymentRequired: true,
        workshopId: params.workshopId,
        userId: params.userId,
        confirmedAt: null,
        providerOrderId,
        amountVnd: workshop.price_vnd
      };
    } catch (error) {
      await client.query("ROLLBACK");
      throw error;
    } finally {
      client.release();
    }

    if (!created || !created.paymentRequired || !created.paymentId || !created.providerOrderId || created.amountVnd === null) {
      throw new AppError(500, "REGISTRATION_CREATION_FAILED", "Registration creation failed unexpectedly");
    }
    const amountVnd = created.amountVnd;

    if (this.paymentGatewayMode === "simulation" || !this.momoAdapter) {
      return {
        registration_id: created.registrationId,
        registration_status: "pending_payment",
        payment_required: true,
        payment_id: created.paymentId,
        payment_status: "unknown",
        payment_url: null,
        next_action: "redirect_to_payment"
      };
    }

    try {
      const response = await this.momoAdapter.createOrder({
        requestId: randomUUID(),
        orderId: created.providerOrderId,
        amount: amountVnd,
        orderInfo: `Workshop ${created.workshopId} registration`,
        extraData: created.registrationId
      });
      const nowIso = this.now().toISOString();

      if (response.resultCode === "0" && response.payUrl) {
        await this.paymentCircuitBreaker?.recordSuccess({ admissionState: paidAdmissionState });
        await dbPool.query(
          `UPDATE payments
           SET payment_url=$2, provider_request_id=$3, provider_result_code=$4, provider_message=$5,
               provider_trans_id=$6, provider_raw_response=$7::jsonb, status='pending_provider', updated_at=$8
           WHERE id=$1`,
          [
            created.paymentId,
            response.payUrl,
            response.requestId,
            response.resultCode,
            response.message,
            response.transId ? String(response.transId) : null,
            JSON.stringify(response),
            nowIso
          ]
        );
        return {
          registration_id: created.registrationId,
          registration_status: "pending_payment",
          payment_required: true,
          payment_id: created.paymentId,
          payment_status: "pending_provider",
          payment_url: response.payUrl,
          next_action: "redirect_to_payment"
        };
      }

      await this.paymentCircuitBreaker?.recordFailure({ admissionState: paidAdmissionState, reason: "provider_error" });
      await dbPool.query(
        `UPDATE payments
         SET provider_request_id=$2, provider_result_code=$3, provider_message=$4,
             provider_raw_response=$5::jsonb, status='unknown', updated_at=$6
         WHERE id=$1`,
        [created.paymentId, response.requestId, response.resultCode, response.message, JSON.stringify(response), nowIso]
      );
      return {
        registration_id: created.registrationId,
        registration_status: "pending_payment",
        payment_required: true,
        payment_id: created.paymentId,
        payment_status: "unknown",
        payment_url: response.payUrl ?? null,
        next_action: "redirect_to_payment"
      };
    } catch (error) {
      await this.paymentCircuitBreaker?.recordFailure({ admissionState: paidAdmissionState, reason: this.classifyGatewayFailureReason(error) });
      await dbPool.query(
        `UPDATE payments
         SET status='unknown', provider_message=$2, updated_at=$3
         WHERE id=$1`,
        [
          created.paymentId,
          error instanceof Error ? error.message : "MoMo create-order call failed",
          this.now().toISOString()
        ]
      );
      return {
        registration_id: created.registrationId,
        registration_status: "pending_payment",
        payment_required: true,
        payment_id: created.paymentId,
        payment_status: "unknown",
        payment_url: null,
        next_action: "redirect_to_payment"
      };
    }
  }

  public async handleMomoCallback(payload: MomoCallbackPayload): Promise<void> {
    if (!this.momoAdapter || !this.momoAdapter.verifyCallbackSignature(payload)) {
      throw new AppError(400, "INVALID_SIGNATURE", "MoMo callback signature verification failed");
    }

    const client = await dbPool.connect();
    let confirmationEvent: ConfirmationEventPayload | null = null;
    try {
      await client.query("BEGIN");
      const row = await this.findPaymentForProviderOrder(client, payload.orderId);
      if (!row) {
        throw new AppError(404, "PAYMENT_NOT_FOUND", "Payment mapping not found for callback order");
      }
      if (row.amount_vnd !== payload.amount) {
        throw new AppError(409, "PAYMENT_AMOUNT_MISMATCH", "Callback amount does not match payment amount");
      }
      if (row.currency !== "VND") {
        throw new AppError(409, "PAYMENT_CURRENCY_MISMATCH", "Unsupported currency for callback");
      }

      const mappedStatus = this.momoAdapter.mapPaymentStatus(payload.resultCode);
      confirmationEvent = await this.applyProviderResult(client, row, mappedStatus, payload);
      await client.query("COMMIT");
    } catch (error) {
      await client.query("ROLLBACK");
      throw error;
    } finally {
      client.release();
    }
    if (confirmationEvent) {
      await this.queue.enqueueRegistrationConfirmed(confirmationEvent);
    }
  }

  public async getPaymentStatus(params: { registrationId: string; userId: string }): Promise<PaymentStatusResponse> {
    await this.expireStaleRegistrations();
    const result = await dbPool.query<{
      registration_id: string;
      registration_status: RegistrationStatus;
      payment_status: InternalPaymentStatus;
      payment_url: string | null;
    }>(
      `SELECT r.id AS registration_id, r.status AS registration_status, p.status AS payment_status, p.payment_url
       FROM registrations r
       JOIN payments p ON p.registration_id = r.id
       WHERE r.id=$1 AND r.user_id=$2
       LIMIT 1`,
      [params.registrationId, params.userId]
    );
    const row = result.rows[0];
    if (!row) {
      throw new AppError(404, "REGISTRATION_NOT_FOUND", "Registration not found");
    }

    if (row.registration_status === "confirmed") {
      return {
        registration_id: row.registration_id,
        registration_status: "confirmed",
        payment_status: "completed",
        qr_available: true
      };
    }

    if (row.registration_status === "expired") {
      return {
        registration_id: row.registration_id,
        registration_status: "expired",
        payment_status: "expired",
        next_action: "register_again"
      };
    }

    if (row.registration_status === "cancelled") {
      return {
        registration_id: row.registration_id,
        registration_status: "cancelled",
        payment_status: row.payment_status === "requires_review" ? "requires_review" : "failed",
        next_action: row.payment_status === "requires_review" ? "contact_support" : "register_again"
      };
    }

    if (row.payment_status === "unknown") {
      return {
        registration_id: row.registration_id,
        registration_status: "pending_payment",
        payment_status: "unknown",
        payment_url: row.payment_url,
        next_action: "wait_for_confirmation"
      };
    }

    return {
      registration_id: row.registration_id,
      registration_status: "pending_payment",
      payment_status: "pending_provider",
      payment_url: row.payment_url,
      next_action: "redirect_to_payment"
    };
  }

  public async getRegistrationQr(params: { registrationId: string; userId: string }): Promise<RegistrationQrResponse> {
    await this.expireStaleRegistrations();
    const result = await dbPool.query<{
      id: string;
      status: RegistrationStatus;
      user_id: string;
      qr_token: string | null;
      qr_issued_at: Date | null;
    }>(
      `SELECT id, status, user_id, qr_token, qr_issued_at
       FROM registrations
       WHERE id=$1 AND user_id=$2
       LIMIT 1`,
      [params.registrationId, params.userId]
    );
    const row = result.rows[0];
    if (!row) {
      throw new AppError(404, "REGISTRATION_NOT_FOUND", "Registration not found");
    }
    if (row.status !== "confirmed" || !row.qr_token || !row.qr_issued_at) {
      throw new AppError(409, "QR_NOT_AVAILABLE", "QR is not available for this registration state");
    }
    return {
      registration_id: row.id,
      qr_token: row.qr_token,
      qr_issued_at: row.qr_issued_at.toISOString()
    };
  }

  public async getCurrentRegistrationForWorkshop(params: {
    workshopId: string;
    userId: string;
  }): Promise<CurrentRegistrationResponse> {
    await this.expireStaleRegistrations();
    const result = await dbPool.query<{
      registration_id: string;
      workshop_id: string;
      registration_status: "pending_payment" | "confirmed";
      payment_id: string;
      payment_status: InternalPaymentStatus;
      payment_url: string | null;
      provider_order_id: string | null;
      amount_vnd: number;
      qr_token: string | null;
    }>(
      `SELECT
         r.id AS registration_id,
         r.workshop_id AS workshop_id,
         r.status AS registration_status,
         p.id AS payment_id,
         p.status AS payment_status,
          p.payment_url AS payment_url,
         p.provider_order_id AS provider_order_id,
         p.amount_vnd AS amount_vnd,
         r.qr_token AS qr_token
       FROM registrations r
       JOIN payments p ON p.registration_id = r.id
       WHERE r.user_id=$1
         AND r.workshop_id=$2
         AND r.status IN ('pending_payment', 'confirmed')
       ORDER BY r.updated_at DESC
       LIMIT 1`,
      [params.userId, params.workshopId]
    );
    const row = result.rows[0];
    if (!row) {
      throw new AppError(404, "REGISTRATION_NOT_FOUND", "No active registration for this workshop");
    }
    const recovered = row.registration_status === "pending_payment"
      ? await this.recoverPaymentUrlIfMissing({
        paymentId: row.payment_id,
        registrationId: row.registration_id,
        workshopId: row.workshop_id,
        providerOrderId: row.provider_order_id,
        amountVnd: row.amount_vnd,
        paymentStatus: row.payment_status,
        paymentUrl: row.payment_url
      })
      : { paymentStatus: "pending_provider" as const, paymentUrl: row.payment_url };

    const paymentStatus = row.registration_status === "confirmed"
      ? "completed"
      : recovered.paymentStatus === "unknown"
        ? "unknown"
        : "pending_provider";

    return {
      registration_id: row.registration_id,
      workshop_id: row.workshop_id,
      registration_status: row.registration_status,
      payment_status: paymentStatus,
      payment_url: recovered.paymentUrl,
      qr_available: row.registration_status === "confirmed" && Boolean(row.qr_token)
    };
  }

  public async runReconciliationBatch(limit = 50): Promise<{ scanned: number; updated: number }> {
    if (!this.momoAdapter) {
      return { scanned: 0, updated: 0 };
    }

    const client = await dbPool.connect();
    try {
      await client.query("BEGIN");
      const candidates = await client.query<RegistrationWithPaymentRow>(
        `SELECT
           r.id AS registration_id,
           r.workshop_id,
           r.user_id,
           r.status AS registration_status,
           p.id AS payment_id,
           p.status AS payment_status,
           p.payment_url,
           p.amount_vnd,
           p.currency,
           r.qr_token
         FROM registrations r
         JOIN payments p ON p.registration_id = r.id
         WHERE p.status IN ('pending_provider','unknown')
         ORDER BY p.updated_at ASC
         FOR UPDATE OF p, r SKIP LOCKED
         LIMIT $1`,
        [limit]
      );
      await client.query("COMMIT");

      let updated = 0;
      for (const row of candidates.rows) {
        const providerOrderResult = await dbPool.query<{ provider_order_id: string | null }>(
          "SELECT provider_order_id FROM payments WHERE id=$1 LIMIT 1",
          [row.payment_id]
        );
        const providerOrderId = providerOrderResult.rows[0]?.provider_order_id;
        if (!providerOrderId) {
          continue;
        }
        try {
          const status = await this.momoAdapter.queryTransaction({
            orderId: providerOrderId,
            requestId: randomUUID(),
            lang: "vi"
          });
          const lockClient = await dbPool.connect();
          let confirmationEvent: ConfirmationEventPayload | null = null;
          try {
            await lockClient.query("BEGIN");
            const lockedRow = await this.findPaymentForProviderOrder(lockClient, providerOrderId);
            if (lockedRow) {
              const mapped = this.momoAdapter.mapPaymentStatus(status.resultCode);
              confirmationEvent = await this.applyProviderResult(lockClient, lockedRow, mapped, {
                partnerCode: status.partnerCode,
                orderId: status.orderId,
                requestId: status.requestId,
                amount: status.amount,
                orderInfo: "reconciliation",
                resultCode: status.resultCode,
                message: status.message,
                payType: status.payType,
                transId: status.transId,
                responseTime: status.responseTime,
                extraData: "",
                signature: "reconciliation"
              });
              await lockClient.query(
                "UPDATE payments SET reconciliation_attempts = reconciliation_attempts + 1, reconciled_at=NOW(), updated_at=NOW() WHERE id=$1",
                [lockedRow.payment_id]
              );
            }
            await lockClient.query("COMMIT");
          } catch (error) {
            await lockClient.query("ROLLBACK");
            throw error;
          } finally {
            lockClient.release();
          }
          if (confirmationEvent) {
            await this.queue.enqueueRegistrationConfirmed(confirmationEvent);
          }
          updated += 1;
        } catch {
          await dbPool.query(
            `UPDATE payments
             SET reconciliation_attempts = reconciliation_attempts + 1, updated_at=NOW()
             WHERE id=$1`,
            [row.payment_id]
          );
        }
      }

      const unknownBacklogResult = await dbPool.query<{ count: string }>("SELECT COUNT(*)::text AS count FROM payments WHERE status='unknown'");
      const unknownBacklog = Number(unknownBacklogResult.rows[0]?.count ?? "0");
      const breakerSnapshot = this.paymentCircuitBreaker ? await this.paymentCircuitBreaker.getSnapshot() : null;
      // eslint-disable-next-line no-console
      console.info(JSON.stringify({
        type: "payment_reconciliation_summary",
        scanned: candidates.rowCount ?? 0,
        updated,
        unknownBacklog,
        breakerState: breakerSnapshot?.state ?? "unconfigured",
        breakerOpenedAtMs: breakerSnapshot?.openedAtMs ?? null
      }));

      return { scanned: candidates.rowCount ?? 0, updated };
    } finally {
      client.release();
    }
  }

  public async expireStaleRegistrations(): Promise<void> {
    const client = await dbPool.connect();
    try {
      await client.query("BEGIN");
      const stale = await client.query<{ id: string; workshop_id: string }>(
        `SELECT id, workshop_id
         FROM registrations
         WHERE status='pending_payment'
           AND reservation_expires_at IS NOT NULL
           AND reservation_expires_at < NOW()
         FOR UPDATE SKIP LOCKED`
      );

      for (const row of stale.rows) {
        const registrationUpdate = await client.query<{ workshop_id: string }>(
          `UPDATE registrations
           SET status='expired', expired_at=NOW(), updated_at=NOW()
           WHERE id=$1 AND status='pending_payment'
           RETURNING workshop_id`,
          [row.id]
        );
        if (registrationUpdate.rowCount === 0) {
          continue;
        }

        await client.query(
          `UPDATE payments
           SET status='expired', expired_at=NOW(), updated_at=NOW()
           WHERE registration_id=$1
             AND status IN ('pending_provider','unknown','pending_simulation')`,
          [row.id]
        );
        await client.query(
          "UPDATE workshops SET reserved_count = GREATEST(reserved_count - 1, 0) WHERE id=$1",
          [registrationUpdate.rows[0].workshop_id]
        );
      }

      await client.query("COMMIT");
    } catch (error) {
      await client.query("ROLLBACK");
      throw error;
    } finally {
      client.release();
    }
  }

  private async getReplayResponse(registrationId: string): Promise<CreateRegistrationResponse> {
    const result = await dbPool.query<{
      registration_id: string;
      registration_status: RegistrationStatus;
      payment_id: string;
      payment_status: InternalPaymentStatus;
      payment_url: string | null;
      provider_order_id: string | null;
      amount_vnd: number;
      workshop_id: string;
    }>(
      `SELECT r.id AS registration_id, r.status AS registration_status, r.workshop_id AS workshop_id,
              p.id AS payment_id, p.status AS payment_status, p.payment_url, p.provider_order_id, p.amount_vnd
       FROM registrations r
       JOIN payments p ON p.registration_id = r.id
       WHERE r.id=$1
       LIMIT 1`,
      [registrationId]
    );
    const row = result.rows[0];
    if (!row) {
      throw new AppError(404, "REGISTRATION_NOT_FOUND", "Registration not found");
    }
    if (row.registration_status === "confirmed") {
      return {
        registration_id: row.registration_id,
        registration_status: "confirmed",
        payment_required: false,
        qr_available: true
      };
    }
    if (row.registration_status === "expired") {
      throw new AppError(409, "REGISTRATION_EXPIRED", "Previous registration has expired. Submit again to create a new payment session");
    }
    if (row.registration_status === "cancelled") {
      throw new AppError(409, "REGISTRATION_CANCELLED", "Previous registration was cancelled. Submit again to create a new payment session");
    }
    const recovered = await this.recoverPaymentUrlIfMissing({
      paymentId: row.payment_id,
      registrationId: row.registration_id,
      workshopId: row.workshop_id,
      providerOrderId: row.provider_order_id,
      amountVnd: row.amount_vnd,
      paymentStatus: row.payment_status,
      paymentUrl: row.payment_url
    });
    return {
      registration_id: row.registration_id,
      registration_status: "pending_payment",
      payment_required: true,
      payment_id: row.payment_id,
      payment_status: recovered.paymentStatus,
      payment_url: recovered.paymentUrl,
      next_action: "redirect_to_payment"
    };
  }

  private async releaseTerminalIdempotencyKey(paymentId: string, idempotencyKey: string): Promise<void> {
    const archivedKey = `${idempotencyKey}::terminal::${randomUUID()}`;
    await dbPool.query(
      `UPDATE payments p
       SET idempotency_key=$2, updated_at=$3
       FROM registrations r
       WHERE p.id=$1
         AND p.idempotency_key=$4
         AND r.id = p.registration_id
         AND r.status IN ('expired', 'cancelled')`,
      [paymentId, archivedKey, this.now().toISOString(), idempotencyKey]
    );
  }

  private async recoverPaymentUrlIfMissing(input: {
    paymentId: string;
    registrationId: string;
    workshopId: string;
    providerOrderId: string | null;
    amountVnd: number;
    paymentStatus: InternalPaymentStatus;
    paymentUrl: string | null;
  }): Promise<{ paymentStatus: "pending_provider" | "unknown"; paymentUrl: string | null }> {
    if (input.paymentUrl) {
      return {
        paymentStatus: input.paymentStatus === "unknown" ? "unknown" : "pending_provider",
        paymentUrl: input.paymentUrl
      };
    }
    if (!this.momoAdapter || this.paymentGatewayMode !== "momo_sandbox") {
      return {
        paymentStatus: input.paymentStatus === "unknown" ? "unknown" : "pending_provider",
        paymentUrl: null
      };
    }

    const initialProviderOrderId = input.providerOrderId ?? `momo-${input.registrationId}`;
    const attemptCreate = async (providerOrderId: string): Promise<{
      response: Awaited<ReturnType<IMomoAdapter["createOrder"]>>;
      providerOrderId: string;
    }> => {
      const response = await this.momoAdapter!.createOrder({
        requestId: randomUUID(),
        orderId: providerOrderId,
        amount: input.amountVnd,
        orderInfo: `Workshop ${input.workshopId} registration`,
        extraData: input.registrationId
      });
      return { response, providerOrderId };
    };

    try {
      let { response, providerOrderId } = await attemptCreate(initialProviderOrderId);
      if ((response.resultCode === "41" || response.message.toLowerCase().includes("trùng orderid")) && !response.payUrl) {
        const retryOrderId = `momo-${input.registrationId}-${randomUUID().slice(0, 8)}`;
        ({ response, providerOrderId } = await attemptCreate(retryOrderId));
      }

      const nowIso = this.now().toISOString();
      if (response.resultCode === "0" && response.payUrl) {
        await dbPool.query(
          `UPDATE payments
           SET provider_order_id=$2, payment_url=$3, provider_request_id=$4, provider_result_code=$5, provider_message=$6,
               provider_trans_id=$7, provider_raw_response=$8::jsonb, status='pending_provider', updated_at=$9
           WHERE id=$1`,
          [
            input.paymentId,
            providerOrderId,
            response.payUrl,
            response.requestId,
            response.resultCode,
            response.message,
            response.transId ? String(response.transId) : null,
            JSON.stringify(response),
            nowIso
          ]
        );
        return { paymentStatus: "pending_provider", paymentUrl: response.payUrl };
      }

      await dbPool.query(
        `UPDATE payments
         SET provider_order_id=$2, provider_request_id=$3, provider_result_code=$4, provider_message=$5,
             provider_raw_response=$6::jsonb, status='unknown', updated_at=$7
         WHERE id=$1`,
        [
          input.paymentId,
          providerOrderId,
          response.requestId,
          response.resultCode,
          response.message,
          JSON.stringify(response),
          nowIso
        ]
      );
      return { paymentStatus: "unknown", paymentUrl: response.payUrl ?? null };
    } catch (error) {
      await dbPool.query(
        `UPDATE payments
         SET provider_order_id=$2, status='unknown', provider_message=$3, updated_at=$4
         WHERE id=$1`,
        [
          input.paymentId,
          initialProviderOrderId,
          error instanceof Error ? error.message : "Recover payment link failed",
          this.now().toISOString()
        ]
      );
      return { paymentStatus: "unknown", paymentUrl: null };
    }
  }

  private async lockPublishedWorkshop(client: PoolClient, workshopId: string): Promise<WorkshopRow> {
    const workshopResult = await client.query<WorkshopRow>(
      "SELECT * FROM workshops WHERE id=$1 FOR UPDATE",
      [workshopId]
    );
    const workshop = workshopResult.rows[0];
    if (!workshop || workshop.status !== "published") {
      throw new AppError(404, "WORKSHOP_NOT_FOUND", "Workshop does not exist or is not published");
    }
    if (workshop.reserved_count >= workshop.capacity) {
      throw new AppError(409, "WORKSHOP_FULL", "Workshop is full");
    }
    return workshop;
  }

  private async findPaymentForProviderOrder(client: PoolClient, providerOrderId: string): Promise<RegistrationWithPaymentRow | null> {
    const result = await client.query<RegistrationWithPaymentRow>(
      `SELECT
         r.id AS registration_id,
         r.workshop_id,
         r.user_id,
         r.status AS registration_status,
         p.id AS payment_id,
         p.status AS payment_status,
         p.payment_url,
         p.amount_vnd,
         p.currency,
         r.qr_token
       FROM payments p
       JOIN registrations r ON r.id = p.registration_id
       WHERE p.provider_order_id=$1
       LIMIT 1
       FOR UPDATE OF p, r`,
      [providerOrderId]
    );
    return result.rows[0] ?? null;
  }

  private async applyProviderResult(
    client: PoolClient,
    row: RegistrationWithPaymentRow,
    mappedStatus: InternalPaymentStatus,
    payload: MomoCallbackPayload
  ): Promise<ConfirmationEventPayload | null> {
    const nowIso = this.now().toISOString();
    const updateCallbackMetadataSql = `
      UPDATE payments
      SET callback_first_received_at = COALESCE(callback_first_received_at, $2),
          callback_last_received_at = $2,
          callback_count = callback_count + 1,
          callback_signature = $3,
          callback_payload = $4::jsonb,
          provider_request_id = $5,
          provider_result_code = $6,
          provider_message = $7,
          provider_trans_id = $8,
          updated_at = $2
      WHERE id = $1
    `;
    await client.query(updateCallbackMetadataSql, [
      row.payment_id,
      nowIso,
      payload.signature,
      JSON.stringify(payload),
      payload.requestId,
      payload.resultCode,
      payload.message,
      payload.transId ? String(payload.transId) : null
    ]);

    if (isTerminalPaymentStatus(row.payment_status)) {
      if (row.registration_status !== "pending_payment" && mappedStatus === "completed") {
        await client.query(
          `UPDATE payments
           SET status='requires_review', review_reason='LATE_SUCCESS_AFTER_EXPIRY', updated_at=$2
           WHERE id=$1`,
          [row.payment_id, nowIso]
        );
      }
      return null;
    }

    if (row.registration_status !== "pending_payment") {
      if (mappedStatus === "completed") {
        await client.query(
          `UPDATE payments
           SET status='requires_review', review_reason='LATE_SUCCESS_AFTER_EXPIRY', updated_at=$2
           WHERE id=$1`,
          [row.payment_id, nowIso]
        );
      }
      return null;
    }

    if (mappedStatus === "completed") {
      return this.confirmPendingRegistration(client, row, nowIso);
    }

    if (mappedStatus === "failed" || mappedStatus === "expired") {
      await this.failPendingRegistration(client, row, mappedStatus, nowIso);
      return null;
    }

    await client.query(
      "UPDATE payments SET status='unknown', updated_at=$2 WHERE id=$1",
      [row.payment_id, nowIso]
    );
    return null;
  }

  private async confirmPendingRegistration(
    client: PoolClient,
    row: RegistrationWithPaymentRow,
    nowIso: string
  ): Promise<ConfirmationEventPayload> {
    const workshopResult = await client.query<Pick<WorkshopRow, "ends_at">>(
      "SELECT ends_at FROM workshops WHERE id=$1 LIMIT 1 FOR UPDATE",
      [row.workshop_id]
    );
    const endsAt = workshopResult.rows[0]?.ends_at;
    if (!endsAt) {
      throw new AppError(404, "WORKSHOP_NOT_FOUND", "Workshop not found for callback");
    }

    const qrToken = this.signQrToken({
      registrationId: row.registration_id,
      workshopId: row.workshop_id,
      userId: row.user_id,
      endsAtIso: endsAt.toISOString()
    });
    const qrHash = this.computeQrHash(qrToken);

    await client.query(
      `UPDATE registrations
       SET status='confirmed', confirmed_at=$2, qr_token=$3, qr_token_hash=$4, qr_issued_at=$2, updated_at=$2
       WHERE id=$1 AND status='pending_payment'`,
      [row.registration_id, nowIso, qrToken, qrHash]
    );
    await client.query(
      "UPDATE payments SET status='completed', paid_at=$2, updated_at=$2 WHERE id=$1",
      [row.payment_id, nowIso]
    );
    await client.query(
      "UPDATE workshops SET confirmed_count = confirmed_count + 1 WHERE id=$1",
      [row.workshop_id]
    );
    return {
      registrationId: row.registration_id,
      workshopId: row.workshop_id,
      userId: row.user_id,
      confirmedAt: nowIso
    };
  }

  private async failPendingRegistration(
    client: PoolClient,
    row: RegistrationWithPaymentRow,
    mappedStatus: "failed" | "expired",
    nowIso: string
  ): Promise<void> {
    const registrationTerminal = mappedStatus === "expired" ? "expired" : "cancelled";
    const timeField = mappedStatus === "expired" ? "expired_at" : "cancelled_at";
    const registrationUpdate = await client.query(
      `UPDATE registrations
       SET status=$2, ${timeField}=$3, updated_at=$3
       WHERE id=$1 AND status='pending_payment'`,
      [row.registration_id, registrationTerminal, nowIso]
    );
    if ((registrationUpdate.rowCount ?? 0) > 0) {
      await client.query(
        "UPDATE workshops SET reserved_count = GREATEST(reserved_count - 1, 0) WHERE id=$1",
        [row.workshop_id]
      );
    }
    await client.query(
      "UPDATE payments SET status=$2, updated_at=$3 WHERE id=$1",
      [row.payment_id, mappedStatus, nowIso]
    );
  }

  private async acquirePaidGatewayAdmission(): Promise<CircuitState> {
    if (!this.paymentCircuitBreaker || this.paymentGatewayMode !== "momo_sandbox" || !this.momoAdapter) {
      return "CLOSED";
    }

    const admission = await this.paymentCircuitBreaker.evaluateAdmission();
    if (!admission.allowed) {
      throw new PaymentGatewayUnavailableError(admission.retryAfterSeconds);
    }
    return admission.state;
  }

  private classifyGatewayFailureReason(error: unknown): "timeout" | "transport_error" | "invalid_response" {
    if (error instanceof Error && error.name === "MomoTimeoutError") {
      return "timeout";
    }
    return "transport_error";
  }

  private computeRequestHash(userId: string, workshopId: string): string {
    return createHash("sha256").update(`${userId}|${workshopId}`).digest("hex");
  }

  private computeQrHash(token: string): string {
    return createHash("sha256").update(token).digest("hex");
  }

  private signQrToken(input: { registrationId: string; workshopId: string; userId: string; endsAtIso: string }): string {
    const secret = process.env.JWT_SECRET ?? "development-secret";
    const expiresAt = Math.floor((new Date(input.endsAtIso).getTime() + 60 * 60 * 1000) / 1000);
    return jwt.sign(
      {
        type: "workshop_checkin",
        registration_id: input.registrationId,
        workshop_id: input.workshopId,
        user_id: input.userId,
        exp: expiresAt
      },
      secret
    );
  }
}
