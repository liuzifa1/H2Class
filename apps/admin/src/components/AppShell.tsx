import {
  draftsListOutputSchema,
  pendingActionsListOutputSchema,
} from "@h2class/shared";
import { useQuery } from "@tanstack/react-query";
import type { ReactNode } from "react";
import { fetchJson } from "../lib/api";
import { followAppLink, usePathname } from "../lib/navigation";

type AppShellProps = {
  onSignOut: () => void;
  children: ReactNode;
};

const navigation = [
  { to: "/chat", mark: "问", label: "AI 助手", caption: "处理日常工作" },
  { to: "/people", mark: "人", label: "人员", caption: "学生、家长与老师" },
  { to: "/drafts", mark: "信", label: "待发消息", caption: "复制并标记已发送" },
  { to: "/pending-actions", mark: "核", label: "待确认", caption: "审核高风险操作" },
] as const;

const pageTitles: Readonly<Record<string, string>> = {
  "/chat": "AI 助手",
  "/people": "人员档案",
  "/drafts": "待发消息",
  "/pending-actions": "待确认操作",
};

export const AppShell = ({ onSignOut, children }: AppShellProps) => {
  const pathname = usePathname();
  const pendingDrafts = useQuery({
    queryKey: ["drafts", "draft"],
    queryFn: () =>
      fetchJson(
        "/message-drafts?status=draft",
        {},
        draftsListOutputSchema,
      ),
    refetchInterval: 60_000,
  });
  const draftCount = pendingDrafts.data?.drafts.length ?? 0;
  const pendingActions = useQuery({
    queryKey: ["pending-actions"],
    queryFn: () =>
      fetchJson("/pending-actions", {}, pendingActionsListOutputSchema),
    refetchInterval: 30_000,
    refetchOnWindowFocus: true,
  });
  const now = Date.now();
  const pendingActionCount =
    pendingActions.data?.actions.filter(
      (action) =>
        action.status === "pending" && Date.parse(action.expiresAt) > now,
    ).length ?? 0;

  return (
    <div className="app-shell">
      <aside className="sidebar">
        <div className="brand">
          <div className="brand__stamp" aria-hidden="true">
            H2
          </div>
          <div>
            <strong>H2Class</strong>
            <span>教学中心管理台</span>
          </div>
        </div>

        <nav className="primary-nav" aria-label="主要导航">
          {navigation.map((item) => (
            <a
              key={item.to}
              href={item.to}
              className={
                pathname === item.to ? "nav-item nav-item--active" : "nav-item"
              }
              aria-current={pathname === item.to ? "page" : undefined}
              onClick={(event) => followAppLink(event, item.to)}
            >
              <span className="nav-item__mark" aria-hidden="true">
                {item.mark}
              </span>
              <span className="nav-item__copy">
                <strong>{item.label}</strong>
                <small>{item.caption}</small>
              </span>
              {(item.to === "/drafts" ? draftCount : item.to === "/pending-actions" ? pendingActionCount : 0) > 0 ? (
                <span
                  className="nav-badge"
                  aria-label={
                    item.to === "/drafts"
                      ? `${draftCount} 条待发消息`
                      : `${pendingActionCount} 项待确认操作`
                  }
                >
                  {(item.to === "/drafts" ? draftCount : pendingActionCount) > 99
                    ? "99+"
                    : item.to === "/drafts"
                      ? draftCount
                      : pendingActionCount}
                </span>
              ) : null}
            </a>
          ))}
        </nav>

        <div className="sidebar__footer">
          <div className="connection-state">
            <span aria-hidden="true" />
            服务已连接
          </div>
          <button className="button button--quiet button--full" onClick={onSignOut}>
            退出登录
          </button>
        </div>
      </aside>

      <div className="workspace">
        <header className="topbar">
          <div>
            <span className="topbar__eyebrow">H2CLASS · 上海时间</span>
            <h1>{pageTitles[pathname] ?? "管理台"}</h1>
          </div>
          <div className="owner-chip">
            <span aria-hidden="true">主</span>
            <div>
              <strong>管理账号</strong>
              <small>所有操作都会记录</small>
            </div>
          </div>
        </header>
        <main className="workspace__main">{children}</main>
      </div>
    </div>
  );
};
