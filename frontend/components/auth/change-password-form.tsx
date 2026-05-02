"use client";

import { useState, type FormEvent, type ReactElement } from "react";
import { useRouter } from "next/navigation";
import { changePassword } from "@/lib/auth-api";

function readCookie(name: string): string {
  const all: string[] = document.cookie.split(";");
  const found: string | undefined = all.find((part) => part.trim().startsWith(`${name}=`));
  return found ? found.split("=")[1] ?? "" : "";
}

export default function ChangePasswordForm(): ReactElement {
  const [oldPassword, setOldPassword] = useState<string>("");
  const [newPassword, setNewPassword] = useState<string>("");
  const [error, setError] = useState<string>("");
  const router = useRouter();

  const onSubmit = async (event: FormEvent<HTMLFormElement>): Promise<void> => {
    event.preventDefault();
    setError("");
    try {
      const accessToken: string = readCookie("access_token");
      await changePassword(accessToken, oldPassword, newPassword);
      router.push("/");
      router.refresh();
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : "Change password failed");
    }
  };

  return (
    <form onSubmit={onSubmit} className="card grid" style={{ maxWidth: 520, margin: "0 auto" }}>
      <h1 style={{ marginBottom: 0 }}>Change password</h1>
      {error ? <p style={{ color: "var(--color-danger)" }}>{error}</p> : null}
      <input className="input" type="password" placeholder="Old password" value={oldPassword} onChange={(e) => setOldPassword(e.target.value)} required />
      <input className="input" type="password" placeholder="New password" value={newPassword} onChange={(e) => setNewPassword(e.target.value)} required minLength={8} />
      <button className="btn btn-primary" type="submit">Update password</button>
    </form>
  );
}

