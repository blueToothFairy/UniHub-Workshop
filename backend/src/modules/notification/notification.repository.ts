import type { QueryResultRow } from "pg";
import { dbPool } from "../../shared/infra/db.js";
import type {
  CreateNotificationDeliveryInput,
  NotificationDeliveryRecord
} from "./notification.types.js";

interface DeliveryContextRow extends QueryResultRow {
  workshop_title: string | null;
  user_email: string | null;
  user_full_name: string | null;
}

interface AppNotificationRow extends QueryResultRow {
  id: string;
  title: string;
  body: string;
  type: string;
  created_at: Date;
  is_read: boolean;
  read_at: Date | null;
}

export class NotificationRepository {
  public async upsertDelivery(input: CreateNotificationDeliveryInput): Promise<NotificationDeliveryRecord> {
    const result = await dbPool.query<NotificationDeliveryRecord>(
      `INSERT INTO notification_deliveries (
         event_id, event_type, registration_id, workshop_id, user_id, channel, status, created_at, updated_at
       ) VALUES ($1,$2,$3,$4,$5,$6,'pending',NOW(),NOW())
       ON CONFLICT (event_type, registration_id, channel)
       DO UPDATE SET updated_at = NOW()
       RETURNING *`,
      [input.eventId, input.eventType, input.registrationId, input.workshopId, input.userId, input.channel]
    );
    return result.rows[0];
  }

  public async getDeliveryById(deliveryId: string): Promise<NotificationDeliveryRecord | null> {
    const result = await dbPool.query<NotificationDeliveryRecord>(
      "SELECT * FROM notification_deliveries WHERE id=$1 LIMIT 1",
      [deliveryId]
    );
    return result.rows[0] ?? null;
  }

  public async markDeliverySent(input: { deliveryId: string; attemptCount: number }): Promise<void> {
    await dbPool.query(
      `UPDATE notification_deliveries
       SET status='sent', attempt_count=$2, last_error=NULL, sent_at=NOW(), updated_at=NOW()
       WHERE id=$1`,
      [input.deliveryId, input.attemptCount]
    );
  }

  public async markDeliveryPendingRetry(input: { deliveryId: string; attemptCount: number; lastError: string }): Promise<void> {
    await dbPool.query(
      `UPDATE notification_deliveries
       SET status='pending', attempt_count=$2, last_error=$3, updated_at=NOW()
       WHERE id=$1`,
      [input.deliveryId, input.attemptCount, input.lastError]
    );
  }

  public async markDeliveryFailed(input: { deliveryId: string; attemptCount: number; lastError: string }): Promise<void> {
    await dbPool.query(
      `UPDATE notification_deliveries
       SET status='failed', attempt_count=$2, last_error=$3, updated_at=NOW()
       WHERE id=$1`,
      [input.deliveryId, input.attemptCount, input.lastError]
    );
  }

  public async getDeliveryContext(deliveryId: string): Promise<DeliveryContextRow | null> {
    const result = await dbPool.query<DeliveryContextRow>(
      `SELECT
         w.title AS workshop_title,
         u.email AS user_email,
         u.full_name AS user_full_name
       FROM notification_deliveries d
       JOIN workshops w ON w.id = d.workshop_id
       JOIN users u ON u.id = d.user_id
       WHERE d.id=$1
       LIMIT 1`,
      [deliveryId]
    );
    return result.rows[0] ?? null;
  }

  public async createInAppNotification(input: { userId: string; title: string; body: string; type: string }): Promise<void> {
    await dbPool.query(
      `INSERT INTO app_notifications (user_id, title, body, type, is_read, created_at)
       VALUES ($1,$2,$3,$4,false,NOW())`,
      [input.userId, input.title, input.body, input.type]
    );
  }

  public async listInAppNotifications(input: {
    userId: string;
    limit: number;
    cursorCreatedAt?: string;
    cursorId?: string;
  }): Promise<AppNotificationRow[]> {
    if (input.cursorCreatedAt && input.cursorId) {
      const result = await dbPool.query<AppNotificationRow>(
        `SELECT id, title, body, type, created_at, is_read, read_at
         FROM app_notifications
         WHERE user_id=$1
           AND (created_at, id) < ($2::timestamptz, $3::uuid)
         ORDER BY created_at DESC, id DESC
         LIMIT $4`,
        [input.userId, input.cursorCreatedAt, input.cursorId, input.limit]
      );
      return result.rows;
    }

    const result = await dbPool.query<AppNotificationRow>(
      `SELECT id, title, body, type, created_at, is_read, read_at
       FROM app_notifications
       WHERE user_id=$1
       ORDER BY created_at DESC, id DESC
       LIMIT $2`,
      [input.userId, input.limit]
    );
    return result.rows;
  }

  public async getUnreadCount(userId: string): Promise<number> {
    const result = await dbPool.query<{ unread_count: string }>(
      `SELECT COUNT(*)::text AS unread_count
       FROM app_notifications
       WHERE user_id=$1 AND is_read=false`,
      [userId]
    );
    return Number(result.rows[0]?.unread_count ?? "0");
  }

  public async markInAppNotificationRead(input: { userId: string; notificationId: string }): Promise<{ id: string; read_at: Date } | null> {
    const result = await dbPool.query<{ id: string; read_at: Date }>(
      `UPDATE app_notifications
       SET is_read=true, read_at=COALESCE(read_at, NOW())
       WHERE id=$1 AND user_id=$2
       RETURNING id, read_at`,
      [input.notificationId, input.userId]
    );
    return result.rows[0] ?? null;
  }
}

