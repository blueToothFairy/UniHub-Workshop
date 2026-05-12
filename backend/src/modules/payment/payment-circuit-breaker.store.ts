import { Redis } from "ioredis";
import type { CircuitSnapshot, CircuitState } from "./payment-circuit-breaker.types.js";

interface StateRecord {
  state: CircuitState;
  openedAtMs: number | null;
  openUntilMs: number | null;
  probeInFlight: number;
}

export interface IPaymentCircuitBreakerStore {
  getSnapshot(): Promise<CircuitSnapshot>;
  incrementFailureCount(windowSeconds: number): Promise<number>;
  resetFailureCount(): Promise<void>;
  transitionToOpen(input: { nowMs: number; openDurationSeconds: number }): Promise<void>;
  transitionToHalfOpen(): Promise<void>;
  transitionToClosed(): Promise<void>;
  tryAcquireProbe(limit: number): Promise<boolean>;
}

export class RedisPaymentCircuitBreakerStore implements IPaymentCircuitBreakerStore {
  private readonly stateKey: string;
  private readonly failureKey: string;

  public constructor(
    private readonly redis: Redis,
    keyPrefix = "payment:circuit-breaker:momo"
  ) {
    this.stateKey = `${keyPrefix}:state`;
    this.failureKey = `${keyPrefix}:failures`;
  }

  public async getSnapshot(): Promise<CircuitSnapshot> {
    const [stateRaw, openedRaw, openUntilRaw, probeRaw, failureRaw] = await Promise.all([
      this.redis.hget(this.stateKey, "state"),
      this.redis.hget(this.stateKey, "opened_at_ms"),
      this.redis.hget(this.stateKey, "open_until_ms"),
      this.redis.hget(this.stateKey, "probe_in_flight"),
      this.redis.get(this.failureKey)
    ]);

    const state: CircuitState = stateRaw === "OPEN" || stateRaw === "HALF_OPEN" ? stateRaw : "CLOSED";
    return {
      state,
      openedAtMs: openedRaw ? Number(openedRaw) : null,
      openUntilMs: openUntilRaw ? Number(openUntilRaw) : null,
      probeInFlight: probeRaw ? Number(probeRaw) : 0,
      failureCount: failureRaw ? Number(failureRaw) : 0
    };
  }

  public async incrementFailureCount(windowSeconds: number): Promise<number> {
    const count = await this.redis.incr(this.failureKey);
    if (count === 1) {
      await this.redis.expire(this.failureKey, Math.max(windowSeconds, 1));
    }
    return count;
  }

  public async resetFailureCount(): Promise<void> {
    await this.redis.del(this.failureKey);
  }

  public async transitionToOpen(input: { nowMs: number; openDurationSeconds: number }): Promise<void> {
    const openUntilMs = input.nowMs + Math.max(input.openDurationSeconds, 1) * 1000;
    await this.redis.hset(this.stateKey, {
      state: "OPEN",
      opened_at_ms: String(input.nowMs),
      open_until_ms: String(openUntilMs),
      probe_in_flight: "0"
    });
    await this.redis.expire(this.stateKey, Math.max(input.openDurationSeconds * 3, 60));
    await this.resetFailureCount();
  }

  public async transitionToHalfOpen(): Promise<void> {
    const existing = await this.redis.hget(this.stateKey, "opened_at_ms");
    await this.redis.hset(this.stateKey, {
      state: "HALF_OPEN",
      opened_at_ms: existing ?? "",
      open_until_ms: "",
      probe_in_flight: "0"
    });
  }

  public async transitionToClosed(): Promise<void> {
    await this.redis.hset(this.stateKey, {
      state: "CLOSED",
      opened_at_ms: "",
      open_until_ms: "",
      probe_in_flight: "0"
    });
    await this.resetFailureCount();
  }

  public async tryAcquireProbe(limit: number): Promise<boolean> {
    const result = await this.redis.eval(
      `
      local key = KEYS[1]
      local limit = tonumber(ARGV[1])
      local current = tonumber(redis.call('HGET', key, 'probe_in_flight') or '0')
      if current >= limit then
        return 0
      end
      redis.call('HINCRBY', key, 'probe_in_flight', 1)
      return 1
      `,
      1,
      this.stateKey,
      String(Math.max(limit, 1))
    );

    return Number(result) === 1;
  }
}

export class InMemoryPaymentCircuitBreakerStore implements IPaymentCircuitBreakerStore {
  private state: StateRecord = {
    state: "CLOSED",
    openedAtMs: null,
    openUntilMs: null,
    probeInFlight: 0
  };

  private failureCount = 0;

  public async getSnapshot(): Promise<CircuitSnapshot> {
    return {
      state: this.state.state,
      openedAtMs: this.state.openedAtMs,
      openUntilMs: this.state.openUntilMs,
      probeInFlight: this.state.probeInFlight,
      failureCount: this.failureCount
    };
  }

  public async incrementFailureCount(_windowSeconds: number): Promise<number> {
    this.failureCount += 1;
    return this.failureCount;
  }

  public async resetFailureCount(): Promise<void> {
    this.failureCount = 0;
  }

  public async transitionToOpen(input: { nowMs: number; openDurationSeconds: number }): Promise<void> {
    this.state = {
      state: "OPEN",
      openedAtMs: input.nowMs,
      openUntilMs: input.nowMs + Math.max(input.openDurationSeconds, 1) * 1000,
      probeInFlight: 0
    };
    this.failureCount = 0;
  }

  public async transitionToHalfOpen(): Promise<void> {
    this.state = {
      state: "HALF_OPEN",
      openedAtMs: this.state.openedAtMs,
      openUntilMs: null,
      probeInFlight: 0
    };
  }

  public async transitionToClosed(): Promise<void> {
    this.state = {
      state: "CLOSED",
      openedAtMs: null,
      openUntilMs: null,
      probeInFlight: 0
    };
    this.failureCount = 0;
  }

  public async tryAcquireProbe(limit: number): Promise<boolean> {
    if (this.state.probeInFlight >= Math.max(limit, 1)) {
      return false;
    }
    this.state.probeInFlight += 1;
    return true;
  }
}
