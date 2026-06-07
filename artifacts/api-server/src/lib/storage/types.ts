import { ObjectAclPolicy, ObjectPermission } from "../objectAcl";

export { ObjectPermission };
export type { ObjectAclPolicy };

export class ObjectNotFoundError extends Error {
  constructor() {
    super("Object not found");
    this.name = "ObjectNotFoundError";
    Object.setPrototypeOf(this, ObjectNotFoundError.prototype);
  }
}

export class ObjectForbiddenError extends Error {
  constructor() {
    super("Forbidden");
    this.name = "ObjectForbiddenError";
    Object.setPrototypeOf(this, ObjectForbiddenError.prototype);
  }
}

/**
 * A pluggable storage backend. Two implementations exist:
 *   - replit: Google Cloud Storage via the Replit object-storage sidecar.
 *   - local:  the server's own disk (default for self-hosted servers).
 *
 * Routes only ever talk to this interface, so the rest of the app is agnostic
 * about where files actually live.
 */
export interface StorageBackend {
  /**
   * Returns a URL the client should PUT the file bytes to, plus the canonical
   * object path used to reference it afterwards. The upload URL may be absolute
   * (signed cloud URL) or relative to this server (local disk).
   */
  requestUpload(contentType: string): Promise<{ uploadURL: string; objectPath: string }>;

  /** Records ownership/visibility for an uploaded object. Returns its normalized path. */
  finalizeUpload(objectPath: string, acl: ObjectAclPolicy): Promise<string>;

  /** Serves a publicly-readable object, or null if it does not exist. */
  servePublicObject(filePath: string): Promise<Response | null>;

  /**
   * Serves a private object entity after an access check.
   * Throws ObjectNotFoundError if missing, ObjectForbiddenError if not allowed.
   */
  serveObjectEntity(
    objectPath: string,
    ctx: { userId?: string; permission: ObjectPermission },
  ): Promise<Response>;

  /**
   * Local-disk only: receives the raw bytes for a previously-requested upload.
   * Undefined on backends that accept uploads directly (e.g. signed cloud URLs).
   */
  receiveUpload?(
    objectId: string,
    contentType: string,
    body: NodeJS.ReadableStream,
  ): Promise<void>;
}
