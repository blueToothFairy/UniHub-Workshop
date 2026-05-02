import type { IQueue } from "../interfaces/IQueue.js";

export class QueueStub implements IQueue {
  public async enqueueWorkshopChanged(_workshopId: string, _reason: string): Promise<void> {
    return Promise.resolve();
  }
}
