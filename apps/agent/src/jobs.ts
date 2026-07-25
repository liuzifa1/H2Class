import { endpoints } from "@h2class/shared";
import { z } from "zod";
import { CoreApiError, createCoreClient } from "./api";
import {
  appendMessages,
  beginJobRun,
  finishJobRun,
} from "./db";
import type { JobRunStatus } from "./db";
import type { AgentEnv } from "./env";
import {
  createJobExecutor,
  emptyMetrics,
  serializableMetrics,
} from "./job-drafts";
import type {
  DraftEvidencePolicy,
  DraftIdempotencePolicy,
} from "./job-drafts";
import { createProposalExecutor } from "./job-proposals";
import type { PendingActionIdempotencePolicy } from "./job-proposals";
import { ModelApiError, runAgentLoop } from "./loop";
import type { ConversationMessage } from "./openai";
import {
  autonomousToolFilter,
  createToolRuntime,
} from "./tools";
import type { ToolFilter } from "./tools";

type JobDefinition = {
  name: string;
  conversationTitle: string;
  cron: string;
  order: number;
  systemPrompt: string;
  prompt: (scheduledAt: number) => string;
  toolFilter: ToolFilter;
  draftIdempotence?: DraftIdempotencePolicy;
  draftEvidence?: (scheduledAt: number) => DraftEvidencePolicy;
  pendingActionIdempotence?: PendingActionIdempotencePolicy;
};

const JOB_SYSTEM_PROMPT = `You run a headless H2Class autonomous job for a small Chinese K12 tutoring and after-school-care center. The business timezone is Asia/Shanghai.

Use core API tools for every business fact. Never calculate balances, prices, conflicts, or other business facts yourself. You may only read, create message drafts, or create owner-confirmation proposals through the tools supplied for this run. Never ask the owner a question during a scheduled run. Follow the job prompt exactly and finish with a concise Simplified-Chinese run summary containing the relevant verified counts and names/ids, plus any created or skipped draft or pending-action ids.`;

const shanghaiDateTime = (scheduledAt: number) =>
  new Date(scheduledAt + 8 * 60 * 60 * 1_000)
    .toISOString()
    .slice(0, 16)
    .replace("T", " ");

const renewalWatchPrompt = (scheduledAt: number) => `Run the daily renewal watch now. Scheduled local time: ${shanghaiDateTime(scheduledAt)} Asia/Shanghai.

Required procedure:
1. Call entitlements_list with {} and arrears_list with {} before drafting anything. Use the balances and statuses returned by core; do not recompute them.
2. Treat these as renewal triggers: every arrears_list result; an active package whose remainingCredits is 3 or less; an active subscription whose validTo is within the next 14 Asia/Shanghai calendar days. Ignore refunded entitlements. Combine multiple triggers for the same student.
3. Build unique guardian+student pairs from the guardianIds returned by core. File at most one draft per pair. If a student has multiple triggers, combine the concrete reasons in that one message.
4. Before every draft, call drafts_list with exactly {"personId":"<guardian id>","purpose":"renewal:<student UUID>","status":"draft"}. If it returns any draft, skip that pair and record the existing draft ids in the final summary.
5. Otherwise call drafts_create once with that guardian personId, purpose exactly renewal:<student UUID>, and a concise, natural Simplified-Chinese reminder in the owner's voice. Include the verified student name and concrete renewal reason; never invent a price.
6. Finish with one concise Simplified-Chinese summary: candidates, drafts created, drafts skipped, each affected student's name and id, guardian ids, and all created or existing draft ids. If there are no candidates, state that explicitly.

Do not call drafts_mark_sent or any operational write. Do not ask a question.`;

const dailyDigestPrompt = (scheduledAt: number) => `Create today's H2Class owner digest. Scheduled local time: ${shanghaiDateTime(scheduledAt)} Asia/Shanghai.

Required procedure:
1. Call reports_daily exactly once with {}. It is the only source for this digest; do not call any other tool and do not recompute its business facts.
2. Return one concise Simplified-Chinese summary headed "今日简报". Include the report date; every lesson with verified local time, class, teacher, and students; yesterday's transaction count and gross/discount/net amounts in integer fen; unsent draft count; and unexpired pending-action count.
3. Preserve signed money values exactly as returned and label them 分. If a section is empty or zero, state that explicitly.

Do not create drafts or proposals. Do not ask a question.`;

