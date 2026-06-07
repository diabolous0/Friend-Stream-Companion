import { db, serverSettingsTable, SERVER_SETTINGS_ID } from "@workspace/db";
import { eq } from "drizzle-orm";
import { config } from "./config";

export type RegistrationMode = "open" | "invite" | "closed";

export interface ServerSettings {
  serverName: string;
  description: string | null;
  registration: RegistrationMode;
  maxUsers: number;
}

export interface ServerSettingsPatch {
  serverName?: string;
  description?: string | null;
  registration?: RegistrationMode;
  maxUsers?: number;
}

/** The single overrides row, or null if none has been written yet. */
async function getRow() {
  const [row] = await db
    .select()
    .from(serverSettingsTable)
    .where(eq(serverSettingsTable.id, SERVER_SETTINGS_ID))
    .limit(1);
  return row ?? null;
}

/** Merged settings: DB override wins, otherwise the resolved static config. */
export async function getServerSettings(): Promise<ServerSettings> {
  const row = await getRow();
  return {
    serverName: row?.serverName ?? config.serverName,
    description: row?.description ?? null,
    registration:
      (row?.registration as RegistrationMode | null | undefined) ?? config.registration,
    maxUsers: row?.maxUsers ?? config.maxUsers,
  };
}

/**
 * Apply an admin patch to the overrides row (creating it on first write), then
 * return the merged settings. Only fields present in `patch` are changed.
 */
export async function updateServerSettings(patch: ServerSettingsPatch): Promise<ServerSettings> {
  const values: Partial<typeof serverSettingsTable.$inferInsert> = { updatedAt: new Date() };
  if (patch.serverName !== undefined) values.serverName = patch.serverName;
  if (patch.description !== undefined) values.description = patch.description;
  if (patch.registration !== undefined) values.registration = patch.registration;
  if (patch.maxUsers !== undefined) values.maxUsers = Math.floor(patch.maxUsers);

  // Atomic singleton upsert keyed on the fixed primary key: concurrent
  // first-writes conflict on the PK and converge instead of duplicating rows.
  await db
    .insert(serverSettingsTable)
    .values({ id: SERVER_SETTINGS_ID, ...values })
    .onConflictDoUpdate({ target: serverSettingsTable.id, set: values });

  return getServerSettings();
}
