import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";
import { dbTable, idCol, txt, int, ts, tsCreated } from "./_dialect";
import { usersTable } from "./users";

/**
 * Server-level invite keys (distinct from per-room invite codes). Used when the
 * server's `registration` mode is "invite": a valid, unexhausted, unexpired key
 * is required to create an account.
 */
export const serverInvitesTable = dbTable("server_invites", {
  id: idCol(),
  key: txt("key").notNull().unique(),
  createdBy: int("created_by").notNull().references(() => usersTable.id),
  // null = unlimited uses
  maxUses: int("max_uses"),
  uses: int("uses").notNull().default(0),
  // null = never expires
  expiresAt: ts("expires_at"),
  createdAt: tsCreated("created_at"),
});

export const insertServerInviteSchema = createInsertSchema(serverInvitesTable).omit({
  id: true,
  uses: true,
  createdAt: true,
});
export type InsertServerInvite = z.infer<typeof insertServerInviteSchema>;
export type ServerInvite = typeof serverInvitesTable.$inferSelect;
