import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { z } from "zod/v4";

/**
 * Central runtime configuration for the ScreenCrew server.
 *
 * Resolution order (lowest to highest precedence):
 *   1. Built-in defaults (this file)
 *   2. A JSON config file (path from SCREENCREW_CONFIG, else ./screencrew.config.json)
 *   3. Environment variables
 *
 * This makes the server portable: self-hosters drive it from a config file, while
 * the Replit/cloud deployment keeps working purely from environment variables.
 *
 * NOTE: this module is imported FIRST in index.ts. On load it also injects the
 * database settings back into process.env so the standalone `@workspace/db`
 * package (which cannot import this file) can read them. Environment values that
 * are already set always win.
 */

const IceServerSchema = z.object({
  urls: z.union([z.string(), z.array(z.string())]),
  username: z.string().optional(),
  credential: z.string().optional(),
});

const ConfigFileSchema = z
  .object({
    serverName: z.string().min(1).optional(),
    port: z.number().int().positive().optional(),
    sessionSecret: z.string().min(1).optional(),
    adminPassword: z.string().min(1).optional(),
    maxUsers: z.number().int().positive().optional(),
    registration: z.enum(["open", "invite", "closed"]).optional(),
    ephemeralRooms: z.boolean().optional(),
    roomTtlHours: z.number().int().positive().optional(),
    database: z
      .object({
        driver: z.enum(["postgres", "sqlite"]).optional(),
        url: z.string().optional(),
        path: z.string().optional(),
      })
      .optional(),
    storage: z
      .object({
        driver: z.enum(["local", "replit"]).optional(),
        dataDir: z.string().optional(),
      })
      .optional(),
    iceServers: z.array(IceServerSchema).optional(),
  })
  .strict();

type ConfigFile = z.infer<typeof ConfigFileSchema>;

export interface ResolvedConfig {
  serverName: string;
  port: number;
  sessionSecret: string;
  adminPassword: string | null;
  maxUsers: number;
  registration: "open" | "invite" | "closed";
  ephemeralRooms: boolean;
  roomTtlHours: number;
  database:
    | { driver: "postgres"; url: string | null }
    | { driver: "sqlite"; path: string };
  storage: { driver: "local" | "replit"; dataDir: string };
  iceServers: z.infer<typeof IceServerSchema>[];
}

const DEFAULTS = {
  serverName: "ScreenCrew Server",
  port: 8080,
  sessionSecret: "screencrew-dev-secret",
  maxUsers: 100,
  registration: "open" as const,
  ephemeralRooms: false,
  roomTtlHours: 24,
  sqlitePath: "./data/screencrew.db",
  storageDataDir: "./data/uploads",
  iceServers: [{ urls: "stun:stun.l.google.com:19302" }],
};

function loadConfigFile(): ConfigFile {
  const explicit = process.env.SCREENCREW_CONFIG;
  const filePath = explicit
    ? path.resolve(explicit)
    : path.resolve(process.cwd(), "screencrew.config.json");

  if (!existsSync(filePath)) {
    if (explicit) {
      throw new Error(`SCREENCREW_CONFIG points to a missing file: ${filePath}`);
    }
    return {};
  }

  let raw: unknown;
  try {
    raw = JSON.parse(readFileSync(filePath, "utf8"));
  } catch (err) {
    throw new Error(`Failed to parse config file ${filePath}: ${(err as Error).message}`);
  }

  const parsed = ConfigFileSchema.safeParse(raw);
  if (!parsed.success) {
    throw new Error(`Invalid config file ${filePath}: ${parsed.error.message}`);
  }
  return parsed.data;
}

function boolFromEnv(value: string | undefined): boolean | undefined {
  if (value === undefined || value === "") return undefined;
  return ["1", "true", "yes", "on"].includes(value.toLowerCase());
}

function numberFromEnv(value: string | undefined, label: string): number | undefined {
  if (value === undefined || value === "") return undefined;
  const n = Number(value);
  if (Number.isNaN(n) || n <= 0) {
    throw new Error(`Invalid ${label} value: "${value}"`);
  }
  return n;
}

