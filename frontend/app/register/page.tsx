import type { ReactElement } from "react";
import RegisterForm from "@/components/auth/register-form";

export default function RegisterPage(): ReactElement {
  return (
    <main className="section">
      <div className="container">
        <RegisterForm />
      </div>
    </main>
  );
}
