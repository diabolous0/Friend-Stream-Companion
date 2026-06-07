import { createReadStream, createWriteStream } from "node:fs";
import { mkdir, readFile, stat, writeFile } from "node:fs/promises";
import path from "node:path";
import { pipeline } from "node:stream/promises";
import { Readable } from "node:stream";
import { randomUUID } from "node:crypto";
import {
  type StorageBackend,
  type ObjectAclPolicy,
  ObjectPermission,
  ObjectForbiddenError,
  ObjectNotFoundError,
} from "./types";

const UUID_RE = /^[0-9a-f-]{36}$/i;

// Minimal extension → MIME map for public objects served from disk. Anything
// unknown falls back to a non-renderable type so the browser downloads it.
const EXT_TYPES: Record<string, string> = {
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".gif": "image/gif",
  ".webp": "image/webp",
  ".svg": "image/svg+xml",
  ".mp4": "video/mp4",
  ".webm": "video/webm",
  ".mp3": "audio/mpeg",
  ".ogg": "audio/ogg",
  ".wav": "audio/wav",
  ".pdf": "application/pdf",
  ".txt": "text/plain",
  ".json": "application/json",
};

interface LocalAcl {
  contentType: string;
  owner?: string;
  visibility?: "public" | "private";
}

/**
 * Local-disk storage backend — the default for self-hosted servers. Layout
 * under `dataDir`:
 *   public/<path>                     — publicly served files
 *   private/uploads/<id>              — uploaded object bytes
 *   private/uploads/<id>.acl.json     — { contentType, owner, visibility }
 */
export class LocalDiskStorageBackend implements StorageBackend {
  private readonly publicDir: string;
  private readonly privateDir: string;

  constructor(dataDir: string) {
    const base = path.resolve(dataDir);
    this.publicDir = path.join(base, "public");
    this.privateDir = path.join(base, "private");
  }

  // --- helpers ---------------------------------------------------------------

  private uploadFilePath(objectId: string): string {
    return path.join(this.privateDir, "uploads", objectId);
  }

  private aclFilePath(objectId: string): string {
    return `${this.uploadFilePath(objectId)}.acl.json`;
  }

  /** Extracts and validates the upload id from `/objects/uploads/<id>`. */
  private parseObjectId(objectPath: string): string {
    if (!objectPath.startsWith("/objects/uploads/")) throw new ObjectNotFoundError();
    const id = objectPath.slice("/objects/uploads/".length);
    if (!UUID_RE.test(id)) throw new ObjectNotFoundError();
    return id;
  }

  private async readAcl(objectId: string): Promise<LocalAcl> {
    try {
      return JSON.parse(await readFile(this.aclFilePath(objectId), "utf8")) as LocalAcl;
    } catch {
      throw new ObjectNotFoundError();
    }
  }

  private buildResponse(filePath: string, contentType: string, size: number, isPublic: boolean): Response {
    const webStream = Readable.toWeb(createReadStream(filePath)) as ReadableStream;
    return new Response(webStream, {
      headers: {
        "Content-Type": contentType || "application/octet-stream",
        "Content-Length": String(size),
        "Cache-Control": `${isPublic ? "public" : "private"}, max-age=3600`,
      },
    });
  }

  // --- StorageBackend --------------------------------------------------------

  async requestUpload(_contentType: string): Promise<{ uploadURL: string; objectPath: string }> {
    const objectId = randomUUID();
    return {
      uploadURL: `/api/storage/uploads/local/${objectId}`,
      objectPath: `/objects/uploads/${objectId}`,
    };
  }

  async receiveUpload(
    objectId: string,
    contentType: string,
    body: NodeJS.ReadableStream,
  ): Promise<void> {
    if (!UUID_RE.test(objectId)) throw new ObjectNotFoundError();
    const dest = this.uploadFilePath(objectId);
    await mkdir(path.dirname(dest), { recursive: true });
    await pipeline(body, createWriteStream(dest));
    // ACL/owner is recorded on finalize; store contentType now.
    const acl: LocalAcl = { contentType };
    await writeFile(this.aclFilePath(objectId), JSON.stringify(acl), "utf8");
  }

  async finalizeUpload(objectPath: string, policy: ObjectAclPolicy): Promise<string> {
    const objectId = this.parseObjectId(objectPath);
    const acl = await this.readAcl(objectId);
    acl.owner = policy.owner;
    acl.visibility = policy.visibility;
    await writeFile(this.aclFilePath(objectId), JSON.stringify(acl), "utf8");
    return objectPath;
  }

  async servePublicObject(filePath: string): Promise<Response | null> {
    // Resolve safely inside publicDir to prevent path traversal.
    const resolved = path.resolve(this.publicDir, filePath);
    if (resolved !== this.publicDir && !resolved.startsWith(this.publicDir + path.sep)) {
      return null;
    }
    let size: number;
    try {
      const s = await stat(resolved);
      if (!s.isFile()) return null;
      size = s.size;
    } catch {
      return null;
    }
    const ext = path.extname(resolved).toLowerCase();
    return this.buildResponse(resolved, EXT_TYPES[ext] ?? "application/octet-stream", size, true);
  }

  async serveObjectEntity(
    objectPath: string,
    ctx: { userId?: string; permission: ObjectPermission },
  ): Promise<Response> {
    const objectId = this.parseObjectId(objectPath);
    const acl = await this.readAcl(objectId);
    const filePath = this.uploadFilePath(objectId);
    let size: number;
    try {
      size = (await stat(filePath)).size;
    } catch {
      throw new ObjectNotFoundError();
    }

    const isPublic = acl.visibility === "public";
    const allowed =
      (isPublic && ctx.permission === ObjectPermission.READ) ||
      (ctx.userId !== undefined && acl.owner === ctx.userId);
    if (!allowed) throw new ObjectForbiddenError();

    return this.buildResponse(filePath, acl.contentType, size, isPublic);
  }
}
