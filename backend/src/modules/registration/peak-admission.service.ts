import { randomUUID } from "node:crypto";
import type { QueryResultRow } from "pg";
import { AppError } from "../../shared/errors/AppError.js";
import { dbPool } from "../../shared/infra/db.js";
import {
  activeAdmissionTokensKey,
  globalWriteCounterKey,
  tokenPayloadKey,
  userPollThrottleKey,
  userQueueKey,
  userTokenKey,
  userWriteThrottleKey,
  waitingQueueKey
} from "./peak-admission.redis-keys.js";
import { type PeakControllerConfig, isPeakControlActiveForWorkshop } from "./peak-controller.config.js";
import type {
  IPeakAdmissionService,
  PeakRegistrationAttemptInput,
  RegistrationAdmissionResponse,
  RegistrationGateResponse
} from "./peak-admission.types.js";

interface PeakRedisClient {
  get(key: string): Promise<string | null>;
  set(key: string, value: string, ...args: unknown[]): Promise<string | null>;
  del(...keys: string[]): Promise<number>;
  zadd(key: string, score: number, member: string): Promise<number>;
  zrank(key: string, member: string): Promise<number | null>;
  zrem(key: string, member: string): Promise<number>;
  zcard(key: string): Promise<number>;
  zremrangebyscore(key: string, min: number | string, max: number | string): Promise<number>;
  incr(key: string): Promise<number>;
  expire(key: string, seconds: number): Promise<number>;
  ttl(key: string): Promise<number>;
}

interface WorkshopSnapshotRow extends QueryResultRow {
  id: string;
  capacity: number;
  reserved_count: number;
  status: "draft" | "published" | "cancelled";
}

interface AdmissionTokenPayload {
  userId: string;
  workshopId: string;
  issuedAtMs: number;
}

export class RetryAfterAppError extends AppError {
  public readonly retryAfterSeconds: number;

  public constructor(statusCode: number, code: string, message: string, retryAfterSeconds: number) {
    super(statusCode, code, message);
    this.retryAfterSeconds = retryAfterSeconds;
  }
}

export class PeakAdmissionService implements IPeakAdmissionService {
  private readonly now: () => Date;
  private readonly getWorkshopSnapshotFn: (workshopId: string) => Promise<WorkshopSnapshotRow | null>;

  public constructor(
    private readonly redis: PeakRedisClient,
    private readonly config: PeakControllerConfig,
    now?: () => Date,
    getWorkshopSnapshotFn?: (workshopId: string) => Promise<WorkshopSnapshotRow | null>
  ) {
    this.now = now ?? (() => new Date());
    this.getWorkshopSnapshotFn = getWorkshopSnapshotFn ?? ((workshopId) => this.getWorkshopSnapshotFromDb(workshopId));
  }

  public async getRegistrationGate(input: { workshopId: string; userId: string }): Promise<RegistrationGateResponse> {
    const workshop = await this.getWorkshopSnapshotFn(input.workshopId);
    if (!workshop || workshop.status !== "published") {
      throw new AppError(404, "WORKSHOP_NOT_FOUND", "Workshop does not exist or is not published");
    }

    if (!this.isPeakEnabled(input.workshopId)) {
      return { status: "disabled" };
    }
    if (workshop.reserved_count >= workshop.capacity) {
      this.logPeakEvent({
        type: "peak_admission_full",
        workshopId: input.workshopId,
        userId: input.userId
      });
      return { status: "full" };
    }

    const token = await this.redis.get(userTokenKey(input.workshopId, input.userId));
    if (token) {
      return { status: "admitted", retry_after: 1 };
    }

    const rank = await this.redis.zrank(waitingQueueKey(input.workshopId), input.userId);
    if (rank === null) {
      return { status: "open" };
    }

    return {
      status: "waiting",
      queue_position: rank + 1,
      retry_after: this.config.queuePositionRetryAfterSeconds
    };
  }

