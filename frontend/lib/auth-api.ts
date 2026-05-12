import type { LoginResponse, RefreshResponse, RegisterResponse } from "@/types/auth";

const API_BASE_URL: string = process.env.NEXT_PUBLIC_API_BASE_URL ?? "http://localhost:3000";

export async function login(email: string, password: string): Promise<LoginResponse> {
  const response: Response = await fetch(`${API_BASE_URL}/auth/login`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ email, password })
  });

  const body: unknown = await response.json();
  if (!response.ok) {
    const message = (body as { error?: { message?: string } })?.error?.message ?? "Login failed";
    throw new Error(message);
  }

  return body as LoginResponse;
}

export async function register(email: string, fullName: string, password: string): Promise<RegisterResponse> {
  const response: Response = await fetch(`${API_BASE_URL}/auth/register`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ email, full_name: fullName, password })
  });

  const body: unknown = await response.json();
  if (!response.ok) {
    const message = (body as { error?: { message?: string } })?.error?.message ?? "Register failed";
    throw new Error(message);
  }

  return body as RegisterResponse;
}

export async function changePassword(accessToken: string, oldPassword: string, newPassword: string): Promise<void> {
  const response: Response = await fetch(`${API_BASE_URL}/auth/change-password`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${accessToken}`,
      "Content-Type": "application/json"
    },
    body: JSON.stringify({ old_password: oldPassword, new_password: newPassword })
  });

  if (!response.ok) {
    const body: unknown = await response.json();
    const message = (body as { error?: { message?: string } })?.error?.message ?? "Change password failed";
    throw new Error(message);
  }
}

export async function refreshToken(refreshTokenValue: string): Promise<RefreshResponse> {
  const response: Response = await fetch(`${API_BASE_URL}/auth/refresh`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ refresh_token: refreshTokenValue })
  });

  const body: unknown = await response.json();
  if (!response.ok) {
    const message = (body as { error?: { message?: string } })?.error?.message ?? "Refresh failed";
    throw new Error(message);
  }

  return body as RefreshResponse;
}

export async function logout(accessToken: string, refreshTokenValue: string): Promise<void> {
  const response: Response = await fetch(`${API_BASE_URL}/auth/logout`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${accessToken}`,
      "Content-Type": "application/json"
    },
    body: JSON.stringify({ refresh_token: refreshTokenValue })
  });

  if (!response.ok && response.status !== 401) {
    const body: unknown = await response.json().catch(() => ({}));
    const message = (body as { error?: { message?: string } })?.error?.message ?? "Logout failed";
    throw new Error(message);
  }
}
