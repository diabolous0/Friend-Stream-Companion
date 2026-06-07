import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";
import { dbTable, dbUnique, idCol, txt, int, tsCreated } from "./_dialect";
import { roomsTable } from "./rooms";
import { usersTable } from "./users";

export const roomBansTable = dbTable("room_bans", {
  id: idCol(),
  roomId: int("room_id").notNull().references(() => roomsTable.id),
  userId: int("user_id").notNull().references(() => usersTable.id),
  bannedBy: int("banned_by").notNull().references(() => usersTable.id),
  reason: txt("reason"),
  createdAt: tsCreated("created_at"),
}, (t) => [dbUnique().on(t.roomId, t.userId)]);

export const insertRoomBanSchema = createInsertSchema(roomBansTable).omit({ id: true, createdAt: true });
export type InsertRoomBan = z.infer<typeof insertRoomBanSchema>;
export type RoomBan = typeof roomBansTable.$inferSelect;
