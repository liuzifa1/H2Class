import {
  pendingActionSchema,
  pendingActionsListOutputSchema,
  type PendingAction,
  type PendingActionsExecuteInput,
  type PendingActionsListOutput,
  type PendingActionsRejectInput,
} from "@h2class/shared";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useMemo, useState, type FormEvent } from "react";
import { PageState } from "../components/PageState";
import { fetchJson, getRequestErrorMessage } from "../lib/api";
import { formatShanghaiFullDateTime } from "../lib/date";

const queryKey = ["pending-actions"] as const;

type ResolutionCommand =
  | { kind: "execute"; input: PendingActionsExecuteInput }
  | { kind: "reject"; input: PendingActionsRejectInput };

const statusLabels = {
  pending: "等待确认",
  expired: "已过期",
  executed: "已执行",
  rejected: "已拒绝",
} as const;

const exactJson = (value: unknown) => JSON.stringify(value, null, 2);

const useExpired = (action: PendingAction) => {
  const [now, setNow] = useState(Date.now());

  useEffect(() => {
    if (action.status !== "pending") return;
    const remaining = Date.parse(action.expiresAt) - Date.now();
    if (remaining <= 0) {
      setNow(Date.now());
      return;
    }
    const timer = window.setTimeout(() => setNow(Date.now()), remaining + 50);
    return () => window.clearTimeout(timer);
  }, [action.expiresAt, action.status]);

  return action.status === "expired" ||
    (action.status === "pending" && Date.parse(action.expiresAt) <= now);
};

type PendingActionCardProps = {
  action: PendingAction;
  busy: boolean;
  resolving: "execute" | "reject" | null;
  error: string | null;
  onExecute: () => void;
  onReject: (reason: string | undefined) => void;
};

const PendingActionCard = ({
  action,
  busy,
  resolving,
  error,
  onExecute,
  onReject,
}: PendingActionCardProps) => {
  const expired = useExpired(action);
  const [rejectOpen, setRejectOpen] = useState(false);
  const [reason, setReason] = useState("");
  const disabled = expired || busy;

  const submitRejection = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const trimmed = reason.trim();
    onReject(trimmed.length === 0 ? undefined : trimmed);
  };

  return (
    <article className={expired ? "pending-card pending-card--expired" : "pending-card"}>
      <header className="pending-card__head">
        <span className={expired ? "status-pill status-pill--expired" : "status-pill status-pill--pending"}>
          {expired ? statusLabels.expired : statusLabels.pending}
        </span>
        <span className="pending-card__endpoint">{action.endpointName}</span>
        <time>提出于 {formatShanghaiFullDateTime(action.createdAt)}</time>
      </header>

      <h3>{action.summary}</h3>
      <dl className="pending-card__facts">
        <div>
          <dt>提出者</dt>
          <dd>{action.createdBy}</dd>
        </div>
        <div>
          <dt>{expired ? "过期时间" : "确认期限"}</dt>
          <dd>{formatShanghaiFullDateTime(action.expiresAt)}</dd>
        </div>
      </dl>

      <details className="payload-disclosure">
        <summary>查看核心保存的完整参数</summary>
        <pre>{exactJson(action.payload)}</pre>
      </details>

      {expired ? (
        <div className="pending-card__expired-note">
          该操作已超过确认期限，不能执行或拒绝。
        </div>
      ) : null}

      {error === null ? null : (
        <div className="inline-alert inline-alert--error" role="alert">
          {error}
        </div>
      )}

      {rejectOpen && !expired ? (
        <form className="reject-form" onSubmit={submitRejection}>
          <label className="field">
            <span>拒绝原因（选填）</span>
            <textarea
              value={reason}
              onChange={(event) => setReason(event.target.value)}
              maxLength={500}
              rows={2}
              placeholder="例如：金额需要重新确认"
              disabled={disabled}
              autoFocus
            />
          </label>
          <div>
            <button
              className="button button--quiet"
              type="button"
              onClick={() => {
                setReason("");
                setRejectOpen(false);
              }}
              disabled={disabled}
            >
              取消
            </button>
            <button
              className="button button--danger"
              type="submit"
              disabled={disabled}
            >
              {resolving === "reject" ? "正在拒绝…" : "确认拒绝"}
            </button>
          </div>
        </form>
      ) : (
        <footer className="pending-card__actions">
          <button
            className="button button--quiet"
            type="button"
            onClick={() => setRejectOpen(true)}
            disabled={disabled}
          >
            拒绝
          </button>
          <button
            className="button button--primary"
            type="button"
            onClick={onExecute}
            disabled={disabled}
          >
            {resolving === "execute" ? "正在执行…" : "确认执行"}
          </button>
        </footer>
      )}
    </article>
  );
};

const ResolutionHistoryCard = ({ action }: { action: PendingAction }) => (
  <article className="resolution-card">
    <div className="resolution-card__head">
      <span className={`status-pill status-pill--${action.status}`}>
        {statusLabels[action.status]}
      </span>
      <time>
        {action.resolvedAt === null
          ? formatShanghaiFullDateTime(action.expiresAt)
          : formatShanghaiFullDateTime(action.resolvedAt)}
      </time>
    </div>
    <h4>{action.summary}</h4>
    <p>
      <span>{action.endpointName}</span>
      {action.resolvedBy === null ? "系统标记" : `由 ${action.resolvedBy} 处理`}
    </p>
    <details className="payload-disclosure payload-disclosure--compact">
      <summary>查看保存参数{action.result === null ? "" : "与处理结果"}</summary>
      <span>完整参数</span>
      <pre>{exactJson(action.payload)}</pre>
      {action.result === null ? null : (
        <>
          <span>处理结果</span>
          <pre>{exactJson(action.result)}</pre>
        </>
      )}
    </details>
  </article>
);

