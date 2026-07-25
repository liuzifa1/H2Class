import { endpoints } from "@h2class/shared";
import type { ProposalEndpointName } from "@h2class/shared";
import { CoreApiError } from "./api";
import type { MutableJobMetrics } from "./job-drafts";
import { toolFailure } from "./tools";
import type { ToolExecutor } from "./tools";

export type PendingActionIdempotencePolicy = {
  endpointName: ProposalEndpointName;
  singleProposalPerRun?: true;
};

const canonicalize = (value: unknown): unknown => {
  if (Array.isArray(value)) return value.map(canonicalize);
  if (typeof value !== "object" || value === null) return value;
  const object = value as Record<string, unknown>;
  return Object.fromEntries(
    Object.keys(object)
      .sort((left, right) => left.localeCompare(right))
      .filter((key) => object[key] !== undefined)
      .map((key) => [key, canonicalize(object[key])]),
  );
};

const canonicalJson = (value: unknown) => JSON.stringify(canonicalize(value));

const parsedJson = (value: string): unknown => {
  try {
    return JSON.parse(value);
  } catch {
    return null;
  }
};

export const createProposalExecutor = (
  baseExecutor: ToolExecutor,
  metrics: MutableJobMetrics,
  policy: PendingActionIdempotencePolicy | undefined,
): ToolExecutor => {
  const claimedPayloads = new Set<string>();
  let proposalCallConsumed = false;

  return async (name, input, client, conversationId) => {
    if (policy === undefined || name !== `propose_${policy.endpointName}`) {
      return baseExecutor(name, input, client, conversationId);
    }

    const endpoint = endpoints[policy.endpointName];
    const parsed = endpoint.input.safeParse(input);
    if (!parsed.success) return baseExecutor(name, input, client, conversationId);
    if (policy.singleProposalPerRun && proposalCallConsumed) {
      metrics.toolCalls += 1;
      metrics.toolErrors += 1;
      return toolFailure("scheduled_proposal_limit_reached");
    }
    if (policy.singleProposalPerRun) proposalCallConsumed = true;
    const payloadJson = canonicalJson(parsed.data);
    if (claimedPayloads.has(payloadJson)) {
      metrics.toolCalls += 1;
      metrics.skippedPendingActions.push({
        endpointName: policy.endpointName,
        pendingActionIds: [],
      });
      return {
        content: JSON.stringify({
          skipped: true,
          reason: "duplicate_proposal_call_in_run",
          endpointName: policy.endpointName,
          pendingActionIds: [],
        }),
        isError: false,
      };
    }
    claimedPayloads.add(payloadJson);

    try {
      const existing = await client.call(
        "pending_actions_list",
        {},
        conversationId,
      );
      const matches = existing.actions.filter((action) =>
        action.status === "pending" &&
        action.endpointName === policy.endpointName &&
        canonicalJson(action.payload) === payloadJson
      );
      if (matches.length > 0) {
        const pendingActionIds = matches.map((action) => action.id);
        metrics.toolCalls += 1;
        metrics.skippedPendingActions.push({
          endpointName: policy.endpointName,
          pendingActionIds,
        });
        return {
          content: JSON.stringify({
            skipped: true,
            reason: "existing_pending_action",
            endpointName: policy.endpointName,
            pendingActionIds,
          }),
          isError: false,
        };
      }
    } catch (error) {
      claimedPayloads.delete(payloadJson);
      metrics.toolCalls += 1;
      metrics.toolErrors += 1;
      return error instanceof CoreApiError
        ? toolFailure(error.code)
        : toolFailure("tool_execution_failed");
    }

    const result = await baseExecutor(name, parsed.data, client, conversationId);
    if (result.isError) {
      claimedPayloads.delete(payloadJson);
      return result;
    }
    const output = parsedJson(result.content);
    if (typeof output === "object" && output !== null && !Array.isArray(output)) {
      const id = Reflect.get(output, "id");
      if (typeof id === "string") {
        metrics.createdPendingActions.push({
          endpointName: policy.endpointName,
          pendingActionIds: [id],
        });
      }
    }
    return result;
  };
};
