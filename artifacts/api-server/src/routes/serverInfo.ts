import { Router, type IRouter } from "express";
import { db, usersTable } from "@workspace/db";
import { sql } from "drizzle-orm";
import { config } from "../lib/config";
import { getServerSettings } from "../lib/serverSettings";
import { requireAuth } from "../middlewares/auth";

const router: IRouter = Router();

// Public endpoint: lets clients discover the server name, description, member
// count, and registration policy before authenticating (the login screen and
// the server-info hover window need these). Deliberately excludes ICE servers
// so TURN credentials are never exposed to anonymous callers.
router.get("/server-info", async (_req, res): Promise<void> => {
  const settings = await getServerSettings();
  const [{ count }] = await db
    .select({ count: sql<number>`count(*)` })
    .from(usersTable);
  res.json({
    serverName: settings.serverName,
    description: settings.description,
    registration: settings.registration,
    userCount: Number(count),
  });
});

// Authenticated endpoint: WebRTC ICE servers (STUN/TURN). May include TURN
// credentials, so it requires a valid session.
router.get("/ice-servers", requireAuth, (_req, res): void => {
  res.json({ iceServers: config.iceServers });
});

export default router;
