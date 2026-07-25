import type { Principal } from "./auth/types";
import type { AuditDetails } from "./audit/types";

export type AppEnv = {
  Bindings: {
    AGENT_SERVICE_TOKEN: string;
    ADMIN_ORIGINS?: string;
    CLIENT_ORIGINS?: string;
    BETTER_AUTH_SECRET: string;
    DB: D1Database;
  };
  Variables: {
    audit: AuditDetails | undefined;
    principal: Principal | undefined;
  };
};
