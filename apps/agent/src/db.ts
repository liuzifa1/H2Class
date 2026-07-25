import { conversationMessageSchema } from "./openai";
import type { ConversationMessage } from "./openai";

type MessageRow = { message_json: string };

export const loadConversation = async (
  db: D1Database,
  conversationId: string,
): Promise<ConversationMessage[] | null> => {
  const conversation = await db
    .prepare("SELECT id FROM conversation WHERE id = ?")
    .bind(conversationId)
    .first<{ id: string }>();
  if (conversation === null) return null;

  const rows = await db
    .prepare(
      "SELECT message_json FROM message WHERE conversation_id = ? ORDER BY sequence",
    )
    .bind(conversationId)
    .all<MessageRow>();

  return rows.results.map((row) =>
    conversationMessageSchema.parse(JSON.parse(row.message_json)),
  );
};

export const appendMessages = async (
  db: D1Database,
  conversationId: string,
  messages: readonly ConversationMessage[],
) => {
  if (messages.length === 0) return;

  const now = Math.floor(Date.now() / 1_000);
  const statements: D1PreparedStatement[] = [
    db
      .prepare(
        "INSERT OR IGNORE INTO conversation (id, created_at, updated_at) VALUES (?, ?, ?)",
      )
      .bind(conversationId, now, now),
  ];

  for (const message of messages) {
    statements.push(
      db
        .prepare(
          `INSERT INTO message
             (id, conversation_id, sequence, role, message_json, created_at)
           SELECT ?, ?, COALESCE(MAX(sequence) + 1, 0), ?, ?, ?
           FROM message WHERE conversation_id = ?`,
        )
        .bind(
          crypto.randomUUID(),
          conversationId,
          message.role,
          JSON.stringify(message),
          now,
          conversationId,
        ),
    );
  }

  statements.push(
    db
      .prepare("UPDATE conversation SET updated_at = ? WHERE id = ?")
      .bind(now, conversationId),
  );
  await db.batch(statements);
};

export type JobRunStatus = "completed" | "partial" | "failed";

type BeginJobRunInput = {
  runId: string;
  jobName: string;
  cron: string;
  conversationId: string;
  conversationTitle: string;
  scheduledAt: number;
  initialMessage: ConversationMessage;
};

export const beginJobRun = async (
  db: D1Database,
  input: BeginJobRunInput,
) => {
  const startedAt = Math.floor(Date.now() / 1_000);
  await db.batch([
    db
      .prepare(
        `INSERT INTO conversation (id, title, created_at, updated_at)
         VALUES (?, ?, ?, ?)`,
      )
      .bind(
        input.conversationId,
        input.conversationTitle,
        startedAt,
        startedAt,
      ),
    db
      .prepare(
        `INSERT INTO message
           (id, conversation_id, sequence, role, message_json, created_at)
         VALUES (?, ?, 0, ?, ?, ?)`,
      )
      .bind(
        crypto.randomUUID(),
        input.conversationId,
        input.initialMessage.role,
        JSON.stringify(input.initialMessage),
        startedAt,
      ),
    db
      .prepare(
        `INSERT INTO job_run
           (id, job_name, cron, conversation_id, status, scheduled_at, started_at)
         VALUES (?, ?, ?, ?, 'running', ?, ?)`,
      )
      .bind(
        input.runId,
        input.jobName,
        input.cron,
        input.conversationId,
        input.scheduledAt,
        startedAt,
      ),
  ]);
};

type FinishJobRunInput = {
  runId: string;
  status: JobRunStatus;
  iterations: number;
  finishReason: string | null;
  summaryText: string | null;
  metrics: unknown;
  errorCode: string | null;
};

export const finishJobRun = async (
  db: D1Database,
  input: FinishJobRunInput,
) => {
  const result = await db
    .prepare(
      `UPDATE job_run
       SET status = ?, finished_at = ?, iteration_count = ?, finish_reason = ?,
           summary_text = ?, metrics_json = ?, error_code = ?
       WHERE id = ? AND status = 'running'`,
    )
    .bind(
      input.status,
      Math.floor(Date.now() / 1_000),
      input.iterations,
      input.finishReason,
      input.summaryText,
      JSON.stringify(input.metrics),
      input.errorCode,
      input.runId,
    )
    .run();
  if (!result.success || result.meta.changes !== 1) {
    throw new Error("job_run_finalize_failed");
  }
};
