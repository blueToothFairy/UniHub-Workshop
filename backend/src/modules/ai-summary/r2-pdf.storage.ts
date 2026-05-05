import { GetObjectCommand, PutObjectCommand, S3Client } from "@aws-sdk/client-s3";
import { randomUUID } from "node:crypto";
import type { Readable } from "node:stream";
import type { IPdfStorage } from "./interfaces.js";

export class R2PdfStorage implements IPdfStorage {
  private readonly client: S3Client;
  private readonly bucket: string;
  private readonly publicBaseUrl: string;

  public constructor() {
    const endpoint = requiredEnv("CLOUDFLARE_R2_ENDPOINT");
    const accessKeyId = requiredEnv("CLOUDFLARE_R2_ACCESS_KEY");
    const secretAccessKey = requiredEnv("CLOUDFLARE_R2_SECRET_KEY");
    this.bucket = requiredEnv("CLOUDFLARE_R2_BUCKET");
    this.publicBaseUrl = process.env.CLOUDFLARE_R2_PUBLIC_BASE_URL ?? endpoint;

    this.client = new S3Client({
      region: "auto",
      endpoint,
      credentials: { accessKeyId, secretAccessKey }
    });
  }

  public async putPdf(workshopId: string, fileName: string, bytes: Buffer): Promise<string> {
    const safeName = fileName.replace(/[^a-zA-Z0-9._-]/g, "_");
    const key = `workshops/${workshopId}/${Date.now()}-${randomUUID()}-${safeName}`;

    await this.client.send(
      new PutObjectCommand({
        Bucket: this.bucket,
        Key: key,
        Body: bytes,
        ContentType: "application/pdf"
      })
    );

    return `${this.publicBaseUrl.replace(/\/$/, "")}/${this.bucket}/${key}`;
  }

  public async getPdf(url: string): Promise<Buffer> {
    const { key } = parseR2Url(url, this.bucket);
    const output = await this.client.send(new GetObjectCommand({ Bucket: this.bucket, Key: key }));
    const stream = output.Body as Readable | undefined;
    if (!stream) {
      throw new Error("R2_EMPTY_OBJECT_STREAM");
    }

    const chunks: Buffer[] = [];
    for await (const chunk of stream) {
      chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
    }
    return Buffer.concat(chunks);
  }
}

function requiredEnv(name: string): string {
  const value = process.env[name];
  if (!value) {
    throw new Error(`${name} is required`);
  }
  return value;
}

function parseR2Url(url: string, bucket: string): { key: string } {
  const parsed = new URL(url);
  const path = parsed.pathname.replace(/^\/+/, "");
  const expectedPrefix = `${bucket}/`;
  if (!path.startsWith(expectedPrefix)) {
    throw new Error("R2_URL_FORMAT_INVALID");
  }
  return { key: path.slice(expectedPrefix.length) };
}
