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

    const now = Date.now();
    const startsAt = new Date(now + 24 * 60 * 60 * 1000).toISOString();
    const endsAt = new Date(now + 26 * 60 * 60 * 1000).toISOString();

    const workshopPayload = {
      title: "Automated test workshop",
      description: "Workshop created by assistant test script",
      speakerName: "Assistant Speaker",
      room: "Room A",
      startsAt,
      endsAt,
      capacity: 50,
      priceVnd: 0,
      status: "published"
    };

    const createRes = await fetch(`${baseUrl}/admin/workshops`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${token}`
      },
      body: JSON.stringify(workshopPayload)
    });

    const text = await createRes.text();
    console.log("Create status:", createRes.status);
    try {
      console.log(JSON.stringify(JSON.parse(text), null, 2));
    } catch (err) {
      console.log(text);
    }
  } catch (err) {
    console.error(err);
    process.exit(1);
  }
}

main();
