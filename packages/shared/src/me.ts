import { z } from "zod";

export const roleSchema = z.enum([
  "admin",
  "staff",
  "teacher",
  "guardian",
  "agent",
]);

export const meInputSchema = z.object({}).strict();

export const meResponseSchema = z.object({
  id: z.string().describe("Authenticated principal id."),
  roles: z.array(roleSchema).describe("Roles granted to the principal."),
});

export type MeResponse = z.infer<typeof meResponseSchema>;
