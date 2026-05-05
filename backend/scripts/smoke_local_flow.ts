// Configure fast retry behavior for local smoke tests before importing service modules
process.env.AI_SUMMARY_MAX_RETRIES = process.env.AI_SUMMARY_MAX_RETRIES ?? "3";
process.env.AI_SUMMARY_RETRY_DELAY_MS = process.env.AI_SUMMARY_RETRY_DELAY_MS ?? "10";

import { randomUUID } from "node:crypto";
import { LocalPdfStorage } from "../src/modules/ai-summary/local-pdf.storage.js";
import { AiSummaryService } from "../src/modules/ai-summary/ai-summary.service.js";
import { QueueStub } from "../src/shared/infra/queue.js";

type SummaryStatus = "idle" | "processing" | "ready" | "fallback" | "failed";

interface WorkshopRecord {
  id: string;
  title: string;
  description: string;
  pdf_url: string | null;
  ai_summary: string | null;
  summary_status: SummaryStatus;
  summary_generated_at: Date | null;
  summary_error_code: string | null;
  updated_at: Date;
}

class InMemoryWorkshopWriter {
  private data = new Map<string, WorkshopRecord>();

  public async getWorkshopById(workshopId: string): Promise<WorkshopRecord | null> {
    return this.data.get(workshopId) ?? null;
  }

  public async markProcessing(workshopId: string, pdfUrl: string): Promise<void> {
    const existing = this.data.get(workshopId) ?? {
      id: workshopId,
      title: "smoke-test",
      description: "",
      pdf_url: null,
      ai_summary: null,
      summary_status: "idle" as SummaryStatus,
      summary_generated_at: null,
      summary_error_code: null,
      updated_at: new Date()
    };
    existing.pdf_url = pdfUrl;
    existing.ai_summary = null;
    existing.summary_status = "processing";
    existing.summary_generated_at = null;
    existing.summary_error_code = null;
    existing.updated_at = new Date();
    this.data.set(workshopId, existing);
  }

  public async markReady(workshopId: string, summary: string): Promise<void> {
    const existing = this.data.get(workshopId) ?? ({ id: workshopId } as WorkshopRecord);
    existing.ai_summary = summary;
    existing.summary_status = "ready";
    existing.summary_generated_at = new Date();
    existing.summary_error_code = null;
    existing.updated_at = new Date();
    this.data.set(workshopId, existing as WorkshopRecord);
  }

  public async markFallback(workshopId: string, summary: string): Promise<void> {
    const existing = this.data.get(workshopId) ?? ({ id: workshopId } as WorkshopRecord);
    existing.ai_summary = summary;
    existing.summary_status = "fallback";
    existing.summary_generated_at = null;
    existing.summary_error_code = "EMPTY_TEXT";
    existing.updated_at = new Date();
    this.data.set(workshopId, existing as WorkshopRecord);
  }

  public async markFailed(workshopId: string, errorCode: string): Promise<void> {
    const existing = this.data.get(workshopId) ?? ({ id: workshopId } as WorkshopRecord);
    existing.summary_status = "failed";
    existing.summary_error_code = errorCode;
    existing.updated_at = new Date();
    this.data.set(workshopId, existing as WorkshopRecord);
  }

  public async overrideSummary(workshopId: string, summary: string): Promise<void> {
    const existing = this.data.get(workshopId) ?? ({ id: workshopId } as WorkshopRecord);
    existing.ai_summary = summary;
    existing.summary_status = "ready";
    existing.summary_generated_at = new Date();
    existing.summary_error_code = null;
    existing.updated_at = new Date();
    this.data.set(workshopId, existing as WorkshopRecord);
  }
}

