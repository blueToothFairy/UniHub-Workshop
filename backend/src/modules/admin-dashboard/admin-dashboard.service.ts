import type {
  CheckinTodayResponse,
  PaymentSummaryResponse,
  StatsResponse
} from "./admin-dashboard.types.js";

async function getStats(): Promise<StatsResponse> {
  return {
    generatedAt: new Date().toISOString(),
    totalWorkshops: 0,
    totalRegistrations: 0,
    activeRegistrations: 0,
    totalPaymentCollected: 0,
    pendingPayments: 0,
    checkinCountToday: 0,
    cancellationRate: 0
  };
}

async function getPaymentSummary(): Promise<PaymentSummaryResponse> {
  return {
    generatedAt: new Date().toISOString(),
    totalRevenue: 0,
    pendingPayments: 0,
    failedPayments: 0,
    refundedPayments: 0,
    paymentDistributionByWorkshop: [],
    anomalies: []
  };
}

async function getCheckinToday(): Promise<CheckinTodayResponse> {
  return {
    generatedAt: new Date().toISOString(),
    filters: {
      room: null,
      fromTime: null,
      toTime: null
    },
    workshops: []
  };
}

export { getCheckinToday, getPaymentSummary, getStats };
