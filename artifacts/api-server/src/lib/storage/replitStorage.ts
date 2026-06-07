import { ObjectStorageService } from "../objectStorage";
import { ObjectAclPolicy, ObjectPermission } from "../objectAcl";
import {
  type StorageBackend,
  ObjectForbiddenError,
  ObjectNotFoundError,
} from "./types";

/**
 * Replit/Google Cloud Storage backend. Thin adapter over the existing
 * ObjectStorageService so the cloud upload/serve path is unchanged.
 */
export class ReplitStorageBackend implements StorageBackend {
  private readonly svc = new ObjectStorageService();

  async requestUpload(_contentType: string): Promise<{ uploadURL: string; objectPath: string }> {
    const uploadURL = await this.svc.getObjectEntityUploadURL();
    const objectPath = this.svc.normalizeObjectEntityPath(uploadURL);
    return { uploadURL, objectPath };
  }

  async finalizeUpload(objectPath: string, acl: ObjectAclPolicy): Promise<string> {
    return this.svc.trySetObjectEntityAclPolicy(objectPath, acl);
  }

  async servePublicObject(filePath: string): Promise<Response | null> {
    const file = await this.svc.searchPublicObject(filePath);
    if (!file) return null;
    return this.svc.downloadObject(file);
  }

  async serveObjectEntity(
    objectPath: string,
    ctx: { userId?: string; permission: ObjectPermission },
  ): Promise<Response> {
    // getObjectEntityFile throws ObjectNotFoundError (from objectStorage) when missing.
    const objectFile = await this.svc.getObjectEntityFile(objectPath);
    const canAccess = await this.svc.canAccessObjectEntity({
      userId: ctx.userId,
      objectFile,
      requestedPermission: ctx.permission,
    });
    if (!canAccess) throw new ObjectForbiddenError();
    return this.svc.downloadObject(objectFile);
  }
}

// Re-export so callers importing from this module get a single error identity.
export { ObjectNotFoundError, ObjectForbiddenError };
