import fs from "node:fs/promises";
import path from "node:path";
import crypto from "node:crypto";
import type { StorageProvider, StoredFile } from "./provider.js";

/**
 * Stores files on local disk. Suitable for development and for the worker's
 * own filesystem when running on Render with a persistent disk. Not suitable
 * for Vercel's read-only, ephemeral filesystem — use CloudinaryStorageProvider
 * there.
 */
export class LocalStorageProvider implements StorageProvider {
  readonly name = "local" as const;
  private baseDir: string;
  private publicBaseUrl: string;

  constructor(baseDir = process.env.LOCAL_STORAGE_DIR || "./storage/local", publicBaseUrl = process.env.API_BASE_URL || "http://localhost:3000") {
    this.baseDir = baseDir;
    this.publicBaseUrl = publicBaseUrl.replace(/\/$/, "");
  }

  async upload(params: { buffer: Buffer; fileName: string; mimeType: string; folder?: string }): Promise<StoredFile> {
    const folder = params.folder ?? "misc";
    const dir = path.join(this.baseDir, folder);
    await fs.mkdir(dir, { recursive: true });
    const key = `${folder}/${Date.now()}-${crypto.randomUUID()}-${sanitize(params.fileName)}`;
    const fullPath = path.join(this.baseDir, key);
    await fs.writeFile(fullPath, params.buffer);
    return {
      provider: "local",
      url: this.getUrl(key),
      storageKey: key,
      size: params.buffer.length,
      mimeType: params.mimeType,
    };
  }

  async delete(storageKey: string): Promise<void> {
    await fs.rm(path.join(this.baseDir, storageKey), { force: true });
  }

  getUrl(storageKey: string): string {
    return `${this.publicBaseUrl}/api/files/local/${storageKey}`;
  }
}

function sanitize(fileName: string): string {
  return fileName.replace(/[^a-zA-Z0-9._-]/g, "_");
}