async function main() {
  const workshopId = "smoke-workshop-1";
  const writer = new InMemoryWorkshopWriter();
  // seed an empty workshop record
  await writer.overrideSummary(workshopId, "");

  const pdfStorage = new LocalPdfStorage();

  // Mock summarizer that can simulate rate-limit errors and eventual success.
  function makeMockSummarizer({ failTimes = 0, returnEmpty = false } = {}) {
    let calls = 0;
    return {
      async summarizeFromPdf(pdfBytes: Buffer) {
        calls += 1;
        if (returnEmpty) {
          return "";
        }
        if (calls <= failTimes) {
          throw new Error("429 Too Many Requests - simulated rate limit");
        }
        // For the smoke test, assume pdfBytes contains plain text for simplicity.
        const text = pdfBytes.toString("utf8").slice(0, 200);
        return `MOCK_SUMMARY: ${text}`;
      }
    } as any;
  }

  const queue = new QueueStub();
  // 1) Quick path: normal summarizer succeeds
  const normalSummarizer = makeMockSummarizer({ failTimes: 0, returnEmpty: false });
  const aiService = new AiSummaryService(writer as any, pdfStorage as any, normalSummarizer as any, queue as any);

  // wire queue to call the service's worker handler
  queue.setAiSummaryHandler(async (payload) => {
    await aiService.processSummaryJob(payload as any);
  });

  console.log("Starting local smoke flow test...");

  // --- Test A: normal content, ensure ready path ---
  const bytes = Buffer.from("This is sample PDF text content for smoke test. It will be extracted by the lightweight extractor in the service.");
  const uploadResponse = await aiService.uploadWorkshopPdf({ workshopId, fileName: "smoke.pdf", contentType: "application/pdf", bytes } as any);
  console.log("[Test A] Upload response:", uploadResponse);
  const after = await writer.getWorkshopById(workshopId);
  console.log("[Test A] State after processing:", after);

  // simulate duplicate deliveries for idempotency verification
  if (after && after.pdf_url) {
    const payload = { workshopId, traceId: randomUUID(), pdfUrl: after.pdf_url };
    console.log("[Test A] Simulating duplicate job delivery 1");
    await queue.enqueueAiSummaryGenerate(payload as any);
    console.log("[Test A] Simulating duplicate job delivery 2");
    await queue.enqueueAiSummaryGenerate(payload as any);
    const final = await writer.getWorkshopById(workshopId);
    console.log("[Test A] Final state after duplicate jobs:", final);
  }

  // --- Test B: empty-text PDF should result in fallback ---
  const emptyWorkshopId = "smoke-workshop-empty";
  await writer.overrideSummary(emptyWorkshopId, "");
  const bytesEmpty = Buffer.alloc(0);
  const aiServiceEmpty = new AiSummaryService(writer as any, pdfStorage as any, makeMockSummarizer({ returnEmpty: true }) as any, queue as any);
  const uploadEmpty = await aiServiceEmpty.uploadWorkshopPdf({ workshopId: emptyWorkshopId, fileName: "empty.pdf", contentType: "application/pdf", bytes: bytesEmpty } as any);
  console.log("[Test B] Upload (empty) response:", uploadEmpty);
  const afterEmpty = await writer.getWorkshopById(emptyWorkshopId);
  console.log("[Test B] State after processing (empty):", afterEmpty);

  // --- Test C: simulate Gemini rate-limit with retries ---
  const retryWorkshopId = "smoke-workshop-retry";
  await writer.overrideSummary(retryWorkshopId, "");
  const bytesRetry = Buffer.from("This text will trigger rate-limit simulation then succeed.");
  // summarizer will fail twice then succeed
  const flakySummarizer = makeMockSummarizer({ failTimes: 2, returnEmpty: false });
  const aiServiceRetry = new AiSummaryService(writer as any, pdfStorage as any, flakySummarizer as any, queue as any);
  const uploadRetry = await aiServiceRetry.uploadWorkshopPdf({ workshopId: retryWorkshopId, fileName: "retry.pdf", contentType: "application/pdf", bytes: bytesRetry } as any);
  console.log("[Test C] Upload (retry) response:", uploadRetry);
  const afterRetry = await writer.getWorkshopById(retryWorkshopId);
  console.log("[Test C] State after processing (retry):", afterRetry);

  console.log("Local smoke flow test complete.");
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
