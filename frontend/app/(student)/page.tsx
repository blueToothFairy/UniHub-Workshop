import Link from "next/link";
import type { ReactElement } from "react";
import { getWorkshopsThisMonth } from "@/lib/api";
import StudentHomeExperience from "@/components/student/student-home-experience";
import { DEFAULT_WORKSHOP_DISCOVERY_QUERY, isWorkshopDiscoveryPaymentFilter } from "@/lib/workshop-discovery";
import type { WorkshopDiscoveryQuery } from "@/types/admin";

interface Props {
  searchParams?: {
    q?: string;
    payment?: string;
    available_only?: string;
  };
}

export default async function StudentHomePage({ searchParams }: Props): Promise<ReactElement> {
  const paymentParam = searchParams?.payment ?? "";
  const payment: WorkshopDiscoveryQuery["payment"] = isWorkshopDiscoveryPaymentFilter(paymentParam)
    ? paymentParam
    : DEFAULT_WORKSHOP_DISCOVERY_QUERY.payment;
  const initialQuery: Partial<WorkshopDiscoveryQuery> = {
    q: searchParams?.q ?? DEFAULT_WORKSHOP_DISCOVERY_QUERY.q,
    payment,
    availableOnly: searchParams?.available_only === "true"
  };
  const payload = await getWorkshopsThisMonth(initialQuery);

  return (
    <main className="home-page">
      <StudentHomeExperience initialPayload={payload} initialQuery={initialQuery} />

      <footer className="footer-band">
        <div className="container footer-grid">
          <div>
            <h3 style={{ marginTop: 0 }}>UniHub Workshop</h3>
            <p>A practical learning space designed for students.</p>
          </div>
          <div>
            <h4>Navigation</h4>
            <p><Link href="/">Home</Link></p>
            <p><Link href="/login">Log in</Link></p>
          </div>
          <div>
            <h4>Contact</h4>
            <p>Email: support@unihub.local</p>
          </div>
        </div>
      </footer>
    </main>
  );
}


