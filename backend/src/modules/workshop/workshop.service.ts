import type { AdminService } from "../admin/admin.service.js";
import { AppError } from "../../shared/errors/AppError.js";
import type { Workshop as AdminWorkshop } from "../admin/admin.types.js";
import type {
  IWorkshopSearchGateway,
  WorkshopDetailResponse,
  WorkshopDiscoveryPaymentFilter,
  WorkshopDiscoveryQuery,
  WorkshopDiscoveryQueryInput,
  WorkshopListItem,
  WorkshopListResponse
} from "./workshop.types.js";

export class WorkshopService {
  public constructor(
    private readonly adminService: AdminService,
    private readonly workshopSearchGateway: IWorkshopSearchGateway
  ) {}

  public async getWorkshopDetail(id: string): Promise<WorkshopDetailResponse> {
    const workshop = await this.adminService.getWorkshopDetail(id);

    // For public/student view we must not surface a previous summary while a new
    // one is being processed. Ensure the public DTO hides any aiSummary when
    // `summaryStatus` is `processing` to avoid showing stale content.
    if (workshop.summaryStatus === "processing") {
      return {
        ...workshop,
        aiSummary: null,
        summaryGeneratedAt: null,
        summaryErrorCode: null
      };
    }

    return workshop;
  }

  public async listWorkshopsForThisMonth(input: WorkshopDiscoveryQueryInput = {}, referenceIso?: string): Promise<WorkshopListResponse> {
    const all = await this.adminService.listWorkshops();
    const query = this.normalizeDiscoveryQuery(input);
    const ref = referenceIso ? new Date(referenceIso) : new Date();
    const year = ref.getFullYear();
    const month = ref.getMonth();
    const monthStartIso = new Date(year, month, 1, 0, 0, 0, 0).toISOString();
    const monthEndIso = new Date(year, month + 1, 0, 23, 59, 59, 999).toISOString();

    let filtered: AdminWorkshop[];
    if (query.q) {
      const hits = await this.workshopSearchGateway.searchWorkshops({
        query: query.q,
        monthStartIso,
        monthEndIso,
        payment: query.payment === "all" ? undefined : query.payment,
        limit: 50
      });
      const byId = new Map(all.map((workshop) => [workshop.id, workshop]));
      filtered = hits
        .map((hit) => byId.get(hit.id))
        .filter((workshop): workshop is AdminWorkshop => Boolean(workshop))
        .filter((workshop) => this.matchesDefaultScope(workshop, year, month))
        .filter((workshop) => this.matchesAvailability(workshop, query.availableOnly))
        .filter((workshop) => this.matchesPayment(workshop, query.payment));
    } else {
      filtered = all
        .filter((workshop) => this.matchesDefaultScope(workshop, year, month))
        .filter((workshop) => this.matchesAvailability(workshop, query.availableOnly))
        .filter((workshop) => this.matchesPayment(workshop, query.payment));
    }

    const registrations = filtered.reduce((sum, w) => sum + (w.confirmedRegistrations ?? 0), 0);
    return {
      stats: { workshopsThisMonth: filtered.length, registrationsThisMonth: registrations },
      workshops: filtered.map((workshop) => this.toWorkshopListItem(workshop))
    };
  }

  private toWorkshopListItem(workshop: AdminWorkshop): WorkshopListItem {
    return {
      ...workshop,
      location: workshop.room
    };
  }

  private normalizeDiscoveryQuery(input: WorkshopDiscoveryQueryInput): WorkshopDiscoveryQuery {
    const q = this.singleValue(input.q)?.trim() ?? "";
    const paymentRaw = this.singleValue(input.payment) ?? "all";
    const availableOnlyRaw = this.singleValue(input.available_only) ?? "false";

    if (!["all", "free", "paid"].includes(paymentRaw)) {
      throw new AppError(400, "INVALID_DISCOVERY_QUERY", "payment must be one of all, free, or paid");
    }

    if (!["true", "false", "1", "0", ""].includes(availableOnlyRaw)) {
      throw new AppError(400, "INVALID_DISCOVERY_QUERY", "available_only must be a boolean flag");
    }

    return {
      q,
      payment: paymentRaw as WorkshopDiscoveryPaymentFilter,
      availableOnly: availableOnlyRaw === "true" || availableOnlyRaw === "1"
    };
  }

  private singleValue(input?: string | string[]): string | undefined {
    if (Array.isArray(input)) {
      return input[0];
    }
    return input;
  }

  private matchesDefaultScope(workshop: AdminWorkshop, year: number, month: number): boolean {
    try {
      if (workshop.status !== "published") return false;
      const startsAt = new Date(workshop.startsAt);
      return startsAt.getFullYear() === year && startsAt.getMonth() === month;
    } catch {
      return false;
    }
  }

  private matchesAvailability(workshop: AdminWorkshop, availableOnly: boolean): boolean {
    return !availableOnly || workshop.availableSeats > 0;
  }

  private matchesPayment(workshop: AdminWorkshop, payment: WorkshopDiscoveryPaymentFilter): boolean {
    if (payment === "all") return true;
    if (payment === "free") return !workshop.paymentRequired;
    return workshop.paymentRequired;
  }
}
