export type PaymentGateway = "simulation" | "momo_sandbox";

export type InternalPaymentStatus =
  | "pending_simulation"
  | "pending_provider"
  | "unknown"
  | "completed"
  | "failed"
  | "expired"
  | "requires_review";

export type MomoRawResultCode = string;

export interface MomoCreateOrderRequest {
  requestId: string;
  orderId: string;
  amount: number;
  orderInfo: string;
  redirectUrl: string;
  ipnUrl: string;
  requestType: "captureWallet";
  extraData: string;
  lang: "vi" | "en";
}

export interface MomoCreateOrderResponse {
  partnerCode: string;
  orderId: string;
  requestId: string;
  amount: number;
  resultCode: MomoRawResultCode;
  message: string;
  payUrl?: string;
  deeplink?: string;
  qrCodeUrl?: string;
  transId?: number;
  responseTime?: number;
  extraData?: string;
}

export interface MomoStatusQueryRequest {
  orderId: string;
  requestId: string;
  lang: "vi" | "en";
}

export interface MomoStatusQueryResponse {
  partnerCode: string;
  orderId: string;
  requestId: string;
  amount: number;
  resultCode: MomoRawResultCode;
  message: string;
  transId?: number;
  payType?: string;
  responseTime?: number;
}

export interface MomoCallbackPayload {
  partnerCode: string;
  orderId: string;
  requestId: string;
  amount: number;
  orderInfo: string;
  orderType?: string;
  transId?: number;
  resultCode: MomoRawResultCode;
  message: string;
  payType?: string;
  responseTime?: number;
  extraData?: string;
  signature: string;
}

export interface MomoSandboxConfig {
  endpoint: string;
  partnerCode: string;
  accessKey: string;
  secretKey: string;
  redirectUrl: string;
  ipnUrl: string;
  requestType?: "captureWallet";
  lang?: "vi" | "en";
}

export interface MomoSignatureMaterial {
  accessKey: string;
  amount: number;
  extraData: string;
  ipnUrl: string;
  orderId: string;
  orderInfo: string;
  partnerCode: string;
  redirectUrl: string;
  requestId: string;
  requestType: string;
}

export function buildMomoCreateOrderCanonicalString(input: MomoSignatureMaterial): string {
  return [
    `accessKey=${input.accessKey}`,
    `amount=${input.amount}`,
    `extraData=${input.extraData}`,
    `ipnUrl=${input.ipnUrl}`,
    `orderId=${input.orderId}`,
    `orderInfo=${input.orderInfo}`,
    `partnerCode=${input.partnerCode}`,
    `redirectUrl=${input.redirectUrl}`,
    `requestId=${input.requestId}`,
    `requestType=${input.requestType}`
  ].join("&");
}

export function buildMomoCallbackCanonicalString(input: { accessKey: string; payload: Omit<MomoCallbackPayload, "signature"> }): string {
  const payload = input.payload;
  return [
    `accessKey=${input.accessKey}`,
    `amount=${payload.amount}`,
    `extraData=${payload.extraData ?? ""}`,
    `message=${payload.message}`,
    `orderId=${payload.orderId}`,
    `orderInfo=${payload.orderInfo}`,
    `orderType=${payload.orderType ?? ""}`,
    `partnerCode=${payload.partnerCode}`,
    `payType=${payload.payType ?? ""}`,
    `requestId=${payload.requestId}`,
    `responseTime=${payload.responseTime ?? ""}`,
    `resultCode=${payload.resultCode}`,
    `transId=${payload.transId ?? ""}`
  ].join("&");
}

export function mapMomoResultCodeToPaymentStatus(resultCode: MomoRawResultCode): InternalPaymentStatus {
  if (resultCode === "0") {
    return "completed";
  }
  if (resultCode === "1006" || resultCode === "1003") {
    return "failed";
  }
  if (resultCode === "7002") {
    return "expired";
  }
  if (resultCode === "99" || resultCode === "-1") {
    return "unknown";
  }
  return "failed";
}

export function isTerminalPaymentStatus(status: InternalPaymentStatus): boolean {
  return status === "completed" || status === "failed" || status === "expired" || status === "requires_review";
}
