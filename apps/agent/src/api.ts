import { endpoints, meResponseSchema } from "@h2class/shared";
import type { z } from "zod";

export type EndpointName = keyof typeof endpoints;
export type EndpointInput<Name extends EndpointName> = z.input<
  (typeof endpoints)[Name]["input"]
>;
export type EndpointOutput<Name extends EndpointName> = z.output<
  (typeof endpoints)[Name]["output"]
>;

export class CoreApiError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
  ) {
    super(code);
  }
}

const errorCode = async (response: Response) => {
  try {
    const body: unknown = await response.clone().json();
    if (typeof body !== "object" || body === null) return "core_request_failed";
    const value = Reflect.get(body, "error");
    return typeof value === "string" ? value : "core_request_failed";
  } catch {
    return "core_request_failed";
  }
};

const requireOk = async (response: Response) => {
  if (!response.ok) {
    throw new CoreApiError(response.status, await errorCode(response));
  }
};

const replacePathParams = (
  path: string,
  input: Record<string, unknown>,
) => {
  const remaining = { ...input };
  const replaced = path.replace(/:([A-Za-z0-9_]+)/g, (_match, name: string) => {
    const value = remaining[name];
    if (typeof value !== "string") {
      throw new CoreApiError(400, "invalid_tool_input");
    }
    delete remaining[name];
    return encodeURIComponent(value);
  });
  return { path: replaced, remaining };
};

const queryString = (input: Record<string, unknown>) => {
  const query = new URLSearchParams();
  for (const [name, value] of Object.entries(input)) {
    if (value === undefined) continue;
    if (
      typeof value !== "string" &&
      typeof value !== "number" &&
      typeof value !== "boolean"
    ) {
      throw new CoreApiError(400, "invalid_tool_input");
    }
    query.set(name, String(value));
  }
  const serialized = query.toString();
  return serialized.length === 0 ? "" : `?${serialized}`;
};

export const verifyAdminToken = async (
  coreApiUrl: string,
  authorization: string | undefined,
): Promise<"admin" | "forbidden"> => {
  if (authorization === undefined || !authorization.startsWith("Bearer ")) {
    throw new CoreApiError(401, "unauthorized");
  }

  let response: Response;
  try {
    response = await fetch(new URL("/me", coreApiUrl), {
      headers: { authorization },
    });
  } catch {
    throw new CoreApiError(503, "core_unavailable");
  }
  if (response.status === 401) throw new CoreApiError(401, "unauthorized");
  await requireOk(response);
  const parsed = meResponseSchema.safeParse(await response.json());
  if (!parsed.success) throw new CoreApiError(502, "invalid_core_response");
  return parsed.data.roles.includes("admin") ? "admin" : "forbidden";
};

export const createCoreClient = (
  coreApiUrl: string,
  token: string,
) => {
  const headers = (conversationId: string) => ({
    authorization: `Bearer ${token}`,
    "content-type": "application/json",
    "x-conversation-id": conversationId,
  });

  const call = async <Name extends EndpointName>(
    name: Name,
    input: EndpointInput<Name>,
    conversationId: string,
  ): Promise<EndpointOutput<Name>> => {
    const endpoint = endpoints[name];
    const parsedInput = endpoint.input.safeParse(input);
    if (!parsedInput.success) throw new CoreApiError(400, "invalid_tool_input");
    const { path, remaining } = replacePathParams(
      endpoint.path,
      parsedInput.data as Record<string, unknown>,
    );
    const isGet = endpoint.method === "GET";
    const url = new URL(
      `${path}${isGet ? queryString(remaining) : ""}`,
      coreApiUrl,
    );
    let response: Response;
    try {
      response = await fetch(url, {
        method: endpoint.method,
        headers: headers(conversationId),
        body: isGet ? undefined : JSON.stringify(remaining),
      });
    } catch {
      throw new CoreApiError(503, "core_unavailable");
    }
    await requireOk(response);
    const output: unknown = await response.json();
    const parsedOutput = endpoint.output.safeParse(output);
    if (!parsedOutput.success) {
      throw new CoreApiError(502, "invalid_core_response");
    }
    return parsedOutput.data as EndpointOutput<Name>;
  };

  const propose = async (
    endpoint: EndpointName,
    payload: unknown,
    conversationId: string,
  ): Promise<unknown> => {
    let response: Response;
    try {
      response = await fetch(new URL("/pending-actions", coreApiUrl), {
        method: "POST",
        headers: headers(conversationId),
        body: JSON.stringify({ endpoint, payload }),
      });
    } catch {
      throw new CoreApiError(503, "core_unavailable");
    }
    await requireOk(response);
    return response.json();
  };

  return { call, propose };
};

export type CoreClient = ReturnType<typeof createCoreClient>;
