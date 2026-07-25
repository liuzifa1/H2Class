export type FakeConversation = {
  id: string;
  title: string | null;
  createdAt: number;
  updatedAt: number;
};

export type FakeMessage = {
  id: string;
  conversationId: string;
  sequence: number;
  role: string;
  messageJson: string;
  createdAt: number;
};

export type FakeJobRun = {
  id: string;
  jobName: string;
  cron: string;
  conversationId: string;
  status: string;
  scheduledAt: number;
  startedAt: number;
  finishedAt: number | null;
  iterationCount: number;
  finishReason: string | null;
  summaryText: string | null;
  metricsJson: string;
  errorCode: string | null;
};

export type FakeD1State = {
  conversations: Map<string, FakeConversation>;
  messages: FakeMessage[];
  jobRuns: FakeJobRun[];
};

type FakeStatement = {
  sql: string;
  args: unknown[];
  bind: (...args: unknown[]) => FakeStatement;
  run: () => Promise<{ success: true; meta: { changes: number } }>;
};

const text = (value: unknown) => {
  if (typeof value !== "string") throw new Error("fake_d1_expected_text");
  return value;
};

const integer = (value: unknown) => {
  if (typeof value !== "number") throw new Error("fake_d1_expected_integer");
  return value;
};

export const createFakeD1 = () => {
  const state: FakeD1State = {
    conversations: new Map(),
    messages: [],
    jobRuns: [],
  };

  const execute = (statement: FakeStatement) => {
    const sql = statement.sql.replace(/\s+/g, " ").trim();
    const args = statement.args;
    if (sql.startsWith("INSERT INTO conversation (id, title")) {
      const id = text(args[0]);
      state.conversations.set(id, {
        id,
        title: text(args[1]),
        createdAt: integer(args[2]),
        updatedAt: integer(args[3]),
      });
      return 1;
    }
    if (sql.startsWith("INSERT OR IGNORE INTO conversation")) {
      const id = text(args[0]);
      if (!state.conversations.has(id)) {
        state.conversations.set(id, {
          id,
          title: null,
          createdAt: integer(args[1]),
          updatedAt: integer(args[2]),
        });
      }
      return 1;
    }
    if (sql.startsWith("INSERT INTO message")) {
      const conversationId = text(args[1]);
      const explicitSequence = sql.includes("VALUES (?, ?, 0,");
      const sequence = explicitSequence
        ? 0
        : state.messages
            .filter((message) => message.conversationId === conversationId)
            .reduce((maximum, message) =>
              Math.max(maximum, message.sequence), -1
            ) + 1;
      state.messages.push({
        id: text(args[0]),
        conversationId,
        sequence,
        role: text(args[2]),
        messageJson: text(args[3]),
        createdAt: integer(args[4]),
      });
      return 1;
    }
    if (sql.startsWith("UPDATE conversation SET updated_at")) {
      const conversation = state.conversations.get(text(args[1]));
      if (conversation !== undefined) conversation.updatedAt = integer(args[0]);
      return conversation === undefined ? 0 : 1;
    }
    if (sql.startsWith("INSERT INTO job_run")) {
      state.jobRuns.push({
        id: text(args[0]),
        jobName: text(args[1]),
        cron: text(args[2]),
        conversationId: text(args[3]),
        status: "running",
        scheduledAt: integer(args[4]),
        startedAt: integer(args[5]),
        finishedAt: null,
        iterationCount: 0,
        finishReason: null,
        summaryText: null,
        metricsJson: "{}",
        errorCode: null,
      });
      return 1;
    }
    if (sql.startsWith("UPDATE job_run SET status")) {
      const run = state.jobRuns.find((candidate) =>
        candidate.id === text(args[7]) && candidate.status === "running"
      );
      if (run === undefined) return 0;
      run.status = text(args[0]);
      run.finishedAt = integer(args[1]);
      run.iterationCount = integer(args[2]);
      run.finishReason = args[3] === null ? null : text(args[3]);
      run.summaryText = args[4] === null ? null : text(args[4]);
      run.metricsJson = text(args[5]);
      run.errorCode = args[6] === null ? null : text(args[6]);
      return 1;
    }
    throw new Error(`fake_d1_unhandled_sql: ${sql}`);
  };

  const prepare = (sql: string): FakeStatement => {
    const make = (args: unknown[]): FakeStatement => ({
      sql,
      args,
      bind: (...nextArgs) => make(nextArgs),
      run: async () => ({ success: true, meta: { changes: execute(make(args)) } }),
    });
    return make([]);
  };

  const db = {
    prepare,
    batch: async (statements: FakeStatement[]) => {
      for (const statement of statements) execute(statement);
      return statements.map(() => ({ success: true, meta: { changes: 1 } }));
    },
  };

  return { db: db as unknown as D1Database, state };
};
