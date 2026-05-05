import { randomUUID } from "node:crypto";
import { AppError } from "../../shared/errors/AppError.js";
import type { IQueue } from "../../shared/interfaces/IQueue.js";
import type { IAiSummarizer, IPdfStorage, IWorkshopSummaryWriter } from "./interfaces.js";
import type { AiSummaryJobPayload, PdfUploadPayload, UploadPdfResponse } from "./ai-summary.types.js";

const MAX_PDF_SIZE_BYTES = Number(process.env.AI_SUMMARY_MAX_PDF_SIZE_BYTES ?? 10 * 1024 * 1024);
const EMPTY_TEXT_FALLBACK = process.env.AI_SUMMARY_EMPTY_TEXT_FALLBACK ?? "Khong the tao tom tat tu dong tu file PDF nay. Vui long nhap mo ta thu cong.";
const MAX_TEXT_CHARS = Number(process.env.AI_SUMMARY_MAX_TEXT_CHARS ?? 32_000);
const MAX_RETRIES = Number(process.env.AI_SUMMARY_MAX_RETRIES ?? 3);
const RETRY_DELAY_MS = Number(process.env.AI_SUMMARY_RETRY_DELAY_MS ?? 60_000);

export class AiSummaryService {
  public constructor(
    private readonly workshopSummaryWriter: IWorkshopSummaryWriter,
    private readonly pdfStorage: IPdfStorage,
    private readonly summarizer: IAiSummarizer,
    private readonly queue: IQueue
  ) {}

  public async uploadWorkshopPdf(input: PdfUploadPayload): Promise<UploadPdfResponse> {
    if (input.contentType !== "application/pdf") {
      throw new AppError(400, "INVALID_PDF_TYPE", "Only application/pdf is allowed");
    }
    if (input.bytes.length > MAX_PDF_SIZE_BYTES) {
      throw new AppError(400, "PDF_TOO_LARGE", "PDF must be <= 10MB");
    }

    const workshop = await this.workshopSummaryWriter.getWorkshopById(input.workshopId);
    if (!workshop) {
      throw new AppError(404, "WORKSHOP_NOT_FOUND", "Workshop does not exist");
    }

    const traceId = randomUUID();
    // eslint-disable-next-line no-console
    console.log(`[ai-summary] upload start workshop=${input.workshopId} file=${input.fileName} size=${input.bytes.length}`);
    const pdfUrl = await this.pdfStorage.putPdf(input.workshopId, input.fileName, input.bytes);
    // eslint-disable-next-line no-console
    console.log(`[ai-summary] uploaded to storage workshop=${input.workshopId} url=${pdfUrl}`);
    await this.workshopSummaryWriter.markProcessing(input.workshopId, pdfUrl);
    // eslint-disable-next-line no-console
    console.log(`[ai-summary] marked processing workshop=${input.workshopId}`);
    await this.queue.enqueueAiSummaryGenerate({ workshopId: input.workshopId, traceId, pdfUrl });
    // eslint-disable-next-line no-console
    console.log(`[ai-summary] enqueued ai summary job workshop=${input.workshopId} trace=${traceId}`);

    return { status: "processing", workshop_id: input.workshopId };
  }

  public async overrideWorkshopSummary(workshopId: string, summary: string): Promise<void> {
    if (!summary.trim()) {
      throw new AppError(400, "INVALID_SUMMARY", "Summary must not be empty");
    }
    const workshop = await this.workshopSummaryWriter.getWorkshopById(workshopId);
    if (!workshop) {
      throw new AppError(404, "WORKSHOP_NOT_FOUND", "Workshop does not exist");
    }
    await this.workshopSummaryWriter.overrideSummary(workshopId, summary.trim());
  }

