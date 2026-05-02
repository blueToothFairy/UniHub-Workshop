import { cookies } from "next/headers";

const API_BASE_URL: string = process.env.NEXT_PUBLIC_API_BASE_URL ?? "http://localhost:3000";

export async function getAccessTokenFromCookie(): Promise<string> {
  const c = cookies();
  const token: string | undefined = c.get("access_token")?.value;
  const refreshToken: string | undefined = c.get("refresh_token")?.value;

  // If a refresh token exists, try to refresh first (covers expired access tokens on SSR)
  if (refreshToken) {
    try {
      const res = await fetch(`${API_BASE_URL}/auth/refresh`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ refresh_token: refreshToken })
      });
      if (res.ok) {
        const body: any = await res.json();
        const access = body.access_token as string | undefined;
        const refresh = body.refresh_token as string | undefined;
        if (access) {
          try {
            c.set("access_token", access);
            if (refresh) c.set("refresh_token", refresh);
          } catch {
            // ignore if cookies.set is not available in this runtime
          }
          return access;
        }
      }
      // fallthrough: if refresh failed, continue to return existing access token if present
    } catch {
      // ignore network/other errors and try fallback
    }
  }

  if (token) {
    return token;
  }

  return "";
}
