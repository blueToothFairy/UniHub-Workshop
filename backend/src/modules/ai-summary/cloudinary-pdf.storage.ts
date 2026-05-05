import { v2 as cloudinary, UploadApiResponse } from "cloudinary";
import { randomUUID } from "node:crypto";
import type { IPdfStorage } from "./interfaces.js";

export class CloudinaryPdfStorage implements IPdfStorage {
  private readonly folder: string;

  public constructor() {
    cloudinary.config({
      cloud_name: requiredEnv("CLOUDINARY_CLOUD_NAME"),
      api_key: requiredEnv("CLOUDINARY_API_KEY"),
      api_secret: requiredEnv("CLOUDINARY_API_SECRET")
    });
    this.folder = process.env.CLOUDINARY_PDF_FOLDER ?? "workshop-pdfs";
  }

  public async putPdf(workshopId: string, fileName: string, bytes: Buffer): Promise<string> {
    const safeName = fileName.replace(/[^a-zA-Z0-9._-]/g, "_");
    const publicId = `${this.folder}/${workshopId}/${Date.now()}-${randomUUID()}-${safeName}`;
    // eslint-disable-next-line no-console
    console.log(`[cloudinary] putPdf start workshop=${workshopId} publicId=${publicId} bytes=${bytes.length}`);
    const uploadResult = await new Promise<UploadApiResponse>((resolve, reject) => {
      const stream = cloudinary.uploader.upload_stream(
        {
          resource_type: "raw",
          public_id: publicId,
          format: "pdf",
          folder: this.folder
        },
        (error, result) => {
          if (error || !result) {
            // eslint-disable-next-line no-console
            console.error(`[cloudinary] putPdf upload error workshop=${workshopId} publicId=${publicId}`, error || result);
            return reject(error || new Error("Cloudinary upload failed"));
          }
          resolve(result);
        }
      );

      stream.end(bytes);
    });
    // eslint-disable-next-line no-console
    console.log(`[cloudinary] putPdf complete workshop=${workshopId} url=${uploadResult.secure_url}`);
    return uploadResult.secure_url;
  }

  public async getPdf(url: string): Promise<Buffer> {
    // Cloudinary does not provide direct download as buffer via SDK, so fetch via HTTP(S)
    // eslint-disable-next-line no-console
    console.log(`[cloudinary] getPdf fetching url=${url}`);
    const res = await fetch(url);
    // eslint-disable-next-line no-console
    console.log(`[cloudinary] getPdf response status=${res.status} statusText=${res.statusText}`);
    if (!res.ok) {
      // eslint-disable-next-line no-console
      console.error(`[cloudinary] getPdf failed url=${url} status=${res.status} statusText=${res.statusText}`);
      throw new Error(`Failed to fetch PDF from Cloudinary: ${res.statusText}`);
    }
    return Buffer.from(await res.arrayBuffer());
  }
}

function requiredEnv(name: string): string {
  const value = process.env[name];
  if (!value) {
    throw new Error(`${name} is required`);
  }
  return value;
}
