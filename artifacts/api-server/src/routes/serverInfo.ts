import { Router, type IRouter } from "express";
import { config } from "../lib/config";
import { requireAuth } from "../middlewares/auth";

const router: IRouter = Router();

// Public endpoint: lets clients discover the server name and registration policy
// before authenticating (the login screen needs these). Deliberately excludes
// ICE servers so TURN credentials are never exposed to anonymous callers.
router.get("/server-info", (_req, res): void => {
  res.json({
    serverName: config.serverName,
    registration: config.registration,
  });
});

// Authenticated endpoint: WebRTC ICE servers (STUN/TURN). May include TURN
// credentials, so it requires a valid session.
router.get("/ice-servers", requireAuth, (_req, res): void => {
  res.json({ iceServers: config.iceServers });
});

export default router;
