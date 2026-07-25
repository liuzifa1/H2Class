import {
  useSyncExternalStore,
  type MouseEvent as ReactMouseEvent,
} from "react";

const NAVIGATION_EVENT = "h2class:navigation";

const currentPathname = () => window.location.pathname;

const subscribe = (onChange: () => void) => {
  window.addEventListener("popstate", onChange);
  window.addEventListener(NAVIGATION_EVENT, onChange);
  return () => {
    window.removeEventListener("popstate", onChange);
    window.removeEventListener(NAVIGATION_EVENT, onChange);
  };
};

export const usePathname = () =>
  useSyncExternalStore(subscribe, currentPathname, () => "/chat");

export const navigate = (pathname: string, replace = false) => {
  if (window.location.pathname === pathname) return;
  if (replace) window.history.replaceState(null, "", pathname);
  else window.history.pushState(null, "", pathname);
  window.dispatchEvent(new Event(NAVIGATION_EVENT));
};

export const followAppLink = (
  event: ReactMouseEvent<HTMLAnchorElement>,
  pathname: string,
) => {
  if (
    event.defaultPrevented ||
    event.button !== 0 ||
    event.metaKey ||
    event.ctrlKey ||
    event.shiftKey ||
    event.altKey
  ) {
    return;
  }
  event.preventDefault();
  navigate(pathname);
};
