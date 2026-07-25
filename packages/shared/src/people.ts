import { z } from "zod";

export const personRoleSchema = z.enum([
  "admin",
  "staff",
  "teacher",
  "guardian",
]);

const personIdSchema = z.uuid().describe("Person UUID.");
const nullablePersonText = z.string().min(1).nullable();

export const personSchema = z.object({
  id: personIdSchema,
  name: z.string().min(1).describe("Person's full name."),
  phone: z
    .string()
    .min(1)
    .nullable()
    .describe("Contact phone number, required for guardians."),
  school: nullablePersonText.describe("School name, when known."),
  grade: nullablePersonText.describe("School grade or year, when known."),
  notes: nullablePersonText.describe("Operational notes about the person."),
  roles: z
    .array(personRoleSchema)
    .describe("Human roles currently assigned to the person."),
  createdAt: z.iso.datetime().describe("UTC creation timestamp."),
});

export const personDetailSchema = personSchema.extend({
  medicalNotes: nullablePersonText
    .optional()
    .describe(
      "Sensitive medical notes; present only for authenticated admin or staff callers.",
    ),
});

export const peopleCreateInputSchema = z
  .object({
    name: z.string().min(1).describe("Person's full name."),
    phone: z
      .string()
      .min(1)
      .optional()
      .describe("Contact phone number; required when guardian is assigned."),
    school: z.string().min(1).optional().describe("School name, when known."),
    grade: z
      .string()
      .min(1)
      .optional()
      .describe("School grade or year, when known."),
    notes: z
      .string()
      .min(1)
      .optional()
      .describe("Operational notes about the person."),
    medicalNotes: z
      .string()
      .min(1)
      .optional()
      .describe("Sensitive medical notes; only admin or staff may set this field."),
    roles: z
      .array(personRoleSchema)
      .optional()
      .describe("Initial human roles to assign."),
  })
  .strict();

export const peopleUpdateInputSchema = z
  .object({
    id: personIdSchema,
    name: z.string().min(1).optional().describe("Replacement full name."),
    phone: nullablePersonText
      .optional()
      .describe("Replacement phone number, or null to clear it."),
    school: nullablePersonText
      .optional()
      .describe("Replacement school name, or null to clear it."),
    grade: nullablePersonText
      .optional()
      .describe("Replacement school grade, or null to clear it."),
    notes: nullablePersonText
      .optional()
      .describe("Replacement operational notes, or null to clear them."),
    medicalNotes: nullablePersonText
      .optional()
      .describe(
        "Replacement sensitive medical notes, or null to clear them; only admin or staff may set this field.",
      ),
  })
  .strict();

export const peopleGetInputSchema = z
  .object({ id: personIdSchema })
  .strict();

export const peopleListInputSchema = z
  .object({
    role: personRoleSchema
      .optional()
      .describe("Return only people assigned this role."),
    search: z
      .string()
      .min(1)
      .optional()
      .describe("Case-insensitive substring to match against person names."),
  })
  .strict();

export const peopleListOutputSchema = z.object({
  people: z.array(personSchema),
});

export const guardianLinkCreateInputSchema = z
  .object({
    guardianId: personIdSchema.describe("Guardian person UUID."),
    studentId: personIdSchema.describe("Student person UUID."),
  })
  .strict();

export const guardianLinkSchema = z.object({
  guardianId: personIdSchema.describe("Guardian person UUID."),
  studentId: personIdSchema.describe("Student person UUID."),
  createdAt: z.iso.datetime().describe("UTC link creation timestamp."),
});

export const guardianLinksListInputSchema = z
  .object({
    guardianId: personIdSchema.optional().describe("Optional guardian filter."),
    studentId: personIdSchema.optional().describe("Optional student filter."),
  })
  .strict();

export const guardianLinksListOutputSchema = z.object({
  links: z.array(guardianLinkSchema),
});

export const peopleRoleGrantInputSchema = z
  .object({
    id: personIdSchema,
    role: personRoleSchema.describe("Human role to grant."),
  })
  .strict();

export const peopleRoleRevokeInputSchema = z
  .object({
    id: personIdSchema,
    role: personRoleSchema.describe("Human role to revoke."),
  })
  .strict();

export const peopleDeleteInputSchema = z
  .object({ id: personIdSchema })
  .strict();

export const peopleDeleteOutputSchema = z.object({
  id: personIdSchema,
  deleted: z.literal(true),
});

export type Person = z.infer<typeof personSchema>;
export type PersonDetail = z.infer<typeof personDetailSchema>;
export type PersonRole = z.infer<typeof personRoleSchema>;
export type PeopleCreateInput = z.infer<typeof peopleCreateInputSchema>;
export type PeopleUpdateInput = z.infer<typeof peopleUpdateInputSchema>;
export type PeopleGetInput = z.infer<typeof peopleGetInputSchema>;
export type PeopleListInput = z.infer<typeof peopleListInputSchema>;
export type PeopleListOutput = z.infer<typeof peopleListOutputSchema>;
export type GuardianLinkCreateInput = z.infer<
  typeof guardianLinkCreateInputSchema
>;
export type GuardianLink = z.infer<typeof guardianLinkSchema>;
export type GuardianLinksListInput = z.infer<
  typeof guardianLinksListInputSchema
>;
export type GuardianLinksListOutput = z.infer<
  typeof guardianLinksListOutputSchema
>;
export type PeopleRoleGrantInput = z.infer<
  typeof peopleRoleGrantInputSchema
>;
export type PeopleRoleRevokeInput = z.infer<
  typeof peopleRoleRevokeInputSchema
>;
export type PeopleDeleteInput = z.infer<typeof peopleDeleteInputSchema>;
export type PeopleDeleteOutput = z.infer<typeof peopleDeleteOutputSchema>;
