import { NextResponse, type NextRequest } from "next/server";

function decodeBase64Url(input: string): string {
  const normalized: string = input.replace(/-/g, "+").replace(/_/g, "/");
  const paddingLength: number = (4 - (normalized.length % 4)) % 4;
  const padded: string = normalized + "=".repeat(paddingLength);
  return atob(padded);
}

function decodeRoleFromToken(token: string): string {
  try {
    const payloadBase64: string = token.split(".")[1] ?? "";
    const payloadJson: string = decodeBase64Url(payloadBase64);
    const payload: unknown = JSON.parse(payloadJson);
    if (typeof payload === "object" && payload !== null && "role" in payload) {
      const role: unknown = (payload as { role: unknown }).role;
      if (typeof role === "string") {
        return role;
      }
    }
    return "";
  } catch {
    return "";
  }
}

export function middleware(req: NextRequest): NextResponse {
  const token: string = req.cookies.get("access_token")?.value ?? "";
  const role: string = decodeRoleFromToken(token);

  if (!token) {
    return NextResponse.redirect(new URL("/login", req.url));
  }

  if (role !== "organizer") {
    return NextResponse.redirect(new URL("/403", req.url));
  }

  return NextResponse.next();
}

export const config = {
  matcher: ["/admin/:path*"]
};
