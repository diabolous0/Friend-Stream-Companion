import { Router, type IRouter, type Response } from "express";
import { Readable } from "stream";
import { z } from "zod/v4";
import {
  getStorage,
  ObjectPermission,
  ObjectNotFoundError,
  ObjectForbiddenError,
} from "../lib/storage";
import { requireAuth, type AuthenticatedRequest } from "../middlewares/auth";

const router: IRouter = Router();
const storage = getStorage();

const MAX_UPLOAD_BYTES = 25 * 1024 * 1024;
// Media types render inline; everything else is force-downloaded. SVG is
// excluded because it can carry active script when served from our origin.
const INLINE_TYPE_PREFIXES = ["image/", "video/", "audio/"];
const ALLOWED_TYPE_PREFIXES = ["image/", "video/", "audio/"];
const ALLOWED_TYPES_EXACT = new Set([
  "text/plain",
  "text/csv",
  "application/pdf",
  "application/zip",
  "application/json",
  "application/msword",
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  "application/vnd.ms-excel",
  "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  "application/vnd.ms-powerpoint",
  "application/vnd.openxmlformats-officedocument.presentationml.presentation",
]);
const BLOCKED_TYPES_EXACT = new Set(["image/svg+xml"]);

function isAllowedType(contentType: string): boolean {
  if (BLOCKED_TYPES_EXACT.has(contentType)) return false;
  if (ALLOWED_TYPE_PREFIXES.some((p) => contentType.startsWith(p))) return true;
  return ALLOWED_TYPES_EXACT.has(contentType);
}

function isInlineType(contentType: string): boolean {
  if (BLOCKED_TYPES_EXACT.has(contentType)) return false;
  return INLINE_TYPE_PREFIXES.some((p) => contentType.startsWith(p));
}

function pipeDownload(res: Response, response: globalThis.Response): void {
  res.status(response.status);
  response.headers.forEach((value, key) => res.setHeader(key, value));
  res.setHeader("X-Content-Type-Options", "nosniff");
  const contentType = response.headers.get("Content-Type") || "application/octet-stream";
  if (!isInlineType(contentType)) res.setHeader("Content-Disposition", "attachment");
  if (response.body) { Readable.fromWeb(response.body as ReadableStream<Uint8Array>).pipe(res); } else res.end();
}

const RequestUploadUrlBody = z.object({
  name: z.string().min(1).max(255),
  size: z.number().int().positive().max(MAX_UPLOAD_BYTES),
  contentType: z.string().min(1).max(255),
});

const FinalizeUploadBody = z.object({
  objectPath: z.string().min(1).startsWith("/objects/"),
});

router.post("/storage/uploads/request-url", requireAuth, async (req: AuthenticatedRequest, res: Response) => {
  const parsed = RequestUploadUrlBody.safeParse(req.body);
  if (!parsed.success) { res.status(400).json({ error: "Missing or invalid required fields" }); return; }
  if (!isAllowedType(parsed.data.contentType)) { res.status(400).json({ error: "Unsupported file type" }); return; }
  try {
    const { name, size, contentType } = parsed.data;
    const { uploadURL, objectPath } = await storage.requestUpload(contentType);
    res.json({ uploadURL, objectPath, metadata: { name, size, contentType } });
  } catch (error) {
    req.log.error({ err: error }, "Error generating upload URL");
    res.status(500).json({ error: "Failed to generate upload URL" });
  }
});

// Local-disk backend only: receives the raw bytes for a previously-requested
// upload. The Replit backend uploads directly to a signed cloud URL instead, so
// this route is a no-op (404) there.
router.put("/storage/uploads/local/:objectId", requireAuth, async (req: AuthenticatedRequest, res: Response) => {
  if (!storage.receiveUpload) { res.status(404).json({ error: "Direct upload not supported" }); return; }
  const rawType = req.headers["content-type"];
  const contentType = (Array.isArray(rawType) ? rawType[0] : rawType) || "application/octet-stream";
  if (!isAllowedType(contentType)) { res.status(400).json({ error: "Unsupported file type" }); return; }
  try {
    await storage.receiveUpload(String(req.params.objectId), contentType, req);
    res.status(200).json({ ok: true });
  } catch (error) {
    if (error instanceof ObjectNotFoundError) { res.status(400).json({ error: "Invalid upload id" }); return; }
    req.log.error({ err: error }, "Error receiving upload");
    res.status(500).json({ error: "Failed to store upload" });
  }
});

// Called after the client PUTs the file: records the owner and marks the
// object publicly readable so it can render in <img>/<a> tags (which cannot
// send auth headers). Until finalized, the object is not downloadable.
router.post("/storage/uploads/finalize", requireAuth, async (req: AuthenticatedRequest, res: Response) => {
  const parsed = FinalizeUploadBody.safeParse(req.body);
  if (!parsed.success) { res.status(400).json({ error: "Invalid object path" }); return; }
  try {
    const objectPath = await storage.finalizeUpload(parsed.data.objectPath, {
      owner: String(req.userId),
      visibility: "public",
    });
    res.json({ objectPath });
  } catch (error) {
    if (error instanceof ObjectNotFoundError) { res.status(404).json({ error: "Object not found" }); return; }
    req.log.error({ err: error }, "Error finalizing upload");
    res.status(500).json({ error: "Failed to finalize upload" });
  }
});

router.get("/storage/public-objects/*filePath", async (req: AuthenticatedRequest, res: Response) => {
  try {
    const raw = req.params.filePath;
    const filePath = Array.isArray(raw) ? raw.join("/") : raw;
    const response = await storage.servePublicObject(filePath);
    if (!response) { res.status(404).json({ error: "File not found" }); return; }
    pipeDownload(res, response);
  } catch (error) {
    req.log.error({ err: error }, "Error serving public object");
    res.status(500).json({ error: "Failed to serve public object" });
  }
});

router.get("/storage/objects/*path", async (req: AuthenticatedRequest, res: Response) => {
  try {
    const raw = req.params.path;
    const wildcardPath = Array.isArray(raw) ? raw.join("/") : raw;
    const objectPath = `/objects/${wildcardPath}`;
    const response = await storage.serveObjectEntity(objectPath, {
      permission: ObjectPermission.READ,
    });
    pipeDownload(res, response);
  } catch (error) {
    if (error instanceof ObjectForbiddenError) { res.status(403).json({ error: "Forbidden" }); return; }
    if (error instanceof ObjectNotFoundError) { res.status(404).json({ error: "Object not found" }); return; }
    req.log.error({ err: error }, "Error serving object");
    res.status(500).json({ error: "Failed to serve object" });
  }
});

export default router;
