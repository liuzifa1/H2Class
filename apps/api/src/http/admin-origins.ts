import type { AppEnv } from "../env";

const LOCAL_CLIENT_ORIGINS = [
  "http://localhost:5173",
  "http://127.0.0.1:5173",
  "http://localhost:5174",
  "http://127.0.0.1:5174",
] as const;

const configuredOrigins = (value: string | undefined) =>
  (value ?? "")
    .split(",")
    .map((origin) => origin.trim())
    .filter((origin) => origin.length > 0)
    .map((origin) => new URL(origin).origin);

export const clientOrigins = (
  bindings: AppEnv["Bindings"],
  apiUrl: string,
): string[] => {
  const apiHostname = new URL(apiUrl).hostname;
  const localOrigins =
    apiHostname === "localhost" || apiHostname === "127.0.0.1"
      ? LOCAL_CLIENT_ORIGINS
      : [];
  return [
    ...new Set([
      ...configuredOrigins(bindings.CLIENT_ORIGINS),
      ...configuredOrigins(bindings.ADMIN_ORIGINS),
      ...localOrigins,
    ]),
  ];
};
