const withoutTrailingSlash = (value: string) => value.replace(/\/+$/, "");

export const CORE_URL = withoutTrailingSlash(
  import.meta.env.VITE_CORE_URL?.trim() ?? "",
);
export const AGENT_URL = withoutTrailingSlash(
  import.meta.env.VITE_AGENT_URL?.trim() ?? "",
);
export const DEFAULT_AGENT_MODEL = import.meta.env.VITE_AGENT_MODEL?.trim() ?? "";

export const configurationError =
  CORE_URL.length === 0 || AGENT_URL.length === 0
    ? "请配置 VITE_CORE_URL 和 VITE_AGENT_URL 后重新打开管理台。"
    : null;
