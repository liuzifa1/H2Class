import {
  meResponseSchema,
  myBalanceGetOutputSchema,
  myFeedbackListOutputSchema,
  myScheduleListOutputSchema,
  myStudentsListOutputSchema,
  type MeResponse,
  type MyBalanceGetOutput,
  type MyFeedbackListOutput,
  type MyScheduleListOutput,
  type MyStudentsListOutput,
} from "@h2class/shared";

const TOKEN_KEY = "h2class.guardian-token";
const coreUrl = (import.meta.env.VITE_CORE_URL?.trim() ?? "").replace(/\/+$/, "");

type Decoder<T> = {
  safeParse(value: unknown): { success: true; data: T } | { success: false };
};

export type ApiError = Error & { status: number; code: string };

let token = localStorage.getItem(TOKEN_KEY);
let unauthorized: (() => void) | undefined;

const error = (status: number, code: string): ApiError =>
  Object.assign(new Error(code), { status, code });

const errorCode = async (response: Response) => {
  const value: unknown = await response.json().catch(() => undefined);
  if (typeof value !== "object" || value === null) return "request_failed";
  const code = Reflect.get(value, "error");
  return typeof code === "string" ? code : "request_failed";
};

export const getToken = () => token;

export const setToken = (value: string | null) => {
  token = value;
  if (value === null) localStorage.removeItem(TOKEN_KEY);
  else localStorage.setItem(TOKEN_KEY, value);
};

export const onUnauthorized = (handler: () => void) => {
  unauthorized = handler;
  return () => {
    if (unauthorized === handler) unauthorized = undefined;
  };
};

const request = async <T>(path: string, decoder: Decoder<T>): Promise<T> => {
  if (coreUrl.length === 0) throw error(0, "not_configured");
  let response: Response;
  try {
    response = await fetch(`${coreUrl}${path}`, {
      headers: token === null ? {} : { authorization: `Bearer ${token}` },
    });
  } catch {
    throw error(0, "network_unavailable");
  }
  if (!response.ok) {
    const requestError = error(response.status, await errorCode(response));
    if (response.status === 401) {
      setToken(null);
      unauthorized?.();
    }
    throw requestError;
  }
  const parsed = decoder.safeParse(await response.json().catch(() => undefined));
  if (!parsed.success) throw error(502, "invalid_api_response");
  return parsed.data;
};

export const signIn = async (email: string, password: string) => {
  if (coreUrl.length === 0) throw error(0, "not_configured");
  let response: Response;
  try {
    response = await fetch(`${coreUrl}/auth/sign-in/email`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ email, password }),
    });
  } catch {
    throw error(0, "network_unavailable");
  }
  if (!response.ok) throw error(response.status, await errorCode(response));
  const body: unknown = await response.json().catch(() => undefined);
  const bodyToken =
    typeof body === "object" &&
    body !== null &&
    typeof Reflect.get(body, "token") === "string"
      ? Reflect.get(body, "token") as string
      : null;
  const authToken = bodyToken ?? response.headers.get("set-auth-token");
  if (authToken === null || authToken.length === 0) {
    throw error(502, "auth_token_missing");
  }
  setToken(authToken);
};

export const signOut = () => {
  const current = token;
  setToken(null);
  if (current === null || coreUrl.length === 0) return;
  void fetch(`${coreUrl}/auth/sign-out`, {
    method: "POST",
    headers: { authorization: `Bearer ${current}` },
  }).catch(() => undefined);
};

export const getMe = (): Promise<MeResponse> => request("/me", meResponseSchema);
export const getMyStudents = (): Promise<MyStudentsListOutput> =>
  request("/my/students", myStudentsListOutputSchema);
export const getMyBalance = (): Promise<MyBalanceGetOutput> =>
  request("/my/balance", myBalanceGetOutputSchema);
export const getMySchedule = (
  startAt: string,
  endAt: string,
): Promise<MyScheduleListOutput> => {
  const query = new URLSearchParams({ startAt, endAt });
  return request(`/my/schedule?${query}`, myScheduleListOutputSchema);
};
export const getMyFeedback = (): Promise<MyFeedbackListOutput> =>
  request("/my/feedback", myFeedbackListOutputSchema);

export const messageForError = (value: unknown) => {
  const code = typeof value === "object" && value !== null
    ? Reflect.get(value, "code")
    : undefined;
  if (code === "invalid_email_or_password") return "邮箱或密码不正确。";
  if (code === "forbidden") return "此账号不是家长账号。";
  if (code === "network_unavailable") return "暂时无法连接，请稍后再试。";
  if (code === "not_configured") return "家长中心尚未配置服务地址。";
  return "加载失败，请稍后再试。";
};
