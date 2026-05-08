import type { AdminService } from "../admin/admin.service.js";
import type { WorkshopDetailResponse } from "./workshop.types.js";
import type { Workshop as AdminWorkshop } from "../admin/admin.types.js";

export class WorkshopService {
  public constructor(private readonly adminService: AdminService) {}

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

  public async listWorkshopsForThisMonth(referenceIso?: string): Promise<{ stats: { workshopsThisMonth: number; registrationsThisMonth: number }; workshops: AdminWorkshop[] }> {
    const all = await this.adminService.listWorkshops();
    const ref = referenceIso ? new Date(referenceIso) : new Date();
    const year = ref.getFullYear();
    const month = ref.getMonth();

    const filtered = all.filter((w) => {
      try {
        if (w.status !== "published") return false;
        const s = new Date(w.startsAt);
        return s.getFullYear() === year && s.getMonth() === month;
      } catch {
        return false;
      }
    });

    const registrations = filtered.reduce((sum, w) => sum + (w.confirmedRegistrations ?? 0), 0);
    return { stats: { workshopsThisMonth: filtered.length, registrationsThisMonth: registrations }, workshops: filtered };
  }
}
