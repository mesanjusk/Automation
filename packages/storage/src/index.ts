import type { StorageProvider } from "./provider";
import { LocalStorageProvider } from "./localProvider";
import { CloudinaryStorageProvider } from "./cloudinaryProvider";

export * from "./provider";
export * from "./localProvider";
export * from "./cloudinaryProvider";

let cached: StorageProvider | null = null;

/** Selects the provider based on STORAGE_PROVIDER env var ("local" | "cloudinary"). */
export function getStorageProvider(): StorageProvider {
  if (cached) return cached;
  const kind = process.env.STORAGE_PROVIDER || "local";
  cached = kind === "cloudinary" ? new CloudinaryStorageProvider() : new LocalStorageProvider();
  return cached;
}
