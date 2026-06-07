import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";
import { dbTable, idCol, txt, int, tsCreated } from "./_dialect";
import { usersTable } from "./users";
import { roomsTable } from "./rooms";

export const botsTable = dbTable("bots", {
  id: idCol(),
  roomId: int("room_id").notNull().references(() => roomsTable.id),
  userId: int("user_id").notNull().references(() => usersTable.id),
  name: txt("name").notNull(),
  tokenHash: txt("token_hash").notNull(),
  createdBy: int("created_by").notNull().references(() => usersTable.id),
  createdAt: tsCreated("created_at"),
});

export const insertBotSchema = createInsertSchema(botsTable).omit({ id: true, createdAt: true });
export type InsertBot = z.infer<typeof insertBotSchema>;
export type Bot = typeof botsTable.$inferSelect;
