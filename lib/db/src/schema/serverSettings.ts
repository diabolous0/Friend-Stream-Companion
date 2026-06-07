import { dbTable, txt, int, ts } from "./_dialect";

/**
 * The fixed primary-key value for the singleton settings row. Using a constant
 * key (instead of an auto-increment id) lets writes use an atomic upsert keyed
 * on the primary key, so concurrent first-writes can never create duplicate
 * rows.
 */
export const SERVER_SETTINGS_ID = 1;

/**
 * Runtime-mutable server settings (single row, id = SERVER_SETTINGS_ID). The
 * static config resolver (`api-server/src/lib/config.ts`) decides startup
 * defaults from env/file/defaults; this table holds admin-editable overrides
 * that win when present. Null columns fall back to the resolved static config.
 * `description` has no static counterpart and lives only here.
 */
export const serverSettingsTable = dbTable("server_settings", {
  id: int("id").primaryKey(),
  serverName: txt("server_name"),
  description: txt("description"),
  registration: txt("registration"),
  maxUsers: int("max_users"),
  updatedAt: ts("updated_at"),
});

export type ServerSettingsRow = typeof serverSettingsTable.$inferSelect;
