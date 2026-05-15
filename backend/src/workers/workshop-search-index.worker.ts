import type { WorkshopChangedQueuePayload } from "../modules/workshop/workshop.types.js";
import type { WorkshopSearchIndexService } from "../modules/workshop/workshop-search-index.service.js";

export class WorkshopSearchIndexWorker {
  public constructor(private readonly workshopSearchIndexService: WorkshopSearchIndexService) {}

  public async consume(payload: WorkshopChangedQueuePayload): Promise<void> {
    await this.workshopSearchIndexService.syncWorkshop(payload.workshopId);
  }
}
