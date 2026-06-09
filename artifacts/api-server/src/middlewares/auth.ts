import { type Request, type Response, type NextFunction } from "express";
import { createHmac, randomBytes, scryptSync, timingSafeEqual } from "node:crypto";
import { db, usersTable } from "@workspace/db";
import { eq } from "drizzle-orm";
import { config } from "../lib/config";

const SECRET = config.sessionSecret;
const TOKEN_MAX_AGE_MS = 30 * 24 * 60 * 60 * 1000;
const GUEST_TOKEN_MAX_AGE_MS = 24 * 60 * 60 * 1000;

interface TokenPayload {
  userId: number;
  iat: number;
  guestRoomId?: number;
}

function signPayload(data: TokenPayload): string {
  const payload = Buffer.from(JSON.stringify(data)).toString("base64url");
  const sig = createHmac("sha256", SECRET).update(payload).digest("base64url");
  return `${payload}.${sig}`;
}

export function signToken(userId: number): string {
  return signPayload({ userId, iat: Date.now() });
}

export function signGuestToken(userId: number, guestRoomId: number): string {
  return signPayload({ userId, guestRoomId, iat: Date.now() });
}

export function verifyToken(token: string): { userId: number; guestRoomId?: number } | null {
  try {
    const [payload, sig] = token.split(".");
    if (!payload || !sig) return null;
    const expected = createHmac("sha256", SECRET).update(payload).digest("base64url");
    const sigBuf = Buffer.from(sig, "base64url");
    const expBuf = Buffer.from(expected, "base64url");
    if (sigBuf.length !== expBuf.length) return null;
    if (!timingSafeEqual(sigBuf, expBuf)) return null;
    const parsed = JSON.parse(Buffer.from(payload, "base64url").toString("utf8")) as Partial<TokenPayload>;
    if (typeof parsed.userId !== "number" || !Number.isInteger(parsed.userId) || typeof parsed.iat !== "number") {
      return null;
    }
    if (parsed.guestRoomId !== undefined && !Number.isInteger(parsed.guestRoomId)) return null;
    const age = Date.now() - parsed.iat;
    const maxAge = parsed.guestRoomId === undefined ? TOKEN_MAX_AGE_MS : GUEST_TOKEN_MAX_AGE_MS;
    if (age < 0 || age > maxAge) return null;
    return { userId: parsed.userId, guestRoomId: parsed.guestRoomId };
  } catch {
    return null;
  }
}

export function hashPassword(password: string): string {
  const salt = randomBytes(16).toString("hex");
  const hash = scryptSync(password, salt, 64).toString("hex");
  return `scrypt:${salt}:${hash}`;
}

export function verifyPassword(password: string, stored: string): boolean {
  if (stored.startsWith("scrypt:")) {
    const [, salt, hash] = stored.split(":");
    if (!salt || !hash) return false;
    const actual = scryptSync(password, salt, 64);
    const expected = Buffer.from(hash, "hex");
    return actual.length === expected.length && timingSafeEqual(actual, expected);
  }

  // Legacy accounts used an HMAC password hash. Accept it only long enough for
  // the login route to transparently replace it with a scrypt hash.
  const actual = Buffer.from(createHmac("sha256", SECRET).update(password).digest("hex"), "hex");
  const expected = Buffer.from(stored, "hex");
  return actual.length === expected.length && timingSafeEqual(actual, expected);
}

export function passwordHashNeedsUpgrade(stored: string): boolean {
  return !stored.startsWith("scrypt:");
}

export interface AuthenticatedRequest extends Request {
  userId?: number;
  username?: string;
  isAdmin?: boolean;
  guestRoomId?: number;
}

function guestRequestAllowed(req: Request, roomId: number): boolean {
  const path = req.originalUrl.split("?")[0];
  if (req.method === "GET" && (path === "/api/users/me" || path === "/api/ice-servers")) {
    return true;
  }
  const roomPath = `/api/rooms/${roomId}`;
  if (req.method === "GET") {
    return path === roomPath || path.startsWith(`${roomPath}/`);
  }
  if (req.method === "POST" && (path === `${roomPath}/messages` || path === `${roomPath}/leave`)) {
    return true;
  }
  return /^\/api\/rooms\/\d+\/messages\/\d+(?:\/reactions|\/pin)?$/.test(path)
    && ["POST", "PATCH", "DELETE"].includes(req.method)
    && path.startsWith(`${roomPath}/messages/`);
}

export async function requireAuth(
  req: AuthenticatedRequest,
  res: Response,
  next: NextFunction
): Promise<void> {
  const authHeader = req.headers.authorization;
  if (!authHeader?.startsWith("Bearer ")) {
    res.status(401).json({ error: "Unauthorized" });
    return;
  }
  const token = authHeader.slice(7);
  const payload = verifyToken(token);
  if (!payload) {
    res.status(401).json({ error: "Invalid token" });
    return;
  }

  const [user] = await db.select().from(usersTable).where(eq(usersTable.id, payload.userId));
  if (!user) {
    res.status(401).json({ error: "User not found" });
    return;
  }

  if (payload.guestRoomId !== undefined && !guestRequestAllowed(req, payload.guestRoomId)) {
    res.status(403).json({ error: "Guest access is limited to this Quick Call" });
    return;
  }

  req.userId = user.id;
  req.username = user.username;
  req.isAdmin = user.isAdmin;
  req.guestRoomId = payload.guestRoomId;
  next();
}

/**
 * Must be chained AFTER `requireAuth` (relies on `req.isAdmin` being populated).
 */
export function requireAdmin(
  req: AuthenticatedRequest,
  res: Response,
  next: NextFunction
): void {
  if (!req.isAdmin) {
    res.status(403).json({ error: "Admin access required" });
    return;
  }
  next();
}
