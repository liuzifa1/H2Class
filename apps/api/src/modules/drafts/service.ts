import type {
  DraftsCreateInput,
  DraftsListInput,
  DraftsListOutput,
  DraftsMarkSentInput,
  MessageDraft,
} from "@h2class/shared";
import { and, asc, eq } from "drizzle-orm";
import { drizzle } from "drizzle-orm/d1";
import type { Principal } from "../../auth/types";
import { messageDraft, person } from "../../db/schema";

type Database = ReturnType<typeof drizzle>;
type DraftsErrorCode = "draft_not_found" | "person_not_found";

export type DraftsServiceError = {
  kind: "drafts_service_error";
  code: DraftsErrorCode;
  status: 404;
};

const fail = (code: DraftsErrorCode): never => {
  throw { kind: "drafts_service_error", code, status: 404 } satisfies DraftsServiceError;
};

export const isDraftsServiceError = (
  error: unknown,
): error is DraftsServiceError => {
  if (typeof error !== "object" || error === null) return false;
  return Reflect.get(error, "kind") === "drafts_service_error";
};

const draftColumns = {
  id: messageDraft.id,
  personId: messageDraft.personId,
  purpose: messageDraft.purpose,
  text: messageDraft.text,
  status: messageDraft.status,
  createdAt: messageDraft.createdAt,
  sentAt: messageDraft.sentAt,
};

type DraftRow = {
  id: string;
  personId: string;
  purpose: string;
  text: string;
  status: "draft" | "sent";
  createdAt: Date;
  sentAt: Date | null;
};

const serializeDraft = (row: DraftRow): MessageDraft => ({
  ...row,
  createdAt: row.createdAt.toISOString(),
  sentAt: row.sentAt?.toISOString() ?? null,
});

const loadDraft = async (db: Database, id: string): Promise<DraftRow> => {
  const [row] = await db
    .select(draftColumns)
    .from(messageDraft)
    .where(eq(messageDraft.id, id));
  if (row === undefined) return fail("draft_not_found");
  return row;
};

export const createDraft = async (
  d1: D1Database,
  _principal: Principal,
  input: DraftsCreateInput,
): Promise<MessageDraft> => {
  const db = drizzle(d1);
  const [recipient] = await db
    .select({ id: person.id })
    .from(person)
    .where(eq(person.id, input.personId));
  if (recipient === undefined) fail("person_not_found");

  const id = crypto.randomUUID();
  const createdAt = new Date(Math.floor(Date.now() / 1_000) * 1_000);
  await db.insert(messageDraft).values({
    id,
    ...input,
    status: "draft",
    createdAt,
    sentAt: null,
  });
  return {
    id,
    ...input,
    status: "draft",
    createdAt: createdAt.toISOString(),
    sentAt: null,
  };
};

export const listDrafts = async (
  d1: D1Database,
  _principal: Principal,
  input: DraftsListInput,
): Promise<DraftsListOutput> => {
  const rows = await drizzle(d1)
    .select(draftColumns)
    .from(messageDraft)
    .where(
      and(
        input.personId === undefined
          ? undefined
          : eq(messageDraft.personId, input.personId),
        input.purpose === undefined
          ? undefined
          : eq(messageDraft.purpose, input.purpose),
        input.status === undefined
          ? undefined
          : eq(messageDraft.status, input.status),
      ),
    )
    .orderBy(asc(messageDraft.status), asc(messageDraft.createdAt), asc(messageDraft.id));
  return { drafts: rows.map(serializeDraft) };
};

export const markDraftSent = async (
  d1: D1Database,
  _principal: Principal,
  input: DraftsMarkSentInput,
): Promise<MessageDraft> => {
  const db = drizzle(d1);
  const existing = await loadDraft(db, input.id);
  if (existing.status === "sent") return serializeDraft(existing);
  const sentAt = new Date(Math.floor(Date.now() / 1_000) * 1_000);
  await db
    .update(messageDraft)
    .set({ status: "sent", sentAt })
    .where(eq(messageDraft.id, input.id));
  return serializeDraft({ ...existing, status: "sent", sentAt });
};
