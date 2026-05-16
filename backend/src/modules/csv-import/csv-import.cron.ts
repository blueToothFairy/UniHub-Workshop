import type { CsvImportRunWindow } from "./csv-import.types.js";
import { CsvImportService } from "./csv-import.service.js";

interface CsvImportScheduleDefinition {
  runWindow: CsvImportRunWindow;
  schedule: string;
  timezone: string;
}

interface CsvImportJobRegistration {
  runWindow: CsvImportRunWindow;
  schedule: string;
  timezone: string;
}

interface RegisterCsvImportJobsOptions {
  env?: NodeJS.ProcessEnv;
  now?: () => Date;
  logger?: Pick<Console, "info" | "warn" | "error">;
  scheduler?: (handler: () => void, intervalMs: number) => { stop: () => void };
}

interface ParsedDailyCron {
  hour: number;
  minute: number;
}

const CHECK_INTERVAL_MS = 30_000;

function parseBooleanFlag(value: string | undefined, fallback: boolean): boolean {
  if (value === undefined) {
    return fallback;
  }
  return value === "true";
}

function parseDailyCron(schedule: string): ParsedDailyCron {
  const match = /^(\d{1,2}) (\d{1,2}) \* \* \*$/.exec(schedule.trim());
  if (!match) {
    throw new Error(`Unsupported CSV cron schedule "${schedule}". Expected "m h * * *" daily format.`);
  }
  const minute = Number(match[1]);
  const hour = Number(match[2]);
  if (minute < 0 || minute > 59 || hour < 0 || hour > 23) {
    throw new Error(`Unsupported CSV cron schedule "${schedule}". Hour/minute out of range.`);
  }
  return { minute, hour };
}

function getParts(now: Date, timezone: string): { year: string; month: string; day: string; hour: number; minute: number } {
  const formatter = new Intl.DateTimeFormat("en-CA", {
    timeZone: timezone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false
  });

  const parts = formatter.formatToParts(now).reduce<Record<string, string>>((acc, part) => {
    if (part.type !== "literal") {
      acc[part.type] = part.value;
    }
    return acc;
  }, {});

  return {
    year: parts.year,
    month: parts.month,
    day: parts.day,
    hour: Number(parts.hour),
    minute: Number(parts.minute)
  };
}

export function loadCsvImportJobDefinitions(env: NodeJS.ProcessEnv = process.env): CsvImportScheduleDefinition[] {
  const enabled = parseBooleanFlag(env.CSV_IMPORT_ENABLED, false);
  if (!enabled) {
    return [];
  }

  const timezone = env.CSV_IMPORT_TIMEZONE ?? "Asia/Ho_Chi_Minh";
  return [
    {
      runWindow: "nightly",
      schedule: env.CSV_IMPORT_NIGHTLY_CRON ?? "5 2 * * *",
      timezone
    },
    {
      runWindow: "evening",
      schedule: env.CSV_IMPORT_EVENING_CRON ?? "5 18 * * *",
      timezone
    }
  ];
}

export function registerCsvImportJobs(
  service: CsvImportService,
  options: RegisterCsvImportJobsOptions = {}
): { jobs: CsvImportJobRegistration[]; stop: () => void } {
  const logger = options.logger ?? console;
  const now = options.now ?? (() => new Date());
  const scheduleInterval =
    options.scheduler ??
    ((handler: () => void, intervalMs: number) => {
      const timer = setInterval(handler, intervalMs);
      return {
        stop: () => clearInterval(timer)
      };
    });
  const definitions = loadCsvImportJobDefinitions(options.env);

  if (definitions.length === 0) {
    logger.info("[csv-import] scheduled CSV imports disabled");
    return { jobs: [], stop: () => undefined };
  }

  const lastRunSlot = new Map<CsvImportRunWindow, string>();
  const timers = definitions.map((definition) => {
    const parsed = parseDailyCron(definition.schedule);
    const tick = async (): Promise<void> => {
      const parts = getParts(now(), definition.timezone);
      if (parts.hour !== parsed.hour || parts.minute !== parsed.minute) {
        return;
      }

      const slotKey = `${parts.year}-${parts.month}-${parts.day}-${parts.hour}-${parts.minute}`;
      if (lastRunSlot.get(definition.runWindow) === slotKey) {
        return;
      }
      lastRunSlot.set(definition.runWindow, slotKey);
      await service.runImport(definition.runWindow);
    };

    const scheduled = scheduleInterval(() => {
      void tick().catch((error: unknown) => {
        logger.error(
          JSON.stringify({
            type: "student_csv_import_scheduler_error",
            runWindow: definition.runWindow,
            error: error instanceof Error ? error.message : "Unknown scheduler error"
          })
        );
      });
    }, CHECK_INTERVAL_MS);

    logger.info(
      `[csv-import] scheduled ${definition.runWindow} import at "${definition.schedule}" (${definition.timezone})`
    );

    return scheduled;
  });

  return {
    jobs: definitions.map((definition) => ({
      runWindow: definition.runWindow,
      schedule: definition.schedule,
      timezone: definition.timezone
    })),
    stop: () => {
      for (const timer of timers) {
        timer.stop();
      }
    }
  };
}
