import assert from "node:assert/strict";
import test from "node:test";
import { createFakeD1 } from "./fake-d1.ts";
import {
  initialUserPrompt,
  lastToolContents,
  modelText,
  modelTools,
  previousToolNames,
  requestBody,
  requestUrl,
} from "./model-mock.ts";
import type { CoreClient } from "../src/api.ts";
import { emptyMetrics } from "../src/job-drafts.ts";
import { createProposalExecutor } from "../src/job-proposals.ts";
import { runScheduledJobs } from "../src/jobs.ts";
import type { ToolExecutor } from "../src/tools.ts";

const absentLessonId = "11111111-1111-4111-8111-111111111111";
const missingLessonId = "22222222-2222-4222-8222-222222222222";
const futureLessonId = "99999999-9999-4999-8999-999999999999";
const cancelledLessonId = "abababab-abab-4bab-8bab-abababababab";
const absentStudentId = "33333333-3333-4333-8333-333333333333";
const missingStudentId = "44444444-4444-4444-8444-444444444444";
const futureStudentId = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const cancelledStudentId = "fefefefe-fefe-4efe-8efe-fefefefefefe";
const wrongStudentId = "eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee";
const guardianId = "55555555-5555-4555-8555-555555555555";
const teacherId = "66666666-6666-4666-8666-666666666666";
const classTypeId = "77777777-7777-4777-8777-777777777777";
const draftId = "88888888-8888-4888-8888-888888888888";

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });

const requestInput = (init: RequestInit | undefined) => {
  if (typeof init?.body !== "string") throw new Error("request_body_missing");
  return JSON.parse(init.body) as Record<string, unknown>;
};

