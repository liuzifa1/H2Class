import {
  arrearsListInputSchema,
  entitlementsListInputSchema,
  entitlementsPurchaseInputSchema,
  paymentsListInputSchema,
  paymentsRefundInputSchema,
  paymentsRefundQuoteInputSchema,
} from "@h2class/shared";
import { Hono, type Context } from "hono";
import { requireRole } from "../../auth/require-role";
import type { Principal } from "../../auth/types";
import type { AppEnv } from "../../env";
import {
  isBillingServiceError,
  listArrears,
  listEntitlements,
  listPayments,
  purchaseEntitlement,
  quotePaymentRefund,
  refundPayment,
} from "./service";

const invalidRequest = (c: Context<AppEnv>) =>
  c.json({ error: "invalid_request" }, 400);

const principal = (c: Context<AppEnv>): Principal => {
  if (c.var.principal === undefined) {
    throw new Error("Authenticated billing route is missing its principal");
  }
  return c.var.principal;
};

const jsonBody = async (c: Context<AppEnv>): Promise<unknown> =>
  c.req.json().catch(() => undefined);

const inputObject = (value: unknown): Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};

const queryObject = (c: Context<AppEnv>) =>
  Object.fromEntries(new URL(c.req.url).searchParams);

const handleServiceError = (c: Context<AppEnv>, error: unknown): Response => {
  if (isBillingServiceError(error)) {
    return c.json({ error: error.code }, error.status);
  }
  throw error;
};

const oneLine = (value: string) => value.replace(/\s+/g, " ").trim();
const canReadBilling = requireRole("admin", "staff", "agent");

export const billingRoutes = new Hono<AppEnv>();

billingRoutes.post(
  "/entitlements/purchase",
  requireRole("admin"),
  async (c) => {
    const parsed = entitlementsPurchaseInputSchema.safeParse(await jsonBody(c));
    if (!parsed.success) return invalidRequest(c);
    try {
      const result = await purchaseEntitlement(c.env.DB, principal(c), parsed.data);
      c.set("audit", {
        entity: "entitlement",
        entityId: result.entitlement.id,
        summary: oneLine(
          `Purchased ${result.entitlement.kind} entitlement ${result.entitlement.id} for student ${result.entitlement.studentId}; payment ${result.payment.id} was ${result.payment.paid_amount_fen} fen`,
        ),
      });
      return c.json(result, 201);
    } catch (error) {
      return handleServiceError(c, error);
    }
  },
);

billingRoutes.get("/entitlements", canReadBilling, async (c) => {
  const parsed = entitlementsListInputSchema.safeParse(queryObject(c));
  if (!parsed.success) return invalidRequest(c);
  try {
    return c.json(await listEntitlements(c.env.DB, principal(c), parsed.data));
  } catch (error) {
    return handleServiceError(c, error);
  }
});

billingRoutes.get("/payments", canReadBilling, async (c) => {
  const parsed = paymentsListInputSchema.safeParse(queryObject(c));
  if (!parsed.success) return invalidRequest(c);
  try {
    return c.json(await listPayments(c.env.DB, principal(c), parsed.data));
  } catch (error) {
    return handleServiceError(c, error);
  }
});

billingRoutes.get(
  "/payments/:paymentId/refund-quote",
  canReadBilling,
  async (c) => {
    const parsed = paymentsRefundQuoteInputSchema.safeParse({
      paymentId: c.req.param("paymentId"),
    });
    if (!parsed.success) return invalidRequest(c);
    try {
      return c.json(await quotePaymentRefund(c.env.DB, principal(c), parsed.data));
    } catch (error) {
      return handleServiceError(c, error);
    }
  },
);

billingRoutes.post(
  "/payments/:paymentId/refund",
  requireRole("admin"),
  async (c) => {
    const body = inputObject(await jsonBody(c));
    const parsed = paymentsRefundInputSchema.safeParse({
      ...body,
      paymentId: c.req.param("paymentId"),
    });
    if (!parsed.success) return invalidRequest(c);
    try {
      const result = await refundPayment(c.env.DB, principal(c), parsed.data);
      c.set("audit", {
        entity: "payment",
        entityId: result.payment.id,
        summary: oneLine(
          `Refunded payment ${parsed.data.paymentId}: ${result.quote.remainingCredits} remaining credits and ${result.quote.refund_amount_fen} fen`,
        ),
      });
      return c.json(result, 201);
    } catch (error) {
      return handleServiceError(c, error);
    }
  },
);

billingRoutes.get("/arrears", canReadBilling, async (c) => {
  const parsed = arrearsListInputSchema.safeParse(queryObject(c));
  if (!parsed.success) return invalidRequest(c);
  try {
    return c.json(await listArrears(c.env.DB, principal(c), parsed.data));
  } catch (error) {
    return handleServiceError(c, error);
  }
});