  public async requestAdmission(input: { workshopId: string; userId: string }): Promise<RegistrationAdmissionResponse> {
    const workshop = await this.getWorkshopSnapshotFn(input.workshopId);
    if (!workshop || workshop.status !== "published") {
      throw new AppError(404, "WORKSHOP_NOT_FOUND", "Workshop does not exist or is not published");
    }

    if (!this.isPeakEnabled(input.workshopId)) {
      return { status: "disabled" };
    }

    await this.guardPollRate(input.workshopId, input.userId);

    if (workshop.reserved_count >= workshop.capacity) {
      return { status: "full" };
    }

    const existingToken = await this.redis.get(userTokenKey(input.workshopId, input.userId));
    if (existingToken) {
      const ttl = await this.redis.ttl(userTokenKey(input.workshopId, input.userId));
      this.logPeakEvent({
        type: "peak_admission_reuse_token",
        workshopId: input.workshopId,
        userId: input.userId,
        ttlSeconds: ttl
      });
      return {
        status: "admitted",
        admission_token: existingToken,
        expires_in: ttl > 0 ? ttl : this.config.admissionTokenTtlSeconds
      };
    }

    const queueKey = waitingQueueKey(input.workshopId);
    let rank = await this.redis.zrank(queueKey, input.userId);
    if (rank === null) {
      const joinedAtMs = this.now().getTime();
      await this.redis.zadd(queueKey, joinedAtMs, input.userId);
      await this.redis.set(
        userQueueKey(input.workshopId, input.userId),
        String(joinedAtMs),
        "EX",
        Math.max(this.config.admissionTokenTtlSeconds * 10, 60)
      );
      rank = await this.redis.zrank(queueKey, input.userId);
    }

    const availableSeats = Math.max(0, workshop.capacity - workshop.reserved_count);
    const activeTokenCount = await this.getActiveAdmissionTokenCount(input.workshopId);
    const admitBudget = Math.max(0, (availableSeats + this.config.queueBufferSeats) - activeTokenCount);
    if (rank !== null && rank < admitBudget) {
      await this.redis.zrem(queueKey, input.userId);
      await this.redis.del(userQueueKey(input.workshopId, input.userId));

      const token = randomUUID();
      const payload: AdmissionTokenPayload = {
        userId: input.userId,
        workshopId: input.workshopId,
        issuedAtMs: this.now().getTime()
      };
      await this.redis.set(
        tokenPayloadKey(token),
        JSON.stringify(payload),
        "EX",
        this.config.admissionTokenTtlSeconds
      );
      await this.redis.set(
        userTokenKey(input.workshopId, input.userId),
        token,
        "EX",
        this.config.admissionTokenTtlSeconds
      );
      await this.redis.zadd(
        activeAdmissionTokensKey(input.workshopId),
        this.now().getTime() + (this.config.admissionTokenTtlSeconds * 1000),
        token
      );
      this.logPeakEvent({
        type: "peak_admission_issued",
        workshopId: input.workshopId,
        userId: input.userId,
        expiresInSeconds: this.config.admissionTokenTtlSeconds,
        admitBudget
      });
      return {
        status: "admitted",
        admission_token: token,
        expires_in: this.config.admissionTokenTtlSeconds
      };
    }

    this.logPeakEvent({
      type: "peak_admission_waiting",
      workshopId: input.workshopId,
      userId: input.userId,
      queuePosition: (rank ?? 0) + 1
    });
    return {
      status: "waiting",
      queue_position: (rank ?? 0) + 1,
      retry_after: this.config.queuePositionRetryAfterSeconds
    };
  }

