import { pgTable, text, serial, timestamp } from "drizzle-orm/pg-core";

export const items = pgTable("items", {
  name: text("name").primaryKey(),
});

export const users = pgTable("users", {
  id: serial("id").primaryKey(),
  email: text("email").notNull().unique(),
  name: text("name"),
  createdAt: timestamp("created_at").defaultNow().notNull(),
});
