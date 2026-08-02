import { mkdir, readFile, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import type { StoragePort } from "../types";

/**
 * Local private-blob storage (FR-4 seam): writes under a gitignored
 * `.local-storage/` directory at the repository root. Paths are validated
 * against traversal; callers always pass tenant-scoped logical paths like
 * `uploads/<orgId>/<sourceId>` produced by trusted server logic.
 */
const ROOT = path.join(process.cwd(), ".local-storage");

function resolveSafe(logicalPath: string): string {
  const cleaned = logicalPath.replace(/\\/g, "/");
  if (cleaned.includes("..") || cleaned.startsWith("/") || cleaned.includes("\0")) {
    throw new Error("invalid_storage_path");
  }
  const absolute = path.join(ROOT, cleaned);
  if (!absolute.startsWith(ROOT + path.sep)) {
    throw new Error("invalid_storage_path");
  }
  return absolute;
}

export class LocalStorageAdapter implements StoragePort {
  async put(logicalPath: string, bytes: Uint8Array): Promise<void> {
    const absolute = resolveSafe(logicalPath);
    await mkdir(path.dirname(absolute), { recursive: true });
    await writeFile(absolute, bytes);
  }

  async get(logicalPath: string): Promise<Uint8Array | null> {
    try {
      return new Uint8Array(await readFile(resolveSafe(logicalPath)));
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") return null;
      throw error;
    }
  }

  async delete(logicalPath: string): Promise<void> {
    await rm(resolveSafe(logicalPath), { force: true });
  }
}
