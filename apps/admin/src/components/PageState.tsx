import type { ReactNode } from "react";

type PageStateProps = {
  title: string;
  detail?: string;
  action?: ReactNode;
  compact?: boolean;
};

export const PageState = ({
  title,
  detail,
  action,
  compact = false,
}: PageStateProps) => (
  <div className={compact ? "page-state page-state--compact" : "page-state"}>
    <div className="page-state__mark" aria-hidden="true">
      ·
    </div>
    <strong>{title}</strong>
    {detail === undefined ? null : <p>{detail}</p>}
    {action}
  </div>
);