test("no-show rejects missing, wrong, future, and cancelled evidence", async () => {
  const { db, state } = createFakeD1();
  const drafts: Array<Record<string, unknown>> = [];
  const draftCreateInputs: Array<Record<string, unknown>> = [];
  const guardianLookupStudentIds: string[] = [];
  const attendanceLookupLessonIds: string[] = [];
  const originalFetch = globalThis.fetch;

  globalThis.fetch = async (input, init) => {
    const url = requestUrl(input);
    if (url.hostname === "model.test") {
      const body = requestBody(init);
      const prompt = initialUserPrompt(body);
      assert.match(prompt, /no-show follow-up/);
      const toolNames = body.tools.map((tool) => tool.function.name);
      assert.ok(toolNames.includes("drafts_create"));
      assert.ok(!toolNames.includes("drafts_mark_sent"));
      assert.ok(!toolNames.includes("lessons_create"));
      assert.ok(!toolNames.some((name) => name.startsWith("propose_")));

      const previous = previousToolNames(body);
      if (previous.length === 0) {
        return modelTools([{
          name: "lessons_list",
          input: {
            startAt: "2026-07-16T16:00:00.000Z",
            endAt: "2026-07-17T16:00:00.000Z",
          },
        }]);
      }
      if (previous.includes("lessons_list")) {
        return modelTools([
          { name: "attendance_list", input: { lessonId: absentLessonId } },
          { name: "attendance_list", input: { lessonId: missingLessonId } },
          { name: "attendance_list", input: { lessonId: futureLessonId } },
          { name: "attendance_list", input: { lessonId: cancelledLessonId } },
        ]);
      }
      if (previous.includes("attendance_list")) {
        return modelTools([
          {
            name: "guardian_links_list",
            input: { studentId: absentStudentId },
          },
          { name: "people_get", input: { id: absentStudentId } },
          { name: "class_types_list", input: {} },
        ]);
      }
      if (previous.includes("guardian_links_list")) {
        return modelTools([{
          name: "drafts_list",
          input: {
            personId: guardianId,
            purpose: `no_show:${absentLessonId}:${absentStudentId}`,
            status: "draft",
          },
        }]);
      }
      if (previous.includes("drafts_list")) {
        const [result] = lastToolContents(body);
        if (
          typeof result === "object" &&
          result !== null &&
          Array.isArray(Reflect.get(result, "drafts")) &&
          (Reflect.get(result, "drafts") as unknown[]).length > 0
        ) {
          return modelText(`缺勤跟进：已跳过现有草稿 ${draftId}；缺少考勤1条，仅内部记录。`);
        }
        return modelTools([
          {
            name: "drafts_create",
            input: {
              personId: guardianId,
              purpose: `no_show:${absentLessonId}:${absentStudentId}`,
              text: "您好，测试学生今天18:00的数学课记录为未到课，想和您确认一下情况。",
            },
          },
          {
            name: "drafts_create",
            input: {
              personId: guardianId,
              purpose: `no_show:${missingLessonId}:${missingStudentId}`,
              text: "模型错误地把缺少考勤说成缺勤。",
            },
          },
          {
            name: "drafts_create",
            input: {
              personId: guardianId,
              purpose: `no_show:${absentLessonId}:${wrongStudentId}`,
              text: "模型错误地使用了不在本节课名单中的学生。",
            },
          },
          {
            name: "drafts_create",
            input: {
              personId: guardianId,
              purpose: `no_show:${futureLessonId}:${futureStudentId}`,
              text: "模型错误地在课程结束前发起缺勤跟进。",
            },
          },
          {
            name: "drafts_create",
            input: {
              personId: guardianId,
              purpose: `no_show:${cancelledLessonId}:${cancelledStudentId}`,
              text: "模型错误地针对已取消课程发起缺勤跟进。",
            },
          },
        ]);
      }
      if (previous.includes("drafts_create")) {
        const results = lastToolContents(body);
        assert.equal(results.length, 5);
        assert.equal(
          Reflect.get(results[0] as object, "id"),
          draftId,
        );
        for (const rejected of results.slice(1)) {
          assert.equal(Reflect.get(rejected as object, "is_error"), true);
          assert.equal(
            Reflect.get(rejected as object, "error"),
            "no_show_draft_not_eligible",
          );
        }
        return modelText(`缺勤跟进：已创建草稿 ${draftId}；缺少考勤1条，仅内部记录。`);
      }
      throw new Error(`unexpected_model_state: ${previous.join(",")}`);
    }

    if (url.pathname === "/lessons") {
      return json({
        lessons: [
          {
            id: absentLessonId,
            classTypeId,
            teacherId,
            startAt: "2026-07-17T10:00:00.000Z",
            endAt: "2026-07-17T11:00:00.000Z",
            status: "completed",
            makeupForLessonId: null,
            termId: null,
            createdAt: "2026-07-01T00:00:00.000Z",
            studentIds: [absentStudentId],
          },
          {
            id: missingLessonId,
            classTypeId,
            teacherId,
            startAt: "2026-07-17T11:00:00.000Z",
            endAt: "2026-07-17T12:00:00.000Z",
            status: "scheduled",
            makeupForLessonId: null,
            termId: null,
            createdAt: "2026-07-01T00:00:00.000Z",
            studentIds: [missingStudentId],
          },
          {
            id: futureLessonId,
            classTypeId,
            teacherId,
            startAt: "2026-07-17T14:00:00.000Z",
            endAt: "2026-07-17T15:00:00.000Z",
            status: "completed",
            makeupForLessonId: null,
            termId: null,
            createdAt: "2026-07-01T00:00:00.000Z",
            studentIds: [futureStudentId],
          },
          {
            id: cancelledLessonId,
            classTypeId,
            teacherId,
            startAt: "2026-07-17T11:30:00.000Z",
            endAt: "2026-07-17T12:30:00.000Z",
            status: "cancelled",
            makeupForLessonId: null,
            termId: null,
            createdAt: "2026-07-01T00:00:00.000Z",
            studentIds: [cancelledStudentId],
          },
        ],
      });
    }
    if (url.pathname === "/attendance") {
      const lessonId = url.searchParams.get("lessonId");
      if (lessonId !== null) attendanceLookupLessonIds.push(lessonId);
      return json({
        attendance: lessonId === absentLessonId
          ? [{
              lessonId: absentLessonId,
              studentId: absentStudentId,
              status: "absent",
              checkedInAt: "2026-07-17T11:00:00.000Z",
              checkedOutAt: null,
              pickedUpBy: null,
              markedBy: "teacher-test",
            }, {
              lessonId: absentLessonId,
              studentId: wrongStudentId,
              status: "absent",
              checkedInAt: "2026-07-17T11:00:00.000Z",
              checkedOutAt: null,
              pickedUpBy: null,
              markedBy: "teacher-test",
            }]
          : lessonId === futureLessonId
            ? [{
                lessonId: futureLessonId,
                studentId: futureStudentId,
                status: "absent",
                checkedInAt: "2026-07-17T15:00:00.000Z",
                checkedOutAt: null,
                pickedUpBy: null,
                markedBy: "teacher-test",
              }]
          : lessonId === cancelledLessonId
            ? [{
                lessonId: cancelledLessonId,
                studentId: cancelledStudentId,
                status: "absent",
                checkedInAt: "2026-07-17T12:30:00.000Z",
                checkedOutAt: null,
                pickedUpBy: null,
                markedBy: "teacher-test",
              }]
            : [],
      });
    }
    if (url.pathname === "/guardian-links") {
      const studentId = url.searchParams.get("studentId");
      if (studentId !== null) guardianLookupStudentIds.push(studentId);
      return json({
        links: [{
          guardianId,
          studentId: absentStudentId,
          createdAt: "2026-07-01T00:00:00.000Z",
        }],
      });
    }
    if (url.pathname === `/people/${absentStudentId}`) {
      return json({
        id: absentStudentId,
        name: "测试学生",
        phone: null,
        school: null,
        grade: null,
        notes: null,
        roles: [],
        createdAt: "2026-07-01T00:00:00.000Z",
      });
    }
    if (url.pathname === "/class-types") {
      return json({
        classTypes: [{
          id: classTypeId,
          name: "数学",
          capacity: 8,
          durationMin: 60,
          category: "学科",
          active: true,
        }],
      });
    }
    if (url.pathname === "/message-drafts" && init?.method === "POST") {
      const draftInput = requestInput(init);
      draftCreateInputs.push(draftInput);
      const draft = {
        id: draftId,
        personId: draftInput.personId,
        purpose: draftInput.purpose,
        text: draftInput.text,
        status: "draft",
        createdAt: "2026-07-17T13:00:00.000Z",
        sentAt: null,
      };
      drafts.push(draft);
      return json(draft, 201);
    }
    if (url.pathname === "/message-drafts") return json({ drafts });
    throw new Error(`unexpected_core_request: ${url.href}`);
  };

  try {
    const env = {
      AGENT_DB: db,
      AGENT_DISABLED: "0",
      CORE_API_URL: "https://core.test",
      CORE_API_TOKEN: "test-core-token",
      OPENAI_API_KEY: "test-model-key",
      OPENAI_BASE_URL: "https://model.test/v1",
      OPENAI_MODEL: "test-model",
    };
    const scheduledAt = Date.parse("2026-07-17T13:00:00.000Z");
    await runScheduledJobs(env, "0 13 * * *", scheduledAt);
    await runScheduledJobs(env, "0 13 * * *", scheduledAt);

    assert.equal(draftCreateInputs.length, 1);
    assert.equal(
      draftCreateInputs[0]?.purpose,
      `no_show:${absentLessonId}:${absentStudentId}`,
    );
    assert.ok(!JSON.stringify(draftCreateInputs).includes(missingStudentId));
    assert.ok(!JSON.stringify(draftCreateInputs).includes(futureStudentId));
    assert.ok(!JSON.stringify(draftCreateInputs).includes(cancelledStudentId));
    assert.ok(!JSON.stringify(draftCreateInputs).includes(wrongStudentId));
    assert.deepEqual(guardianLookupStudentIds, [absentStudentId, absentStudentId]);
    assert.deepEqual(attendanceLookupLessonIds, [
      absentLessonId,
      missingLessonId,
      futureLessonId,
      cancelledLessonId,
      absentLessonId,
      missingLessonId,
      futureLessonId,
      cancelledLessonId,
    ]);

    const runs = state.jobRuns.filter((run) =>
      run.jobName === "no_show_follow_up"
    );
    assert.equal(runs.length, 2);
    assert.ok(runs.every((run) => run.status === "completed"));
    assert.ok(runs.every((run) => run.summaryText?.includes("缺少考勤1条")));
    assert.equal(
      state.conversations.get(runs[0]?.conversationId ?? "")?.title,
      "缺勤跟进",
    );
    assert.equal(JSON.parse(runs[0]?.metricsJson ?? "{}").createdDraftCount, 1);
    assert.equal(JSON.parse(runs[0]?.metricsJson ?? "{}").toolErrors, 4);
    assert.equal(JSON.parse(runs[1]?.metricsJson ?? "{}").skippedDraftCount, 1);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("daily digest exposes only reports_daily and denies other execution", async () => {
  const { db, state } = createFakeD1();
  const originalFetch = globalThis.fetch;
  const reportsDailyCalls: string[] = [];

  globalThis.fetch = async (input, init) => {
    const url = requestUrl(input);
    if (url.hostname === "model.test") {
      const body = requestBody(init);
      const prompt = initialUserPrompt(body);
      const previous = previousToolNames(body);
      if (prompt.includes("daily renewal watch")) {
        if (previous.length === 0) {
          return modelTools([
            { name: "entitlements_list", input: {} },
            { name: "arrears_list", input: {} },
          ]);
        }
        return modelText("续费巡检：候选0，未创建草稿。");
      }
      if (prompt.includes("today's H2Class owner digest")) {
        const toolNames = body.tools.map((tool) => tool.function.name);
        assert.deepEqual(toolNames, ["reports_daily"]);
        if (previous.length === 0) {
          // Deliberately call an unadvertised readonly tool. The execution
          // filter must reject it without touching core.
          return modelTools([{
            name: "lessons_list",
            input: {
              startAt: "2026-07-17T16:00:00.000Z",
              endAt: "2026-07-18T16:00:00.000Z",
            },
          }]);
        }
        if (previous.includes("lessons_list")) {
          const [denied] = lastToolContents(body);
          assert.equal(Reflect.get(denied as object, "is_error"), true);
          assert.equal(
            Reflect.get(denied as object, "error"),
            "tool_not_allowed",
          );
          return modelTools([{ name: "reports_daily", input: {} }]);
        }
        assert.deepEqual(previous, ["reports_daily"]);
        const [report] = lastToolContents(body);
        assert.equal(Reflect.get(report as object, "date"), "2026-07-18");
        return modelText(
          "今日简报｜2026-07-18：09:00数学课，王老师，测试学生；昨日1笔，实收12000分；未发送草稿2，待确认1。",
        );
      }
      throw new Error(`unexpected_job_prompt: ${prompt}`);
    }

    if (url.pathname === "/entitlements") return json({ entitlements: [] });
    if (url.pathname === "/arrears") return json({ arrears: [] });
    if (url.pathname === "/reports/daily") {
      reportsDailyCalls.push(url.href);
      return json({
        date: "2026-07-18",
        lessons: [{
          id: absentLessonId,
          classTypeId,
          classTypeName: "数学",
          teacherId,
          teacherName: "王老师",
          startAt: "2026-07-18T01:00:00.000Z",
          endAt: "2026-07-18T02:00:00.000Z",
          status: "scheduled",
          students: [{ id: absentStudentId, name: "测试学生" }],
        }],
        yesterday: {
          date: "2026-07-17",
          transactionCount: 1,
          gross_fen: 12800,
          discount_fen: 800,
          net_fen: 12000,
        },
        unsentDraftCount: 2,
        pendingActionCount: 1,
      });
    }
    throw new Error(`unexpected_core_request: ${url.href}`);
  };

  try {
    const env = {
      AGENT_DB: db,
      AGENT_DISABLED: "0",
      CORE_API_URL: "https://core.test",
      CORE_API_TOKEN: "test-core-token",
      OPENAI_API_KEY: "test-model-key",
      OPENAI_BASE_URL: "https://model.test/v1",
      OPENAI_MODEL: "test-model",
    };
    await runScheduledJobs(
      env,
      "0 23 * * *",
      Date.parse("2026-07-17T23:00:00.000Z"),
    );

    assert.deepEqual(
      state.jobRuns.map((run) => run.jobName),
      ["renewal_watch", "daily_digest"],
    );
    assert.ok(state.jobRuns.every((run) => run.status === "completed"));
    const dailyRun = state.jobRuns[1];
    assert.equal(
      state.conversations.get(dailyRun?.conversationId ?? "")?.title,
      "今日简报",
    );
    assert.match(dailyRun?.summaryText ?? "", /^今日简报/);
    assert.equal(reportsDailyCalls.length, 1);
    assert.equal(new URL(reportsDailyCalls[0] ?? "https://invalid").search, "");
    assert.equal(JSON.parse(dailyRun?.metricsJson ?? "{}").toolErrors, 1);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("weekly schedule caps distinct proposals and deduplicates reruns", async () => {
  const { db, state } = createFakeD1();
  const originalFetch = globalThis.fetch;
  const weeklyStudentId = "dddddddd-dddd-4ddd-8ddd-dddddddddddd";
  const weeklyTermId = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
  const pendingActionId = "cccccccc-cccc-4ccc-8ccc-cccccccccccc";
  const historyLessonIds = [
    "10101010-1010-4010-8010-101010101010",
    "20202020-2020-4020-8020-202020202020",
    "30303030-3030-4030-8030-303030303030",
  ];
  const historyStarts = [
    "2026-06-22T10:00:00.000Z",
    "2026-06-29T10:00:00.000Z",
    "2026-07-06T10:00:00.000Z",
  ];
  const bulkPayload = {
    lessons: [{
      classTypeId,
      teacherId,
      studentIds: [weeklyStudentId],
      date: "2026-07-20",
      startMin: 1080,
      termId: weeklyTermId,
    }],
  };
  const distinctBulkPayload = {
    lessons: [{
      classTypeId,
      teacherId,
      studentIds: [weeklyStudentId],
      date: "2026-07-21",
      startMin: 1080,
      termId: weeklyTermId,
    }],
  };
  const pendingActions: Array<Record<string, unknown>> = [];
  const proposalBodies: Array<Record<string, unknown>> = [];
  const directLessonWrites: string[] = [];
  const requestedLessonRanges: string[] = [];

  globalThis.fetch = async (input, init) => {
    const url = requestUrl(input);
    if (url.hostname === "model.test") {
      const body = requestBody(init);
      const prompt = initialUserPrompt(body);
      assert.match(prompt, /conservative owner-confirmation proposal/);
      assert.match(prompt, /2026-07-20 through 2026-07-26/);
      const toolNames = body.tools.map((tool) => tool.function.name);
      assert.ok(toolNames.includes("propose_lessons_bulk_apply"));
      assert.ok(toolNames.includes("pending_actions_list"));
      assert.deepEqual(
        toolNames.filter((name) => name.startsWith("propose_")),
        ["propose_lessons_bulk_apply"],
      );
      assert.ok(!toolNames.includes("lessons_create"));
      assert.ok(!toolNames.includes("drafts_create"));

      const previous = previousToolNames(body);
      if (previous.length === 0) {
        return modelTools([
          {
            name: "lessons_list",
            input: {
              startAt: "2026-06-21T16:00:00.000Z",
              endAt: "2026-07-19T16:00:00.000Z",
            },
          },
          {
            name: "lessons_list",
            input: {
              startAt: "2026-07-19T16:00:00.000Z",
              endAt: "2026-07-26T16:00:00.000Z",
            },
          },
          { name: "closure_days_list", input: {} },
          { name: "terms_list", input: {} },
          { name: "class_types_list", input: {} },
        ]);
      }
      if (previous.includes("class_types_list")) {
        return modelTools([{
          name: "free_slots_find",
          input: { teacherId, classTypeId, date: "2026-07-20" },
        }]);
      }
      if (previous.includes("free_slots_find")) {
        return modelTools([{ name: "pending_actions_list", input: {} }]);
      }
      if (previous.includes("pending_actions_list")) {
        // Intentionally attempt the same proposal on a rerun. The executor's
        // structured pending-action guard must suppress the second POST even
        // if a model ignores the prompt-level duplicate check.
        return modelTools([{
          name: "propose_lessons_bulk_apply",
          input: bulkPayload,
        }]);
      }
      if (previous.includes("propose_lessons_bulk_apply")) {
        const [result] = lastToolContents(body);
        if (
          typeof result === "object" && result !== null &&
          Reflect.get(result, "error") === "scheduled_proposal_limit_reached"
        ) {
          assert.equal(Reflect.get(result, "is_error"), true);
          return modelText(
            `每周排课草案：第二个不同批次被运行级上限拒绝；待确认项 ${pendingActionId}。`,
          );
        }
        const skipped = typeof result === "object" && result !== null &&
          Reflect.get(result, "skipped") === true;
        assert.ok(
          skipped || Reflect.get(result as object, "id") === pendingActionId,
        );
        // A malicious model tries a second valid but distinct payload. The
        // run-level cap must reject it before another pending-action POST.
        return modelTools([{
          name: "propose_lessons_bulk_apply",
          input: distinctBulkPayload,
        }]);
      }
      throw new Error(`unexpected_model_state: ${previous.join(",")}`);
    }

    if (url.pathname === "/lessons" && init?.method !== "POST") {
      const startAt = url.searchParams.get("startAt") ?? "";
      requestedLessonRanges.push(startAt);
      const lessons = startAt === "2026-06-21T16:00:00.000Z"
        ? historyStarts.map((startAtValue, index) => ({
            id: historyLessonIds[index],
            classTypeId,
            teacherId,
            startAt: startAtValue,
            endAt: new Date(Date.parse(startAtValue) + 60 * 60 * 1_000)
              .toISOString(),
            status: "completed",
            makeupForLessonId: null,
            termId: weeklyTermId,
            createdAt: "2026-06-01T00:00:00.000Z",
            studentIds: [weeklyStudentId],
          }))
        : [];
      return json({ lessons });
    }
    if (url.pathname === "/lessons" || url.pathname === "/lessons/bulk-apply") {
      directLessonWrites.push(`${init?.method ?? "GET"} ${url.pathname}`);
      return json({ error: "direct_lesson_write_forbidden" }, 500);
    }
    if (url.pathname === "/closure-days") return json({ closureDays: [] });
    if (url.pathname === "/terms") {
      return json({
        terms: [{
          id: weeklyTermId,
          name: "2026暑期",
          startDate: "2026-06-01",
          endDate: "2026-08-31",
        }],
      });
    }
    if (url.pathname === "/class-types") {
      return json({
        classTypes: [{
          id: classTypeId,
          name: "数学",
          capacity: 8,
          durationMin: 60,
          category: "学科",
          active: true,
        }],
      });
    }
    if (url.pathname === "/free-slots") {
      return json({
        teacherId,
        classTypeId,
        date: "2026-07-20",
        slots: [{
          date: "2026-07-20",
          startMin: 1020,
          endMin: 1200,
          startAt: "2026-07-20T09:00:00.000Z",
          endAt: "2026-07-20T12:00:00.000Z",
        }],
      });
    }
    if (url.pathname === "/pending-actions" && init?.method === "POST") {
      const body = requestInput(init);
      proposalBodies.push(body);
      const action = {
        id: pendingActionId,
        endpointName: body.endpoint,
        payload: body.payload,
        summary: "批量排课1节",
        status: "pending",
        createdBy: "agent",
        createdAt: "2026-07-17T09:00:00.000Z",
        expiresAt: "2099-07-17T10:00:00.000Z",
        resolvedBy: null,
        resolvedAt: null,
        result: null,
      };
      pendingActions.push(action);
      return json(action, 201);
    }
    if (url.pathname === "/pending-actions") {
      return json({ actions: pendingActions });
    }
    throw new Error(`unexpected_core_request: ${url.href}`);
  };

  try {
    const env = {
      AGENT_DB: db,
      AGENT_DISABLED: "0",
      CORE_API_URL: "https://core.test",
      CORE_API_TOKEN: "test-core-token",
      OPENAI_API_KEY: "test-model-key",
      OPENAI_BASE_URL: "https://model.test/v1",
      OPENAI_MODEL: "test-model",
    };
    const scheduledAt = Date.parse("2026-07-17T09:00:00.000Z");
    await runScheduledJobs(env, "0 9 * * 5", scheduledAt);
    await runScheduledJobs(env, "0 9 * * 5", scheduledAt);

    assert.equal(proposalBodies.length, 1);
    assert.deepEqual(proposalBodies[0], {
      endpoint: "lessons_bulk_apply",
      payload: bulkPayload,
    });
    assert.equal(pendingActions.length, 1);
    assert.deepEqual(directLessonWrites, []);
    assert.deepEqual(requestedLessonRanges, [
      "2026-06-21T16:00:00.000Z",
      "2026-07-19T16:00:00.000Z",
      "2026-06-21T16:00:00.000Z",
      "2026-07-19T16:00:00.000Z",
    ]);

    const runs = state.jobRuns.filter((run) =>
      run.jobName === "weekly_schedule_draft"
    );
    assert.equal(runs.length, 2);
    assert.ok(runs.every((run) => run.status === "completed"));
    assert.equal(
      state.conversations.get(runs[0]?.conversationId ?? "")?.title,
      "每周排课草案",
    );
    assert.equal(
      JSON.parse(runs[0]?.metricsJson ?? "{}").createdPendingActionCount,
      1,
    );
    assert.equal(JSON.parse(runs[0]?.metricsJson ?? "{}").toolErrors, 1);
    assert.equal(
      JSON.parse(runs[1]?.metricsJson ?? "{}").skippedPendingActionCount,
      1,
    );
    assert.equal(JSON.parse(runs[1]?.metricsJson ?? "{}").toolErrors, 1);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("weekly proposal cap survives an ambiguous failed POST", async () => {
  const metrics = emptyMetrics();
  let attemptedPosts = 0;
  const failedPostExecutor: ToolExecutor = async () => {
    attemptedPosts += 1;
    return {
      content: JSON.stringify({ error: "core_unavailable", is_error: true }),
      isError: true,
    };
  };
  const client = {
    call: async () => ({ actions: [] }),
    propose: async () => ({}),
  } as unknown as CoreClient;
  const execute = createProposalExecutor(
    failedPostExecutor,
    metrics,
    {
      endpointName: "lessons_bulk_apply",
      singleProposalPerRun: true,
    },
  );
  const firstPayload = {
    lessons: [{
      classTypeId,
      teacherId,
      studentIds: [absentStudentId],
      date: "2026-07-20",
      startMin: 1080,
    }],
  };
  const secondPayload = {
    lessons: [{
      classTypeId,
      teacherId,
      studentIds: [absentStudentId],
      date: "2026-07-21",
      startMin: 1080,
    }],
  };

  const first = await execute(
    "propose_lessons_bulk_apply",
    firstPayload,
    client,
    crypto.randomUUID(),
  );
  const second = await execute(
    "propose_lessons_bulk_apply",
    secondPayload,
    client,
    crypto.randomUUID(),
  );

  assert.equal(first.isError, true);
  assert.equal(attemptedPosts, 1);
  assert.equal(second.isError, true);
  assert.deepEqual(JSON.parse(second.content), {
    error: "scheduled_proposal_limit_reached",
    is_error: true,
  });
});
