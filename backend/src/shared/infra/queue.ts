import { Redis } from "ioredis";
import { Queue, Worker, type JobsOptions } from "bullmq";
import type { AiSummaryJobPayload } from "../../modules/ai-summary/ai-summary.types.js";
import type {
  NotificationDeliveryQueuePayload,
  RegistrationConfirmedQueuePayload
} from "../../modules/notification/notification.types.js";
import type { IQueue } from "../interfaces/IQueue.js";

const AI_SUMMARY_QUEUE_NAME = "ai-summary.generate";
const REGISTRATION_CONFIRMED_QUEUE_NAME = "notification.registration-confirmed";
const NOTIFICATION_DELIVERY_QUEUE_NAME = "notification.delivery";

type AiSummaryHandler = (payload: AiSummaryJobPayload) => Promise<void>;
type RegistrationConfirmedHandler = (payload: RegistrationConfirmedQueuePayload) => Promise<void>;
type NotificationDeliveryHandler = (payload: NotificationDeliveryQueuePayload) => Promise<void>;

export class BullMqQueue implements IQueue {
  private readonly connection: Redis;
  private readonly aiSummaryQueue: Queue<AiSummaryJobPayload>;
  private readonly registrationConfirmedQueue: Queue<RegistrationConfirmedQueuePayload>;
  private readonly notificationDeliveryQueue: Queue<NotificationDeliveryQueuePayload>;
  private aiSummaryWorker?: Worker<AiSummaryJobPayload>;
  private registrationConfirmedWorker?: Worker<RegistrationConfirmedQueuePayload>;
  private notificationDeliveryWorker?: Worker<NotificationDeliveryQueuePayload>;

  public constructor(redisUrl: string) {
    this.connection = new Redis(redisUrl, { maxRetriesPerRequest: null });
    this.aiSummaryQueue = new Queue<AiSummaryJobPayload>(AI_SUMMARY_QUEUE_NAME, { connection: this.connection });
    this.registrationConfirmedQueue = new Queue<RegistrationConfirmedQueuePayload>(REGISTRATION_CONFIRMED_QUEUE_NAME, { connection: this.connection });
    this.notificationDeliveryQueue = new Queue<NotificationDeliveryQueuePayload>(NOTIFICATION_DELIVERY_QUEUE_NAME, { connection: this.connection });
  }

  public async enqueueWorkshopChanged(_workshopId: string, _reason: string): Promise<void> {
    return Promise.resolve();
  }

  public async enqueueAiSummaryGenerate(payload: AiSummaryJobPayload): Promise<void> {
    const options: JobsOptions = {
      attempts: 3,
      backoff: { type: "fixed", delay: 60_000 },
      removeOnComplete: true,
      removeOnFail: false
    };

    await this.aiSummaryQueue.add(`summary:${payload.workshopId}:${payload.traceId}`, payload, options);
  }

  public async enqueueRegistrationConfirmed(payload: RegistrationConfirmedQueuePayload): Promise<void> {
    const options: JobsOptions = {
      attempts: 3,
      backoff: { type: "fixed", delay: 15_000 },
      removeOnComplete: true,
      removeOnFail: false,
      jobId: `registration-confirmed-${payload.registrationId}`
    };

    await this.registrationConfirmedQueue.add(`registration-confirmed:${payload.registrationId}`, payload, options);
  }

  public async enqueueNotificationDelivery(payload: NotificationDeliveryQueuePayload): Promise<void> {
    const options: JobsOptions = {
      attempts: 3,
      backoff: { type: "fixed", delay: 10_000 },
      removeOnComplete: true,
      removeOnFail: false,
      jobId: `notification-delivery-${payload.deliveryId}`
    };
    await this.notificationDeliveryQueue.add(`notification-delivery:${payload.deliveryId}`, payload, options);
  }

  public startAiSummaryWorker(handler: AiSummaryHandler): void {
    this.aiSummaryWorker = new Worker<AiSummaryJobPayload>(
      AI_SUMMARY_QUEUE_NAME,
      async (job) => {
        await handler(job.data);
      },
      { connection: this.connection }
    );
  }

  public startRegistrationConfirmedWorker(handler: RegistrationConfirmedHandler): void {
    this.registrationConfirmedWorker = new Worker<RegistrationConfirmedQueuePayload>(
      REGISTRATION_CONFIRMED_QUEUE_NAME,
      async (job) => {
        await handler(job.data);
      },
      { connection: this.connection }
    );
  }

  public startNotificationDeliveryWorker(handler: NotificationDeliveryHandler): void {
    this.notificationDeliveryWorker = new Worker<NotificationDeliveryQueuePayload>(
      NOTIFICATION_DELIVERY_QUEUE_NAME,
      async (job) => {
        await handler(job.data);
      },
      { connection: this.connection }
    );
  }

  public async close(): Promise<void> {
    await this.aiSummaryWorker?.close();
    await this.registrationConfirmedWorker?.close();
    await this.notificationDeliveryWorker?.close();
    await this.aiSummaryQueue.close();
    await this.registrationConfirmedQueue.close();
    await this.notificationDeliveryQueue.close();
    await this.connection.quit();
  }
}

export class QueueStub implements IQueue {
  private aiSummaryHandler?: AiSummaryHandler;
  private registrationConfirmedHandler?: RegistrationConfirmedHandler;
  private notificationDeliveryHandler?: NotificationDeliveryHandler;

  public setAiSummaryHandler(handler: AiSummaryHandler): void {
    this.aiSummaryHandler = handler;
  }

  public async enqueueWorkshopChanged(_workshopId: string, _reason: string): Promise<void> {
    return Promise.resolve();
  }

  public async enqueueAiSummaryGenerate(payload: AiSummaryJobPayload): Promise<void> {
    if (this.aiSummaryHandler) {
      await this.aiSummaryHandler(payload);
    }
  }

  public setRegistrationConfirmedHandler(handler: RegistrationConfirmedHandler): void {
    this.registrationConfirmedHandler = handler;
  }

  public setNotificationDeliveryHandler(handler: NotificationDeliveryHandler): void {
    this.notificationDeliveryHandler = handler;
  }

  public async enqueueRegistrationConfirmed(payload: RegistrationConfirmedQueuePayload): Promise<void> {
    if (this.registrationConfirmedHandler) {
      await this.registrationConfirmedHandler(payload);
    }
  }

  public async enqueueNotificationDelivery(payload: NotificationDeliveryQueuePayload): Promise<void> {
    if (this.notificationDeliveryHandler) {
      await this.notificationDeliveryHandler(payload);
    }
  }
}
