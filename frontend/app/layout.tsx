import { HeaderSessionControls } from "@/components/layout/header-session-controls";
import { cookies } from "next/headers";
import Link from "next/link";
import type { ReactElement, ReactNode } from "react";
import "./globals.css";

export default function RootLayout({ children }: { children: ReactNode }): ReactElement {
  const cookieStore = cookies();
  const initialAuthenticated = Boolean(cookieStore.get("access_token")?.value || cookieStore.get("refresh_token")?.value);

  return (
    <html lang="en">
      <body>
        <div className="page-wrap">
          <header className="marketing-nav">
            <div className="container marketing-nav-inner">
              <Link href="/" className="brand">UniHub Workshop</Link>
              <nav className="nav-links" aria-label="Main Navigation">
                <Link href="/">Home</Link>
                <Link href="/admin">Admin</Link>
                <HeaderSessionControls initialAuthenticated={initialAuthenticated} />
              </nav>
            </div>
          </header>
          {children}
        </div>
      </body>
    </html>
  );
}
