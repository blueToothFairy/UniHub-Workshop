type StatsResponse = {
  generatedAt: string;
  totalWorkshops: number;
  totalRegistrations: number;
  activeRegistrations: number;
  totalPaymentCollected: number;
  pendingPayments: number;
  checkinCountToday: number;
  cancellationRate: number;
};

type PaymentDistributionItem = {
  workshopId: string;
  workshopTitle: string;
  revenue: number;
};

type PaymentSummaryResponse = {
  generatedAt: string;
  totalRevenue: number;
  pendingPayments: number;
  failedPayments: number;
  refundedPayments: number;
  paymentDistributionByWorkshop: PaymentDistributionItem[];
  anomalies: string[];
};

type CheckinWorkshopItem = {
  workshopId: string;
  workshopTitle: string;
  room: string;
  startsAt: string;
  expectedParticipants: number;
  currentCheckinCount: number;
  noShowCount: number;
};

type CheckinTodayResponse = {
  generatedAt: string;
  filters: {
    room: string | null;
    fromTime: string | null;
    toTime: string | null;
  };
  workshops: CheckinWorkshopItem[];
};

export type {
  CheckinTodayResponse,
  PaymentSummaryResponse,
  StatsResponse
};
