import type { AiSummaryService } from "../modules/ai-summary/ai-summary.service.js";
import type { AiSummaryJobPayload } from "../modules/ai-summary/ai-summary.types.js";

export class AiSummaryWorker {
  public constructor(private readonly aiSummaryService: AiSummaryService) {}

  public async consume(payload: AiSummaryJobPayload): Promise<void> {
    // eslint-disable-next-line no-console
    console.log(`[ai-summary-worker] consume start trace=${payload.traceId} workshop=${payload.workshopId}`);
    try {
      await this.aiSummaryService.processSummaryJob(payload);
      // eslint-disable-next-line no-console
      console.log(`[ai-summary-worker] consume complete trace=${payload.traceId} workshop=${payload.workshopId}`);
    } catch (error: unknown) {
      // eslint-disable-next-line no-console
      console.error(`[ai-summary-worker] consume error trace=${payload.traceId} workshop=${payload.workshopId}`, error instanceof Error ? error.stack ?? error.message : error);
      throw error;
    }
  }
}
