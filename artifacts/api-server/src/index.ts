// config MUST be imported first: on load it injects database settings into
// process.env before @workspace/db (pulled in via ./app) initializes.
import { config } from "./lib/config";
import { createServer } from "node:http";
import app from "./app";
import { logger } from "./lib/logger";
import { setupSignaling } from "./lib/signaling";
import { startCleanupJob } from "./lib/cleanup";

const server = createServer(app);

setupSignaling(server);
startCleanupJob();

// Bind 0.0.0.0 so a self-hosted server is reachable across the network.
server.listen(config.port, "0.0.0.0", () => {
  logger.info(
    { port: config.port, serverName: config.serverName },
    "Server listening",
  );
});

server.on("error", (err) => {
  logger.error({ err }, "Server error");
  process.exit(1);
});
