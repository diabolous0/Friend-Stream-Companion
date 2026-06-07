import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";
import { dbTable, dbUnique, idCol, txt, int, tsCreated } from "./_dialect";
import { usersTable } from "./users";

export const FRIENDSHIP_STATUSES = ["pending", "accepted"] as const;
export type FriendshipStatus = (typeof FRIENDSHIP_STATUSES)[number];

export const friendshipsTable = dbTable("friendships", {
  id: idCol(),
  requesterId: int("requester_id").notNull().references(() => usersTable.id),
  addresseeId: int("addressee_id").notNull().references(() => usersTable.id),
  status: txt("status").notNull().default("pending"),
  createdAt: tsCreated("created_at"),
}, (t) => [dbUnique().on(t.requesterId, t.addresseeId)]);

export const insertFriendshipSchema = createInsertSchema(friendshipsTable).omit({ id: true, createdAt: true });
export type InsertFriendship = z.infer<typeof insertFriendshipSchema>;
export type Friendship = typeof friendshipsTable.$inferSelect;
