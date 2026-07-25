# Migration notes

Migration `0002_auth.sql` creates Better Auth's core tables and temporarily
links roles to auth users. Migration `0003_people.sql` creates a person for
each existing auth user, moves `person_role` to the person foreign key, and
adds guardian-to-student links.

## Worker secrets

Set independent secrets for Better Auth and the agent kill switch. Do not reuse
one value for both:

```sh
openssl rand -base64 32 | pnpm --filter @h2class/api exec wrangler secret put BETTER_AUTH_SECRET
openssl rand -hex 32 | pnpm --filter @h2class/api exec wrangler secret put AGENT_SERVICE_TOKEN
```

For local development, put both values in `apps/api/.dev.vars` (gitignored).
Clients send the agent token as `Authorization: Bearer <token>`.

Set the non-secret `CLIENT_ORIGINS` Worker variable to the comma-separated
production admin- and guardian-SPA origins (origins only, with no path).
`ADMIN_ORIGINS` remains a backwards-compatible alias and is combined with
`CLIENT_ORIGINS`. Local API requests automatically trust ports 5173 and 5174
on both `localhost` and `127.0.0.1` while the API itself is running locally.

## One-off admin seed

Apply the migrations first, then run exactly one of these commands:

```sh
pnpm --filter @h2class/api seed:admin:local -- --email owner@example.com --name Owner
pnpm --filter @h2class/api seed:admin:remote -- --email owner@example.com --name Owner
```

The script reads the password from a hidden prompt, hashes it with Better
Auth's default scrypt implementation, and sends only the hash to D1. It never
accepts the password as a command-line argument or writes it to disk.

## Catalog price versions

Migration `0004_catalog.sql` stores amounts as integer fen and installs
database triggers that reject every `UPDATE` or `DELETE` against `price`.
Changing a price always means inserting a new version with its own
`effective_from` timestamp.

## Scheduling foundations

Migration `0005_scheduling_foundations.sql` adds teacher weekly availability,
dated availability exceptions, unique closure dates, and term date bounds.
Weekday/minute fields and calendar dates are Asia/Shanghai-local; future
lesson instants remain UTC epoch values.

## Lessons and message drafts

Migration `0006_lessons_and_drafts.sql` adds lessons, unique lesson/student
enrollments, and the outbound message-draft queue. Lesson instants are UTC
epochs. Exact teacher starts and enrollment pairs are unique; write-time SQLite
triggers reject teacher/student overlaps and capacity overflow from inside the
same batched write that inserts lesson notification drafts.

D1 has no interactive transactions, so service pre-checks cannot lock the later
write. The triggers are the authoritative race-safe check: their error aborts
the complete `db.batch()` rather than leaving a lesson without its drafts.

## Attendance and append-only credits

Migration `0007_attendance_and_ledger.sql` adds unique attendance rows, the
seeded deduction policy, and the append-only credit ledger. Database triggers
reject every ledger update or delete. Migration
`0008_ledger_attendance_integrity.sql` prevents duplicate attendance deductions,
invalid deduction shapes, and deductions against makeup lessons.
Migration `0009_attendance_integrity.sql` preserves attendance history when a
lesson is removed and enforces enrollment, lesson-status, checkout, and policy
integrity at write time. Once any attendance exists, SQLite triggers freeze that
lesson's enrollment roster; bulk check-in completes the lesson in the same batch.

Attendance services decide deductions with conditional `INSERT ... SELECT`
statements against `deduction_policy` inside the same D1 batch as attendance
and guardian drafts, so policy edits cannot race between a read and write.

## Pending actions

Migration `0010_pending_actions.sql` stores canonical validated owner-only
payloads for one hour. An internal immutable resolution-claim row serializes
execute versus reject. The claim, prepared owner-only mutation, result JSON,
and final action status commit in one D1 batch, so failed target writes leave
the proposal pending and concurrent resolution cannot execute it twice.

## Lesson feedback and pickup safety

Migration `0011_feedback_and_pickup.sql` adds one feedback row per
lesson/student pair, authorized pickup people, and the sensitive
`person.medical_notes` column. Feedback inserts are restricted to enrolled
students. The service writes each feedback row and its linked-guardian raw
drafts in one D1 batch.

Authorized pickup names are unique per student. Normal checkout conditionally
updates attendance only when no pickup list exists or the supplied name is on
the current list. An unregistered name requires the separately audited,
admin-only checkout-override endpoint.

## Entitlements and payments

Migration `0012_entitlements_and_payments.sql` adds class packages,
trusteeship subscriptions, and append-only payment/refund rows. Each payment
references the exact immutable price version. Database triggers enforce the
price/class, guardian/student, amount, one-sale/one-refund, and refund-quote
relationships; payment and ledger rows cannot be updated or deleted.

The migration rebuilds `credit_ledger` only to add the nullable entitlement
foreign key, then explicitly recreates every prior index and immutability or
attendance-integrity trigger. Existing rows with `entitlement_id IS NULL` are
preserved as legacy history; there is no safe automatic backfill because an
old deduction does not identify which package paid for it. Every new
non-trusteeship deduction selects the oldest matching active positive-balance
package in the attendance batch. Trusteeship check-in/out requires an active
subscription covering the lesson's Asia/Shanghai date and creates no ledger
deduction.

Once any entitlement references a class type, a database trigger prevents
moving that type across the `托管`/non-`托管` boundary. This keeps the sold
entitlement kind and all later attendance behavior consistent; edits between
the two non-`托管` categories remain allowed.

Purchase and refund services expose prepared mutation plans so direct admin
requests and confirmed pending actions execute identical atomic writes. A
package refund is quoted as
`floor(original_paid_amount_fen * remaining_credits / credits_total)`; stale
expected values return 409. Subscription refunds and zero-paid purchases are
not supported in v1. The proportional floor is calculated with exact integer
arithmetic. Package purchase is rejected when its worst-case refund
multiplication would exceed JavaScript's exact-integer range, and the payment
trigger enforces the same bound for direct database writes.

## Teacher rates, reports, and bulk apply

Migration `0013_teacher_rates.sql` adds immutable teacher/class-type rate
versions keyed by `(teacher_id, class_type_id, effective_from)`. Rate amounts
are safe integer fen and effective instants are UTC epoch integers. Database
triggers require the teacher role on insert and reject every update or delete;
changing a rate always inserts a new effective version.

Teacher settlement is derived at read time. One lesson counts once when any
student attendance row is `present`, and its rate is the latest version whose
`effective_from` is not later than that lesson's start. A missing version stays
`null` with `rateMissing: true`; `total_fen` sums rated items only and
`incomplete` warns that the value is not a final settlement. Settlement reads
the historical lesson teacher as a person rather than requiring their current
teacher role; new rate versions still require that current role in both the
service and database. Income, balances,
and daily digest data are likewise pure reads over payment, ledger, attendance,
lesson, draft, and pending-action source rows. Signed money and report totals
are accumulated with exact integer arithmetic and rejected if they cannot be
represented safely in the JSON contract.

Owner-only `lessons_bulk_apply` accepts a bounded list of explicit single
lessons. It prepares all lesson, enrollment, and Chinese message-draft inserts
as one D1 batch and is wired through the pending-action dispatcher. Friendly
pre-checks cannot lock D1; the existing lesson/enrollment conflict and capacity
triggers remain authoritative inside the batch, so any race or conflict rolls
back the entire proposal.
