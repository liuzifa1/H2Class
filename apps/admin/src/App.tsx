import { useEffect, useState } from "react";
import { AppShell } from "./components/AppShell";
import {
  getAuthToken,
  getMe,
  onUnauthorized,
  revokeAuthSession,
  setAuthToken,
} from "./lib/api";
import { navigate, usePathname } from "./lib/navigation";
import { ChatView } from "./views/ChatView";
import { DraftsView } from "./views/DraftsView";
import { LoginView } from "./views/LoginView";
import { PendingActionsView } from "./views/PendingActionsView";
import { PeopleView } from "./views/PeopleView";

type SessionState = "checking" | "authenticated" | "anonymous";

type AppProps = {
  clearServerCache: () => void;
};

export const App = ({ clearServerCache }: AppProps) => {
  const pathname = usePathname();
  const [session, setSession] = useState<SessionState>(() =>
    getAuthToken() === null ? "anonymous" : "checking",
  );

  useEffect(
    () =>
      onUnauthorized(() => {
        clearServerCache();
        setSession("anonymous");
      }),
    [clearServerCache],
  );

  useEffect(() => {
    if (session !== "checking") return;
    let active = true;
    void getMe()
      .then(() => {
        if (active) setSession("authenticated");
      })
      .catch(() => {
        if (active) {
          setAuthToken(null);
          clearServerCache();
          setSession("anonymous");
        }
      });
    return () => {
      active = false;
    };
  }, [clearServerCache, session]);

  useEffect(() => {
    if (
      session === "authenticated" &&
      pathname !== "/chat" &&
      pathname !== "/people" &&
      pathname !== "/drafts" &&
      pathname !== "/pending-actions"
    ) {
      navigate("/chat", true);
    }
  }, [pathname, session]);

  if (session === "checking") {
    return (
      <main className="session-loader" aria-live="polite">
        <span className="session-loader__stamp" aria-hidden="true">H2</span>
        <strong>正在进入管理台</strong>
        <p>正在确认登录状态…</p>
      </main>
    );
  }

  if (session === "anonymous") {
    return <LoginView onAuthenticated={() => setSession("authenticated")} />;
  }

  const view =
    pathname === "/people" ? (
      <PeopleView />
    ) : pathname === "/drafts" ? (
      <DraftsView />
    ) : pathname === "/pending-actions" ? (
      <PendingActionsView />
    ) : (
      <ChatView />
    );

  return (
    <AppShell
      onSignOut={() => {
        void revokeAuthSession();
        clearServerCache();
        setSession("anonymous");
      }}
    >
      {view}
    </AppShell>
  );
};
