import type { Context } from "hono";
import { createAuth } from "./config";
import { resolveHumanPrincipal } from "../middleware/auth";
import type { AppEnv } from "../env";

const snakeCase = (value: string) =>
  value
    .replace(/([a-z0-9])([A-Z])/g, "$1_$2")
    .replace(/[^a-zA-Z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "")
    .toLowerCase();

const getErrorCode = async (response: Response) => {
  try {
    const body: unknown = await response.clone().json();
    if (typeof body !== "object" || body === null) return "auth_request_failed";
    const code = Reflect.get(body, "code");
    if (typeof code !== "string") return "auth_request_failed";
    return snakeCase(code) || "auth_request_failed";
  } catch {
    return "auth_request_failed";
  }
};

const normalizeError = async (response: Response) => {
  if (response.status < 400) return response;

  const headers = new Headers(response.headers);
  headers.delete("content-length");
  headers.set("content-type", "application/json; charset=UTF-8");
  return new Response(JSON.stringify({ error: await getErrorCode(response) }), {
    status: response.status,
    headers,
  });
};

export const handleAuth = async (c: Context<AppEnv>) => {
  const auth = createAuth(c.env, new URL(c.req.url).origin);
  const response = await auth.handler(c.req.raw);

  // Resolve any session token emitted by the bearer plugin so sign-in audit
  // records the newly authenticated user, even if an old token was supplied.
  if (response.ok) {
    const token = response.headers.get("set-auth-token");
    if (token !== null) {
      const headers = new Headers({ authorization: `Bearer ${token}` });
      const principal = await resolveHumanPrincipal(auth, c.env.DB, headers);
      if (principal !== null) c.set("principal", principal);
    }
  }

  return normalizeError(response);
};
