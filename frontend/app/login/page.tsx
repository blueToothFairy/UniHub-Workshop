import type { ReactElement } from "react";
import LoginForm from "@/components/auth/login-form";

export default function LoginPage(): ReactElement {
  return (
    <main className="section">
      <div className="container">
        <LoginForm />
      </div>
    </main>
  );
}

