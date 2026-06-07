import { pgTable, text, serial, timestamp, integer, boolean, unique } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";
import { usersTable } from "./users";

export const roomsTable = pgTable("rooms", {
  id: serial("id").primaryKey(),
  name: text("name").notNull(),
  inviteCode: text("invite_code").notNull().unique(),
  createdBy: integer("created_by").notNull().references(() => usersTable.id),
  createdAt: timestamp("created_at").notNull().defaultNow(),
  themeColor: text("theme_color"),
  themeSkin: text("theme_skin"),
  bannerUrl: text("banner_url"),
  notes: text("notes"),
  isPrivate: boolean("is_private").notNull().default(false),
  inviteExpiresAt: timestamp("invite_expires_at"),
  passwordHash: text("password_hash"),
});

export const roomMembersTable = pgTable("room_members", {
  id: serial("id").primaryKey(),
  roomId: integer("room_id").notNull().references(() => roomsTable.id),
  userId: integer("user_id").notNull().references(() => usersTable.id),
  joinedAt: timestamp("joined_at").notNull().defaultNow(),
  lastReadMessageId: integer("last_read_message_id"),
  status: text("status").notNull().default("active"),
  role: text("role").notNull().default("member"),
}, (t) => [unique().on(t.roomId, t.userId)]);

export const ROOM_ROLES = ["owner", "mod", "member"] as const;
export type RoomRole = (typeof ROOM_ROLES)[number];

export const insertRoomSchema = createInsertSchema(roomsTable).omit({ id: true, createdAt: true });
export type InsertRoom = z.infer<typeof insertRoomSchema>;
export type Room = typeof roomsTable.$inferSelect;
export type RoomMember = typeof roomMembersTable.$inferSelect;