const shanghaiDayWindow = (scheduledAt: number) => {
  const localDate = new Date(scheduledAt + 8 * 60 * 60 * 1_000)
    .toISOString()
    .slice(0, 10);
  const startAtMs = Date.parse(`${localDate}T00:00:00+08:00`);
  return {
    localDate,
    startAt: new Date(startAtMs).toISOString(),
    endAt: new Date(startAtMs + 24 * 60 * 60 * 1_000).toISOString(),
    scheduledAt: new Date(scheduledAt).toISOString(),
  };
};

const noShowPrompt = (scheduledAt: number) => {
  const window = shanghaiDayWindow(scheduledAt);
  return `Run the daily no-show follow-up for ${window.localDate} Asia/Shanghai. Scheduled instant: ${window.scheduledAt}.

Required procedure:
1. Call lessons_list with exactly {"startAt":"${window.startAt}","endAt":"${window.endAt}"}. Consider only non-cancelled lessons whose endAt is at or before the scheduled instant above.
2. For every such lesson, call attendance_list with its lessonId and compare the returned rows to the lesson's studentIds.
3. A guardian draft is allowed ONLY when that exact lesson/student has an explicit attendance row whose status is "absent". A missing attendance row is an operational anomaly for the final digest note only: never describe it as an absence and NEVER create a guardian draft for it. present, excused_leave, and late_cancel also create no no-show draft.
4. For each explicit absence, call guardian_links_list with {"studentId":"<student UUID>"}. Use readonly tools such as people_get and class_types_list when needed to obtain concrete verified names; never invent them.
5. For each linked guardian, call drafts_list with exactly {"personId":"<guardian UUID>","purpose":"no_show:<lesson UUID>:<student UUID>","status":"draft"}. Skip when an unsent draft exists.
6. Otherwise call drafts_create once for that guardian with the exact purpose above and a concise, factual Simplified-Chinese follow-up in the owner's voice. State the verified student, class, and local lesson time without speculation or blame.
7. Finish with a concise Simplified-Chinese digest note listing explicit absences followed up, missing-attendance anomalies kept internal, created/skipped draft ids, students, lessons, and guardians. State zero counts explicitly.

Never create a draft for missing attendance. Do not call pending actions, drafts_mark_sent, or any operational write. Do not ask a question.`;
};

const DAY_MS = 24 * 60 * 60 * 1_000;
const SHANGHAI_OFFSET_MS = 8 * 60 * 60 * 1_000;

const weeklyWindows = (scheduledAt: number) => {
  const local = new Date(scheduledAt + SHANGHAI_OFFSET_MS);
  const localDate = local.toISOString().slice(0, 10);
  const localMidnight = Date.parse(`${localDate}T00:00:00+08:00`);
  const daysUntilNextMonday = (8 - local.getUTCDay()) % 7 || 7;
  const targetStartMs = localMidnight + daysUntilNextMonday * DAY_MS;
  const targetEndMs = targetStartMs + 7 * DAY_MS;
  const historyStartMs = targetStartMs - 28 * DAY_MS;
  const localDateAt = (instant: number) =>
    new Date(instant + SHANGHAI_OFFSET_MS).toISOString().slice(0, 10);
  return {
    scheduledAt: new Date(scheduledAt).toISOString(),
    historyStartAt: new Date(historyStartMs).toISOString(),
    historyEndAt: new Date(targetStartMs).toISOString(),
    targetStartAt: new Date(targetStartMs).toISOString(),
    targetEndAt: new Date(targetEndMs).toISOString(),
    targetStartDate: localDateAt(targetStartMs),
    targetEndDate: localDateAt(targetEndMs - DAY_MS),
  };
};

