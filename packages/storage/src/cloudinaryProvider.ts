import { v2 as cloudinary } from "cloudinary";
import type { StorageProvider, StoredFile } from "./provider.js";

export class CloudinaryStorageProvider implements StorageProvider {
  readonly name = "cloudinary" as const;

  constructor() {
    cloudinary.config({
      cloud_name: process.env.CLOUDINARY_CLOUD_NAME,
      api_key: process.env.CLOUDINARY_API_KEY,
      api_secret: process.env.CLOUDINARY_API_SECRET,
      secure: true,
    });
  }

  async upload(params: { buffer: Buffer; fileName: string; mimeType: string; folder?: string }): Promise<StoredFile> {
    const folder = `browser-automation-os/${params.folder ?? "misc"}`;
    const result = await new Promise<{ secure_url: string; public_id: string; bytes: number }>((resolve, reject) => {
      const stream = cloudinary.uploader.upload_stream(
        { folder, resource_type: "auto", filename_override: params.fileName, use_filename: true },
        (error, uploadResult) => {
          if (error || !uploadResult) reject(error ?? new Error("Cloudinary upload failed"));
          else resolve(uploadResult as never);
        }
      );
      stream.end(params.buffer);
    });
    return {
      provider: "cloudinary",
      url: result.secure_url,
      storageKey: result.public_id,
      size: result.bytes,
      mimeType: params.mimeType,
    };
  }

  async delete(storageKey: string): Promise<void> {
    await cloudinary.uploader.destroy(storageKey);
  }

  getUrl(storageKey: string): string {
    return cloudinary.url(storageKey, { secure: true });
  }
}
