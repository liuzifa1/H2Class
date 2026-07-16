import { index, integer, sqliteTable, text } from "drizzle-orm/sqlite-core";

// ARCHITECTURE.md §3.8 — append-only activity log, written by middleware on
// every successful mutating request. `actor` becomes the session person id
// once auth lands (milestone 2); the agent's service account shows up here too.
export const activityLog = sqliteTable(
  "activity_log",
  {
    id: integer("id").primaryKey({ autoIncrement: true }),
    actor: text("actor").notNull(),
    action: text("action").notNull(),
    entity: text("entity"),
    entityId: text("entity_id"),
    summary: text("summary"),
    createdAt: integer("created_at", { mode: "timestamp" })
      .notNull()
      .$defaultFn(() => new Date()),
  },
  (t) => [index("activity_log_created_at_idx").on(t.createdAt)],
);
