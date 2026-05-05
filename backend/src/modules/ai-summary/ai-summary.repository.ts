import type { QueryResultRow } from "pg";
import type { IDatabase } from "../../shared/interfaces/IDatabase.js";
import type { IWorkshopSummaryWriter, WorkshopSummaryRecord } from "./interfaces.js";

interface WorkshopSummaryRow extends QueryResultRow {
  id: string;
  title: string;
  description: string;
  pdf_url: string | null;
  ai_summary: string | null;
  summary_status: "idle" | "processing" | "ready" | "fallback" | "failed";
  summary_generated_at: Date | null;
  summary_error_code: string | null;
  updated_at: Date;
}

export class WorkshopSummaryRepository implements IWorkshopSummaryWriter {
  public constructor(private readonly database: IDatabase) {}

  public async getWorkshopById(workshopId: string): Promise<WorkshopSummaryRecord | null> {
    const result = await this.database.query<WorkshopSummaryRow>("SELECT * FROM workshops WHERE id=$1 LIMIT 1", [workshopId]);
    return result.rows[0] ?? null;
  }

  public async markProcessing(workshopId: string, pdfUrl: string): Promise<void> {
    await this.database.query(
      `UPDATE workshops
       SET pdf_url=$2, ai_summary=NULL, summary_status='processing', summary_generated_at=NULL, summary_error_code=NULL, updated_at=NOW()
       WHERE id=$1`,
      [workshopId, pdfUrl]
    );
  }

  public async markReady(workshopId: string, summary: string): Promise<void> {
    await this.database.query(
      `UPDATE workshops
       SET ai_summary=$2, summary_status='ready', summary_generated_at=NOW(), summary_error_code=NULL, updated_at=NOW()
       WHERE id=$1`,
      [workshopId, summary]
    );
  }

  public async markFallback(workshopId: string, summary: string): Promise<void> {
    await this.database.query(
      `UPDATE workshops
       SET ai_summary=$2, summary_status='fallback', summary_generated_at=NULL, summary_error_code='EMPTY_TEXT', updated_at=NOW()
       WHERE id=$1`,
      [workshopId, summary]
    );
  }

  public async markFailed(workshopId: string, errorCode: string): Promise<void> {
    await this.database.query(
      `UPDATE workshops
       SET summary_status='failed', summary_error_code=$2, updated_at=NOW()
       WHERE id=$1`,
      [workshopId, errorCode]
    );
  }

  public async overrideSummary(workshopId: string, summary: string): Promise<void> {
    await this.database.query(
      `UPDATE workshops
       SET ai_summary=$2, summary_status='ready', summary_generated_at=NOW(), summary_error_code=NULL, updated_at=NOW()
       WHERE id=$1`,
      [workshopId, summary]
    );
  }
}
