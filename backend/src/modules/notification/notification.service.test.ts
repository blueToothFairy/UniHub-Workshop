import assert from "node:assert/strict";
import test from "node:test";
import type { IQueue } from "../../shared/interfaces/IQueue.js";
import type { INotificationChannel } from "./channels/INotificationChannel.js";
import { NotificationService } from "./notification.service.js";
import type {
  CreateNotificationDeliveryInput,
  NotificationDeliveryQueuePayload,
  NotificationDeliveryRecord,
  RegistrationConfirmedQueuePayload
} from "./notification.types.js";

class InMemoryQueue implements IQueue {
  public readonly registrationEvents: RegistrationConfirmedQueuePayload[] = [];
  public readonly deliveryJobs: NotificationDeliveryQueuePayload[] = [];

  public async enqueueWorkshopChanged(): Promise<void> {}
  public async enqueueAiSummaryGenerate(): Promise<void> {}

  public async enqueueRegistrationConfirmed(payload: RegistrationConfirmedQueuePayload): Promise<void> {
    this.registrationEvents.push(payload);
  }

  public async enqueueNotificationDelivery(payload: NotificationDeliveryQueuePayload): Promise<void> {
    this.deliveryJobs.push(payload);
  }
}

class InMemoryNotificationRepository {
  private readonly deliveries = new Map<string, NotificationDeliveryRecord>();
  private readonly uniqueByRegistrationChannel = new Map<string, string>();
  private id = 0;

  public async upsertDelivery(input: CreateNotificationDeliveryInput): Promise<NotificationDeliveryRecord> {
    const key = `${input.eventType}:${input.registrationId}:${input.channel}`;
    const existingId = this.uniqueByRegistrationChannel.get(key);
    if (existingId) {
      return this.deliveries.get(existingId)!;
    }

    const delivery: NotificationDeliveryRecord = {
      id: `delivery-${++this.id}`,
      event_id: input.eventId,
      event_type: input.eventType,
      registration_id: input.registrationId,
      workshop_id: input.workshopId,
      user_id: input.userId,
      channel: input.channel,
      status: "pending",
      attempt_count: 0,
      last_error: null,
      created_at: new Date(),
      updated_at: new Date(),
      sent_at: null
    };
    this.deliveries.set(delivery.id, delivery);
    this.uniqueByRegistrationChannel.set(key, delivery.id);
    return delivery;
  }

  public async getDeliveryById(deliveryId: string): Promise<NotificationDeliveryRecord | null> {
    return this.deliveries.get(deliveryId) ?? null;
  }

  public async markDeliverySent(input: { deliveryId: string; attemptCount: number }): Promise<void> {
    const delivery = this.deliveries.get(input.deliveryId)!;
    delivery.status = "sent";
    delivery.attempt_count = input.attemptCount;
    delivery.sent_at = new Date();
    delivery.last_error = null;
    delivery.updated_at = new Date();
  }

  public async markDeliveryPendingRetry(input: { deliveryId: string; attemptCount: number; lastError: string }): Promise<void> {
    const delivery = this.deliveries.get(input.deliveryId)!;
    delivery.status = "pending";
    delivery.attempt_count = input.attemptCount;
    delivery.last_error = input.lastError;
    delivery.updated_at = new Date();
  }

  public async markDeliveryFailed(input: { deliveryId: string; attemptCount: number; lastError: string }): Promise<void> {
    const delivery = this.deliveries.get(input.deliveryId)!;
    delivery.status = "failed";
    delivery.attempt_count = input.attemptCount;
    delivery.last_error = input.lastError;
    delivery.updated_at = new Date();
  }

  public async getDeliveryContext(): Promise<{ workshop_title: string | null; user_email: string | null; user_full_name: string | null }> {
    return {
      workshop_title: "Architecture 101",
      user_email: "student@example.com",
      user_full_name: "Student One"
    };
  }

  public async createInAppNotification(): Promise<void> {}
  public async listInAppNotifications(): Promise<never[]> {
    return [];
  }
  public async getUnreadCount(): Promise<number> {
    return 0;
  }
  public async markInAppNotificationRead(): Promise<{ id: string; read_at: Date } | null> {
    return null;
  }

  public countDeliveries(): number {
    return this.deliveries.size;
  }

  public getDelivery(id: string): NotificationDeliveryRecord {
    return this.deliveries.get(id)!;
  }
}

test("handleRegistrationConfirmed creates one logical delivery per channel on duplicate events", async () => {
  const queue = new InMemoryQueue();
  const repository = new InMemoryNotificationRepository();
  const channels: INotificationChannel[] = [
    { name: "email", async send() { return { success: true, retryable: false }; } },
    { name: "in_app", async send() { return { success: true, retryable: false }; } }
  ];
  const service = new NotificationService(repository as never, queue, channels);

  const payload: RegistrationConfirmedQueuePayload = {
    registrationId: "reg-1",
    workshopId: "workshop-1",
    userId: "user-1",
    confirmedAt: new Date().toISOString()
  };

  await service.handleRegistrationConfirmed(payload);
  await service.handleRegistrationConfirmed(payload);

  assert.equal(repository.countDeliveries(), 2);
  assert.equal(queue.deliveryJobs.length, 4);
});

test("processNotificationDelivery marks sent on successful channel send", async () => {
  const queue = new InMemoryQueue();
  const repository = new InMemoryNotificationRepository();
  const channels: INotificationChannel[] = [
    { name: "email", async send() { return { success: true, retryable: false }; } },
    { name: "in_app", async send() { return { success: true, retryable: false }; } }
  ];
  const service = new NotificationService(repository as never, queue, channels);
  const created = await repository.upsertDelivery({
    eventId: "evt-1",
    eventType: "RegistrationConfirmed",
    registrationId: "reg-2",
    workshopId: "workshop-2",
    userId: "user-2",
    channel: "email"
  });

  await service.processNotificationDelivery({ deliveryId: created.id });
  assert.equal(repository.getDelivery(created.id).status, "sent");
  assert.equal(repository.getDelivery(created.id).attempt_count, 1);
});

test("processNotificationDelivery retries retryable failures and marks failed after max attempts", async () => {
  const queue = new InMemoryQueue();
  const repository = new InMemoryNotificationRepository();
  const channels: INotificationChannel[] = [
    {
      name: "email",
      async send() {
        return { success: false, retryable: true, error: "temporary outage" };
      }
    },
    { name: "in_app", async send() { return { success: true, retryable: false }; } }
  ];
  const service = new NotificationService(repository as never, queue, channels);
  const created = await repository.upsertDelivery({
    eventId: "evt-2",
    eventType: "RegistrationConfirmed",
    registrationId: "reg-3",
    workshopId: "workshop-3",
    userId: "user-3",
    channel: "email"
  });

  await assert.rejects(() => service.processNotificationDelivery({ deliveryId: created.id }));
  assert.equal(repository.getDelivery(created.id).status, "pending");
  assert.equal(repository.getDelivery(created.id).attempt_count, 1);

  await assert.rejects(() => service.processNotificationDelivery({ deliveryId: created.id }));
  assert.equal(repository.getDelivery(created.id).status, "pending");
  assert.equal(repository.getDelivery(created.id).attempt_count, 2);

  await service.processNotificationDelivery({ deliveryId: created.id });
  assert.equal(repository.getDelivery(created.id).status, "failed");
  assert.equal(repository.getDelivery(created.id).attempt_count, 3);
});

