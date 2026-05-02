import fs from "node:fs/promises";

const baseUrl = process.env.BASE_URL ?? "http://localhost:3000";

async function main() {
  try {
    const loginRaw = await fs.readFile(new URL("./login_payload.json", import.meta.url), "utf8");
    const loginPayload = JSON.parse(loginRaw);

    const loginRes = await fetch(`${baseUrl}/auth/login`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(loginPayload)
    });

    if (!loginRes.ok) {
      console.error("Login failed:", await loginRes.text());
      process.exit(1);
    }

    const loginBody = await loginRes.json();
    const token = loginBody.access_token;
    console.log("Logged in, user:", loginBody.user?.id ?? "(unknown)");

    const statsRes = await fetch(`${baseUrl}/admin/dashboard/stats`, {
      method: "GET",
      headers: {
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/json"
      }
    });

    console.log("Stats status:", statsRes.status);
    const body = await statsRes.text();
    try {
      console.log(JSON.stringify(JSON.parse(body), null, 2));
    } catch (err) {
      console.log(body);
    }
  } catch (err) {
    console.error(err);
    process.exit(1);
  }
}

main();
