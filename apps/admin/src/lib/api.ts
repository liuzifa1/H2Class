import type { MeResponse } from "@h2class/shared";
import { meResponseSchema } from "@h2class/shared";
import { CORE_URL } from "./config";

const TOKEN_KEY = "h2class.owner-token";

type Decoder<T> = {
  safeParse: (
    value: unknown,
  ) => { success: true; data: T } | { success: false };
};

export type RequestError = Error & {
  status: number;
  code: string;
};

let bearerToken = localStorage.getItem(TOKEN_KEY);
let unauthorizedHandler: (() => void) | undefined;

const record = (value: unknown): Record<string, unknown> | null =>
  typeof value === "object" && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;

const errorCode = (value: unknown, fallback: string) => {
  const object = record(value);
  return object !== null && typeof object.error === "string"
    ? object.error
    : fallback;
};

const requestError = (status: number, code: string): RequestError =>
  Object.assign(new Error(code), { status, code });

const readError = async (response: Response) => {
  const body: unknown = await response.json().catch(() => undefined);
  return requestError(response.status, errorCode(body, `request_failed_${response.status}`));
};

export const isRequestError = (value: unknown): value is RequestError =>
  value instanceof Error &&
  typeof Reflect.get(value, "status") === "number" &&
  typeof Reflect.get(value, "code") === "string";

export const getRequestErrorMessage = (value: unknown) => {
  if (!isRequestError(value)) return "请求失败，请稍后重试。";
  if (value.status === 403) return "你没有权限执行此操作。";
  if (value.status === 401) return "登录已失效，请重新登录。";

  const messages: Readonly<Record<string, string>> = {
    invalid_request: "填写内容有误，请检查后重试。",
    invalid_email_or_password: "邮箱或密码不正确。",
    auth_request_failed: "登录失败，请检查邮箱和密码。",
    person_not_found: "未找到该人员。",
    guardian_phone_required: "监护人必须填写手机号。",
    guardian_account_exists: "这位监护人已经开通过登录账号。",
    guardian_person_not_found: "没有找到这位监护人。",
    guardian_role_required: "只有监护人档案可以开通家长账号。",
    email_already_used: "这个邮箱已经被其他账号使用。",
    agent_disabled: "AI 助手当前已停用。",
    agent_not_configured: "AI 助手尚未完成配置。",
    agent_stream_failed: "AI 助手没有完成这次请求，请稍后重试。",
    auth_token_missing: "登录成功，但服务没有返回登录凭证。",
    conversation_not_found: "这段对话已失效，请新建对话。",
    invalid_api_response: "服务返回了无法识别的数据。",
    invalid_event_stream: "AI 助手的流式响应中断了。",
    invalid_pending_payload: "待确认操作的参数不符合当前规则。",
    pending_action_expired: "这项操作已过期，无法执行。",
    pending_action_not_found: "没有找到这项待确认操作。",
    pending_action_not_pending: "这项操作已经处理，不能重复操作。",
    pending_action_payload_invalid: "保存的操作参数已无法通过当前规则校验。",
    network_unavailable: "无法连接服务，请检查网络和服务地址。",
  };
  return messages[value.code] ?? "请求失败，请稍后重试。";
};

export const getAuthToken = () => bearerToken;

export const setAuthToken = (token: string | null) => {
  bearerToken = token;
  if (token === null) localStorage.removeItem(TOKEN_KEY);
  else localStorage.setItem(TOKEN_KEY, token);
};

export const onUnauthorized = (handler: () => void) => {
  unauthorizedHandler = handler;
  return () => {
    if (unauthorizedHandler === handler) unauthorizedHandler = undefined;
  };
};

export const fetchAuthorized = async (
  baseUrl: string,
  path: string,
  init: RequestInit = {},
) => {
  const headers = new Headers(init.headers);
  if (bearerToken !== null) headers.set("authorization", `Bearer ${bearerToken}`);
  if (init.body !== undefined && !headers.has("content-type")) {
    headers.set("content-type", "application/json");
  }

  let response: Response;
  try {
    response = await fetch(`${baseUrl}${path}`, { ...init, headers });
  } catch {
    throw requestError(0, "network_unavailable");
  }

  if (!response.ok) {
    const error = await readError(response);
    if (response.status === 401) {
      setAuthToken(null);
      unauthorizedHandler?.();
    }
    throw error;
  }
  return response;
};

export const fetchJson = async <T>(
  path: string,
  init: RequestInit,
  decoder: Decoder<T>,
): Promise<T> => {
  const response = await fetchAuthorized(CORE_URL, path, init);
  const value: unknown = await response.json().catch(() => undefined);
  const parsed = decoder.safeParse(value);
  if (!parsed.success) throw requestError(502, "invalid_api_response");
  return parsed.data;
};

export const signInWithEmail = async (email: string, password: string) => {
  let response: Response;
  try {
    response = await fetch(`${CORE_URL}/auth/sign-in/email`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ email, password }),
    });
  } catch {
    throw requestError(0, "network_unavailable");
  }

  if (!response.ok) throw await readError(response);
  const value: unknown = await response.json().catch(() => undefined);
  const valueRecord = record(value);
  const responseToken = valueRecord?.token;
  const token =
    typeof responseToken === "string" && responseToken.length > 0
      ? responseToken
      : response.headers.get("set-auth-token");
  if (token === null || token.length === 0) {
    throw requestError(502, "auth_token_missing");
  }
  setAuthToken(token);
};

export const revokeAuthSession = () => {
  const request = fetchAuthorized(CORE_URL, "/auth/sign-out", {
    method: "POST",
  }).catch(() => undefined);
  setAuthToken(null);
  return request;
};

export const getMe = (): Promise<MeResponse> =>
  fetchJson("/me", {}, meResponseSchema);
