import assert from "node:assert/strict";
import test from "node:test";
import { RegistrationService } from "./registration.service.js";
import type { IQueue } from "../../shared/interfaces/IQueue.js";
import type { AiSummaryJobPayload } from "../ai-summary/ai-summary.types.js";
import type { NotificationDeliveryQueuePayload, RegistrationConfirmedQueuePayload } from "../notification/notification.types.js";

class ThrowingQueue implements IQueue {
  public async enqueueWorkshopChanged(): Promise<void> {}
  public async enqueueAiSummaryGenerate(_payload: AiSummaryJobPayload): Promise<void> {}
  public async enqueueRegistrationConfirmed(_payload: RegistrationConfirmedQueuePayload): Promise<void> {
    throw new Error("queue unavailable");
  }
  public async enqueueNotificationDelivery(_payload: NotificationDeliveryQueuePayload): Promise<void> {}
}

test("registration enqueue helper swallows notification queue errors", async () => {
  const service = new RegistrationService(new ThrowingQueue());
  await assert.doesNotReject(async () => {
    await (service as unknown as {
      tryEnqueueRegistrationConfirmed: (payload: RegistrationConfirmedQueuePayload, source: string) => Promise<void>;
    }).tryEnqueueRegistrationConfirmed({
      registrationId: "reg-1",
      workshopId: "workshop-1",
      userId: "user-1",
      confirmedAt: new Date().toISOString()
    }, "test");
  });
});

