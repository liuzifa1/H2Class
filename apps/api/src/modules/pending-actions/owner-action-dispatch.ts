import {
  attendanceCheckoutOverrideInputSchema,
  deductionPolicySetInputSchema,
  entitlementsPurchaseInputSchema,
  ledgerAdjustmentCreateInputSchema,
  lessonsBulkApplyInputSchema,
  peopleDeleteInputSchema,
  peopleRoleGrantInputSchema,
  peopleRoleRevokeInputSchema,
  pricesSetInputSchema,
  teacherRatesSetInputSchema,
  paymentsRefundInputSchema,
  type ProposalEndpointName,
} from "@h2class/shared";
import type { Principal } from "../../auth/types";
import type { MutationPlan } from "../../db/mutation-plan";
import {
  prepareCheckOutAttendanceOverride,
  prepareCreateLedgerAdjustment,
  prepareSetDeductionPolicy,
} from "../attendance/service";
import { prepareSetPrice } from "../catalog/service";
import {
  preparePurchaseEntitlement,
  prepareRefundPayment,
} from "../billing/service";
import {
  prepareDeletePerson,
  prepareGrantPersonRole,
  prepareRevokePersonRole,
} from "../people/service";
import { prepareSetTeacherRate } from "../reports/service";
import { prepareBulkApplyLessons } from "../scheduling/service";

type OwnerActionHandler = {
  summary: (input: unknown) => string;
  prepare: (
    d1: D1Database,
    principal: Principal,
    input: unknown,
  ) => Promise<MutationPlan<unknown>>;
};

export const ownerActionDispatch = {
  lessons_bulk_apply: {
    summary: (value) => {
      const input = lessonsBulkApplyInputSchema.parse(value);
      const dates = [...new Set(input.lessons.map(({ date }) => date))];
      return `批量应用 ${input.lessons.length} 节明确课程（${dates.join("、")}）`;
    },
    prepare: (d1, principal, value) =>
      prepareBulkApplyLessons(
        d1,
        principal,
        lessonsBulkApplyInputSchema.parse(value),
      ),
  },
  attendance_checkout_override: {
    summary: (value) => {
      const input = attendanceCheckoutOverrideInputSchema.parse(value);
      return `授权学生 ${input.studentId} 由“${input.pickedUpBy}”例外接走（课程 ${input.lessonId}）`;
    },
    prepare: (d1, principal, value) =>
      prepareCheckOutAttendanceOverride(
        d1,
        principal,
        attendanceCheckoutOverrideInputSchema.parse(value),
      ),
  },
  people_role_grant: {
    summary: (value) => {
      const input = peopleRoleGrantInputSchema.parse(value);
      return `授予人员 ${input.id} “${input.role}”角色`;
    },
    prepare: (d1, principal, value) =>
      prepareGrantPersonRole(
        d1,
        principal,
        peopleRoleGrantInputSchema.parse(value),
      ),
  },
  people_role_revoke: {
    summary: (value) => {
      const input = peopleRoleRevokeInputSchema.parse(value);
      return `撤销人员 ${input.id} 的“${input.role}”角色`;
    },
    prepare: (d1, principal, value) =>
      prepareRevokePersonRole(
        d1,
        principal,
        peopleRoleRevokeInputSchema.parse(value),
      ),
  },
  people_delete: {
    summary: (value) => {
      const input = peopleDeleteInputSchema.parse(value);
      return `永久删除人员 ${input.id}`;
    },
    prepare: (d1, principal, value) =>
      prepareDeletePerson(
        d1,
        principal,
        peopleDeleteInputSchema.parse(value),
      ),
  },
  prices_set: {
    summary: (value) => {
      const input = pricesSetInputSchema.parse(value);
      return `为课程类型 ${input.classTypeId} 设置价格 ${input.unit_amount_fen} 分，自 ${input.effectiveFrom} 生效`;
    },
    prepare: (d1, principal, value) =>
      prepareSetPrice(d1, principal, pricesSetInputSchema.parse(value)),
  },
  teacher_rates_set: {
    summary: (value) => {
      const input = teacherRatesSetInputSchema.parse(value);
      return `为教师 ${input.teacherId} 的课程类型 ${input.classTypeId} 设置 ${input.rate_fen} 分课时费，自 ${input.effectiveFrom} 生效`;
    },
    prepare: (d1, principal, value) =>
      prepareSetTeacherRate(
        d1,
        principal,
        teacherRatesSetInputSchema.parse(value),
      ),
  },
  deduction_policy_set: {
    summary: (value) => {
      const input = deductionPolicySetInputSchema.parse(value);
      return `将考勤状态 ${input.status} 设为${input.deducts ? "扣除" : "不扣除"}课时`;
    },
    prepare: (d1, principal, value) =>
      prepareSetDeductionPolicy(
        d1,
        principal,
        deductionPolicySetInputSchema.parse(value),
      ),
  },
  ledger_adjustment_create: {
    summary: (value) => {
      const input = ledgerAdjustmentCreateInputSchema.parse(value);
      const sign = input.delta > 0 ? "+" : "";
      return `为学生 ${input.studentId} 调整 ${sign}${input.delta} 课时：${input.reason}`;
    },
    prepare: (d1, principal, value) =>
      prepareCreateLedgerAdjustment(
        d1,
        principal,
        ledgerAdjustmentCreateInputSchema.parse(value),
      ),
  },
  entitlements_purchase: {
    summary: (value) => {
      const input = entitlementsPurchaseInputSchema.parse(value);
      return input.kind === "package"
        ? `为学生 ${input.studentId} 购买 ${input.creditsTotal} 课时包（价格版本 ${input.priceId}，收据 ${input.receiptNo}）`
        : `为学生 ${input.studentId} 购买 ${input.validFrom} 至 ${input.validTo} 的托管订阅（价格版本 ${input.priceId}，收据 ${input.receiptNo}）`;
    },
    prepare: (d1, principal, value) =>
      preparePurchaseEntitlement(
        d1,
        principal,
        entitlementsPurchaseInputSchema.parse(value),
      ),
  },
  payments_refund: {
    summary: (value) => {
      const input = paymentsRefundInputSchema.parse(value);
      return `按报价退还付款 ${input.paymentId} 的 ${input.expectedRemainingCredits} 剩余课时，共 ${input.expected_refund_amount_fen} 分：${input.reason}`;
    },
    prepare: (d1, principal, value) =>
      prepareRefundPayment(
        d1,
        principal,
        paymentsRefundInputSchema.parse(value),
      ),
  },
} satisfies Record<ProposalEndpointName, OwnerActionHandler>;
