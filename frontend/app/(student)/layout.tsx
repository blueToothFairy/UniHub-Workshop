import type { ReactNode } from "react";

export default function StudentLayout({
  children
}: {
  children: ReactNode;
}): JSX.Element {
  return (
    <main>
      <header>UniHub Student Portal</header>
      {children}
    </main>
  );
}
