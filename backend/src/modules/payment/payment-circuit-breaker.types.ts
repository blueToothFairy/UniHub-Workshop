export type CircuitState = "CLOSED" | "OPEN" | "HALF_OPEN";

export type CircuitFailureReason = "timeout" | "transport_error" | "provider_error" | "invalid_response";

export interface CircuitBreakerConfig {
  failureThreshold: number;
  failureWindowSeconds: number;
  openDurationSeconds: number;
  halfOpenProbeLimit: number;
}

export interface CircuitSnapshot {
  state: CircuitState;
  openedAtMs: number | null;
  openUntilMs: number | null;
  probeInFlight: number;
  failureCount: number;
}

export interface CircuitAdmissionAllowed {
  allowed: true;
  state: CircuitState;
}

export interface CircuitAdmissionRejected {
  allowed: false;
  state: CircuitState;
  retryAfterSeconds: number;
  reason: "breaker_open" | "probe_limit" | "storage_unavailable";
}

export type CircuitAdmissionResult = CircuitAdmissionAllowed | CircuitAdmissionRejected;

export interface CircuitTransitionContext {
  previousState: CircuitState;
  nextState: CircuitState;
  reason: "threshold_exceeded" | "open_elapsed" | "probe_success" | "probe_failure";
  failureCount: number;
  retryAfterSeconds: number;
}

export interface CircuitMetricsPayload {
  metric: string;
  value: number;
  tags: Record<string, string>;
}

export interface CircuitOutcomeContext {
  admissionState: CircuitState;
  reason?: CircuitFailureReason;
}

export interface IPaymentCircuitBreaker {
  evaluateAdmission(): Promise<CircuitAdmissionResult>;
  recordSuccess(context: CircuitOutcomeContext): Promise<void>;
  recordFailure(context: CircuitOutcomeContext): Promise<void>;
  getSnapshot(): Promise<CircuitSnapshot>;
}
