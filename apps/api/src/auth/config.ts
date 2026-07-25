import { betterAuth } from "better-auth";
import { drizzleAdapter } from "better-auth/adapters/drizzle";
import { bearer } from "better-auth/plugins/bearer";
import { drizzle } from "drizzle-orm/d1";
import { account, session, user, verification } from "../db/schema";
import type { AppEnv } from "../env";
import { clientOrigins } from "../http/admin-origins";

export const createAuth = (bindings: AppEnv["Bindings"], baseURL: string) =>
  betterAuth({
    appName: "H2Class",
    baseURL,
    basePath: "/auth",
    trustedOrigins: clientOrigins(bindings, baseURL),
    secret: bindings.BETTER_AUTH_SECRET,
    database: drizzleAdapter(drizzle(bindings.DB), {
      provider: "sqlite",
      schema: { account, session, user, verification },
    }),
    emailAndPassword: {
      enabled: true,
      disableSignUp: true,
    },
    advanced: {
      database: {
        generateId: "uuid",
      },
    },
    plugins: [bearer()],
  });

export type Auth = ReturnType<typeof createAuth>;
