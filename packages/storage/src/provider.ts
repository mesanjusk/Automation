import type { FileProvider } from "@bos/shared";

export interface StoredFile {
  provider: FileProvider;
  url: string;
  storageKey: string;
  size: number;
  mimeType: string;
}

export interface StorageProvider {
  readonly name: FileProvider;
  upload(params: { buffer: Buffer; fileName: string; mimeType: string; folder?: string }): Promise<StoredFile>;
  delete(storageKey: string): Promise<void>;
  getUrl(storageKey: string): string;
}
