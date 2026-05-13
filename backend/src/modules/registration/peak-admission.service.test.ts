import assert from "node:assert/strict";
import test from "node:test";
import {
  PeakAdmissionService,
  RetryAfterAppError
} from "./peak-admission.service.js";
import type { PeakControllerConfig } from "./peak-controller.config.js";
import {
  tokenPayloadKey,
  userTokenKey
} from "./peak-admission.redis-keys.js";

class InMemoryRedis {
  private readonly values = new Map<string, { value: string; expiresAtMs: number | null }>();
  private readonly zsets = new Map<string, Map<string, number>>();

  public constructor(private readonly now: () => Date) {}

  public async get(key: string): Promise<string | null> {
    this.cleanupKey(key);
    return this.values.get(key)?.value ?? null;
  }

  public async set(key: string, value: string, ...args: Array<string | number>): Promise<"OK" | null> {
    let ttlSeconds: number | null = null;
    let nx = false;
    for (let i = 0; i < args.length; i += 1) {
      const part = args[i];
      if (part === "EX") {
        const ttlRaw = args[i + 1];
        ttlSeconds = typeof ttlRaw === "number" ? ttlRaw : Number(ttlRaw);
      }
      if (part === "NX") {
        nx = true;
      }
    }
    this.cleanupKey(key);
    if (nx && this.values.has(key)) {
      return null;
    }
    const expiresAtMs = ttlSeconds && Number.isFinite(ttlSeconds)
      ? this.now().getTime() + (ttlSeconds * 1000)
      : null;
    this.values.set(key, { value, expiresAtMs });
    return "OK";
  }

  public async del(...keys: string[]): Promise<number> {
    let removed = 0;
    for (const key of keys) {
      if (this.values.delete(key)) {
        removed += 1;
      }
    }
    return removed;
  }

  public async zadd(key: string, score: number, member: string): Promise<number> {
    const set = this.zsets.get(key) ?? new Map<string, number>();
    const exists = set.has(member);
    set.set(member, score);
    this.zsets.set(key, set);
    return exists ? 0 : 1;
  }

  public async zrank(key: string, member: string): Promise<number | null> {
    const set = this.zsets.get(key);
    if (!set || !set.has(member)) {
      return null;
    }
    const ordered = [...set.entries()].sort((a, b) => a[1] - b[1]).map((entry) => entry[0]);
    return ordered.indexOf(member);
  }

  public async zrem(key: string, member: string): Promise<number> {
    const set = this.zsets.get(key);
    if (!set) {
      return 0;
    }
    const existed = set.delete(member);
    if (set.size === 0) {
      this.zsets.delete(key);
    }
    return existed ? 1 : 0;
  }

  public async zcard(key: string): Promise<number> {
    const set = this.zsets.get(key);
    return set ? set.size : 0;
  }

  public async zremrangebyscore(key: string, min: number | string, max: number | string): Promise<number> {
    const set = this.zsets.get(key);
    if (!set || set.size === 0) {
      return 0;
    }

    const minScore = min === "-inf" ? Number.NEGATIVE_INFINITY : Number(min);
    const maxScore = max === "+inf" ? Number.POSITIVE_INFINITY : Number(max);

    let removed = 0;
    for (const [member, score] of set.entries()) {
      if (score >= minScore && score <= maxScore) {
        set.delete(member);
        removed += 1;
      }
    }
    if (set.size === 0) {
      this.zsets.delete(key);
    } else {
      this.zsets.set(key, set);
    }
    return removed;
  }

  public async incr(key: string): Promise<number> {
    this.cleanupKey(key);
    const existing = this.values.get(key);
    const current = existing ? Number(existing.value) : 0;
    const next = current + 1;
    this.values.set(key, { value: String(next), expiresAtMs: existing?.expiresAtMs ?? null });
    return next;
  }

  public async expire(key: string, seconds: number): Promise<number> {
    const existing = this.values.get(key);
    if (!existing) {
      return 0;
    }
    existing.expiresAtMs = this.now().getTime() + (seconds * 1000);
    this.values.set(key, existing);
    return 1;
  }

  public async ttl(key: string): Promise<number> {
    this.cleanupKey(key);
    const existing = this.values.get(key);
    if (!existing) {
      return -2;
    }
    if (existing.expiresAtMs === null) {
      return -1;
    }
    return Math.max(0, Math.ceil((existing.expiresAtMs - this.now().getTime()) / 1000));
  }