const weeklySchedulePrompt = (scheduledAt: number) => {
  const window = weeklyWindows(scheduledAt);
  return `Prepare a conservative owner-confirmation proposal for the next H2Class week. Scheduled instant: ${window.scheduledAt}. Target local dates: ${window.targetStartDate} through ${window.targetEndDate}, Asia/Shanghai.

Required procedure:
1. Read all source facts before proposing: call lessons_list for the four-week history with exactly {"startAt":"${window.historyStartAt}","endAt":"${window.historyEndAt}"}; call lessons_list for the target week with exactly {"startAt":"${window.targetStartAt}","endAt":"${window.targetEndAt}"}; and call closure_days_list, terms_list, and class_types_list with {}.
2. A recurring-pattern candidate must have the exact same classTypeId, teacherId, sorted studentIds, Asia/Shanghai weekday, and start minute in at least 3 distinct weeks of that four-week history. Ignore cancelled lessons and makeup lessons. Never merge or guess rosters, teachers, class types, dates, or times.
3. Project each qualifying signature once onto its matching target-week local date. Skip inactive class types, closure dates, already-booked matching lessons, and any obvious teacher or student overlap in the target-week results. Use the class type's verified duration for overlap checks. Include termId only when one returned term covers the target date and the historical signature consistently used that same term; otherwise omit termId.
4. For every remaining candidate, call free_slots_find with its exact teacherId, classTypeId, and date. Keep it only when a returned interval fully contains the proposed start minute plus the verified class duration. Core remains authoritative for final conflict checks.
5. Sort retained explicit lesson specs by date, startMin, teacherId, classTypeId, then sorted studentIds. Put at most the first 24 specs in ONE {"lessons":[...]} payload; report any conservative overflow as skipped.
6. Before proposing, call pending_actions_list with {} and compare structured endpointName and payload values. If an unexpired pending action for endpointName "lessons_bulk_apply" has the exact same payload, do not propose again and report its id.
7. Otherwise call propose_lessons_bulk_apply exactly once with that payload. This is the ONLY proposal tool allowed for this job. If there are no retained candidates, create no proposal.
8. Finish with a concise Simplified-Chinese summary listing the pattern threshold, target week, proposed or skipped lesson count, concrete date/time/class/teacher/student ids, and the created or existing pending-action id.

Never call lessons_create, drafts_create, or any other write/proposal tool. A scheduled job must never book lessons directly. Do not ask a question.`;
};

export const jobRegistry: readonly JobDefinition[] = [
  {
    name: "renewal_watch",
    conversationTitle: "续费巡检",
    cron: "0 23 * * *",
    order: 10,
    systemPrompt: JOB_SYSTEM_PROMPT,
    prompt: renewalWatchPrompt,
    toolFilter: (metadata) => metadata.readonly || metadata.autonomousWrite,
    draftIdempotence: {
      invalidPurposeError: "invalid_renewal_draft_purpose",
      studentIdFromPurpose: renewalStudentId,
    },
  },
  {
    name: "daily_digest",
    conversationTitle: "今日简报",
    cron: "0 23 * * *",
    order: 20,
    systemPrompt: JOB_SYSTEM_PROMPT,
    prompt: dailyDigestPrompt,
    toolFilter: (metadata) => metadata.endpointName === "reports_daily",
  },
  {
    name: "no_show_follow_up",
    conversationTitle: "缺勤跟进",
    cron: "0 13 * * *",
    order: 10,
    systemPrompt: JOB_SYSTEM_PROMPT,
    prompt: noShowPrompt,
    toolFilter: (metadata) => metadata.readonly || metadata.autonomousWrite,
    draftIdempotence: {
      invalidPurposeError: "invalid_no_show_draft_purpose",
      studentIdFromPurpose: noShowStudentId,
    },
    draftEvidence: noShowEvidence,
  },
  {
    name: "weekly_schedule_draft",
    conversationTitle: "每周排课草案",
    cron: "0 9 * * 5",
    order: 10,
    systemPrompt: JOB_SYSTEM_PROMPT,
    prompt: weeklySchedulePrompt,
    toolFilter: (metadata) =>
      metadata.readonly ||
      (metadata.ownerOnly && metadata.endpointName === "lessons_bulk_apply"),
    pendingActionIdempotence: {
      endpointName: "lessons_bulk_apply",
      singleProposalPerRun: true,
    },
  },
];

function renewalStudentId(purpose: string): string | null {
  const prefix = "renewal:";
  if (!purpose.startsWith(prefix)) return null;
  const parsed = z.uuid().safeParse(purpose.slice(prefix.length));
  return parsed.success ? parsed.data : null;
}

function noShowStudentId(purpose: string): string | null {
  return noShowPurpose(purpose)?.studentId ?? null;
}

