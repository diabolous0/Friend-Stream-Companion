import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";
import { dbTable, idCol, txt, bool, tsCreated } from "./_dialect";

export const usersTable = dbTable("users", {
  id: idCol(),
  username: txt("username").notNull().unique(),
  passwordHash: txt("password_hash").notNull(),
  displayName: txt("display_name"),
  email: txt("email"),
  steamUrl: txt("steam_url"),
  discordUrl: txt("discord_url"),
  avatarUrl: txt("avatar_url"),
  nameColor: txt("name_color"),
  avatarStyle: txt("avatar_style"),
  isBot: bool("is_bot").notNull().default(false),
  isAdmin: bool("is_admin").notNull().default(false),
  createdAt: tsCreated("created_at"),
});

export const insertUserSchema = createInsertSchema(usersTable).omit({ id: true, createdAt: true });
export type InsertUser = z.infer<typeof insertUserSchema>;
export type User = typeof usersTable.$inferSelect;
