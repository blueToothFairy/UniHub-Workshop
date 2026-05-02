import Link from "next/link";
import type { ReactElement, ReactNode } from "react";
import "./globals.css";

export default function RootLayout({ children }: { children: ReactNode }): ReactElement {
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
                <Link href="/register" className="btn btn-secondary">Sign up</Link>
                <Link href="/login" className="btn btn-primary">Log in</Link>
              </nav>
            </div>
          </header>
          {children}
        </div>
      </body>
    </html>
  );
}
