import { defineConfig } from "drizzle-kit";
import path from "path";

const isSqlite = process.env.DB_DRIVER === "sqlite";

if (!isSqlite && !process.env.DATABASE_URL) {
  throw new Error("DATABASE_URL, ensure the database is provisioned");
}

export default defineConfig(
  isSqlite
    ? {
        schema: path.join(__dirname, "./src/schema/index.ts"),
        dialect: "sqlite",
        dbCredentials: {
          url: process.env.SQLITE_PATH || "./data/screencrew.db",
        },
      }
    : {
        schema: path.join(__dirname, "./src/schema/index.ts"),
        dialect: "postgresql",
        dbCredentials: {
          url: process.env.DATABASE_URL!,
        },
      },
);