function noShowPurpose(
  purpose: string,
): { lessonId: string; studentId: string } | null {
  const [prefix, lessonId, studentId, extra] = purpose.split(":");
  if (prefix !== "no_show" || extra !== undefined) return null;
  const parsedLessonId = z.uuid().safeParse(lessonId);
  if (!parsedLessonId.success) return null;
  const parsedStudentId = z.uuid().safeParse(studentId);
  return parsedStudentId.success
    ? { lessonId: parsedLessonId.data, studentId: parsedStudentId.data }
    : null;
}

function noShowEvidence(scheduledAt: number): DraftEvidencePolicy {
  const endedRosterPairs = new Set<string>();
  const explicitAbsentPairs = new Set<string>();
  const pairKey = (lessonId: string, studentId: string) =>
    `${lessonId}:${studentId}`;

  return {
    observeToolResult: (name, _input, output) => {
      if (name === "lessons_list") {
        const parsed = endpoints.lessons_list.output.safeParse(output);
        if (parsed.success) {
          for (const lesson of parsed.data.lessons) {
            if (
              lesson.status === "cancelled" ||
              Date.parse(lesson.endAt) > scheduledAt
            ) continue;
            for (const studentId of lesson.studentIds) {
              endedRosterPairs.add(pairKey(lesson.id, studentId));
            }
          }
        }
      }
      if (name === "attendance_list") {
        const parsed = endpoints.attendance_list.output.safeParse(output);
        if (parsed.success) {
          for (const attendance of parsed.data.attendance) {
            if (attendance.status === "absent") {
              explicitAbsentPairs.add(
                pairKey(attendance.lessonId, attendance.studentId),
              );
            }
          }
        }
      }
    },
    rejectionForPurpose: (purpose) => {
      const parsed = noShowPurpose(purpose);
      if (parsed === null) return "invalid_no_show_draft_purpose";
      const key = pairKey(parsed.lessonId, parsed.studentId);
      return endedRosterPairs.has(key) && explicitAbsentPairs.has(key)
        ? null
        : "no_show_draft_not_eligible";
    },
  };
}

const safeErrorCode = (error: unknown) => {
  if (error instanceof ModelApiError || error instanceof CoreApiError) {
    return error.code;
  }
  if (isJobConfigurationError(error)) return error.code;
  return "scheduled_job_failed";
};

type JobConfigurationError = Error & {
  name: "JobConfigurationError";
  code: string;
};

const jobConfigurationError = (code: string): JobConfigurationError =>
  Object.assign(new Error(code), {
    name: "JobConfigurationError" as const,
    code,
  });

const isJobConfigurationError = (
  error: unknown,
): error is JobConfigurationError =>
  error instanceof Error &&
  error.name === "JobConfigurationError" &&
  "code" in error &&
  typeof error.code === "string";

const assertConfigured = (env: AgentEnv["Bindings"]) => {
  if (env.AGENT_DISABLED === "1") {
    throw jobConfigurationError("agent_disabled");
  }
  if (env.CORE_API_TOKEN === undefined || env.CORE_API_TOKEN.length === 0) {
    throw jobConfigurationError("core_api_token_missing");
  }
  if (env.OPENAI_API_KEY === undefined || env.OPENAI_API_KEY.length === 0) {
    throw jobConfigurationError("model_api_key_missing");
  }
  if (env.OPENAI_MODEL === undefined || env.OPENAI_MODEL.trim().length === 0) {
    throw jobConfigurationError("model_id_missing");
  }
  if (env.OPENAI_BASE_URL.length === 0) {
    throw jobConfigurationError("model_base_url_missing");
  }
  return {
    coreToken: env.CORE_API_TOKEN,
    model: env.OPENAI_MODEL.trim(),
  };
};

