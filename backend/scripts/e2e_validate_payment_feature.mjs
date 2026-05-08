import assert from "node:assert/strict";
import { createHmac } from "node:crypto";
import pg from "pg";
import dotenv from "dotenv";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
dotenv.config({ path: path.resolve(__dirname, "..", ".env") });

const { Client } = pg;

const API_BASE = process.env.BASE_URL ?? "http://localhost:3000";
const ADMIN_EMAIL = "dungd@example.com";
const ADMIN_PASSWORD = "Password123!";
const MOMO_ACCESS_KEY = process.env.MOMO_ACCESS_KEY ?? "";
const MOMO_SECRET_KEY = process.env.MOMO_SECRET_KEY ?? "";
const PG_URL = process.env.SUPABASE_POOLER_URL ?? "";

async function api(path, init = {}) {
  const res = await fetch(`${API_BASE}${path}`, init);
  const body = await res.json().catch(() => ({}));
  return { status: res.status, json: body };
}

function signCallback(payload) {
  const canonical = [
    `accessKey=${MOMO_ACCESS_KEY}`,
    `amount=${payload.amount}`,
    `extraData=${payload.extraData}`,
    `message=${payload.message}`,
    `orderId=${payload.orderId}`,
    `orderInfo=${payload.orderInfo}`,
    `orderType=${payload.orderType}`,
    `partnerCode=${payload.partnerCode}`,
    `payType=${payload.payType}`,
    `requestId=${payload.requestId}`,
    `responseTime=${payload.responseTime}`,
    `resultCode=${payload.resultCode}`,
    `transId=${payload.transId}`
  ].join("&");
  return createHmac("sha256", MOMO_SECRET_KEY).update(canonical, "utf8").digest("hex");
}

async function loginAdmin() {
  const { status, json } = await api("/auth/login", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ email: ADMIN_EMAIL, password: ADMIN_PASSWORD })
  });
  assert.equal(status, 200, `Admin login failed: ${JSON.stringify(json)}`);
  assert.equal(json.user.role, "organizer", "Admin account is not organizer");
  return json.access_token;
}

async function createWorkshop(token, payload) {
  const { status, json } = await api("/admin/workshops", {
    method: "POST",
    headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
    body: JSON.stringify(payload)
  });
  assert.equal(status, 201, `Create workshop failed: ${JSON.stringify(json)}`);
  return json.data;
}

async function registerStudent(email, fullName, password) {
  const { status, json } = await api("/auth/register", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ email, full_name: fullName, password })
  });
  assert.equal(status, 201, `Register student ${email} failed: ${JSON.stringify(json)}`);
  return json.access_token;
}

async function createRegistration(token, workshopId, idempotencyKey) {
  const { status, json } = await api("/registrations", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
      "Idempotency-Key": idempotencyKey
    },
    body: JSON.stringify({ workshop_id: workshopId })
  });
  assert.equal(status, 201, `Create registration failed: ${JSON.stringify(json)}`);
  return json.data;
}

async function getPaymentStatus(token, registrationId) {
  const { status, json } = await api(`/registrations/${registrationId}/payment-status`, {
    headers: { Authorization: `Bearer ${token}` }
  });
  assert.equal(status, 200, `Get payment status failed: ${JSON.stringify(json)}`);
  return json.data;
}

async function postCallback(payload) {
  const { status, json } = await api("/payments/momo/callback", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload)
  });
  return { status, json };
}

async function fetchWorkshopCounters(workshopId) {
  assert.ok(PG_URL, "SUPABASE_POOLER_URL is required for invariant checks");
  const client = new Client({ connectionString: PG_URL });
  await client.connect();
  try {
    const rs = await client.query(
      "SELECT reserved_count, confirmed_count, capacity FROM workshops WHERE id=$1 LIMIT 1",
      [workshopId]
    );
    assert.ok(rs.rows[0], `Workshop not found in DB: ${workshopId}`);
    return rs.rows[0];
  } finally {
    await client.end();
  }
}

