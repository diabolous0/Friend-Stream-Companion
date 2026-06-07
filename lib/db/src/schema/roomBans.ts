import { pgTable, serial, integer, text, timestamp, unique } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";
import { roomsTable } from "./rooms";
import { usersTable } from "./users";

export const roomBansTable = pgTable("room_bans", {
  id: serial("id").primaryKey(),
  roomId: integer("room_id").notNull().references(() => roomsTable.id),
  userId: integer("user_id").notNull().references(() => usersTable.id),
  bannedBy: integer("banned_by").notNull().references(() => usersTable.id),
  reason: text("reason"),
  createdAt: timestamp("created_at").notNull().defaultNow(),
}, (t) => [unique().on(t.roomId, t.userId)]);

export const insertRoomBanSchema = createInsertSchema(roomBansTable).omit({ id: true, createdAt: true });
export type InsertRoomBan = z.infer<typeof insertRoomBanSchema>;
export type RoomBan = typeof roomBansTable.$inferSelect;