function resolve(): ResolvedConfig {
  const file = loadConfigFile();
  const env = process.env;

  const serverName = env.SERVER_NAME ?? file.serverName ?? DEFAULTS.serverName;
  const port =
    numberFromEnv(env.PORT, "PORT") ?? file.port ?? DEFAULTS.port;
  const sessionSecret =
    env.SESSION_SECRET ?? file.sessionSecret ?? DEFAULTS.sessionSecret;
  const adminPassword = env.ADMIN_PASSWORD ?? file.adminPassword ?? null;
  const maxUsers =
    numberFromEnv(env.MAX_USERS, "MAX_USERS") ?? file.maxUsers ?? DEFAULTS.maxUsers;
  const registration =
    (env.REGISTRATION as ResolvedConfig["registration"] | undefined) ??
    file.registration ??
    DEFAULTS.registration;
  const ephemeralRooms =
    boolFromEnv(env.EPHEMERAL_ROOMS) ?? file.ephemeralRooms ?? DEFAULTS.ephemeralRooms;
  const roomTtlHours =
    numberFromEnv(env.ROOM_TTL_HOURS, "ROOM_TTL_HOURS") ?? file.roomTtlHours ?? DEFAULTS.roomTtlHours;

  // Database driver selection:
  //   - explicit DB_DRIVER env always wins
  //   - else a DATABASE_URL env implies postgres (the Replit/cloud default)
  //   - else the config file's driver
  //   - else sqlite (the self-hosted default — no external DB required)
  const driver: "postgres" | "sqlite" =
    (env.DB_DRIVER as "postgres" | "sqlite" | undefined) ??
    (env.DATABASE_URL ? "postgres" : undefined) ??
    file.database?.driver ??
    "sqlite";

  let database: ResolvedConfig["database"];
  if (driver === "sqlite") {
    database = {
      driver: "sqlite",
      path: env.SQLITE_PATH ?? file.database?.path ?? DEFAULTS.sqlitePath,
    };
  } else {
    database = {
      driver: "postgres",
      url: env.DATABASE_URL ?? file.database?.url ?? null,
    };
  }

  const storage: ResolvedConfig["storage"] = {
    driver:
      (env.STORAGE_DRIVER as "local" | "replit" | undefined) ??
      file.storage?.driver ??
      // Default to Replit storage only when its sidecar env is present.
      (env.PRIVATE_OBJECT_DIR ? "replit" : "local"),
    dataDir: env.STORAGE_DATA_DIR ?? file.storage?.dataDir ?? DEFAULTS.storageDataDir,
  };

  // ICE servers: start from the config file (or the STUN-only default), then
  // append a TURN server if one is provided via env (TURN_URL). This lets the
  // Docker Compose `turn` profile wire up a bundled coturn relay without anyone
  // having to hand-edit a config file.
  const iceServers = [...(file.iceServers ?? DEFAULTS.iceServers)];
  const turnUrl = env.TURN_URL?.trim();
  if (turnUrl) {
    iceServers.push({
      urls: turnUrl,
      ...(env.TURN_USERNAME ? { username: env.TURN_USERNAME } : {}),
      ...(env.TURN_CREDENTIAL ? { credential: env.TURN_CREDENTIAL } : {}),
    });
  }

  return {
    serverName,
    port,
    sessionSecret,
    adminPassword,
    maxUsers,
    registration,
    ephemeralRooms,
    roomTtlHours,
    database,
    storage,
    iceServers,
  };
}

export const config: ResolvedConfig = resolve();

/**
 * Inject database settings into process.env so the standalone `@workspace/db`
 * package can pick them up at import time. Only fills values that are not
 * already set in the environment, so real env vars always win.
 */
function injectDbEnv(): void {
  if (config.database.driver === "sqlite") {
    process.env.DB_DRIVER ??= "sqlite";
    process.env.SQLITE_PATH ??= config.database.path;
  } else {
    process.env.DB_DRIVER ??= "postgres";
    if (config.database.url) {
      process.env.DATABASE_URL ??= config.database.url;
    }
  }
}

injectDbEnv();
