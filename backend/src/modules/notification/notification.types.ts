export type NotificationChannelName = "email" | "in_app";
export type NotificationDeliveryStatus = "pending" | "sent" | "failed";
export type NotificationEventType = "RegistrationConfirmed";

export interface RegistrationConfirmedQueuePayload {
  registrationId: string;
  workshopId: string;
  userId: string;
  confirmedAt: string;
}

export interface RegistrationConfirmedEvent {
  eventId: string;
  eventType: NotificationEventType;
  occurredAt: string;
  payload: RegistrationConfirmedQueuePayload;
}

export interface NotificationDeliveryQueuePayload {
  deliveryId: string;
}

export interface NotificationDeliveryRecord {
  id: string;
  event_id: string | null;
  event_type: NotificationEventType;
  registration_id: string;
  workshop_id: string;
  user_id: string;
  channel: NotificationChannelName;
  status: NotificationDeliveryStatus;
  attempt_count: number;
  last_error: string | null;
  created_at: Date;
  updated_at: Date;
  sent_at: Date | null;
}

export interface CreateNotificationDeliveryInput {
  eventId: string;
  eventType: NotificationEventType;
  registrationId: string;
  workshopId: string;
  userId: string;
  channel: NotificationChannelName;
}

export interface UpdateDeliveryAttemptInput {
  deliveryId: string;
  attemptCount: number;
  lastError: string;
}

export interface MarkDeliverySentInput {
  deliveryId: string;
  attemptCount: number;
}

export interface InAppNotificationItem {
  id: string;
  title: string;
  body: string;
  type: string;
  created_at: string;
  is_read: boolean;
}

export interface ListNotificationsResponse {
  items: InAppNotificationItem[];
  next_cursor: string | null;
}

export interface UnreadCountResponse {
  unread_count: number;
}

export interface MarkNotificationReadResponse {
  id: string;
  is_read: true;
  read_at: string;
}

export interface ListNotificationsQuery {
  limit?: number;
  cursor?: string;
}

