export interface PeakAdmissionRedisKeySet {
  userQueueMembership: string;
  waitingQueue: string;
  userAdmissionToken: string;
  tokenPayload: string;
  activeAdmissionTokens: string;
  userPollThrottle: string;
  userWriteThrottle: string;
  globalWriteCounter: string;
}

export const PEAK_REDIS_TTL = {
  queueMembershipSeconds: 15 * 60,
  userTokenSeconds: 60,
  tokenPayloadSeconds: 60,
  userPollThrottleSeconds: 3,
  userWriteThrottleSeconds: 3,
  globalWriteCounterSeconds: 1
} as const;

export function buildPeakAdmissionRedisKeys(workshopId: string, userId: string, token: string): PeakAdmissionRedisKeySet {
  return {
    userQueueMembership: `peak:queue:user:${workshopId}:${userId}`,
    waitingQueue: `peak:queue:workshop:${workshopId}`,
    userAdmissionToken: `peak:token:user:${workshopId}:${userId}`,
    tokenPayload: `peak:token:payload:${token}`,
    activeAdmissionTokens: `peak:token:active:${workshopId}`,
    userPollThrottle: `peak:throttle:poll:${workshopId}:${userId}`,
    userWriteThrottle: `peak:throttle:write:${workshopId}:${userId}`,
    globalWriteCounter: `peak:throttle:global-write`
  };
}

export function waitingQueueKey(workshopId: string): string {
  return `peak:queue:workshop:${workshopId}`;
}

export function userQueueKey(workshopId: string, userId: string): string {
  return `peak:queue:user:${workshopId}:${userId}`;
}

export function userTokenKey(workshopId: string, userId: string): string {
  return `peak:token:user:${workshopId}:${userId}`;
}

export function tokenPayloadKey(token: string): string {
  return `peak:token:payload:${token}`;
}

export function activeAdmissionTokensKey(workshopId: string): string {
  return `peak:token:active:${workshopId}`;
}

export function userPollThrottleKey(workshopId: string, userId: string): string {
  return `peak:throttle:poll:${workshopId}:${userId}`;
}

export function userWriteThrottleKey(workshopId: string, userId: string): string {
  return `peak:throttle:write:${workshopId}:${userId}`;
}

export function globalWriteCounterKey(): string {
  return "peak:throttle:global-write";
}
