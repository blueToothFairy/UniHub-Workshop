export type WorkshopStatus = "draft" | "published" | "cancelled";
export type SummaryStatus = "idle" | "processing" | "ready" | "fallback" | "failed";

export interface Workshop {
  id: string;
  title: string;
  description: string;
  speakerName: string;
  room: string;
  startsAt: string;
  endsAt: string;
  capacity: number;
  confirmedRegistrations: number;
  priceVnd: number;
  paymentRequired: boolean;
  status: WorkshopStatus;
  pdfUrl: string | null;
  aiSummary: string | null;
  summaryStatus: SummaryStatus;
  summaryGeneratedAt: string | null;
  summaryErrorCode: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface UploadWorkshopPdfResponse {
  status: "processing";
  workshop_id: string;
}

export interface OverrideSummaryInput {
  summary: string;
}

export interface AuditLog {
  id: string;
  actorUserId: string;
  action: "workshop.create" | "workshop.update" | "workshop.cancel";
  targetType: "workshop";
  targetId: string;
  beforeState: Workshop | null;
  afterState: Workshop | null;
  createdAt: string;
}

export interface CreateWorkshopInput {
  title: string;
  description: string;
  speakerName: string;
  room: string;
  startsAt: string;
  endsAt: string;
  capacity: number;
  priceVnd: number;
  status?: WorkshopStatus;
}

export interface UpdateWorkshopInput {
  title?: string;
  description?: string;
  speakerName?: string;
  room?: string;
  startsAt?: string;
  endsAt?: string;
  capacity?: number;
  priceVnd?: number;
  status?: WorkshopStatus;
}

export interface DashboardStats {
  totalWorkshops: number;
  totalRegistrations: number;
  paidWorkshops: number;
  freeWorkshops: number;
  cancelledWorkshops: number;
  checkins: number;
  lastUpdatedAt: string;
}