async function main() {
  const adminToken = await loginAdmin();
  const now = Date.now();
  const freeStarts = new Date(now + 3 * 24 * 60 * 60 * 1000).toISOString();
  const freeEnds = new Date(now + 3 * 24 * 60 * 60 * 1000 + 2 * 60 * 60 * 1000).toISOString();
  const paidStarts = new Date(now + 4 * 24 * 60 * 60 * 1000).toISOString();
  const paidEnds = new Date(now + 4 * 24 * 60 * 60 * 1000 + 2 * 60 * 60 * 1000).toISOString();

  const freeWorkshop = await createWorkshop(adminToken, {
    title: `E2E Free Workshop ${now}`,
    description: "Free workshop for payment regression validation",
    speakerName: `Free Speaker ${now}`,
    room: `F-${now}`,
    startsAt: freeStarts,
    endsAt: freeEnds,
    capacity: 10,
    priceVnd: 0,
    status: "published"
  });
  const paidWorkshop = await createWorkshop(adminToken, {
    title: `E2E Paid Workshop ${now}`,
    description: "Paid workshop for payment regression validation",
    speakerName: `Paid Speaker ${now}`,
    room: `P-${now}`,
    startsAt: paidStarts,
    endsAt: paidEnds,
    capacity: 10,
    priceVnd: 100000,
    status: "published"
  });

  const studentTokens = [];
  const studentEmails = [];
  for (let i = 0; i < 10; i += 1) {
    const email = `student.pay.e2e.${now}.${i}@example.com`;
    studentEmails.push(email);
    const token = await registerStudent(email, `Student ${i}`, "Password123!");
    studentTokens.push(token);
  }

  for (let i = 0; i < 10; i += 1) {
    const reg = await createRegistration(studentTokens[i], freeWorkshop.id, `idem-free-${now}-${i}`);
    assert.equal(reg.registration_status, "confirmed", "Free workshop registration must confirm immediately");
    assert.equal(reg.payment_required, false, "Free workshop registration must not require payment");
  }

  const paidRegs = [];
  for (let i = 0; i < 10; i += 1) {
    const idem = `idem-paid-${now}-${i}`;
    const reg = await createRegistration(studentTokens[i], paidWorkshop.id, idem);
    assert.equal(reg.registration_status, "pending_payment", "Paid workshop registration must be pending payment");
    assert.equal(reg.payment_required, true, "Paid workshop registration must require payment");
    assert.ok(reg.payment_status === "pending_provider" || reg.payment_status === "unknown", "Paid payment_status must be pending_provider|unknown");
    paidRegs.push({ token: studentTokens[i], registrationId: reg.registration_id, idempotencyKey: idem });
  }

  const replay = await createRegistration(studentTokens[0], paidWorkshop.id, paidRegs[0].idempotencyKey);
  assert.equal(replay.registration_id, paidRegs[0].registrationId, "Idempotency replay must return original registration");

  const partnerCode = process.env.MOMO_PARTNER_CODE ?? "";
  const successIndices = [0, 1, 2, 3, 4];
  for (const index of successIndices) {
    const reg = paidRegs[index];
    const callbackPayload = {
      partnerCode,
      orderId: `momo-${reg.registrationId}`,
      requestId: `req-success-${now}-${index}`,
      amount: 100000,
      orderInfo: "E2E paid success",
      orderType: "momo_wallet",
      transId: now + index,
      resultCode: "0",
      message: "Success",
      payType: "qr",
      responseTime: now + index,
      extraData: reg.registrationId
    };
    const signature = signCallback(callbackPayload);
    const rs = await postCallback({ ...callbackPayload, signature });
    assert.equal(rs.status, 200, `Success callback failed: ${JSON.stringify(rs.json)}`);
  }

  const replayReg = paidRegs[0];
  const replayPayload = {
    partnerCode,
    orderId: `momo-${replayReg.registrationId}`,
    requestId: `req-success-replay-${now}`,
    amount: 100000,
    orderInfo: "E2E paid success replay",
    orderType: "momo_wallet",
    transId: now + 999,
    resultCode: "0",
    message: "Success",
    payType: "qr",
    responseTime: now + 999,
    extraData: replayReg.registrationId
  };
  const replaySig = signCallback(replayPayload);
  const replayResp = await postCallback({ ...replayPayload, signature: replaySig });
  assert.equal(replayResp.status, 200, "Replay success callback must be idempotent and return 200");

  const failReg = paidRegs[5];
  const failPayload = {
    partnerCode,
    orderId: `momo-${failReg.registrationId}`,
    requestId: `req-fail-${now}`,
    amount: 100000,
    orderInfo: "E2E paid fail",
    orderType: "momo_wallet",
    transId: now + 1500,
    resultCode: "1006",
    message: "Transaction failed",
    payType: "qr",
    responseTime: now + 1500,
    extraData: failReg.registrationId
  };
  const failSig = signCallback(failPayload);
  const failResp = await postCallback({ ...failPayload, signature: failSig });
  assert.equal(failResp.status, 200, "Failure callback must return 200");
  const failReplay = await postCallback({ ...failPayload, signature: failSig });
  assert.equal(failReplay.status, 200, "Failure callback replay must return 200");

  const badSignaturePayload = {
    partnerCode,
    orderId: `momo-${paidRegs[6].registrationId}`,
    requestId: `req-bad-signature-${now}`,
    amount: 100000,
    orderInfo: "Bad signature",
    orderType: "momo_wallet",
    transId: now + 2000,
    resultCode: "0",
    message: "Success",
    payType: "qr",
    responseTime: now + 2000,
    extraData: paidRegs[6].registrationId,
    signature: "invalid-signature"
  };
  const badSigResp = await postCallback(badSignaturePayload);
  assert.equal(badSigResp.status, 400, "Invalid signature must return 400");
  assert.equal(badSigResp.json?.error?.code, "INVALID_SIGNATURE");

  const mismatchPayload = {
    partnerCode,
    orderId: `momo-${paidRegs[7].registrationId}`,
    requestId: `req-amount-mismatch-${now}`,
    amount: 100001,
    orderInfo: "Amount mismatch",
    orderType: "momo_wallet",
    transId: now + 2500,
    resultCode: "0",
    message: "Success",
    payType: "qr",
    responseTime: now + 2500,
    extraData: paidRegs[7].registrationId
  };
  const mismatchSig = signCallback(mismatchPayload);
  const mismatchResp = await postCallback({ ...mismatchPayload, signature: mismatchSig });
  assert.equal(mismatchResp.status, 409, "Amount mismatch must return 409");
  assert.equal(mismatchResp.json?.error?.code, "PAYMENT_AMOUNT_MISMATCH");

  const notFoundPayload = {
    partnerCode,
    orderId: `momo-non-existing-${now}`,
    requestId: `req-not-found-${now}`,
    amount: 100000,
    orderInfo: "Not found",
    orderType: "momo_wallet",
    transId: now + 3000,
    resultCode: "0",
    message: "Success",
    payType: "qr",
    responseTime: now + 3000,
    extraData: "none"
  };
  const notFoundSig = signCallback(notFoundPayload);
  const notFoundResp = await postCallback({ ...notFoundPayload, signature: notFoundSig });
  assert.equal(notFoundResp.status, 404, "Unknown orderId must return 404");
  assert.equal(notFoundResp.json?.error?.code, "PAYMENT_NOT_FOUND");

  for (const idx of successIndices) {
    const status = await getPaymentStatus(studentTokens[idx], paidRegs[idx].registrationId);
    assert.equal(status.registration_status, "confirmed", `Student ${idx} should be confirmed`);
    assert.equal(status.payment_status, "completed", `Student ${idx} payment should be completed`);
  }
  const failedStatus = await getPaymentStatus(studentTokens[5], paidRegs[5].registrationId);
  assert.equal(failedStatus.registration_status, "cancelled", "Failed callback should cancel registration");
  assert.equal(failedStatus.payment_status, "failed", "Failed callback should mark payment failed");

  const freeCounters = await fetchWorkshopCounters(freeWorkshop.id);
  assert.equal(Number(freeCounters.capacity), 10);
  assert.equal(Number(freeCounters.reserved_count), 10);
  assert.equal(Number(freeCounters.confirmed_count), 10);

  const paidCounters = await fetchWorkshopCounters(paidWorkshop.id);
  assert.equal(Number(paidCounters.capacity), 10);
  assert.ok(Number(paidCounters.reserved_count) <= 10, "reserved_count must not exceed capacity");
  assert.ok(Number(paidCounters.confirmed_count) <= Number(paidCounters.reserved_count), "confirmed_count must not exceed reserved_count");
  assert.equal(Number(paidCounters.confirmed_count), 5, "Expected 5 successful paid confirmations");
  assert.equal(Number(paidCounters.reserved_count), 9, "Expected one failed payment to release one reserved seat exactly once");

  console.log("E2E payment validation succeeded.");
  console.log(
    JSON.stringify(
      {
        adminEmail: ADMIN_EMAIL,
        freeWorkshopId: freeWorkshop.id,
        paidWorkshopId: paidWorkshop.id,
        createdStudentEmails: studentEmails,
        freeWorkshopCounters: freeCounters,
        paidWorkshopCounters: paidCounters
      },
      null,
      2
    )
  );
}

main().catch((error) => {
  console.error("E2E payment validation failed:", error);
  process.exit(1);
});