  private cleanupKey(key: string): void {
    const existing = this.values.get(key);
    if (!existing || existing.expiresAtMs === null) {
      return;
    }
    if (existing.expiresAtMs <= this.now().getTime()) {
      this.values.delete(key);
    }
  }
}

function makeConfig(): PeakControllerConfig {
  return {
    enabled: true,
    workshopAllowList: new Set<string>(),
    userPollMinIntervalSeconds: 1,
    userWriteMinIntervalSeconds: 1,
    globalWriteLimitPerSecond: 100,
    admissionTokenTtlSeconds: 45,
    queueBufferSeats: 0,
    queuePositionRetryAfterSeconds: 5,
    windowStartHourUtc: 0,
    windowStartMinuteUtc: 0,
    windowEndHourUtc: 23,
    windowEndMinuteUtc: 59
  };
}

test("peak admission uses token TTL from config", async () => {
  const now = () => new Date("2026-05-12T09:00:00.000Z");
  const redis = new InMemoryRedis(now);
  const service = new PeakAdmissionService(
    redis,
    makeConfig(),
    now,
    async () => ({ id: "w1", capacity: 10, reserved_count: 0, status: "published" })
  );

  const response = await service.requestAdmission({ workshopId: "w1", userId: "u1" });
  assert.equal(response.status, "admitted");
  assert.equal(response.expires_in, 45);
  const ttl = await redis.ttl(userTokenKey("w1", "u1"));
  assert.equal(ttl, 45);
});

test("repeated waiting-room joins do not create duplicate membership", async () => {
  let nowMs = Date.parse("2026-05-12T09:00:00.000Z");
  const now = () => new Date(nowMs);
  const redis = new InMemoryRedis(now);
  const config = makeConfig();
  const service = new PeakAdmissionService(
    redis,
    config,
    now,
    async () => ({ id: "w1", capacity: 1, reserved_count: 0, status: "published" })
  );

  const admitted = await service.requestAdmission({ workshopId: "w1", userId: "u1" });
  assert.equal(admitted.status, "admitted");

  const waitingA = await service.requestAdmission({ workshopId: "w1", userId: "u2" });
  assert.equal(waitingA.status, "waiting");
  nowMs += 1000;
  const waitingB = await service.requestAdmission({ workshopId: "w1", userId: "u2" });
  assert.equal(waitingB.status, "waiting");
  assert.equal(waitingA.queue_position, waitingB.queue_position);
});

test("invalid token payload is rejected on registration attempt", async () => {
  const now = () => new Date("2026-05-12T09:00:00.000Z");
  const redis = new InMemoryRedis(now);
  const service = new PeakAdmissionService(
    redis,
    makeConfig(),
    now,
    async () => ({ id: "w1", capacity: 2, reserved_count: 0, status: "published" })
  );
  const token = "token-1";
  await redis.set(tokenPayloadKey(token), "{invalid-json", "EX", 45);
  await redis.set(userTokenKey("w1", "u1"), token, "EX", 45);

  await assert.rejects(
    async () => service.validateRegistrationAttempt({ workshopId: "w1", userId: "u1", admissionToken: token }),
    (error: unknown) => {
      assert.equal(error instanceof Error, true);
      const appError = error as { code?: string };
      assert.equal(appError.code, "ADMISSION_TOKEN_INVALID");
      return true;
    }
  );
});

test("polling too quickly returns rate-limited error with retry-after", async () => {
  const now = () => new Date("2026-05-12T09:00:00.000Z");
  const redis = new InMemoryRedis(now);
  const service = new PeakAdmissionService(
    redis,
    makeConfig(),
    now,
    async () => ({ id: "w1", capacity: 5, reserved_count: 0, status: "published" })
  );

  await service.requestAdmission({ workshopId: "w1", userId: "u1" });
  await assert.rejects(
    async () => service.requestAdmission({ workshopId: "w1", userId: "u1" }),
    (error: unknown) => {
      assert.equal(error instanceof RetryAfterAppError, true);
      const typed = error as RetryAfterAppError;
      assert.equal(typed.retryAfterSeconds, 1);
      return true;
    }
  );
});
