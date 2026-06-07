import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";
import { dbTable, dbUnique, idCol, txt, int, bool, ts, tsCreated } from "./_dialect";
import { usersTable } from "./users";

export const roomsTable = dbTable("rooms", {
  id: idCol(),
  name: txt("name").notNull(),
  inviteCode: txt("invite_code").notNull().unique(),
  createdBy: int("created_by").notNull().references(() => usersTable.id),
  createdAt: tsCreated("created_at"),
  themeColor: txt("theme_color"),
  themeSkin: txt("theme_skin"),
  bannerUrl: txt("banner_url"),
  notes: txt("notes"),
  isPrivate: bool("is_private").notNull().default(false),
  inviteExpiresAt: ts("invite_expires_at"),
  passwordHash: txt("password_hash"),
  preset: bool("preset").notNull().default(false),
  ephemeral: bool("ephemeral").notNull().default(false),
  lastActivityAt: ts("last_activity_at"),
  expiresAt: ts("expires_at"),
});

export const roomMembersTable = dbTable("room_members", {
  id: idCol(),
  roomId: int("room_id").notNull().references(() => roomsTable.id),
  userId: int("user_id").notNull().references(() => usersTable.id),
  joinedAt: tsCreated("joined_at"),
  lastReadMessageId: int("last_read_message_id"),
  status: txt("status").notNull().default("active"),
  role: txt("role").notNull().default("member"),
}, (t) => [dbUnique().on(t.roomId, t.userId)]);

export const ROOM_ROLES = ["owner", "mod", "member"] as const;
export type RoomRole = (typeof ROOM_ROLES)[number];

export const ROOM_ROLE_RANK: Record<string, number> = { owner: 3, mod: 2, member: 1 };

/** True if `role` is at least as privileged as `required`. Unknown roles rank lowest. */
export function roleAtLeast(role: string | null | undefined, required: string): boolean {
  return (ROOM_ROLE_RANK[role ?? ""] ?? 0) >= (ROOM_ROLE_RANK[required] ?? 0);
}

export const insertRoomSchema = createInsertSchema(roomsTable).omit({ id: true, createdAt: true });
export type InsertRoom = z.infer<typeof insertRoomSchema>;
export type Room = typeof roomsTable.$inferSelect;
export type RoomMember = typeof roomMembersTable.$inferSelect;
