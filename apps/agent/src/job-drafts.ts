import { endpoints } from "@h2class/shared";
import { z } from "zod";
import { CoreApiError } from "./api";
import { toolFailure } from "./tools";
import type { ToolExecutor } from "./tools";

export type DraftIdempotencePolicy = {
  invalidPurposeError: string;
  studentIdFromPurpose: (purpose: string) => string | null;
};

export type DraftEvidencePolicy = {
  observeToolResult: (
    name: string,
    input: unknown,
    output: unknown,
  ) => void;
  rejectionForPurpose: (purpose: string) => string | null;
};

type StudentMetric = { id: string; name: string | null };
type DraftMetric = {
  draftId: string;
  guardianId: string;
  purpose: string;
  studentId: string;
};
type SkippedDraftMetric = {
  draftIds: string[];
  guardianId: string;
  purpose: string;
  studentId: string;
  reason: "existing_unsent_draft" | "duplicate_draft_call_in_run";
};

export type PendingActionMetric = {
  endpointName: string;
  pendingActionIds: string[];
};

type JobMetrics = {
  toolCalls: number;
  toolErrors: number;
  affectedStudentCount: number;
  createdDraftCount: number;
  skippedDraftCount: number;
  createdPendingActionCount: number;
  skippedPendingActionCount: number;
  students: StudentMetric[];
  createdDrafts: DraftMetric[];
  skippedDrafts: SkippedDraftMetric[];
  createdPendingActions: PendingActionMetric[];
  skippedPendingActions: PendingActionMetric[];
};

export type MutableJobMetrics = {
  toolCalls: number;
  toolErrors: number;
  students: Map<string, string | null>;
  createdDrafts: DraftMetric[];
  skippedDrafts: SkippedDraftMetric[];
  createdPendingActions: PendingActionMetric[];
  skippedPendingActions: PendingActionMetric[];
};

export const emptyMetrics = (): MutableJobMetrics => ({
  toolCalls: 0,
  toolErrors: 0,
  students: new Map(),
  createdDrafts: [],
  skippedDrafts: [],
  createdPendingActions: [],
  skippedPendingActions: [],
});

export const serializableMetrics = (
  metrics: MutableJobMetrics,
): JobMetrics => {
  const affectedStudentIds = new Set([
    ...metrics.createdDrafts.map((draft) => draft.studentId),
    ...metrics.skippedDrafts.map((draft) => draft.studentId),
  ]);
  return {
    toolCalls: metrics.toolCalls,
    toolErrors: metrics.toolErrors,
    affectedStudentCount: affectedStudentIds.size,
    createdDraftCount: metrics.createdDrafts.length,
    skippedDraftCount: metrics.skippedDrafts.length,
    createdPendingActionCount: metrics.createdPendingActions.length,
    skippedPendingActionCount: metrics.skippedPendingActions.length,
    students: [...affectedStudentIds]
      .map((id) => ({ id, name: metrics.students.get(id) ?? null }))
      .sort((left, right) => left.id.localeCompare(right.id)),
    createdDrafts: metrics.createdDrafts,
    skippedDrafts: metrics.skippedDrafts,
    createdPendingActions: metrics.createdPendingActions,
    skippedPendingActions: metrics.skippedPendingActions,
  };
};

const recordStudents = (
  value: unknown,
  students: Map<string, string | null>,
) => {
  if (Array.isArray(value)) {
    for (const item of value) recordStudents(item, students);
    return;
  }
  if (typeof value !== "object" || value === null) return;
  const object = value as Record<string, unknown>;
  if (typeof object.studentId === "string") {
    const parsedId = z.uuid().safeParse(object.studentId);
    if (parsedId.success) {
      const name = typeof object.studentName === "string"
        ? object.studentName
        : null;
      const knownName = students.get(parsedId.data);
      students.set(parsedId.data, knownName ?? name);
    }
  }
  for (const child of Object.values(object)) recordStudents(child, students);
};

const parseJson = (value: string): unknown => {
  try {
    return JSON.parse(value);
  } catch {
    return null;
  }
};

