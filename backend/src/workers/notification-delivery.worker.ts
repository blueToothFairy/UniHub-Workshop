import type { NotificationService } from "../modules/notification/notification.service.js";
import type { NotificationDeliveryQueuePayload } from "../modules/notification/notification.types.js";

export class NotificationDeliveryWorker {
  public constructor(private readonly notificationService: NotificationService) {}

  public async consume(payload: NotificationDeliveryQueuePayload): Promise<void> {
    await this.notificationService.processNotificationDelivery(payload);
  }
}

