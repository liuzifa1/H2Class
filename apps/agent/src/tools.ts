import { endpoints } from "@h2class/shared";
import { z } from "zod";
import { CoreApiError } from "./api";
import type { CoreClient, EndpointName } from "./api";
import type { OpenAIFunctionTool } from "./openai";

export type ToolMetadata = {
  toolName: string;
  endpointName: EndpointName;
  readonly: boolean;
  ownerOnly: boolean;
  autonomousWrite: boolean;
};

type ToolBinding = ToolMetadata & {
  tool: OpenAIFunctionTool;
};

export type ToolExecutionResult = {
  content: string;
  isError: boolean;
};

export type ToolExecutor = (
  name: string,
  input: unknown,
  client: CoreClient,
  conversationId: string,
) => Promise<ToolExecutionResult>;

export type ToolFilter = (metadata: ToolMetadata) => boolean;

export type ToolRuntime = {
  tools: OpenAIFunctionTool[];
  execute: ToolExecutor;
};

const record = (value: unknown): Record<string, unknown> | null =>
  typeof value === "object" && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;

const mergeAlternativeObjectShape = (schema: Record<string, unknown>) => {
  const alternativesValue = Array.isArray(schema.oneOf)
    ? schema.oneOf
    : Array.isArray(schema.anyOf)
      ? schema.anyOf
      : null;
  if (alternativesValue === null || alternativesValue.length === 0) return;

  const alternatives = alternativesValue.map(record);
  if (
    alternatives.some((alternative) =>
      alternative === null || alternative.type !== "object"
    )
  ) return;

  const objectAlternatives = alternatives.filter(
    (alternative): alternative is Record<string, unknown> =>
      alternative !== null,
  );
  const propertyMaps = objectAlternatives.map((alternative) =>
    record(alternative.properties) ?? {}
  );
  const propertyNames = [...new Set(
    propertyMaps.flatMap((properties) => Object.keys(properties)),
  )].sort((left, right) => left.localeCompare(right));
  const properties: Record<string, unknown> = {};
  for (const propertyName of propertyNames) {
    const variants = propertyMaps
      .map((propertyMap) => propertyMap[propertyName])
      .filter((variant) => variant !== undefined);
    const uniqueVariants = [...new Map(
      variants.map((variant) => [JSON.stringify(variant), variant] as const),
    ).values()];
    const firstVariant = uniqueVariants[0];
    if (firstVariant !== undefined) {
      properties[propertyName] = uniqueVariants.length === 1
        ? firstVariant
        : { anyOf: uniqueVariants };
    }
  }

  const requiredLists = objectAlternatives.map((alternative) =>
    Array.isArray(alternative.required)
      ? alternative.required.filter(
          (value): value is string => typeof value === "string",
        )
      : []
  );
  const commonRequired = requiredLists[0]?.filter((propertyName) =>
    requiredLists.every((required) => required.includes(propertyName))
  ) ?? [];
  schema.properties = properties;
  schema.required = commonRequired;
};

const parametersFor = (
  endpointName: EndpointName,
): Record<string, unknown> => {
  const generated = z.toJSONSchema(endpoints[endpointName].input, {
    target: "draft-07",
    io: "input",
    reused: "inline",
  });
  const plain: unknown = JSON.parse(JSON.stringify(generated));
  if (typeof plain !== "object" || plain === null || Array.isArray(plain)) {
    throw new Error(`Endpoint ${endpointName} did not produce an object schema`);
  }
  const schema = plain as Record<string, unknown>;
  delete schema.$schema;
  mergeAlternativeObjectShape(schema);
  schema.type = "object";
  schema.required = Array.isArray(schema.required) ? schema.required : [];
  schema.additionalProperties = false;
  return schema;
};

const buildCatalog = (): ToolBinding[] =>
  Object.keys(endpoints)
    .flatMap((endpointNameValue) => {
      const endpointName = endpointNameValue as EndpointName;
      const endpoint = endpoints[endpointName];
      if ("toolExposure" in endpoint && endpoint.toolExposure === "hidden") {
        return [];
      }
      const toolName = endpoint.ownerOnly
        ? `propose_${endpointName}`
        : endpointName;
      return [{
        toolName,
        endpointName,
        readonly: endpoint.readonly,
        ownerOnly: endpoint.ownerOnly,
        autonomousWrite:
          "autonomousWrite" in endpoint && endpoint.autonomousWrite === true,
        tool: {
          type: "function",
          function: {
            name: toolName,
            description: endpoint.ownerOnly
              ? `${endpoint.description} Call this to create an owner-confirmation proposal; never perform the operation directly.`
              : endpoint.description,
            parameters: parametersFor(endpointName),
            strict: true,
          },
        },
      } satisfies ToolBinding];
    })
    .sort((left, right) => left.toolName.localeCompare(right.toolName));

const catalog = buildCatalog();

export const toolFailure = (
  error: string,
  message?: string,
): ToolExecutionResult => ({
  content: JSON.stringify({
    error,
    is_error: true,
    ...(message === undefined ? {} : { message }),
  }),
  isError: true,
});

const executeBinding = async (
  binding: ToolBinding,
  input: unknown,
  client: CoreClient,
  conversationId: string,
): Promise<ToolExecutionResult> => {
  const endpoint = endpoints[binding.endpointName];
  const parsed = endpoint.input.safeParse(input);
  if (!parsed.success) return toolFailure("invalid_tool_input");

  try {
    const output = binding.ownerOnly
      ? await client.propose(
          binding.endpointName,
          parsed.data,
          conversationId,
        )
      : await client.call(binding.endpointName, parsed.data, conversationId);
    return { content: JSON.stringify(output), isError: false };
  } catch (error) {
    if (error instanceof CoreApiError) {
      if (binding.ownerOnly && error.status === 404) {
        return toolFailure(
          "pending_actions_unavailable",
          "Owner-only proposal capability is pending because core has not shipped POST /pending-actions yet.",
        );
      }
      return toolFailure(error.code);
    }
    return toolFailure("tool_execution_failed");
  }
};

export const createToolRuntime = (
  filter: ToolFilter,
  unavailableError = "tool_not_allowed",
): ToolRuntime => {
  const allowed = catalog.filter((binding) => filter(binding));
  const bindings = new Map(
    allowed.map((binding) => [binding.toolName, binding] as const),
  );
  return {
    tools: allowed.map((binding) => binding.tool),
    execute: async (name, input, client, conversationId) => {
      const binding = bindings.get(name);
      if (binding === undefined) return toolFailure(unavailableError);
      return executeBinding(binding, input, client, conversationId);
    },
  };
};

export const interactiveToolFilter: ToolFilter = () => true;

// This filter is the autonomous-run security boundary. It is derived from
// registry metadata, with drafts_create as the one explicitly approved direct
// write. Hidden control-plane entries never enter the catalog.
export const autonomousToolFilter: ToolFilter = (metadata) =>
  metadata.readonly ||
  metadata.ownerOnly ||
  metadata.autonomousWrite;

export const interactiveToolRuntime = createToolRuntime(
  interactiveToolFilter,
  "unknown_tool",
);

// Backward-compatible exports for the interactive loop.
export const tools = interactiveToolRuntime.tools;
export const executeTool = interactiveToolRuntime.execute;
