import type { QueryResultRow } from "pg";
import type { IDatabase } from "../../shared/interfaces/IDatabase.js";
import type {
  IWorkshopSearchGateway,
  WorkshopSearchDocument
} from "./workshop.types.js";

interface WorkshopSearchRow extends QueryResultRow {
  id: string;
  title: string;
  description: string;
  speaker_name: string;
  room: string;
  starts_at: Date;
  status: "draft" | "published" | "cancelled";
  price_vnd: number;
  payment_required: boolean;
  updated_at: Date;
}

export class WorkshopSearchIndexService {
  public constructor(
    private readonly database: IDatabase,
    private readonly searchGateway: IWorkshopSearchGateway
  ) {}

  public isConfigured(): boolean {
    return this.searchGateway.isConfigured();
  }

  public async syncWorkshop(workshopId: string): Promise<void> {
    if (!this.searchGateway.isConfigured()) return;

    const workshop = await this.findWorkshop(workshopId);
    if (!workshop || workshop.status !== "published") {
      await this.searchGateway.removeWorkshopDocument(workshopId);
      return;
    }

    await this.searchGateway.upsertWorkshopDocument(this.toSearchDocument(workshop));
  }

  public async rebuildIndex(): Promise<void> {
    await this.searchGateway.recreateIndex();

    const result = await this.database.query<WorkshopSearchRow>(
      `SELECT id, title, description, speaker_name, room, starts_at, status, price_vnd, payment_required, updated_at
       FROM workshops
       WHERE status = 'published'
       ORDER BY updated_at DESC`
    );

    for (const row of result.rows) {
      await this.searchGateway.upsertWorkshopDocument(this.toSearchDocument(row));
    }
  }

  private async findWorkshop(workshopId: string): Promise<WorkshopSearchRow | null> {
    const result = await this.database.query<WorkshopSearchRow>(
      `SELECT id, title, description, speaker_name, room, starts_at, status, price_vnd, payment_required, updated_at
       FROM workshops
       WHERE id=$1
       LIMIT 1`,
      [workshopId]
    );

    return result.rows[0] ?? null;
  }

  private toSearchDocument(row: WorkshopSearchRow): WorkshopSearchDocument {
    return {
      id: row.id,
      title: row.title,
      description: row.description,
      speakerName: row.speaker_name,
      room: row.room,
      startsAt: row.starts_at.toISOString(),
      status: row.status,
      paymentRequired: row.payment_required || row.price_vnd > 0,
      updatedAt: row.updated_at.toISOString()
    };
  }
}
