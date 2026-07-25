import { z } from "zod";

export const classTypeCategorySchema = z.enum(["素质类", "托管", "学科"]);

const classTypeIdSchema = z.uuid().describe("Class type UUID.");
const priceIdSchema = z.uuid().describe("Price version UUID.");
const unitAmountFenSchema = z
  .number()
  .int()
  .nonnegative()
  .describe("Price in integer fen; never a floating-point currency value.");

export const classTypeSchema = z.object({
  id: classTypeIdSchema,
  name: z.string().min(1).describe("Display name for the class type."),
  capacity: z
    .number()
    .int()
    .positive()
    .describe("Maximum number of students in one lesson."),
  durationMin: z
    .number()
    .int()
    .positive()
    .describe("Default lesson duration in whole minutes."),
  category: classTypeCategorySchema.describe(
    "Business category: 素质类, 托管, or 学科.",
  ),
  active: z
    .boolean()
    .describe("Whether this class type can be used for new work."),
});

export const priceSchema = z.object({
  id: priceIdSchema,
  classTypeId: classTypeIdSchema,
  unit_amount_fen: unitAmountFenSchema,
  effectiveFrom: z
    .iso.datetime()
    .describe("UTC instant when this price takes effect."),
  createdAt: z
    .iso.datetime()
    .describe("UTC creation timestamp for this immutable version."),
});

export const classTypesCreateInputSchema = z
  .object({
    name: z.string().min(1).describe("Display name for the class type."),
    capacity: z
      .number()
      .int()
      .positive()
      .describe("Maximum number of students in one lesson."),
    durationMin: z
      .number()
      .int()
      .positive()
      .describe("Default lesson duration in whole minutes."),
    category: classTypeCategorySchema,
    active: z
      .boolean()
      .default(true)
      .describe("Whether this class type is active; defaults to true."),
  })
  .strict();

export const classTypesUpdateInputSchema = z
  .object({
    id: classTypeIdSchema,
    name: z.string().min(1).optional().describe("Replacement display name."),
    capacity: z
      .number()
      .int()
      .positive()
      .optional()
      .describe("Replacement maximum student capacity."),
    durationMin: z
      .number()
      .int()
      .positive()
      .optional()
      .describe("Replacement default duration in whole minutes."),
    category: classTypeCategorySchema
      .optional()
      .describe("Replacement category."),
    active: z.boolean().optional().describe("Replacement active state."),
  })
  .strict();

export const classTypesListInputSchema = z.object({}).strict();

export const classTypesListOutputSchema = z.object({
  classTypes: z.array(classTypeSchema),
});

export const pricesSetInputSchema = z
  .object({
    classTypeId: classTypeIdSchema,
    unit_amount_fen: unitAmountFenSchema,
    effectiveFrom: z
      .iso.datetime()
      .describe("UTC instant when the new version takes effect."),
  })
  .strict();

export const pricesListInputSchema = z
  .object({
    classTypeId: classTypeIdSchema
      .optional()
      .describe("Return price history only for this class type when provided."),
  })
  .strict();

export const pricesListOutputSchema = z.object({
  prices: z.array(priceSchema),
});

export const pricesCurrentGetInputSchema = z
  .object({ classTypeId: classTypeIdSchema })
  .strict();

export type ClassTypeCategory = z.infer<typeof classTypeCategorySchema>;
export type ClassType = z.infer<typeof classTypeSchema>;
export type Price = z.infer<typeof priceSchema>;
export type ClassTypesCreateInput = z.infer<typeof classTypesCreateInputSchema>;
export type ClassTypesUpdateInput = z.infer<typeof classTypesUpdateInputSchema>;
export type ClassTypesListInput = z.infer<typeof classTypesListInputSchema>;
export type ClassTypesListOutput = z.infer<typeof classTypesListOutputSchema>;
export type PricesSetInput = z.infer<typeof pricesSetInputSchema>;
export type PricesListInput = z.infer<typeof pricesListInputSchema>;
export type PricesListOutput = z.infer<typeof pricesListOutputSchema>;
export type PricesCurrentGetInput = z.infer<typeof pricesCurrentGetInputSchema>;