  public async validateRegistrationAttempt(input: PeakRegistrationAttemptInput): Promise<void> {
    if (!this.isPeakEnabled(input.workshopId)) {
      return;
    }
    if (!input.admissionToken) {
      throw new AppError(403, "ADMISSION_TOKEN_REQUIRED", "Admission-Token header is required during peak registration windows");
    }

    await this.guardWriteRate(input.workshopId, input.userId);
    await this.guardGlobalWriteRate();

    const payloadRaw = await this.redis.get(tokenPayloadKey(input.admissionToken));
    if (!payloadRaw) {
      throw new AppError(403, "ADMISSION_TOKEN_INVALID", "Admission token is invalid or expired");
    }
    const payload = this.parseTokenPayload(payloadRaw);
    if (payload.userId !== input.userId || payload.workshopId !== input.workshopId) {
      throw new AppError(403, "ADMISSION_TOKEN_INVALID", "Admission token does not match current user/workshop");
    }

    await this.redis.del(tokenPayloadKey(input.admissionToken), userTokenKey(input.workshopId, input.userId));
    await this.redis.zrem(activeAdmissionTokensKey(input.workshopId), input.admissionToken);
    this.logPeakEvent({
      type: "peak_admission_consumed",
      workshopId: input.workshopId,
      userId: input.userId
    });
  }

  private parseTokenPayload(raw: string): AdmissionTokenPayload {
    try {
      const parsed = JSON.parse(raw) as AdmissionTokenPayload;
      if (!parsed?.userId || !parsed?.workshopId || !Number.isFinite(parsed?.issuedAtMs)) {
        throw new Error("Invalid payload");
      }
      return parsed;
    } catch {
      throw new AppError(403, "ADMISSION_TOKEN_INVALID", "Admission token payload is invalid");
    }
  }

  private async guardPollRate(workshopId: string, userId: string): Promise<void> {
    const result = await this.redis.set(
      userPollThrottleKey(workshopId, userId),
      String(this.now().getTime()),
      "EX",
      this.config.userPollMinIntervalSeconds,
      "NX"
    );
    if (result !== "OK") {
      this.logPeakEvent({
        type: "peak_admission_poll_rate_limited",
        workshopId,
        userId
      });
      throw new RetryAfterAppError(
        429,
        "RATE_LIMITED",
        "Admission polling is too frequent",
        this.config.userPollMinIntervalSeconds
      );
    }
  }

  private async guardWriteRate(workshopId: string, userId: string): Promise<void> {
    const result = await this.redis.set(
      userWriteThrottleKey(workshopId, userId),
      String(this.now().getTime()),
      "EX",
      this.config.userWriteMinIntervalSeconds,
      "NX"
    );
    if (result !== "OK") {
      this.logPeakEvent({
        type: "peak_registration_user_rate_limited",
        workshopId,
        userId
      });
      throw new RetryAfterAppError(
        429,
        "RATE_LIMITED",
        "Registration attempts are too frequent",
        this.config.userWriteMinIntervalSeconds
      );
    }
  }

  private async guardGlobalWriteRate(): Promise<void> {
    const key = globalWriteCounterKey();
    const count = await this.redis.incr(key);
    if (count === 1) {
      await this.redis.expire(key, 1);
    }
    if (count > this.config.globalWriteLimitPerSecond) {
      this.logPeakEvent({
        type: "peak_registration_global_busy",
        currentCount: count,
        limit: this.config.globalWriteLimitPerSecond
      });
      throw new RetryAfterAppError(
        503,
        "REGISTRATION_BUSY",
        "System is handling peak registration load",
        1
      );
    }
  }

  private isPeakEnabled(workshopId: string): boolean {
    return isPeakControlActiveForWorkshop(this.config, workshopId, this.now());
  }

  private async getActiveAdmissionTokenCount(workshopId: string): Promise<number> {
    const key = activeAdmissionTokensKey(workshopId);
    const nowMs = this.now().getTime();
    await this.redis.zremrangebyscore(key, "-inf", nowMs);
    return this.redis.zcard(key);
  }

  private async getWorkshopSnapshotFromDb(workshopId: string): Promise<WorkshopSnapshotRow | null> {
    const result = await dbPool.query<WorkshopSnapshotRow>(
      "SELECT id, capacity, reserved_count, status FROM workshops WHERE id=$1 LIMIT 1",
      [workshopId]
    );
    return result.rows[0] ?? null;
  }

  private logPeakEvent(payload: Record<string, unknown>): void {
    // eslint-disable-next-line no-console
    console.info(JSON.stringify({
      ...payload,
      at: this.now().toISOString()
    }));
  }
}
