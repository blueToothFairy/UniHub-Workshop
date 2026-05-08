import type { AiSummaryJobPayload } from "../../modules/ai-summary/ai-summary.types.js";

export interface IQueue {
  enqueueWorkshopChanged(workshopId: string, reason: string): Promise<void>;
  enqueueAiSummaryGenerate(payload: AiSummaryJobPayload): Promise<void>;
  enqueueRegistrationConfirmed(payload: { registrationId: string; workshopId: string; userId: string; confirmedAt: string }): Promise<void>;
}
