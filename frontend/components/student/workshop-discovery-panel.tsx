"use client";

import WorkshopShowcaseGrid from "@/components/student/workshop-showcase-grid";
import WorkshopDiscoveryControls from "@/components/student/workshop-discovery-controls";
import { useWorkshopDiscovery } from "@/components/student/use-workshop-discovery";
import type { WorkshopsThisMonthResponse } from "@/lib/api";
import type { WorkshopDiscoveryQuery } from "@/types/admin";

interface Props {
  initialPayload: WorkshopsThisMonthResponse;
  initialQuery?: Partial<WorkshopDiscoveryQuery>;
  onPayloadChange?: (payload: WorkshopsThisMonthResponse) => void;
}

export default function WorkshopDiscoveryPanel(props: Props): JSX.Element {
  const discovery = useWorkshopDiscovery(props);

  return (
    <div className="grid" style={{ gap: 20 }}>
      <WorkshopDiscoveryControls discovery={discovery} suggestionWorkshops={props.initialPayload.workshops ?? []} />
      <div className={discovery.loading ? "workshop-showcase-grid-loading" : undefined}>
        <WorkshopShowcaseGrid workshops={discovery.workshops} />
      </div>
    </div>
  );
}
