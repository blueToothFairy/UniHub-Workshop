import { randomUUID } from "node:crypto";
import { AppError } from "../../shared/errors/AppError.js";
import type { IQueue } from "../../shared/interfaces/IQueue.js";
import type { INotificationChannel } from "./channels/INotificationChannel.js";
import type { NotificationRepository } from "./notification.repository.js";
import type {
  ListNotificationsQuery,
  ListNotificationsResponse,
  MarkNotificationReadResponse,
  NotificationChannelName,
  NotificationDeliveryQueuePayload,
  RegistrationConfirmedQueuePayload,
  UnreadCountResponse
} from "./notification.types.js";

const DEFAULT_PAGE_SIZE = 10;
const MAX_PAGE_SIZE = 50;
const DELIVERY_MAX_ATTEMPTS = 3;

function encodeCursor(createdAtIso: string, id: string): string {
  return Buffer.from(`${createdAtIso}|${id}`, "utf8").toString("base64url");
}

function decodeCursor(cursor: string): { createdAt: string; id: string } {
  try {
    const raw = Buffer.from(cursor, "base64url").toString("utf8");
    const splitIndex = raw.lastIndexOf("|");
    if (splitIndex <= 0 || splitIndex >= raw.length - 1) {
      throw new Error("Invalid cursor");
    }
    return {
      createdAt: raw.slice(0, splitIndex),
      id: raw.slice(splitIndex + 1)
    };
  } catch {
    throw new AppError(400, "INVALID_CURSOR", "Cursor is invalid");
  }
}

export class NotificationService {
  private readonly channelMap: Map<NotificationChannelName, INotificationChannel>;

  public constructor(
    private readonly notificationRepository: NotificationRepository,
    private readonly queue: IQueue,
    channels: INotificationChannel[]
  ) {
    this.channelMap = new Map(channels.map((channel) => [channel.name, channel]));
  }

  public async handleRegistrationConfirmed(payload: RegistrationConfirmedQueuePayload): Promise<void> {
    const eventId = `evt_${payload.registrationId}_${randomUUID().slice(0, 8)}`;
    const channels: NotificationChannelName[] = ["email", "in_app"];

    for (const channel of channels) {
      const delivery = await this.notificationRepository.upsertDelivery({
        eventId,
        eventType: "RegistrationConfirmed",
        registrationId: payload.registrationId,
        workshopId: payload.workshopId,
        userId: payload.userId,
        channel
      });
      await this.queue.enqueueNotificationDelivery({ deliveryId: delivery.id });
    }
  }

  public async processNotificationDelivery(payload: NotificationDeliveryQueuePayload): Promise<void> {
    const delivery = await this.notificationRepository.getDeliveryById(payload.deliveryId);
    if (!delivery) {
      return;
    }
    if (delivery.status === "sent" || delivery.status === "failed") {
      return;
    }

    const attemptCount = delivery.attempt_count + 1;
    const context = await this.notificationRepository.getDeliveryContext(delivery.id);
    const channel = this.channelMap.get(delivery.channel);

    if (!channel) {
      await this.notificationRepository.markDeliveryFailed({
        deliveryId: delivery.id,
        attemptCount,
        lastError: `Unsupported channel: ${delivery.channel}`
      });
      return;
    }

    try {
      const result = await channel.send({
        delivery,
        workshopTitle: context?.workshop_title ?? null,
        userEmail: context?.user_email ?? null,
        userFullName: context?.user_full_name ?? null
      });

      if (result.success) {
        await this.notificationRepository.markDeliverySent({ deliveryId: delivery.id, attemptCount });
        return;
      }

      const errorMessage = result.error ?? "Channel delivery failed";
      if (result.retryable && attemptCount < DELIVERY_MAX_ATTEMPTS) {
        await this.notificationRepository.markDeliveryPendingRetry({
          deliveryId: delivery.id,
          attemptCount,
          lastError: errorMessage
        });
        throw new Error(errorMessage);
      }

      await this.notificationRepository.markDeliveryFailed({
        deliveryId: delivery.id,
        attemptCount,
        lastError: errorMessage
      });
    } catch (error: unknown) {
      const errorMessage = error instanceof Error ? error.message : "Channel delivery failed";
      if (attemptCount < DELIVERY_MAX_ATTEMPTS) {
        await this.notificationRepository.markDeliveryPendingRetry({
          deliveryId: delivery.id,
          attemptCount,
          lastError: errorMessage
        });
        throw error instanceof Error ? error : new Error(errorMessage);
      }

      await this.notificationRepository.markDeliveryFailed({
        deliveryId: delivery.id,
        attemptCount,
        lastError: errorMessage
      });
    }
  }

  public async listNotifications(userId: string, query: ListNotificationsQuery): Promise<ListNotificationsResponse> {
    const requestedLimit = query.limit ?? DEFAULT_PAGE_SIZE;
    const limit = Number.isFinite(requestedLimit)
      ? Math.max(1, Math.min(MAX_PAGE_SIZE, requestedLimit))
      : DEFAULT_PAGE_SIZE;

    const cursor = query.cursor ? decodeCursor(query.cursor) : null;
    const rows = await this.notificationRepository.listInAppNotifications({
      userId,
      limit,
      cursorCreatedAt: cursor?.createdAt,
      cursorId: cursor?.id
    });

    const items = rows.map((row) => ({
      id: row.id,
      title: row.title,
      body: row.body,
      type: row.type,
      created_at: row.created_at.toISOString(),
      is_read: row.is_read
    }));

    const last = rows.at(-1);
    const nextCursor = rows.length === limit && last
      ? encodeCursor(last.created_at.toISOString(), last.id)
      : null;

    return { items, next_cursor: nextCursor };
  }

  public async getUnreadCount(userId: string): Promise<UnreadCountResponse> {
    const unreadCount = await this.notificationRepository.getUnreadCount(userId);
    return { unread_count: unreadCount };
  }

  public async markNotificationRead(userId: string, notificationId: string): Promise<MarkNotificationReadResponse> {
    const updated = await this.notificationRepository.markInAppNotificationRead({ userId, notificationId });
    if (!updated) {
      throw new AppError(404, "NOTIFICATION_NOT_FOUND", "Notification not found");
    }
    return {
      id: updated.id,
      is_read: true,
      read_at: updated.read_at.toISOString()
    };
  }
}

