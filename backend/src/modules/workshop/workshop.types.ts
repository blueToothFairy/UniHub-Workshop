import type { Workshop } from "../admin/admin.types.js";

export type WorkshopDetailResponse = Workshop;
export type WorkshopDiscoveryPaymentFilter = "all" | "free" | "paid";

export interface WorkshopListItem extends Workshop {
  location: string;
}

export interface WorkshopDiscoveryQueryInput {
  q?: string | string[];
  payment?: string | string[];
  available_only?: string | string[];
}

export interface WorkshopDiscoveryQuery {
  q: string;
  payment: WorkshopDiscoveryPaymentFilter;
  availableOnly: boolean;
}

export interface WorkshopListResponse {
  stats: {
    workshopsThisMonth: number;
    registrationsThisMonth: number;
  };
  workshops: WorkshopListItem[];
}

export interface WorkshopSearchHit {
  id: string;
  score: number;
}

export interface WorkshopSearchRequest {
  query: string;
  monthStartIso: string;
  monthEndIso: string;
  payment?: Exclude<WorkshopDiscoveryPaymentFilter, "all">;
  limit: number;
}

export interface WorkshopSearchDocument {
  id: string;
  title: string;
  description: string;
  speakerName: string;
  room: string;
  startsAt: string;
  status: Workshop["status"];
  paymentRequired: boolean;
  updatedAt: string;
}

export interface WorkshopChangedQueuePayload {
  workshopId: string;
  reason: string;
}

export interface IWorkshopSearchGateway {
  isConfigured(): boolean;
  ensureIndex(): Promise<void>;
  recreateIndex(): Promise<void>;
  searchWorkshops(input: WorkshopSearchRequest): Promise<WorkshopSearchHit[]>;
  upsertWorkshopDocument(document: WorkshopSearchDocument): Promise<void>;
  removeWorkshopDocument(workshopId: string): Promise<void>;
}
