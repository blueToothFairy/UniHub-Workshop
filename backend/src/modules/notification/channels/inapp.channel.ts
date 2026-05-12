import type { ChannelSendInput, ChannelSendResult, INotificationChannel } from "./INotificationChannel.js";
import type { NotificationRepository } from "../notification.repository.js";

export class InAppNotificationChannel implements INotificationChannel {
  public readonly name = "in_app" as const;

  public constructor(private readonly notificationRepository: NotificationRepository) {}

  public async send(input: ChannelSendInput): Promise<ChannelSendResult> {
    const workshopTitle = input.workshopTitle ?? "your workshop";
    await this.notificationRepository.createInAppNotification({
      userId: input.delivery.user_id,
      title: "Registration confirmed",
      body: `Your registration for ${workshopTitle} is confirmed.`,
      type: "registration_confirmed"
    });
    return { success: true, retryable: false };
  }
}

