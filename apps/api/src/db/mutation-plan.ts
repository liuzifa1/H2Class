import type { BatchItem } from "drizzle-orm/batch";
import { drizzle } from "drizzle-orm/d1";

export type MutationPlan<Result> = {
  statements: readonly [BatchItem<"sqlite">, ...BatchItem<"sqlite">[]];
  result: Result;
  mapError?: (error: unknown) => never;
};

export const executeMutationPlan = async <Result>(
  d1: D1Database,
  plan: MutationPlan<Result>,
): Promise<Result> => {
  try {
    await drizzle(d1).batch(plan.statements);
  } catch (error) {
    if (plan.mapError !== undefined) plan.mapError(error);
    throw error;
  }
  return plan.result;
};
