import { AppError } from "../../shared/errors/AppError.js";
import type {
  CircuitAdmissionResult,
  CircuitBreakerConfig,
  CircuitMetricsPayload,
  CircuitOutcomeContext,
  CircuitSnapshot,
  CircuitState,
  CircuitTransitionContext,
  IPaymentCircuitBreaker
} from "./payment-circuit-breaker.types.js";
import type { IPaymentCircuitBreakerStore } from "./payment-circuit-breaker.store.js";

export class PaymentGatewayUnavailableError extends AppError {
  public readonly retryAfterSeconds: number;

  public constructor(retryAfterSeconds: number, message = "Payment gateway is temporarily unavailable") {
    super(503, "PAYMENT_GATEWAY_UNAVAILABLE", message);
    this.retryAfterSeconds = Math.max(retryAfterSeconds, 1);
  }
}

interface PaymentCircuitBreakerOptions {
  config: CircuitBreakerConfig;
  now?: () => Date;
  telemetry?: (payload: CircuitMetricsPayload | CircuitTransitionContext) => void;
}

export class PaymentCircuitBreaker implements IPaymentCircuitBreaker {
  private readonly now: () => Date;

  public constructor(
    private readonly store: IPaymentCircuitBreakerStore,
    private readonly options: PaymentCircuitBreakerOptions
  ) {
    this.now = options.now ?? (() => new Date());
  }

  public async evaluateAdmission(): Promise<CircuitAdmissionResult> {
    try {
      const snapshot = await this.store.getSnapshot();
      const nowMs = this.now().getTime();

      if (snapshot.state === "OPEN") {
        const openUntilMs = snapshot.openUntilMs ?? nowMs;
        if (openUntilMs > nowMs) {
          const retryAfterSeconds = Math.max(Math.ceil((openUntilMs - nowMs) / 1000), 1);
          this.emitMetric({ metric: "payment_circuit_fail_fast_total", value: 1, tags: { reason: "open" } });
          return { allowed: false, state: "OPEN", retryAfterSeconds, reason: "breaker_open" };
        }

        await this.store.transitionToHalfOpen();
        this.emitTransition({
          previousState: "OPEN",
          nextState: "HALF_OPEN",
          reason: "open_elapsed",
          failureCount: snapshot.failureCount,
          retryAfterSeconds: 0
        });
        return this.evaluateAdmission();
      }

      if (snapshot.state === "HALF_OPEN") {
        const acquired = await this.store.tryAcquireProbe(this.options.config.halfOpenProbeLimit);
        if (!acquired) {
          this.emitMetric({ metric: "payment_circuit_fail_fast_total", value: 1, tags: { reason: "probe_limit" } });
          return { allowed: false, state: "HALF_OPEN", retryAfterSeconds: 1, reason: "probe_limit" };
        }
      }

      return { allowed: true, state: snapshot.state };
    } catch {
      this.emitMetric({ metric: "payment_circuit_fail_fast_total", value: 1, tags: { reason: "storage_unavailable" } });
      return {
        allowed: false,
        state: "OPEN",
        retryAfterSeconds: Math.max(this.options.config.openDurationSeconds, 1),
        reason: "storage_unavailable"
      };
    }
  }

  public async recordSuccess(context: CircuitOutcomeContext): Promise<void> {
    try {
      if (context.admissionState === "HALF_OPEN") {
        await this.store.transitionToClosed();
        this.emitTransition({
          previousState: "HALF_OPEN",
          nextState: "CLOSED",
          reason: "probe_success",
          failureCount: 0,
          retryAfterSeconds: 0
        });
      } else {
        await this.store.resetFailureCount();
      }
      this.emitMetric({ metric: "payment_gateway_success_total", value: 1, tags: { mode: context.admissionState } });
    } catch {
      this.emitMetric({ metric: "payment_circuit_storage_error_total", value: 1, tags: { path: "recordSuccess" } });
    }
  }

  public async recordFailure(context: CircuitOutcomeContext): Promise<void> {
    try {
      const nowMs = this.now().getTime();
      this.emitMetric({ metric: "payment_gateway_failure_total", value: 1, tags: { reason: context.reason ?? "unknown" } });

      if (context.admissionState === "HALF_OPEN") {
        await this.store.transitionToOpen({ nowMs, openDurationSeconds: this.options.config.openDurationSeconds });
        this.emitTransition({
          previousState: "HALF_OPEN",
          nextState: "OPEN",
          reason: "probe_failure",
          failureCount: this.options.config.failureThreshold,
          retryAfterSeconds: this.options.config.openDurationSeconds
        });
        return;
      }

      const failureCount = await this.store.incrementFailureCount(this.options.config.failureWindowSeconds);
      if (failureCount >= this.options.config.failureThreshold) {
        await this.store.transitionToOpen({ nowMs, openDurationSeconds: this.options.config.openDurationSeconds });
        this.emitTransition({
          previousState: "CLOSED",
          nextState: "OPEN",
          reason: "threshold_exceeded",
          failureCount,
          retryAfterSeconds: this.options.config.openDurationSeconds
        });
      }
    } catch {
      this.emitMetric({ metric: "payment_circuit_storage_error_total", value: 1, tags: { path: "recordFailure" } });
    }
  }

  public async getSnapshot(): Promise<CircuitSnapshot> {
    return this.store.getSnapshot();
  }

  public async enforceAdmission(): Promise<CircuitState> {
    const admission = await this.evaluateAdmission();
    if (!admission.allowed) {
      throw new PaymentGatewayUnavailableError(admission.retryAfterSeconds);
    }
    return admission.state;
  }

  private emitTransition(payload: CircuitTransitionContext): void {
    if (this.options.telemetry) {
      this.options.telemetry(payload);
      return;
    }

    // eslint-disable-next-line no-console
    console.info(JSON.stringify({ type: "payment_circuit_transition", ...payload }));
  }

  private emitMetric(payload: CircuitMetricsPayload): void {
    if (this.options.telemetry) {
      this.options.telemetry(payload);
      return;
    }

    // eslint-disable-next-line no-console
    console.info(JSON.stringify({ type: "metric", ...payload }));
  }
}
