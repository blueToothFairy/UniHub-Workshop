export interface PeakControllerConfig {
  enabled: boolean;
  workshopAllowList: Set<string>;
  userPollMinIntervalSeconds: number;
  userWriteMinIntervalSeconds: number;
  globalWriteLimitPerSecond: number;
  admissionTokenTtlSeconds: number;
  queueBufferSeats: number;
  queuePositionRetryAfterSeconds: number;
  windowStartHourUtc: number;
  windowStartMinuteUtc: number;
  windowEndHourUtc: number;
  windowEndMinuteUtc: number;
}

const DEFAULT_WINDOW_START = "00:00";
const DEFAULT_WINDOW_END = "23:59";

function parsePositiveInt(raw: string | undefined, fallback: number): number {
  const value = Number(raw);
  if (!Number.isFinite(value) || value <= 0) {
    return fallback;
  }
  return Math.floor(value);
}

function parseTimeUtc(raw: string | undefined, fallback: string): { hour: number; minute: number } {
  const input = (raw ?? fallback).trim();
  const parts = input.split(":");
  if (parts.length !== 2) {
    return parseTimeUtc(fallback, fallback);
  }
  const hour = Number(parts[0]);
  const minute = Number(parts[1]);
  if (!Number.isFinite(hour) || !Number.isFinite(minute) || hour < 0 || hour > 23 || minute < 0 || minute > 59) {
    return parseTimeUtc(fallback, fallback);
  }
  return { hour: Math.floor(hour), minute: Math.floor(minute) };
}

export function loadPeakControllerConfig(env: NodeJS.ProcessEnv = process.env): PeakControllerConfig {
  const windowStart = parseTimeUtc(env.PEAK_CONTROL_WINDOW_START_UTC, DEFAULT_WINDOW_START);
  const windowEnd = parseTimeUtc(env.PEAK_CONTROL_WINDOW_END_UTC, DEFAULT_WINDOW_END);
  const workshopList = (env.PEAK_CONTROL_WORKSHOP_IDS ?? "")
    .split(",")
    .map((item) => item.trim())
    .filter((item) => item.length > 0);

  return {
    enabled: (env.PEAK_CONTROL_ENABLED ?? "false").toLowerCase() === "true",
    workshopAllowList: new Set(workshopList),
    userPollMinIntervalSeconds: parsePositiveInt(env.PEAK_CONTROL_USER_POLL_MIN_INTERVAL_SECONDS, 3),
    userWriteMinIntervalSeconds: parsePositiveInt(env.PEAK_CONTROL_USER_WRITE_MIN_INTERVAL_SECONDS, 3),
    globalWriteLimitPerSecond: parsePositiveInt(env.PEAK_CONTROL_GLOBAL_WRITE_LIMIT_PER_SECOND, 100),
    admissionTokenTtlSeconds: parsePositiveInt(env.PEAK_CONTROL_ADMISSION_TOKEN_TTL_SECONDS, 45),
    queueBufferSeats: parsePositiveInt(env.PEAK_CONTROL_QUEUE_BUFFER_SEATS, 20),
    queuePositionRetryAfterSeconds: parsePositiveInt(env.PEAK_CONTROL_QUEUE_RETRY_AFTER_SECONDS, 5),
    windowStartHourUtc: windowStart.hour,
    windowStartMinuteUtc: windowStart.minute,
    windowEndHourUtc: windowEnd.hour,
    windowEndMinuteUtc: windowEnd.minute
  };
}

function toUtcMinutes(date: Date): number {
  return (date.getUTCHours() * 60) + date.getUTCMinutes();
}

export function isPeakControlActiveForWorkshop(config: PeakControllerConfig, workshopId: string, now: Date): boolean {
  if (!config.enabled) {
    return false;
  }
  if (config.workshopAllowList.size > 0 && !config.workshopAllowList.has(workshopId)) {
    return false;
  }
  const start = (config.windowStartHourUtc * 60) + config.windowStartMinuteUtc;
  const end = (config.windowEndHourUtc * 60) + config.windowEndMinuteUtc;
  const value = toUtcMinutes(now);

  if (start <= end) {
    return value >= start && value <= end;
  }
  // Handles overnight windows such as 23:00 -> 01:00.
  return value >= start || value <= end;
}
