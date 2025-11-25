import { pgTable, text } from "drizzle-orm/pg-core";

export const items = pgTable("items", {
  name: text("name").primaryKey(),
});
