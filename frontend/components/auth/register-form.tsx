"use client";

import Link from "next/link";
import { useState, type FormEvent, type ReactElement } from "react";
import { useRouter } from "next/navigation";
import { register } from "@/lib/auth-api";

const ACCESS_TOKEN_TTL_SECONDS: number = 15 * 60;
const REFRESH_TOKEN_TTL_SECONDS: number = 7 * 24 * 60 * 60;

function setCookie(name: string, value: string, ttlSeconds: number): void {
  document.cookie = `${name}=${encodeURIComponent(value)}; path=/; max-age=${ttlSeconds}; samesite=lax`;
}

export default function RegisterForm(): ReactElement {
  const [fullName, setFullName] = useState<string>("");
  const [email, setEmail] = useState<string>("");
  const [password, setPassword] = useState<string>("");
  const [error, setError] = useState<string>("");
  const router = useRouter();

  const onSubmit = async (event: FormEvent<HTMLFormElement>): Promise<void> => {
    event.preventDefault();
    setError("");

    try {
      const result = await register(email, fullName, password);
      setCookie("access_token", result.access_token, ACCESS_TOKEN_TTL_SECONDS);
      setCookie("refresh_token", result.refresh_token, REFRESH_TOKEN_TTL_SECONDS);
      setCookie("role", result.user.role, REFRESH_TOKEN_TTL_SECONDS);
      router.push("/");
      router.refresh();
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : "Register failed");
    }
  };

  return (
    <form onSubmit={onSubmit} className="card grid" style={{ maxWidth: 500, margin: "0 auto" }}>
      <h1 style={{ marginBottom: 0 }}>Create account</h1>
      {error ? <p style={{ color: "var(--color-danger)" }}>{error}</p> : null}
      <input className="input" type="text" placeholder="Full name" value={fullName} onChange={(e) => setFullName(e.target.value)} required />
      <input className="input" type="email" placeholder="Email" value={email} onChange={(e) => setEmail(e.target.value)} required />
      <input className="input" type="password" placeholder="Password (min 8 chars)" minLength={8} value={password} onChange={(e) => setPassword(e.target.value)} required />
      <button className="btn btn-primary" type="submit">Sign up</button>
      <p className="muted" style={{ margin: 0 }}>
        Already have an account? <Link href="/login">Log in</Link>
      </p>
    </form>
  );
}
