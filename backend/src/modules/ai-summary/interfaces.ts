import type { SummaryStatus } from "./ai-summary.types.js";

export interface WorkshopSummaryRecord {
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

export interface IWorkshopSummaryWriter {
  getWorkshopById(workshopId: string): Promise<WorkshopSummaryRecord | null>;
  markProcessing(workshopId: string, pdfUrl: string): Promise<void>;
  markReady(workshopId: string, summary: string): Promise<void>;
  markFallback(workshopId: string, summary: string): Promise<void>;
  markFailed(workshopId: string, errorCode: string): Promise<void>;
  overrideSummary(workshopId: string, summary: string): Promise<void>;
}

export interface IPdfStorage {
  putPdf(workshopId: string, fileName: string, bytes: Buffer): Promise<string>;
  getPdf(url: string): Promise<Buffer>;
}

export interface IAiSummarizer {
  summarizeVietnamese(input: string): Promise<string>;
  // Summarize directly from a PDF file's bytes. Implementations SHOULD extract text server-side
  // or use a model/file-upload feature — caller will provide raw PDF bytes.
  summarizeFromPdf(pdfBytes: Buffer): Promise<string>;
}
