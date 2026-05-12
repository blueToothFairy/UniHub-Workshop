import AsyncStorage from "@react-native-async-storage/async-storage";
import { authApi, type MobileAuthUser } from "./api";

const SESSION_KEY = "unihub.mobile.session";
const DEVICE_ID_KEY = "unihub.mobile.device_id";

export class StaffRoleError extends Error {
  public constructor(message = "This app is only available to check-in staff.") {
    super(message);
    this.name = "StaffRoleError";
  }
}

export interface StoredSession {
  accessToken: string;
  refreshToken: string;
  user: MobileAuthUser;
}

function ensureStaffUser(user: MobileAuthUser): MobileAuthUser {
  if (user.role !== "checkin_staff") {
    throw new StaffRoleError();
  }
  return user;
}

function createDeviceId(): string {
  return `device-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
}

export async function saveStoredSession(session: StoredSession): Promise<void> {
  await AsyncStorage.setItem(SESSION_KEY, JSON.stringify(session));
}

export async function loadStoredSession(): Promise<StoredSession | null> {
  const raw: string | null = await AsyncStorage.getItem(SESSION_KEY);
  if (!raw) {
    return null;
  }

  try {
    return JSON.parse(raw) as StoredSession;
  } catch {
    await AsyncStorage.removeItem(SESSION_KEY);
    return null;
  }
}

export async function clearStoredSession(): Promise<void> {
  await AsyncStorage.removeItem(SESSION_KEY);
}

export async function getOrCreateDeviceId(): Promise<string> {
  const existing: string | null = await AsyncStorage.getItem(DEVICE_ID_KEY);
  if (existing) {
    return existing;
  }

  const created: string = createDeviceId();
  await AsyncStorage.setItem(DEVICE_ID_KEY, created);
  return created;
}

export async function loginStaff(email: string, password: string): Promise<StoredSession> {
  const response = await authApi.login({ email, password });
  const session: StoredSession = {
    accessToken: response.access_token,
    refreshToken: response.refresh_token,
    user: ensureStaffUser(response.user)
  };
  await saveStoredSession(session);
  return session;
}

export async function refreshStaffSession(refreshToken: string): Promise<StoredSession> {
  const tokens = await authApi.refresh(refreshToken);
  const me = await authApi.me(tokens.access_token);
  const session: StoredSession = {
    accessToken: tokens.access_token,
    refreshToken: tokens.refresh_token,
    user: ensureStaffUser(me.user)
  };
  await saveStoredSession(session);
  return session;
}

export async function validateStaffSession(accessToken: string): Promise<MobileAuthUser> {
  const me = await authApi.me(accessToken);
  return ensureStaffUser(me.user);
}
