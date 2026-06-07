import { existsSync } from "node:fs";
import path from "node:path";
import express, { type Express } from "express";
import cors from "cors";
import pinoHttp from "pino-http";
import router from "./routes";
import { logger } from "./lib/logger";

const app: Express = express();

app.use(
  pinoHttp({
    logger,
    serializers: {
      req(req) {
        return {
          id: req.id,
          method: req.method,
          url: req.url?.split("?")[0],
        };
      },
      res(res) {
        return {
          statusCode: res.statusCode,
        };
      },
    },
  }),
);
app.use(cors());

// Body parsers must NOT run for the raw direct-upload stream, otherwise an upload
// sent with Content-Type: application/json would be consumed/parsed here before the
// route can stream it to storage. Skip parsing for that single endpoint.
const isRawUpload = (req: express.Request): boolean =>
  req.method === "PUT" && req.path.startsWith("/api/storage/uploads/local/");
const jsonParser = express.json();
const urlencodedParser = express.urlencoded({ extended: true });
app.use((req, res, next) => (isRawUpload(req) ? next() : jsonParser(req, res, next)));
app.use((req, res, next) => (isRawUpload(req) ? next() : urlencodedParser(req, res, next)));

app.use("/api", router);

// Optional single-server mode (self-hosting): when SCREENCREW_STATIC_DIR points to
// a built frontend, serve it from the same origin as the API. Replit leaves this
// unset (the frontend is served by its own Vite artifact), so this is a no-op there.
const staticDir = process.env.SCREENCREW_STATIC_DIR;
if (staticDir && existsSync(staticDir)) {
  logger.info({ staticDir }, "Serving frontend static assets");
  app.use(express.static(staticDir));
  // SPA fallback: send index.html for any non-API GET so client-side routes work.
  app.get(/^\/(?!api\/).*/, (_req, res) => {
    res.sendFile(path.join(staticDir, "index.html"));
  });
}

export default app;
