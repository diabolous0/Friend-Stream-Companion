import { config } from "../config";
import { logger } from "../logger";
import { type StorageBackend } from "./types";
import { ReplitStorageBackend } from "./replitStorage";
import { LocalDiskStorageBackend } from "./localDiskStorage";

export * from "./types";

let backend: StorageBackend | null = null;

/** Returns the configured storage backend (created once, on first use). */
export function getStorage(): StorageBackend {
  if (backend) return backend;
  if (config.storage.driver === "replit") {
    logger.info("Using Replit object storage backend");
    backend = new ReplitStorageBackend();
  } else {
    logger.info({ dataDir: config.storage.dataDir }, "Using local-disk storage backend");
    backend = new LocalDiskStorageBackend(config.storage.dataDir);
  }
  return backend;
}
