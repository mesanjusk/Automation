import type { StorageProvider } from "./provider.js";
import { LocalStorageProvider } from "./localProvider.js";
import { CloudinaryStorageProvider } from "./cloudinaryProvider.js";

export * from "./provider.js";
export * from "./localProvider.js";
export * from "./cloudinaryProvider.js";

let cached: StorageProvider | null = null;

/** Selects the provider based on STORAGE_PROVIDER env var ("local" | "cloudinary"). */
export function getStorageProvider(): StorageProvider {
  if (cached) return cached;
  const kind = process.env.STORAGE_PROVIDER || "local";
  cached = kind === "cloudinary" ? new CloudinaryStorageProvider() : new LocalStorageProvider();
  return cached;
}
