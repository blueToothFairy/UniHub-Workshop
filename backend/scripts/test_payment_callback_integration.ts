import "dotenv/config";
import assert from "node:assert/strict";
import { createHmac } from "node:crypto";

const API_BASE = process.env.TEST_API_BASE_URL ?? "http://localhost:3000";
const STUDENT_TOKEN = process.env.TEST_STUDENT_TOKEN ?? "";
const CALLBACK_ORDER_ID = process.env.TEST_MOMO_ORDER_ID ?? "";
const CALLBACK_REGISTRATION_ID = process.env.TEST_REGISTRATION_ID ?? "";
const CALLBACK_AMOUNT = Number(process.env.TEST_PAYMENT_AMOUNT_VND ?? "0");
const PARTNER_CODE = process.env.MOMO_PARTNER_CODE ?? "";
const ACCESS_KEY = process.env.MOMO_ACCESS_KEY ?? "";
const SECRET_KEY = process.env.MOMO_SECRET_KEY ?? "";

function signCallback(input: {
  amount: number;
  message: string;
  orderId: string;
  orderInfo: string;
  orderType: string;
  partnerCode: string;
  payType: string;
  requestId: string;
  responseTime: number;
  resultCode: string;
  transId: number;
  extraData: string;
}): string {
  const raw = [
    `accessKey=${ACCESS_KEY}`,
    `amount=${input.amount}`,
    `extraData=${input.extraData}`,
    `message=${input.message}`,
    `orderId=${input.orderId}`,
    `orderInfo=${input.orderInfo}`,
    `orderType=${input.orderType}`,
    `partnerCode=${input.partnerCode}`,
    `payType=${input.payType}`,
    `requestId=${input.requestId}`,
    `responseTime=${input.responseTime}`,
    `resultCode=${input.resultCode}`,
    `transId=${input.transId}`
  ].join("&");
  return createHmac("sha256", SECRET_KEY).update(raw, "utf8").digest("hex");
}

async function postCallback(payload: Record<string, unknown>): Promise<{ status: number; body: any }> {
  const response = await fetch(`${API_BASE}/payments/momo/callback`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload)
  });
  const body = await response.json().catch(() => ({}));
  return { status: response.status, body };
}

async function getStatus(registrationId: string): Promise<{ status: number; body: any }> {
  const response = await fetch(`${API_BASE}/registrations/${registrationId}/payment-status`, {
    headers: {
      Authorization: `Bearer ${STUDENT_TOKEN}`
    }
  });
  const body = await response.json().catch(() => ({}));
  return { status: response.status, body };
}

async function main(): Promise<void> {
  assert.ok(CALLBACK_ORDER_ID, "TEST_MOMO_ORDER_ID is required");
  assert.ok(CALLBACK_REGISTRATION_ID, "TEST_REGISTRATION_ID is required");
  assert.ok(CALLBACK_AMOUNT > 0, "TEST_PAYMENT_AMOUNT_VND must be > 0");
  assert.ok(STUDENT_TOKEN, "TEST_STUDENT_TOKEN is required");
  assert.ok(PARTNER_CODE, "MOMO_PARTNER_CODE is required");
  assert.ok(ACCESS_KEY, "MOMO_ACCESS_KEY is required");
  assert.ok(SECRET_KEY, "MOMO_SECRET_KEY is required");

  const basePayload = {
    partnerCode: PARTNER_CODE,
    orderId: CALLBACK_ORDER_ID,
    requestId: `req-${Date.now()}`,
    amount: CALLBACK_AMOUNT,
    orderInfo: "Integration test payment callback",
    orderType: "momo_wallet",
    transId: Date.now(),
    resultCode: "0",
    message: "Success",
    payType: "qr",
    responseTime: Date.now(),
    extraData: CALLBACK_REGISTRATION_ID
  };

  const invalidSig = await postCallback({ ...basePayload, signature: "invalid-signature" });
  assert.equal(invalidSig.status, 400);
  assert.equal(invalidSig.body?.error?.code, "INVALID_SIGNATURE");

  const notFoundPayload = { ...basePayload, orderId: `unknown-${Date.now()}` };
  const notFoundSig = signCallback({ ...notFoundPayload });
  const notFound = await postCallback({ ...notFoundPayload, signature: notFoundSig });
  assert.equal(notFound.status, 404);
  assert.equal(notFound.body?.error?.code, "PAYMENT_NOT_FOUND");

  const mismatchPayload = { ...basePayload, amount: CALLBACK_AMOUNT + 1 };
  const mismatchSig = signCallback({ ...mismatchPayload });
  const mismatch = await postCallback({ ...mismatchPayload, signature: mismatchSig });
  assert.equal(mismatch.status, 409);
  assert.equal(mismatch.body?.error?.code, "PAYMENT_AMOUNT_MISMATCH");

  const successSignature = signCallback(basePayload);
  const success = await postCallback({ ...basePayload, signature: successSignature });
  assert.equal(success.status, 200);

  const replay = await postCallback({ ...basePayload, signature: successSignature });
  assert.equal(replay.status, 200);

  const after = await getStatus(CALLBACK_REGISTRATION_ID);
  assert.equal(after.status, 200);
  assert.equal(after.body?.data?.registration_id, CALLBACK_REGISTRATION_ID);
  assert.ok(["confirmed", "pending_payment", "cancelled", "expired"].includes(String(after.body?.data?.registration_status)));

  console.log("Callback integration checks passed.");
}

main().catch((error) => {
  console.error("Callback integration checks failed:", error);
  process.exit(1);
});
