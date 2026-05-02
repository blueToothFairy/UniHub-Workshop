import type { ReactElement } from "react";
import ChangePasswordForm from "@/components/auth/change-password-form";

export default function ChangePasswordPage(): ReactElement {
  return (
    <main className="section">
      <div className="container">
        <ChangePasswordForm />
      </div>
    </main>
  );
}

