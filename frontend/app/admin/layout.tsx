import type { ReactNode } from "react";

export default function AdminLayout({
  children
}: {
  children: ReactNode;
}): JSX.Element {
  return (
    <main>
      <aside>Admin Sidebar</aside>
      <section>{children}</section>
    </main>
  );
}
