export type SummaryStatus = "idle" | "processing" | "ready" | "fallback" | "failed";

export interface AiSummaryJobPayload {
  workshopId: string;
  traceId: string;
  pdfUrl: string;
}

export interface PdfUploadPayload {
  workshopId: string;
  fileName: string;
  contentType: string;
  bytes: Buffer;
}

export interface UploadPdfResponse {
  status: "processing";
  workshop_id: string;
}
