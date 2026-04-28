import type {
  CheckinTodayResponse,
  PaymentSummaryResponse,
  StatsResponse
} from "../../modules/admin-dashboard/admin-dashboard.types.js";

interface IDashboardRepository {
  getStats(): Promise<StatsResponse>;
  getPaymentSummary(): Promise<PaymentSummaryResponse>;
  getCheckinToday(): Promise<CheckinTodayResponse>;
}

export type { IDashboardRepository };
