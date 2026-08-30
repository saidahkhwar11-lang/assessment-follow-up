import { sqliteTable, text, integer } from "drizzle-orm/sqlite-core";
export const departmentState = sqliteTable("department_state", {
  id: text("id").primaryKey(),
  payload: text("payload").notNull(),
  updatedAt: integer("updated_at").notNull(),
});
