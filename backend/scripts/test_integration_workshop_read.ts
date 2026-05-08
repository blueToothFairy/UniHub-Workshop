async function main() {
  const id = process.argv[2] ?? "example-workshop-id";
  const base = process.env.API_BASE_URL ?? "http://localhost:3000";
  const url = `${base}/workshops/${id}`;
  console.log(`Fetching ${url}`);

  const res = await fetch(url, { cache: "no-store" });
  console.log("status", res.status);

  const cacheControl = res.headers.get("cache-control");
  const etag = res.headers.get("etag");
  const lastModified = res.headers.get("last-modified");

  console.log("headers:", { cacheControl, etag, lastModified });

  if (!res.ok) {
    const text = await res.text().catch(() => "");
    console.error("Request failed:", res.status, text);
    process.exit(2);
  }

  if (!etag) {
    console.error("Missing ETag header");
    process.exit(3);
  }

  if (!cacheControl || !cacheControl.includes("max-age=30")) {
    console.error("Cache-Control header missing expected max-age=30", cacheControl);
    process.exit(4);
  }

  const body = await res.json().catch(() => null);
  if (!body || !body.data || typeof body.data.id !== "string") {
    console.error("Invalid body shape", body);
    process.exit(5);
  }

  console.log("Integration check passed: body shape OK and headers present");
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
