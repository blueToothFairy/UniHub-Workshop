import test from "node:test";
import assert from "node:assert/strict";
import { createHmac } from "node:crypto";
import { MomoAdapter } from "./momo.adapter.js";
import {
  buildMomoCallbackCanonicalString,
  buildMomoCreateOrderCanonicalString,
  mapMomoResultCodeToPaymentStatus
} from "./payment.types.js";

test("buildMomoCreateOrderCanonicalString returns expected field order", () => {
  const canonical = buildMomoCreateOrderCanonicalString({
    accessKey: "ACCESS",
    amount: 50000,
    extraData: "",
    ipnUrl: "https://example.test/ipn",
    orderId: "ORDER-1",
    orderInfo: "Workshop payment",
    partnerCode: "PARTNER",
    redirectUrl: "https://example.test/return",
    requestId: "REQ-1",
    requestType: "captureWallet"
  });
  assert.equal(
    canonical,
    "accessKey=ACCESS&amount=50000&extraData=&ipnUrl=https://example.test/ipn&orderId=ORDER-1&orderInfo=Workshop payment&partnerCode=PARTNER&redirectUrl=https://example.test/return&requestId=REQ-1&requestType=captureWallet"
  );
});

test("verifyCallbackSignature validates canonicalized callback payload", () => {
  const adapter = new MomoAdapter({
    endpoint: "https://test-payment.momo.vn",
    partnerCode: "PARTNER",
    accessKey: "ACCESS",
    secretKey: "SECRET",
    redirectUrl: "https://example.test/return",
    ipnUrl: "https://example.test/ipn"
  });

  const payloadWithoutSignature = {
    partnerCode: "PARTNER",
    orderId: "ORDER-1",
    requestId: "REQ-1",
    amount: 50000,
    orderInfo: "Workshop payment",
    orderType: "momo_wallet",
    transId: 123456789,
    resultCode: "0",
    message: "Success",
    payType: "qr",
    responseTime: 1715000000000,
    extraData: ""
  };

  const canonical = buildMomoCallbackCanonicalString({
    accessKey: "ACCESS",
    payload: payloadWithoutSignature
  });
  const signature = createHmac("sha256", "SECRET").update(canonical, "utf8").digest("hex");
  assert.equal(adapter.verifyCallbackSignature({ ...payloadWithoutSignature, signature }), true);
  assert.equal(adapter.verifyCallbackSignature({ ...payloadWithoutSignature, signature: "bad-signature" }), false);
});

test("mapMomoResultCodeToPaymentStatus maps provider result codes", () => {
  assert.equal(mapMomoResultCodeToPaymentStatus("0"), "completed");
  assert.equal(mapMomoResultCodeToPaymentStatus("1006"), "failed");
  assert.equal(mapMomoResultCodeToPaymentStatus("7002"), "expired");
  assert.equal(mapMomoResultCodeToPaymentStatus("99"), "unknown");
  assert.equal(mapMomoResultCodeToPaymentStatus("12345"), "failed");
});
