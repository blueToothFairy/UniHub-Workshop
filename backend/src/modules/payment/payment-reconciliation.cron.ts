import type { RegistrationService } from "../registration/registration.service.js";

interface RegisterPaymentReconciliationCronOptions {
  env?: NodeJS.ProcessEnv;
  logger?: Pick<Console, "info" | "warn" | "error">;
  scheduler?: (handler: () => void, intervalMs: number) => { stop: () => void };
}

interface PaymentReconciliationCronConfig {
  enabled: boolean;
  intervalSeconds: number;
  limit: number;
}

interface PaymentReconciliationCronJobRegistration {
  intervalSeconds: number;
  limit: number;
}

function parseBooleanFlag(value: string | undefined, fallback: boolean): boolean {
  if (value === undefined) {
    return fallback;
  }
  return value === "true";
}

function parsePositiveInt(value: string | undefined, fallback: number): number {
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed <= 0) {
    return fallback;
  }
  return Math.floor(parsed);
}

export function loadPaymentReconciliationCronConfig(env: NodeJS.ProcessEnv = process.env): PaymentReconciliationCronConfig {
  const startWorkersDefault = (env.START_WORKERS ?? (env.NODE_ENV === "production" ? "true" : "false")) === "true";
  return {
    enabled: parseBooleanFlag(env.PAYMENT_RECONCILIATION_CRON_ENABLED, startWorkersDefault),
    intervalSeconds: parsePositiveInt(env.PAYMENT_RECONCILIATION_CRON_INTERVAL_SECONDS, 60),
    limit: parsePositiveInt(env.PAYMENT_RECONCILIATION_LIMIT, 100)
  };
}

export function registerPaymentReconciliationCron(
  registrationService: RegistrationService,
  options: RegisterPaymentReconciliationCronOptions = {}
): { jobs: PaymentReconciliationCronJobRegistration[]; stop: () => void } {
  const logger = options.logger ?? console;
  const scheduleInterval =
    options.scheduler ??
    ((handler: () => void, intervalMs: number) => {
      const timer = setInterval(handler, intervalMs);
      return {
        stop: () => clearInterval(timer)
      };
    });

  const config = loadPaymentReconciliationCronConfig(options.env);
  if (!config.enabled) {
    logger.info("[payment-reconciliation] cron disabled");
    return { jobs: [], stop: () => undefined };
  }

  let inFlight = false;
  const tick = async (): Promise<void> => {
    if (inFlight) {
      logger.warn("[payment-reconciliation] previous run still in progress; skipping tick");
      return;
    }

    inFlight = true;
    const startedAt = Date.now();
    try {
      const result = await registrationService.runReconciliationBatch(config.limit);
      logger.info(
        JSON.stringify({
          type: "payment_reconciliation_cron_tick",
          intervalSeconds: config.intervalSeconds,
          limit: config.limit,
          scanned: result.scanned,
          updated: result.updated,
          durationMs: Date.now() - startedAt
        })
      );
    } catch (error: unknown) {
      logger.error(
        JSON.stringify({
          type: "payment_reconciliation_cron_error",
          intervalSeconds: config.intervalSeconds,
          limit: config.limit,
          error: error instanceof Error ? error.message : "Unknown cron error"
        })
      );
    } finally {
      inFlight = false;
    }
  };

  const scheduled = scheduleInterval(() => {
    void tick();
  }, config.intervalSeconds * 1000);

  logger.info(
    `[payment-reconciliation] scheduled every ${config.intervalSeconds}s with limit=${config.limit}`
  );

  return {
    jobs: [
      {
        intervalSeconds: config.intervalSeconds,
        limit: config.limit
      }
    ],
    stop: () => {
      scheduled.stop();
    }
  };
}
