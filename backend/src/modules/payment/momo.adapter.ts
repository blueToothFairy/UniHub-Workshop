import { createHmac, timingSafeEqual } from "node:crypto";
import {
  buildMomoCallbackCanonicalString,
  buildMomoCreateOrderCanonicalString,
  mapMomoResultCodeToPaymentStatus,
  type InternalPaymentStatus,
  type MomoCallbackPayload,
  type MomoCreateOrderRequest,
  type MomoCreateOrderResponse,
  type MomoSandboxConfig,
  type MomoStatusQueryRequest,
  type MomoStatusQueryResponse
} from "./payment.types.js";

interface JsonResponseShape {
  [key: string]: unknown;
}

export interface IMomoAdapter {
  createOrder(input: Pick<MomoCreateOrderRequest, "requestId" | "orderId" | "amount" | "orderInfo" | "extraData">): Promise<MomoCreateOrderResponse>;
  verifyCallbackSignature(payload: MomoCallbackPayload): boolean;
  queryTransaction(input: MomoStatusQueryRequest): Promise<MomoStatusQueryResponse>;
  mapPaymentStatus(resultCode: string): InternalPaymentStatus;
}

export class MomoAdapter implements IMomoAdapter {
  private readonly requestType: "captureWallet";
  private readonly lang: "vi" | "en";

  public constructor(private readonly config: MomoSandboxConfig) {
    this.requestType = config.requestType ?? "captureWallet";
    this.lang = config.lang ?? "vi";
  }

  public async createOrder(input: Pick<MomoCreateOrderRequest, "requestId" | "orderId" | "amount" | "orderInfo" | "extraData">): Promise<MomoCreateOrderResponse> {
    const payload: MomoCreateOrderRequest = {
      requestId: input.requestId,
      orderId: input.orderId,
      amount: input.amount,
      orderInfo: input.orderInfo,
      redirectUrl: this.config.redirectUrl,
      ipnUrl: this.config.ipnUrl,
      requestType: this.requestType,
      extraData: input.extraData,
      lang: this.lang
    };
    const canonical = buildMomoCreateOrderCanonicalString({
      accessKey: this.config.accessKey,
      amount: payload.amount,
      extraData: payload.extraData,
      ipnUrl: payload.ipnUrl,
      orderId: payload.orderId,
      orderInfo: payload.orderInfo,
      partnerCode: this.config.partnerCode,
      redirectUrl: payload.redirectUrl,
      requestId: payload.requestId,
      requestType: payload.requestType
    });
    const signature = this.sign(canonical);

    const response = await fetch(`${this.config.endpoint}/v2/gateway/api/create`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        partnerCode: this.config.partnerCode,
        accessKey: this.config.accessKey,
        requestId: payload.requestId,
        amount: payload.amount,
        orderId: payload.orderId,
        orderInfo: payload.orderInfo,
        redirectUrl: payload.redirectUrl,
        ipnUrl: payload.ipnUrl,
        extraData: payload.extraData,
        requestType: payload.requestType,
        lang: payload.lang,
        signature
      })
    });

    const data = (await response.json()) as JsonResponseShape;
    return {
      partnerCode: String(data.partnerCode ?? this.config.partnerCode),
      orderId: String(data.orderId ?? payload.orderId),
      requestId: String(data.requestId ?? payload.requestId),
      amount: Number(data.amount ?? payload.amount),
      resultCode: String(data.resultCode ?? "-1"),
      message: String(data.message ?? "Unknown MoMo response"),
      payUrl: data.payUrl ? String(data.payUrl) : undefined,
      deeplink: data.deeplink ? String(data.deeplink) : undefined,
      qrCodeUrl: data.qrCodeUrl ? String(data.qrCodeUrl) : undefined,
      transId: data.transId ? Number(data.transId) : undefined,
      responseTime: data.responseTime ? Number(data.responseTime) : undefined,
      extraData: data.extraData ? String(data.extraData) : undefined
    };
  }

  public verifyCallbackSignature(payload: MomoCallbackPayload): boolean {
    const { signature, ...unsignedPayload } = payload;
    const canonical = buildMomoCallbackCanonicalString({ accessKey: this.config.accessKey, payload: unsignedPayload });
    const expected = this.sign(canonical);
    const expectedBuffer = Buffer.from(expected, "utf8");
    const actualBuffer = Buffer.from(signature, "utf8");
    if (expectedBuffer.length !== actualBuffer.length) {
      return false;
    }
    return timingSafeEqual(expectedBuffer, actualBuffer);
  }

  public async queryTransaction(input: MomoStatusQueryRequest): Promise<MomoStatusQueryResponse> {
    const signature = this.sign(
      [
        `accessKey=${this.config.accessKey}`,
        `orderId=${input.orderId}`,
        `partnerCode=${this.config.partnerCode}`,
        `requestId=${input.requestId}`
      ].join("&")
    );

    const response = await fetch(`${this.config.endpoint}/v2/gateway/api/query`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        partnerCode: this.config.partnerCode,
        accessKey: this.config.accessKey,
        requestId: input.requestId,
        orderId: input.orderId,
        lang: input.lang,
        signature
      })
    });

    const data = (await response.json()) as JsonResponseShape;
    return {
      partnerCode: String(data.partnerCode ?? this.config.partnerCode),
      orderId: String(data.orderId ?? input.orderId),
      requestId: String(data.requestId ?? input.requestId),
      amount: Number(data.amount ?? 0),
      resultCode: String(data.resultCode ?? "-1"),
      message: String(data.message ?? "Unknown MoMo response"),
      transId: data.transId ? Number(data.transId) : undefined,
      payType: data.payType ? String(data.payType) : undefined,
      responseTime: data.responseTime ? Number(data.responseTime) : undefined
    };
  }

  public mapPaymentStatus(resultCode: string): InternalPaymentStatus {
    return mapMomoResultCodeToPaymentStatus(resultCode);
  }

  private sign(value: string): string {
    return createHmac("sha256", this.config.secretKey).update(value, "utf8").digest("hex");
  }
}
