import type { NotificationService } from "../modules/notification/notification.service.js";
import type { RegistrationConfirmedQueuePayload } from "../modules/notification/notification.types.js";

export class RegistrationConfirmedWorker {
  public constructor(private readonly notificationService: NotificationService) {}

  public async consume(payload: RegistrationConfirmedQueuePayload): Promise<void> {
    await this.notificationService.handleRegistrationConfirmed(payload);
  }
}

