import type { AdminService } from "../admin/admin.service.js";
import type { WorkshopDetailResponse } from "./workshop.types.js";

export class WorkshopService {
  public constructor(private readonly adminService: AdminService) {}

  public async getWorkshopDetail(id: string): Promise<WorkshopDetailResponse> {
    return this.adminService.getWorkshopDetail(id);
  }
}
