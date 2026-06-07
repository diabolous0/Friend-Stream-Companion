import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";
import { dbTable, dbUnique, idCol, int, tsCreated } from "./_dialect";
import { usersTable } from "./users";

export const blocksTable = dbTable("blocks", {
  id: idCol(),
  blockerId: int("blocker_id").notNull().references(() => usersTable.id),
  blockedId: int("blocked_id").notNull().references(() => usersTable.id),
  createdAt: tsCreated("created_at"),
}, (t) => [dbUnique().on(t.blockerId, t.blockedId)]);

export const insertBlockSchema = createInsertSchema(blocksTable).omit({ id: true, createdAt: true });
export type InsertBlock = z.infer<typeof insertBlockSchema>;
export type Block = typeof blocksTable.$inferSelect;
