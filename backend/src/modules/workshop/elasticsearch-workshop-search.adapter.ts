import { Buffer } from "node:buffer";
import { AppError } from "../../shared/errors/AppError.js";
import type {
  IWorkshopSearchGateway,
  WorkshopSearchDocument,
  WorkshopSearchHit,
  WorkshopSearchRequest
} from "./workshop.types.js";

interface ElasticsearchConfig {
  baseUrl: string;
  indexName: string;
  apiKey: string;
  username: string;
  password: string;
  requestTimeoutMs: number;
}

interface ElasticsearchSearchResponse {
  hits?: {
    hits?: Array<{
      _id?: string;
      _score?: number;
    }>;
  };
}

export class ElasticsearchWorkshopSearchAdapter implements IWorkshopSearchGateway {
  private readonly config: ElasticsearchConfig;
  private indexEnsured: boolean;

  public constructor(config?: Partial<ElasticsearchConfig>) {
    this.config = {
      baseUrl: config?.baseUrl ?? (process.env.ELASTICSEARCH_URL ?? "").trim(),
      indexName: config?.indexName ?? (process.env.ELASTICSEARCH_INDEX ?? "unihub-workshops").trim(),
      apiKey: config?.apiKey ?? (process.env.ELASTICSEARCH_API_KEY ?? "").trim(),
      username: config?.username ?? (process.env.ELASTICSEARCH_USERNAME ?? "").trim(),
      password: config?.password ?? (process.env.ELASTICSEARCH_PASSWORD ?? "").trim(),
      requestTimeoutMs: config?.requestTimeoutMs ?? Number(process.env.ELASTICSEARCH_REQUEST_TIMEOUT_MS ?? 5_000)
    };
    this.indexEnsured = false;
  }

  public isConfigured(): boolean {
    return this.config.baseUrl.length > 0;
  }

  public async ensureIndex(): Promise<void> {
    this.assertConfiguredForMutation();
    if (this.indexEnsured) return;

    const exists = await this.request(`/${this.config.indexName}`, { method: "HEAD" });
    if (!exists.ok) {
      await this.expectOk(
        this.request(`/${this.config.indexName}`, {
          method: "PUT",
          body: JSON.stringify({
            mappings: {
              properties: {
                title: { type: "text" },
                description: { type: "text" },
                speakerName: { type: "text" },
                room: { type: "text" },
                startsAt: { type: "date" },
                status: { type: "keyword" },
                paymentRequired: { type: "boolean" },
                updatedAt: { type: "date" }
              }
            }
          })
        }),
        "WORKSHOP_SEARCH_UNAVAILABLE",
        "Failed to create workshop search index"
      );
    }

    this.indexEnsured = true;
  }

  public async recreateIndex(): Promise<void> {
    this.assertConfiguredForMutation();
    await this.request(`/${this.config.indexName}`, { method: "DELETE" });
    this.indexEnsured = false;
    await this.ensureIndex();
  }

  public async searchWorkshops(input: WorkshopSearchRequest): Promise<WorkshopSearchHit[]> {
    this.assertConfiguredForSearch();
    await this.ensureIndex();

    const filters: unknown[] = [
      { term: { status: "published" } },
      {
        range: {
          startsAt: {
            gte: input.monthStartIso,
            lte: input.monthEndIso
          }
        }
      }
    ];

    if (input.payment === "free") {
      filters.push({ term: { paymentRequired: false } });
    }
    if (input.payment === "paid") {
      filters.push({ term: { paymentRequired: true } });
    }

    const response = await this.expectJson<ElasticsearchSearchResponse>(
      this.request(`/${this.config.indexName}/_search`, {
        method: "POST",
        body: JSON.stringify({
          size: input.limit,
          query: {
            bool: {
              must: [
                {
                  multi_match: {
                    query: input.query,
                    fields: ["title^3", "speakerName^2", "description", "room"],
                    fuzziness: "AUTO"
                  }
                }
              ],
              filter: filters
            }
          },
          sort: [{ _score: "desc" }, { startsAt: "asc" }]
        })
      }),
      "WORKSHOP_SEARCH_UNAVAILABLE",
      "Workshop search is temporarily unavailable"
    );

    return (response.hits?.hits ?? [])
      .map((hit) => ({
        id: hit._id ?? "",
        score: typeof hit._score === "number" ? hit._score : 0
      }))
      .filter((hit) => hit.id.length > 0);
  }

  public async upsertWorkshopDocument(document: WorkshopSearchDocument): Promise<void> {
    this.assertConfiguredForMutation();
    await this.ensureIndex();

    await this.expectOk(
      this.request(`/${this.config.indexName}/_doc/${encodeURIComponent(document.id)}`, {
        method: "PUT",
        body: JSON.stringify(document)
      }),
      "WORKSHOP_INDEX_SYNC_FAILED",
      "Failed to upsert workshop search document"
    );
  }

  public async removeWorkshopDocument(workshopId: string): Promise<void> {
    this.assertConfiguredForMutation();
    await this.ensureIndex();

    const response = await this.request(`/${this.config.indexName}/_doc/${encodeURIComponent(workshopId)}`, {
      method: "DELETE"
    });
    if (response.ok || response.status === 404) {
      return;
    }

    throw new Error("Failed to remove workshop search document");
  }

  private assertConfiguredForSearch(): void {
    if (!this.isConfigured()) {
      throw new AppError(503, "WORKSHOP_SEARCH_UNAVAILABLE", "Workshop search is temporarily unavailable");
    }
  }

  private assertConfiguredForMutation(): void {
    if (!this.isConfigured()) {
      throw new Error("Elasticsearch is not configured");
    }
  }

  private async request(path: string, init?: RequestInit): Promise<Response> {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), this.config.requestTimeoutMs);

    try {
      return await fetch(`${this.config.baseUrl}${path}`, {
        ...init,
        headers: {
          Accept: "application/json",
          "Content-Type": "application/json",
          ...this.buildAuthHeader(),
          ...(init?.headers ?? {})
        },
        signal: controller.signal
      });
    } catch (error: unknown) {
      if (error instanceof AppError) throw error;
      throw new Error(error instanceof Error ? error.message : "Elasticsearch request failed");
    } finally {
      clearTimeout(timeout);
    }
  }

  private async expectJson<T>(responsePromise: Promise<Response>, code: string, message: string): Promise<T> {
    const response = await responsePromise;
    if (!response.ok) {
      throw new AppError(503, code, message);
    }
    return (await response.json()) as T;
  }

  private async expectOk(responsePromise: Promise<Response>, code: string, message: string): Promise<void> {
    const response = await responsePromise;
    if (!response.ok) {
      throw new AppError(503, code, message);
    }
  }

  private buildAuthHeader(): Record<string, string> {
    if (this.config.apiKey) {
      return { Authorization: `ApiKey ${this.config.apiKey}` };
    }
    if (this.config.username && this.config.password) {
      return {
        Authorization: `Basic ${Buffer.from(`${this.config.username}:${this.config.password}`).toString("base64")}`
      };
    }
    return {};
  }
}
