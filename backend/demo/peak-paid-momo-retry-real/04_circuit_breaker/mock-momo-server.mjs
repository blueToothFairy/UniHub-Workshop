import http from "node:http";

const port = Number(process.env.MOCK_MOMO_PORT ?? 19090);
let mode = (process.env.MOCK_MOMO_MODE ?? "error").toLowerCase();

function json(res, status, payload) {
  res.writeHead(status, { "Content-Type": "application/json" });
  res.end(JSON.stringify(payload));
}

function readJson(req) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    req.on("data", (chunk) => chunks.push(chunk));
    req.on("end", () => {
      try {
        const raw = Buffer.concat(chunks).toString("utf8").trim();
        resolve(raw ? JSON.parse(raw) : {});
      } catch (error) {
        reject(error);
      }
    });
    req.on("error", reject);
  });
}

async function handleCreateOrder(req, res) {
  const body = await readJson(req);
  const orderId = String(body.orderId ?? "mock-order");
  const requestId = String(body.requestId ?? "mock-request");
  const amount = Number(body.amount ?? 0);
  const partnerCode = String(body.partnerCode ?? "MOMO");

  if (mode === "timeout") {
    // hold the connection to trigger caller-side timeout
    return;
  }

  if (mode === "error") {
    return json(res, 200, {
      partnerCode,
      orderId,
      requestId,
      amount,
      resultCode: "99",
      message: "Mocked provider error (circuit test)"
    });
  }

  return json(res, 200, {
    partnerCode,
    orderId,
    requestId,
    amount,
    resultCode: "0",
    message: "Mocked success",
    payUrl: `http://127.0.0.1:${port}/pay/mock/${encodeURIComponent(orderId)}`,
    responseTime: Date.now()
  });
}

async function handleQuery(req, res) {
  const body = await readJson(req);
  const orderId = String(body.orderId ?? "mock-order");
  const requestId = String(body.requestId ?? "mock-request");
  const partnerCode = String(body.partnerCode ?? "MOMO");

  if (mode === "success") {
    return json(res, 200, {
      partnerCode,
      orderId,
      requestId,
      amount: 100000,
      resultCode: "0",
      message: "Mocked query success"
    });
  }

  return json(res, 200, {
    partnerCode,
    orderId,
    requestId,
    amount: 100000,
    resultCode: "99",
    message: "Mocked query error"
  });
}

async function handleSetMode(req, res) {
  try {
    const body = await readJson(req);
    const nextMode = String(body.mode ?? "").toLowerCase();
    if (!["error", "success", "timeout"].includes(nextMode)) {
      return json(res, 400, { error: "INVALID_MODE", allowed: ["error", "success", "timeout"] });
    }
    mode = nextMode;
    return json(res, 200, { ok: true, mode });
  } catch (error) {
    return json(res, 400, { error: "INVALID_JSON", message: error instanceof Error ? error.message : "Unknown" });
  }
}

const server = http.createServer(async (req, res) => {
  const method = req.method ?? "GET";
  const url = req.url ?? "/";
  try {
    if (method === "GET" && url === "/__health") {
      return json(res, 200, { ok: true, mode });
    }
    if (method === "POST" && url === "/__mode") {
      return handleSetMode(req, res);
    }
    if (method === "POST" && url === "/v2/gateway/api/create") {
      return handleCreateOrder(req, res);
    }
    if (method === "POST" && url === "/v2/gateway/api/query") {
      return handleQuery(req, res);
    }
    return json(res, 404, { error: "NOT_FOUND", method, url });
  } catch (error) {
    return json(res, 500, { error: "INTERNAL", message: error instanceof Error ? error.message : "Unknown" });
  }
});

server.listen(port, "127.0.0.1", () => {
  // eslint-disable-next-line no-console
  console.log(JSON.stringify({ type: "mock_momo_started", port, mode }));
});

process.on("SIGTERM", () => {
  server.close(() => process.exit(0));
});
process.on("SIGINT", () => {
  server.close(() => process.exit(0));
});

