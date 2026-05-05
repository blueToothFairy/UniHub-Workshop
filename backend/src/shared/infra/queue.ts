import { Redis } from "ioredis";
import { Queue, Worker, type JobsOptions } from "bullmq";
import type { AiSummaryJobPayload } from "../../modules/ai-summary/ai-summary.types.js";
import type { IQueue } from "../interfaces/IQueue.js";

const AI_SUMMARY_QUEUE_NAME = "ai-summary.generate";

type AiSummaryHandler = (payload: AiSummaryJobPayload) => Promise<void>;

export class BullMqQueue implements IQueue {
  private readonly connection: Redis;
  private readonly aiSummaryQueue: Queue<AiSummaryJobPayload>;
  private worker?: Worker<AiSummaryJobPayload>;

  public constructor(redisUrl: string) {
    this.connection = new Redis(redisUrl, { maxRetriesPerRequest: null });
    this.aiSummaryQueue = new Queue<AiSummaryJobPayload>(AI_SUMMARY_QUEUE_NAME, { connection: this.connection });
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

  public startAiSummaryWorker(handler: AiSummaryHandler): void {
    this.worker = new Worker<AiSummaryJobPayload>(
      AI_SUMMARY_QUEUE_NAME,
      async (job) => {
        await handler(job.data);
      },
      { connection: this.connection }
    );
  }

  public async close(): Promise<void> {
    await this.worker?.close();
    await this.aiSummaryQueue.close();
    await this.connection.quit();
  }
}

export class QueueStub implements IQueue {
  private aiSummaryHandler?: AiSummaryHandler;

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
}
