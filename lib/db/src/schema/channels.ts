import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";
import { dbTable, idCol, txt, int, bool, tsCreated } from "./_dialect";
import { roomsTable } from "./rooms";

export const CHANNEL_TYPES = ["text", "voice", "announcement", "media"] as const;
export type ChannelType = (typeof CHANNEL_TYPES)[number];

export const channelsTable = dbTable("channels", {
  id: idCol(),
  roomId: int("room_id").notNull().references(() => roomsTable.id),
  name: txt("name").notNull(),
  type: txt("type").notNull().default("text"),
  position: int("position").notNull().default(0),
  isPrivate: bool("is_private").notNull().default(false),
  minViewRole: txt("min_view_role").notNull().default("member"),
  minSendRole: txt("min_send_role").notNull().default("member"),
  createdAt: tsCreated("created_at"),
});

export const insertChannelSchema = createInsertSchema(channelsTable).omit({ id: true, createdAt: true });
export type InsertChannel = z.infer<typeof insertChannelSchema>;
export type Channel = typeof channelsTable.$inferSelect;