const runJob = async (
  env: AgentEnv["Bindings"],
  definition: JobDefinition,
  cron: string,
  scheduledAtMs: number,
) => {
  const runId = crypto.randomUUID();
  const conversationId = crypto.randomUUID();
  const initialMessage: ConversationMessage = {
    role: "user",
    content: definition.prompt(scheduledAtMs),
  };
  await beginJobRun(env.AGENT_DB, {
    runId,
    jobName: definition.name,
    cron,
    conversationId,
    conversationTitle: definition.conversationTitle,
    scheduledAt: Math.floor(scheduledAtMs / 1_000),
    initialMessage,
  });

  const metrics = emptyMetrics();
  let iterations = 0;
  try {
    const configuration = assertConfigured(env);
    const client = createCoreClient(env.CORE_API_URL, configuration.coreToken);
    // Job filters may narrow the autonomous set, but can never widen its
    // registry-derived security boundary.
    const baseRuntime = createToolRuntime((metadata) =>
      autonomousToolFilter(metadata) && definition.toolFilter(metadata)
    );
    const draftExecutor = createJobExecutor(
      baseRuntime.execute,
      metrics,
      definition.draftIdempotence,
      definition.draftEvidence?.(scheduledAtMs),
    );
    const execute = createProposalExecutor(
      draftExecutor,
      metrics,
      definition.pendingActionIdempotence,
    );
    const result = await runAgentLoop(
      env,
      configuration.model,
      [initialMessage],
      conversationId,
      client,
      new AbortController().signal,
      async () => undefined,
      {
        systemPrompt: definition.systemPrompt,
        toolRuntime: { tools: baseRuntime.tools, execute },
      },
    );
    iterations = result.iterations;
    const status: JobRunStatus = result.status === "partial"
      ? "partial"
      : "completed";
    await finishJobRun(env.AGENT_DB, {
      runId,
      status,
      iterations,
      finishReason: result.finishReason,
      summaryText: result.finalText,
      metrics: serializableMetrics(metrics),
      errorCode: null,
    });
    return { runId, conversationId, status };
  } catch (error) {
    const errorCode = safeErrorCode(error);
    const failureMessage: ConversationMessage = {
      role: "assistant",
      content: `自动任务失败：${errorCode}。`,
    };
    try {
      await appendMessages(env.AGENT_DB, conversationId, [failureMessage]);
    } catch {
      // The explicit job row is still finalized below when D1 remains usable.
    }
    await finishJobRun(env.AGENT_DB, {
      runId,
      status: "failed",
      iterations,
      finishReason: null,
      summaryText: failureMessage.content,
      metrics: serializableMetrics(metrics),
      errorCode,
    });
    console.error("scheduled job failed", definition.name, errorCode);
    return { runId, conversationId, status: "failed" as const };
  }
};

const recordUnknownCron = async (
  env: AgentEnv["Bindings"],
  cron: string,
  scheduledAtMs: number,
) => {
  const runId = crypto.randomUUID();
  const conversationId = crypto.randomUUID();
  const initialMessage: ConversationMessage = {
    role: "user",
    content: `Unregistered scheduled cron received: ${cron}`,
  };
  await beginJobRun(env.AGENT_DB, {
    runId,
    jobName: "unknown_cron",
    cron,
    conversationId,
    conversationTitle: "未知自动任务",
    scheduledAt: Math.floor(scheduledAtMs / 1_000),
    initialMessage,
  });
  const summaryText = "自动任务失败：unknown_scheduled_cron。";
  await appendMessages(env.AGENT_DB, conversationId, [{
    role: "assistant",
    content: summaryText,
  }]);
  await finishJobRun(env.AGENT_DB, {
    runId,
    status: "failed",
    iterations: 0,
    finishReason: null,
    summaryText,
    metrics: serializableMetrics(emptyMetrics()),
    errorCode: "unknown_scheduled_cron",
  });
  console.error("unknown scheduled cron", cron);
  return { runId, conversationId, status: "failed" as const };
};

const dispatchScheduledJobs = async (
  env: AgentEnv["Bindings"],
  cron: string,
  scheduledAtMs: number,
) => {
  const definitions = jobRegistry
    .filter((job) => job.cron === cron)
    .sort((left, right) =>
      left.order - right.order || left.name.localeCompare(right.name)
    );
  if (definitions.length === 0) {
    return [await recordUnknownCron(env, cron, scheduledAtMs)];
  }
  const results = [];
  for (const definition of definitions) {
    results.push(await runJob(env, definition, cron, scheduledAtMs));
  }
  return results;
};

// Miniflare and Cloudflare acknowledge a scheduled event before waitUntil()
// work necessarily finishes. Serialize events within an isolate so a manual
// retry cannot overlap the renewal read-before-create idempotence check.
let scheduledQueue: Promise<void> = Promise.resolve();

export const runScheduledJobs = (
  env: AgentEnv["Bindings"],
  cron: string,
  scheduledAtMs: number,
) => {
  const run = scheduledQueue.then(() =>
    dispatchScheduledJobs(env, cron, scheduledAtMs),
  );
  scheduledQueue = run.then(
    () => undefined,
    () => undefined,
  );
  return run;
};
