import assert from "node:assert/strict";
import test from "node:test";
import { endpoints } from "@h2class/shared";
import { z } from "zod";
import {
  autonomousToolFilter,
  createToolRuntime,
  interactiveToolRuntime,
} from "../src/tools.ts";

const studentId = "11111111-1111-4111-8111-111111111111";
const guardianId = "22222222-2222-4222-8222-222222222222";
const priceId = "33333333-3333-4333-8333-333333333333";

test("generated discriminated-union tool schema remains strict and usable", () => {
  const tool = interactiveToolRuntime.tools.find(
    (candidate) =>
      candidate.function.name === "propose_entitlements_purchase",
  );
  assert.ok(tool);
  const validator = z.fromJSONSchema(tool.function.parameters);
  const packagePurchase = {
    kind: "package",
    studentId,
    guardianId,
    priceId,
    creditsTotal: 20,
    discount_fen: 0,
    method: "wechat",
    receiptNo: "PKG-TEST-001",
  };
  const subscriptionPurchase = {
    kind: "subscription",
    studentId,
    guardianId,
    priceId,
    validFrom: "2026-07-01",
    validTo: "2026-07-31",
    discount_fen: 0,
    method: "wechat",
    receiptNo: "SUB-TEST-001",
  };

  assert.equal(validator.safeParse(packagePurchase).success, true);
  assert.equal(validator.safeParse(subscriptionPurchase).success, true);
  assert.equal(
    validator.safeParse({ ...packagePurchase, unexpected: true }).success,
    false,
  );
});

test("autonomous tools derive and enforce registry capabilities", async () => {
  const runtime = createToolRuntime(autonomousToolFilter);
  const names = runtime.tools.map((tool) => tool.function.name);
  assert.deepEqual(
    names,
    [...names].sort((left, right) => left.localeCompare(right)),
  );

  for (const [endpointName, endpoint] of Object.entries(endpoints)) {
    const hidden = "toolExposure" in endpoint &&
      endpoint.toolExposure === "hidden";
    const autonomousWrite = "autonomousWrite" in endpoint &&
      endpoint.autonomousWrite === true;
    const expected = !hidden && (
      endpoint.readonly || endpoint.ownerOnly || autonomousWrite
    );
    const toolName = endpoint.ownerOnly
      ? `propose_${endpointName}`
      : endpointName;
    assert.equal(names.includes(toolName), expected, toolName);
  }

  const denied = await runtime.execute(
    "drafts_mark_sent",
    {},
    {} as never,
    crypto.randomUUID(),
  );
  assert.equal(denied.isError, true);
  assert.match(denied.content, /tool_not_allowed/);
});
