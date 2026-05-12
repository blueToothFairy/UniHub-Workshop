import type { NotificationDeliveryRecord } from "../notification.types.js";

export interface ChannelSendResult {
  success: boolean;
  retryable: boolean;
  error?: string;
}

export interface ChannelSendInput {
  delivery: NotificationDeliveryRecord;
  workshopTitle: string | null;
  userEmail: string | null;
  userFullName: string | null;
}

export interface INotificationChannel {
  readonly name: NotificationDeliveryRecord["channel"];
  send(input: ChannelSendInput): Promise<ChannelSendResult>;
}