  public async processSummaryJob(payload: AiSummaryJobPayload): Promise<void> {
    // eslint-disable-next-line no-console
    console.log(`[ai-summary] job start trace=${payload.traceId} workshop=${payload.workshopId} jobPdfUrl=${payload.pdfUrl}`);
    const workshop = await this.workshopSummaryWriter.getWorkshopById(payload.workshopId);
    if (!workshop || !workshop.pdf_url) {
      // eslint-disable-next-line no-console
      console.warn(`[ai-summary] job abort: workshop not found or missing pdf_url workshop=${payload.workshopId}`);
      return;
    }
    if (workshop.pdf_url !== payload.pdfUrl) {
      // Idempotency guard: stale/duplicate jobs for old PDF versions must not overwrite newer state.
      // eslint-disable-next-line no-console
      console.warn(`[ai-summary] job abort: stale job workshop=${payload.workshopId} currentPdf=${workshop.pdf_url} jobPdf=${payload.pdfUrl}`);
      return;
    }

    try {
      // eslint-disable-next-line no-console
      console.log(`[ai-summary] fetching pdf workshop=${payload.workshopId} url=${workshop.pdf_url}`);
      const pdfBytes = await this.pdfStorage.getPdf(workshop.pdf_url);
      // eslint-disable-next-line no-console
      console.log(`[ai-summary] fetched pdf bytes length=${pdfBytes ? pdfBytes.length : 0} workshop=${payload.workshopId}`);
      if (!pdfBytes || pdfBytes.length === 0) {
        // eslint-disable-next-line no-console
        console.warn(`[ai-summary] empty pdf bytes workshop=${payload.workshopId}`);
        await this.workshopSummaryWriter.markFallback(payload.workshopId, EMPTY_TEXT_FALLBACK);
        return;
      }

      // Summarize PDF (with retry logic inside)
      // eslint-disable-next-line no-console
      console.log(`[ai-summary] calling summarizer trace=${payload.traceId} workshop=${payload.workshopId}`);
      const summary = (await this.summarizePdfWithRetry(pdfBytes, payload.workshopId, payload.traceId)).trim();
      // eslint-disable-next-line no-console
      console.log(`[ai-summary] summarizer returned length=${summary.length} trace=${payload.traceId} workshop=${payload.workshopId}`);
      if (!summary) {
        // eslint-disable-next-line no-console
        console.warn(`[ai-summary] summarizer returned empty summary workshop=${payload.workshopId}`);
        await this.workshopSummaryWriter.markFallback(payload.workshopId, EMPTY_TEXT_FALLBACK);
        return;
      }

      // Persist summary
      // eslint-disable-next-line no-console
      console.log(`[ai-summary] persisting summary len=${summary.length} workshop=${payload.workshopId} trace=${payload.traceId}`);
      await this.workshopSummaryWriter.markReady(payload.workshopId, summary);
      // eslint-disable-next-line no-console
      console.log(`[ai-summary] markReady complete workshop=${payload.workshopId} trace=${payload.traceId}`);
    } catch (error: unknown) {
      // Log error details for debugging and mark failure in DB
      // eslint-disable-next-line no-console
      console.error(`[ai-summary] processing error trace=${payload.traceId} workshop=${payload.workshopId}`, error instanceof Error ? error.stack ?? error.message : error);
      await this.workshopSummaryWriter.markFailed(payload.workshopId, "SUMMARY_PROCESSING_ERROR");
    }
  }

  private extractText(pdfBytes: Buffer): string {
    // Lightweight fallback extraction: decode printable chars.
    // Keeps the seam ready for pdf-parse adapter without changing service logic.
    return pdfBytes.toString("utf8").replace(/[^\x09\x0A\x0D\x20-\x7E]/g, " ").replace(/\s+/g, " ");
  }

  private async summarizeWithRetry(input: string, workshopId: string, traceId: string): Promise<string> {
    let attempt = 0;
    // eslint-disable-next-line no-constant-condition
    while (true) {
      attempt += 1;
      const startedAt = Date.now();
      try {
        const summary = await this.summarizer.summarizeVietnamese(input);
        // eslint-disable-next-line no-console
        console.log(`[ai-summary] trace=${traceId} workshop=${workshopId} attempt=${attempt} status=ok latency_ms=${Date.now() - startedAt}`);
        return summary;
      } catch (error: unknown) {
        const message = error instanceof Error ? error.message : "UNKNOWN_ERROR";
        // eslint-disable-next-line no-console
        console.warn(`[ai-summary] trace=${traceId} workshop=${workshopId} attempt=${attempt} status=error reason=${message}`);
        const isRetryable = /rate|429|temporar|timeout|5\\d\\d/i.test(message);
        if (!isRetryable || attempt >= MAX_RETRIES) {
          throw error;
        }
        await delay(RETRY_DELAY_MS);
      }
    }
  }

  private async summarizePdfWithRetry(pdfBytes: Buffer, workshopId: string, traceId: string): Promise<string> {
    let attempt = 0;
    // eslint-disable-next-line no-constant-condition
    while (true) {
      attempt += 1;
      const startedAt = Date.now();
      try {
        const summary = await this.summarizer.summarizeFromPdf(pdfBytes);
        // eslint-disable-next-line no-console
        console.log(`[ai-summary] trace=${traceId} workshop=${workshopId} attempt=${attempt} status=ok latency_ms=${Date.now() - startedAt}`);
        return summary;
      } catch (error: unknown) {
        const message = error instanceof Error ? error.message : "UNKNOWN_ERROR";
        // eslint-disable-next-line no-console
        console.warn(`[ai-summary] trace=${traceId} workshop=${workshopId} attempt=${attempt} status=error reason=${message}`);
        const isRetryable = /rate|429|temporar|timeout|5\\d\\d/i.test(message);
        if (!isRetryable || attempt >= MAX_RETRIES) {
          throw error;
        }
        await delay(RETRY_DELAY_MS);
      }
    }
  }
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
