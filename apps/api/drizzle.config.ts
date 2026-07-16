import { defineConfig } from "drizzle-kit";

// Used by `pnpm db:generate` to emit migration SQL into ./migrations,
// which `wrangler d1 migrations apply` then runs (locally or remotely).
export default defineConfig({
  dialect: "sqlite",
  schema: "./src/db/schema.ts",
  out: "./migrations",
});
