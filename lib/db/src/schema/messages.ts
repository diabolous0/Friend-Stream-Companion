import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";
import { dbTable, dbUnique, idCol, txt, int, bool, ts, tsCreated } from "./_dialect";
import { usersTable } from "./users";
import { roomsTable } from "./rooms";

export const messagesTable = dbTable("messages", {
  id: idCol(),
  roomId: int("room_id").notNull().references(() => roomsTable.id),
  channelId: int("channel_id"),
  userId: int("user_id").notNull().references(() => usersTable.id),
  content: txt("content").notNull(),
  createdAt: tsCreated("created_at"),
  editedAt: ts("edited_at"),
  replyToId: int("reply_to_id"),
  pinned: bool("pinned").notNull().default(false),
});

export const messageReactionsTable = dbTable("message_reactions", {
  id: idCol(),
  messageId: int("message_id").notNull().references(() => messagesTable.id, { onDelete: "cascade" }),
  userId: int("user_id").notNull().references(() => usersTable.id),
  emoji: txt("emoji").notNull(),
  createdAt: tsCreated("created_at"),
}, (t) => [dbUnique().on(t.messageId, t.userId, t.emoji)]);

export const insertMessageSchema = createInsertSchema(messagesTable).omit({ id: true, createdAt: true });
export type InsertMessage = z.infer<typeof insertMessageSchema>;
export type Message = typeof messagesTable.$inferSelect;
export type MessageReaction = typeof messageReactionsTable.$inferSelect;
