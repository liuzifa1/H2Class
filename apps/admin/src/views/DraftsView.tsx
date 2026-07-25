import {
  draftsListOutputSchema,
  messageDraftSchema,
  peopleListOutputSchema,
  type DraftsMarkSentInput,
  type MessageDraft,
} from "@h2class/shared";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useMemo, useState } from "react";
import { PageState } from "../components/PageState";
import { fetchJson, getRequestErrorMessage } from "../lib/api";
import { formatShanghaiFullDateTime } from "../lib/date";

const purposeLabels: Readonly<Record<string, string>> = {
  lesson_created_teacher: "新课通知 · 老师",
  lesson_created_guardian: "新课通知 · 家长",
  lesson_moved_teacher: "调课通知 · 老师",
  lesson_moved_guardian: "调课通知 · 家长",
  lesson_cancelled_teacher: "取消课程 · 老师",
  lesson_cancelled_guardian: "取消课程 · 家长",
};

const purposeLabel = (purpose: string) => purposeLabels[purpose] ?? "其他通知";

type DraftCardProps = {
  draft: MessageDraft;
  recipient: string;
  copied: boolean;
  marking: boolean;
  onCopy: () => void;
  onMarkSent: () => void;
};

const DraftCard = ({
  draft,
  recipient,
  copied,
  marking,
  onCopy,
  onMarkSent,
}: DraftCardProps) => (
  <article className="draft-card">
    <div className="draft-card__topline">
      <div className="recipient-avatar" aria-hidden="true">
        {recipient.slice(0, 1)}
      </div>
      <div className="draft-recipient">
        <strong>{recipient}</strong>
        <span>{purposeLabel(draft.purpose)}</span>
      </div>
      <time>{formatShanghaiFullDateTime(draft.createdAt)}</time>
    </div>
    <p className="draft-copy">{draft.text}</p>
    <footer className="draft-actions">
      <button className="button button--quiet" type="button" onClick={onCopy}>
        {copied ? "✓ 已复制" : "复制消息"}
      </button>
      <button
        className="button button--primary"
        type="button"
        onClick={onMarkSent}
        disabled={marking}
      >
        {marking ? "正在更新…" : "标记已发送"}
      </button>
    </footer>
  </article>
);

export const DraftsView = () => {
  const queryClient = useQueryClient();
  const [copiedId, setCopiedId] = useState<string | null>(null);
  const [copyError, setCopyError] = useState<string | null>(null);

  const drafts = useQuery({
    queryKey: ["drafts", "all"],
    queryFn: () => fetchJson("/message-drafts", {}, draftsListOutputSchema),
  });
  const people = useQuery({
    queryKey: ["people", "draft-contacts"],
    queryFn: () => fetchJson("/people", {}, peopleListOutputSchema),
  });
  const markSent = useMutation({
    mutationFn: (input: DraftsMarkSentInput) =>
      fetchJson(
        `/message-drafts/${input.id}/mark-sent`,
        { method: "POST" },
        messageDraftSchema,
      ),
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ["drafts"] });
    },
  });

  const names = useMemo(
    () => new Map((people.data?.people ?? []).map((person) => [person.id, person.name])),
    [people.data],
  );
  const pending = useMemo(
    () =>
      (drafts.data?.drafts ?? [])
        .filter((draft) => draft.status === "draft")
        .sort((left, right) => left.createdAt.localeCompare(right.createdAt)),
    [drafts.data],
  );
  const sent = useMemo(
    () =>
      (drafts.data?.drafts ?? [])
        .filter((draft) => draft.status === "sent")
        .sort((left, right) => right.createdAt.localeCompare(left.createdAt)),
    [drafts.data],
  );

  const copy = async (draft: MessageDraft) => {
    setCopyError(null);
    try {
      await navigator.clipboard.writeText(draft.text);
      setCopiedId(draft.id);
      window.setTimeout(() => setCopiedId((current) => (current === draft.id ? null : current)), 1_800);
    } catch {
      setCopyError("复制失败，请手动选择消息文字后复制。");
    }
  };

  const loading = drafts.isPending || people.isPending;
  const loadError = drafts.error ?? people.error;

  return (
    <section className="page-stack drafts-page">
      <header className="page-heading">
        <div>
          <span className="section-kicker">消息队列</span>
          <h2>待发消息</h2>
          <p>复制到微信发送后，再标记为已发送。未发消息按最早时间排列。</p>
        </div>
        <div className="count-card">
          <strong>{pending.length}</strong>
          <span>条待发送</span>
        </div>
      </header>

      {copyError === null && !markSent.isError ? null : (
        <div className="inline-alert inline-alert--error" role="alert">
          {copyError ?? getRequestErrorMessage(markSent.error)}
        </div>
      )}

      {loading ? (
        <PageState title="正在整理消息队列…" />
      ) : loadError !== null ? (
        <PageState
          title="消息队列加载失败"
          detail={getRequestErrorMessage(loadError)}
          action={
            <button
              className="button button--quiet"
              onClick={() => {
                void drafts.refetch();
                void people.refetch();
              }}
            >
              重新加载
            </button>
          }
        />
      ) : (
        <>
          <div className="queue-heading">
            <h3>等待发送</h3>
            <span>{pending.length} 条</span>
          </div>
          {pending.length === 0 ? (
            <PageState
              title="所有消息都已处理"
              detail="新建、调课或取消课程后，需要通知的消息会出现在这里。"
            />
          ) : (
            <div className="draft-grid">
              {pending.map((draft) => (
                <DraftCard
                  key={draft.id}
                  draft={draft}
                  recipient={names.get(draft.personId) ?? "未知联系人"}
                  copied={copiedId === draft.id}
                  marking={markSent.isPending && markSent.variables?.id === draft.id}
                  onCopy={() => void copy(draft)}
                  onMarkSent={() => markSent.mutate({ id: draft.id })}
                />
              ))}
            </div>
          )}

          <details className="sent-drafts">
            <summary>
              <span>已发送消息</span>
              <strong>{sent.length}</strong>
            </summary>
            {sent.length === 0 ? (
              <p className="sent-drafts__empty">还没有已发送记录。</p>
            ) : (
              <div className="sent-list">
                {sent.map((draft) => (
                  <article key={draft.id}>
                    <div>
                      <strong>{names.get(draft.personId) ?? "未知联系人"}</strong>
                      <span>{purposeLabel(draft.purpose)}</span>
                    </div>
                    <p>{draft.text}</p>
                    <time>
                      已发送 · {formatShanghaiFullDateTime(draft.sentAt ?? draft.createdAt)}
                    </time>
                  </article>
                ))}
              </div>
            )}
          </details>
        </>
      )}
    </section>
  );
};