export const createJobExecutor = (
  baseExecutor: ToolExecutor,
  metrics: MutableJobMetrics,
  draftIdempotence: DraftIdempotencePolicy | undefined,
  draftEvidence?: DraftEvidencePolicy,
): ToolExecutor => {
  const claimedDraftKeys = new Set<string>();
  const recordSkip = (skip: SkippedDraftMetric) => {
    const signature = `${skip.guardianId}:${skip.purpose}:${skip.reason}:${skip.draftIds.join(",")}`;
    const exists = metrics.skippedDrafts.some((existing) =>
      `${existing.guardianId}:${existing.purpose}:${existing.reason}:${existing.draftIds.join(",")}` === signature
    );
    if (!exists) metrics.skippedDrafts.push(skip);
  };

  return async (name, input, client, conversationId) => {
    metrics.toolCalls += 1;

    if (name !== "drafts_create") {
      const result = await baseExecutor(name, input, client, conversationId);
      if (result.isError) metrics.toolErrors += 1;
      else {
        const output = parseJson(result.content);
        recordStudents(output, metrics.students);
        draftEvidence?.observeToolResult(name, input, output);
        if (name === "drafts_list" && draftIdempotence !== undefined) {
          const parsedInput = endpoints.drafts_list.input.safeParse(input);
          const parsedOutput = endpoints.drafts_list.output.safeParse(output);
          if (
            parsedInput.success &&
            parsedOutput.success &&
            parsedInput.data.personId !== undefined &&
            parsedInput.data.status === "draft"
          ) {
            const purpose = parsedInput.data.purpose;
            const studentId = purpose === undefined
              ? null
              : draftIdempotence.studentIdFromPurpose(
                  purpose,
                );
            if (
              purpose !== undefined &&
              studentId !== null &&
              parsedOutput.data.drafts.length > 0
            ) {
              recordSkip({
                draftIds: parsedOutput.data.drafts.map((draft) => draft.id),
                guardianId: parsedInput.data.personId,
                purpose,
                studentId,
                reason: "existing_unsent_draft",
              });
            }
          }
        }
      }
      return result;
    }

    if (draftIdempotence === undefined) {
      metrics.toolErrors += 1;
      return toolFailure("drafts_not_configured_for_job");
    }
    const parsed = endpoints.drafts_create.input.safeParse(input);
    if (!parsed.success) {
      metrics.toolErrors += 1;
      return toolFailure("invalid_tool_input");
    }
    const studentId = draftIdempotence.studentIdFromPurpose(
      parsed.data.purpose,
    );
    if (studentId === null) {
      metrics.toolErrors += 1;
      return toolFailure(draftIdempotence.invalidPurposeError);
    }
    const evidenceRejection = draftEvidence?.rejectionForPurpose(
      parsed.data.purpose,
    );
    if (evidenceRejection !== undefined && evidenceRejection !== null) {
      metrics.toolErrors += 1;
      return toolFailure(evidenceRejection);
    }
    const key = `${parsed.data.personId}:${parsed.data.purpose}`;
    if (claimedDraftKeys.has(key)) {
      recordSkip({
        draftIds: [],
        guardianId: parsed.data.personId,
        purpose: parsed.data.purpose,
        studentId,
        reason: "duplicate_draft_call_in_run",
      });
      return {
        content: JSON.stringify({
          skipped: true,
          reason: "duplicate_draft_call_in_run",
          personId: parsed.data.personId,
          purpose: parsed.data.purpose,
          draftIds: [],
        }),
        isError: false,
      };
    }
    claimedDraftKeys.add(key);

    try {
      const existing = await client.call(
        "drafts_list",
        {
          personId: parsed.data.personId,
          purpose: parsed.data.purpose,
          status: "draft",
        },
        conversationId,
      );
      if (existing.drafts.length > 0) {
        const draftIds = existing.drafts.map((draft) => draft.id);
        recordSkip({
          draftIds,
          guardianId: parsed.data.personId,
          purpose: parsed.data.purpose,
          studentId,
          reason: "existing_unsent_draft",
        });
        metrics.students.set(studentId, metrics.students.get(studentId) ?? null);
        return {
          content: JSON.stringify({
            skipped: true,
            reason: "existing_unsent_draft",
            personId: parsed.data.personId,
            purpose: parsed.data.purpose,
            draftIds,
          }),
          isError: false,
        };
      }
    } catch (error) {
      claimedDraftKeys.delete(key);
      metrics.toolErrors += 1;
      return error instanceof CoreApiError
        ? toolFailure(error.code)
        : toolFailure("tool_execution_failed");
    }

    const result = await baseExecutor(name, parsed.data, client, conversationId);
    if (result.isError) {
      claimedDraftKeys.delete(key);
      metrics.toolErrors += 1;
      return result;
    }

    const parsedOutput = endpoints.drafts_create.output.safeParse(
      parseJson(result.content),
    );
    if (parsedOutput.success) {
      metrics.createdDrafts.push({
        draftId: parsedOutput.data.id,
        guardianId: parsed.data.personId,
        purpose: parsed.data.purpose,
        studentId,
      });
      metrics.students.set(studentId, metrics.students.get(studentId) ?? null);
    }
    return result;
  };
};
