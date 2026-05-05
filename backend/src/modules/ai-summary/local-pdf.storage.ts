import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import type { IPdfStorage } from "./interfaces.js";

export class LocalPdfStorage implements IPdfStorage {
  private readonly rootDir: string;

  public constructor(rootDir: string = resolve(process.cwd(), "storage", "pdfs")) {
    this.rootDir = rootDir;
  }

  public async putPdf(workshopId: string, fileName: string, bytes: Buffer): Promise<string> {
    const safeName = fileName.replace(/[^a-zA-Z0-9._-]/g, "_");
    const relativePath = join(workshopId, `${Date.now()}_${safeName}`);
    const fullPath = join(this.rootDir, relativePath);
    await mkdir(dirname(fullPath), { recursive: true });
    await writeFile(fullPath, bytes);
    return `local://${relativePath.replace(/\\/g, "/")}`;
  }

  public async getPdf(url: string): Promise<Buffer> {
    if (!url.startsWith("local://")) {
      throw new Error("Unsupported pdf url scheme");
    }
    const relative = url.slice("local://".length);
    const fullPath = join(this.rootDir, relative);
    return readFile(fullPath);
  }
}