export const PendingActionsView = () => {
  const queryClient = useQueryClient();
  const actions = useQuery({
    queryKey,
    queryFn: () =>
      fetchJson("/pending-actions", {}, pendingActionsListOutputSchema),
    refetchInterval: 30_000,
    refetchOnWindowFocus: true,
  });

  const resolution = useMutation({
    mutationFn: (command: ResolutionCommand) =>
      command.kind === "execute"
        ? fetchJson(
            `/pending-actions/${command.input.id}/execute`,
            { method: "POST" },
            pendingActionSchema,
          )
        : fetchJson(
            `/pending-actions/${command.input.id}/reject`,
            {
              method: "POST",
              body: JSON.stringify(
                command.input.reason === undefined
                  ? {}
                  : { reason: command.input.reason },
              ),
            },
            pendingActionSchema,
          ),
    onSuccess: async (updated) => {
      queryClient.setQueryData<PendingActionsListOutput>(queryKey, (current) =>
        current === undefined
          ? current
          : {
              actions: current.actions.map((action) =>
                action.id === updated.id ? updated : action,
              ),
            },
      );
      await queryClient.invalidateQueries({ queryKey });
    },
    onError: async () => {
      await queryClient.invalidateQueries({ queryKey });
    },
  });

  const open = useMemo(
    () =>
      (actions.data?.actions ?? []).filter(
        (action) => action.status === "pending" || action.status === "expired",
      ),
    [actions.data],
  );
  const history = useMemo(
    () =>
      (actions.data?.actions ?? []).filter(
        (action) => action.status === "executed" || action.status === "rejected",
      ),
    [actions.data],
  );
  const pendingCount = open.filter(
    (action) =>
      action.status === "pending" && Date.parse(action.expiresAt) > Date.now(),
  ).length;
  const activeResolution = resolution.variables;
  const resolutionError = resolution.isError
    ? getRequestErrorMessage(resolution.error)
    : null;

  return (
    <section className="page-stack pending-actions-page">
      <header className="page-heading">
        <div>
          <span className="section-kicker">所有者确认</span>
          <h2>待确认操作</h2>
          <p>确认后，核心系统只执行下方保存的参数，并以你的账号记录操作。</p>
        </div>
        <div className="pending-heading__tools">
          <span>
            {actions.dataUpdatedAt === 0
              ? "尚未刷新"
              : `上次刷新 ${formatShanghaiFullDateTime(new Date(actions.dataUpdatedAt).toISOString())}`}
          </span>
          <button
            className="button button--quiet"
            type="button"
            onClick={() => {
              resolution.reset();
              void actions.refetch();
            }}
            disabled={actions.isFetching}
          >
            {actions.isFetching ? "正在刷新…" : "刷新"}
          </button>
          <div className="count-card">
            <strong>{pendingCount}</strong>
            <span>项待确认</span>
          </div>
        </div>
      </header>

      {actions.isPending ? (
        <PageState title="正在读取待确认操作…" />
      ) : actions.isError ? (
        <PageState
          title="待确认操作加载失败"
          detail={getRequestErrorMessage(actions.error)}
          action={
            <button className="button button--quiet" onClick={() => void actions.refetch()}>
              重新加载
            </button>
          }
        />
      ) : (
        <>
          <div className="queue-heading">
            <h3>等待你的决定</h3>
            <span>{pendingCount} 项可操作</span>
          </div>
          {open.length === 0 ? (
            <PageState
              title="目前没有待确认操作"
              detail="AI 助手提出需要所有者权限的操作后，会显示在这里。"
            />
          ) : (
            <div className="pending-action-grid">
              {open.map((action) => {
                const isCurrent = activeResolution?.input.id === action.id;
                return (
                  <PendingActionCard
                    key={action.id}
                    action={action}
                    busy={resolution.isPending}
                    resolving={isCurrent && resolution.isPending ? activeResolution.kind : null}
                    error={isCurrent ? resolutionError : null}
                    onExecute={() => {
                      resolution.reset();
                      resolution.mutate({ kind: "execute", input: { id: action.id } });
                    }}
                    onReject={(reason) => {
                      resolution.reset();
                      resolution.mutate({
                        kind: "reject",
                        input: {
                          id: action.id,
                          ...(reason === undefined ? {} : { reason }),
                        },
                      });
                    }}
                  />
                );
              })}
            </div>
          )}

          <section className="resolution-history" aria-labelledby="resolution-history-title">
            <div className="queue-heading">
              <h3 id="resolution-history-title">处理记录</h3>
              <span>{history.length} 项</span>
            </div>
            {history.length === 0 ? (
              <p className="resolution-history__empty">还没有已执行或已拒绝的操作。</p>
            ) : (
              <div className="resolution-grid">
                {history.map((action) => (
                  <ResolutionHistoryCard key={action.id} action={action} />
                ))}
              </div>
            )}
          </section>
        </>
      )}
    </section>
  );
};
