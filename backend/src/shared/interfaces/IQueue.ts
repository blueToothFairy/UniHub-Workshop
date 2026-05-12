import type { AiSummaryJobPayload } from "../../modules/ai-summary/ai-summary.types.js";
import type {
  NotificationDeliveryQueuePayload,
  RegistrationConfirmedQueuePayload
} from "../../modules/notification/notification.types.js";

export interface IQueue {
  enqueueWorkshopChanged(workshopId: string, reason: string): Promise<void>;
  enqueueAiSummaryGenerate(payload: AiSummaryJobPayload): Promise<void>;
  enqueueRegistrationConfirmed(payload: RegistrationConfirmedQueuePayload): Promise<void>;
  enqueueNotificationDelivery(payload: NotificationDeliveryQueuePayload): Promise<void>;
}
