# H2Class — System Architecture

Class arrangement & logging system for a small K12 tutoring / trusteeship (托管) business.

## 1. Overview

```
┌────────────┐  ┌────────────┐  ┌────────────┐  ┌───────────────┐
│ Web client │  │   Admin    │  │  iOS app   │  │ Agent service │
│  (Pages)   │  │  console   │  │ (SwiftUI)  │  │ (Claude loop) │
└─────┬──────┘  └─────┬──────┘  └─────┬──────┘  └───────┬───────┘
      └───────────────┴───────┬───────┴─────────────────┘
                              │  HTTPS + JSON, bearer tokens
                              ▼
                    ┌──────────────────────┐
                    │       Core API       │   the only place with
                    │  auth · scheduling   │   business logic and
                    │  attendance · ledger │   data access
                    └──────────┬───────────┘
                               ▼
                    ┌──────────────────────┐
                    │      PostgreSQL      │   single source of truth
                    └──────────────────────┘
```

Principles:

- **One core backend.** All business logic and all data access live in a single API service ("core module"). Every other process — web, admin, iOS, **and the agent** — is a client of it.
- **Static frontends.** The web client (and preferably the admin console) are static SPAs served from Pages (CDN). No SSR unless a page needs SEO — nothing behind a login does.
- **One API for every client.** Web, admin, iOS, and the agent all consume the same JSON API. No client-specific backends, no agent back door.
- **Boring infrastructure.** No microservices, queues, or Kubernetes. One core service + one thin agent client + one database splits cleanly later if the business ever outgrows it.

## 2. Components

### 2.1 API backend ("root server")

- JSON over HTTPS, bearer-token auth (`Authorization` header — avoids cross-origin cookie/CORS pain since frontends live on a different origin than `api.<domain>`).
- Owns: authentication & roles, scheduling, attendance, entitlements & ledger, payments/income, pricing, activity log.
- Stateless — safe to restart/redeploy anytime; all state in PostgreSQL.

### 2.2 Web client

- Static SPA deployed to Pages (Cloudflare/GitHub Pages).
- Audience: parents/guardians — view schedule, remaining credits, subscription validity, attendance history.

### 2.3 Admin console

- Audience: owner/staff — everything in §4.
- Preferred: static SPA on Pages (same deployment model as web client, `/admin` route or `admin.` subdomain). SSR buys nothing behind a login; if Next.js is used anyway, it stays a thin frontend calling the API — no business logic in it.

### 2.4 iOS app

- SwiftUI, native. Audience: teachers (and optionally staff).
- Core job: check-in / check-out after class — the highest-frequency action in the system.
- Token stored in Keychain. Same API as web.

### 2.5 Agent service ("agentic module")

- Separate small service (`apps/agent`) that operates the system **through the public core API, like any other client** — service-account token, role `agent`, zero business logic, core data only via endpoints (its own tables hold only conversations/run state). Owner-only endpoints (money, deletions) return 403 to its token; it proposes those as pending actions the owner confirms in the console. Full design: [AGENT.md](AGENT.md).

### 2.6 Message drafts queue

- No WeChat automation. The owner relays WeChat manually; the assistant writes every outbound message into a **drafts queue** in the admin console (copy → paste → mark sent), populated transactionally by the services. The queue's consumer is swappable by design, should an automated channel ever be wanted.

### 2.7 Database

- PostgreSQL, managed (Railway / Fly.io / Render / Supabase) for automatic backups.
- This database holds money-equivalent credits — **daily backups from day one**.

## 3. Domain model

### 3.1 People

- Single `person` table + role assignments (admin, staff, teacher, student, guardian) — not one table per type.
- `guardian_student` link table (a parent with two enrolled kids = one person, two links).

### 3.2 Catalog & pricing

- `class_type`: name, capacity (1v1, 1v2, group…), duration.
- `price`: **versioned** — new price = new row with effective date. Never edit a price in place; every sale references the exact price row it was sold at, so historical income never silently changes.

### 3.3 Entitlements — the two billing models

Both are "something a payment buys that attendance consumes". A student can hold both at once.

| | Class package | Trusteeship subscription |
|---|---|---|
| Buys | N class credits | A validity date range |
| Consumed by | Lesson check-in → ledger deduction | Daily check-in/out within range |
| Runs out | Credits reach 0 (or expiry date) | `valid_to` passes |
| Renewal signal | Low-balance threshold | Approaching `valid_to` |

### 3.4 Credit ledger — append-only, never a counter

Do **not** store `remaining_classes = 7` and mutate it. Store immutable entries:

```
+20  package purchase        2026-03-01  (payment #123)
 -1  attended: Math 1v1      2026-03-08  (lesson #456, marked by teacher A)
 +1  adjustment: makeup      2026-03-10  (by admin B, reason: "teacher sick 3/8")
```

Balance = SUM. Benefits: every parent dispute is answerable, refunds and corrections are explicit new entries (not scary mutations), and the audit trail is the data itself.

### 3.5 Scheduling

- `lesson`: class_type, teacher, start/end time (+ room if needed).
- `enrollment`: student ↔ lesson (a 1v4 group lesson = 1 lesson row, 4 enrollments).
- Conflict detection on create/update: teacher double-booked, student double-booked.

### 3.6 Attendance

- Check-in/check-out = timestamped **events** recording who marked them, not booleans.
- Lesson attendance statuses: present, absent, excused leave (请假), late cancel.
- **Which statuses deduct a credit is a configurable policy, not hardcoded.** This rule changes as the business evolves and is the #1 source of parent disputes.
- Group check-in is one atomic transaction: one teacher action fans out to N attendance records + N ledger deductions, each under its own policy (one kid excused, three present). 1v1 is the trivial case of this.
- Trusteeship: daily check-in/out events, validated against an active subscription range. (Later: notify parents on check-in/out via SMS / WeChat template message.)

### 3.7 Payments & income

- `payment` table is the **only** source of income truth. A scheduled lesson is not income; a payment is.
- Reports (income by month / teacher / class type, outstanding balances, credits outstanding) are queries over payments + ledger — no separate bookkeeping.

### 3.8 Activity log

- API middleware appends `(actor, action, entity, entity_id, timestamp, summary)` to an audit table on every write.
- Built in from day one — retrofitting later loses the early history permanently.

### 3.9 K12-specific additions

Beyond the core, features a K12 tutoring/托管 business needs. Priority tags: **[v1]** design into the schema now (cheap now, painful to retrofit), **[v1.5]** soon after launch, **[later]** when it hurts.

| Feature | What it is | Priority |
|---|---|---|
| **Lesson feedback 课后反馈** | After each lesson the teacher records: content covered, homework assigned, performance note. The agent polishes bullet points into a parent-ready message → drafts queue. Parents judge the center by this. | **[v1]** |
| **Teacher pay 课时费** | Per-teacher (× class-type) hourly/lesson rates; monthly settlement report derived from attendance records — who taught what is already captured, so payroll is nearly free. Rates versioned like prices. | **[v1]** |
| **Holiday & term calendar** | Center closure days (public holidays, 寒暑假 breaks) that recurring schedules must skip; **terms** (春季班/秋季班/寒假班/暑假班) grouping seasonal group-class offerings with start/end dates. Touches the scheduling generator — decide now. | **[v1]** |
| **Makeup linkage 补课** | `lesson.makeup_for_lesson_id` so a makeup never double-deducts credits. One column. | **[v1]** |
| **Pickup & safety 接送** | Authorized pickup persons per student; check-out records *who* picked up; allergy/medical notes; incident log. Core duty of trusteeship. | **[v1]** (托管) |
| **Academic profile 学情** | School, grade, textbook edition (人教/北师大…), subjects, weak points, exam scores over time. Starts as a few fields on student; feeds agent context for arranging and renewal conversations. | **[v1]** fields, grow later |
| **Leads & trials 试听** | Lead records (source, status: 咨询→试听→报名/流失, follow-up notes + next-contact date); trial lesson type (no entitlement needed); conversion tracking. Owner pastes WeChat inquiries; agent manages follow-up reminders. | **[v1.5]** |
| **Discounts & receipts** | Discount recorded on the sale (list price stays versioned); printable payment receipt. | **[v1.5]** |
| **Arrears 欠费** | Policy: allow negative balance or block booking; arrears report + agent nagging. | **[v1.5]** |
| **Referral 老带新** | `referred_by` on person/lead — source attribution for the cheapest growth channel. One field. | **[v1.5]** |
| **Rooms 教室** | Room capacity + conflict checks in scheduling. Skip while single-room. | **[later]** |
| **Homework tracking** | Assigned/completed per lesson, beyond the feedback note. | **[later]** |
| **Waitlist** | For full group classes. | **[later]** |

**Compliance notes (China):**
- **PIPL / minors' data**: student data is sensitive personal information — record guardian consent at enrollment, collect the minimum, restrict photo storage/sharing to explicit consent, and delete on request. Design the consent record in v1.
- **Refunds**: 教培 refund disputes are regulated and common — the ledger + versioned prices already make "remaining value" computable; encode the refund formula as policy, not ad-hoc math.
- **双减 positioning** (subject tutoring restrictions for compulsory-education ages) is a business/licensing matter, not a software feature — but keep `class_type` labeling flexible (素质类/托管/学科) so reporting can follow whatever positioning you operate under.

## 4. Feature → module map

| Feature | Module |
|---|---|
| User authentication | Auth & roles |
| Arrange student's class + teacher | Scheduling |
| Check-in & check-out | Attendance |
| Remaining class calculation | Credit ledger (derived) |
| Trusteeship subscription management | Entitlements |
| Price setting | Catalog & pricing (versioned) |
| 1v1 / 1v2 / group settings | Catalog (`class_type`) |
| Income | Payments & reports |
| People management | People |
| Activity log | Audit middleware |
| Lesson feedback / teacher pay / terms / pickup (§3.9) | Attendance · Reports · Scheduling · People — no new top-level modules |
| Leads & trials (§3.9) | New small `crm` module |

## 5. Auth

- Roles: admin/owner, staff, teacher, guardian (student optional as login).
- Email/phone + password. Bearer tokens for all clients; iOS stores in Keychain.
- No OAuth/SSO — not needed at this scale.
- Open v1 question: do parents get real logins, or is a read-only link / push notification enough? This decides most of the web client's auth scope.

## 6. Deployment

- API: one small VPS with Docker, or a PaaS (Railway / Fly.io / Render).
- Frontends: Pages (CDN), deploy on push.
- Database: managed PostgreSQL, daily automated backups verified periodically.
- Environments: local + production is enough to start; add staging when it hurts.

## 7. Deliberately out of scope (until needed)

- Microservices, message queues, Redis, Kubernetes.
- SSR / SEO work (nothing public-facing yet).
- Multi-center / multi-tenant support — but keep IDs and queries clean so a `center_id` column can be added later without archaeology.

## 8. AI assistant layer

The agent (Claude API + tool use, §2.5) is the **primary operating interface**: the owner runs the business by chatting with it in the admin console (typed or pasted from WeChat), and it executes every function — sign-ups, arranging, rescheduling, renewals, follow-ups — by calling the same public API the forms use. Guarantee by construction: agent tools are generated from the shared endpoint schemas, so every new endpoint is agent-operable the day it ships. Money-moving and destructive actions are **authorization-gated**: the agent's token gets 403 on those endpoints and can only file pending actions, which the owner one-click confirms (the stored payload executes deterministically, under the owner's authority). Outbound WeChat messages become drafts in a console queue (§2.6). Full design: [AGENT.md](AGENT.md) — the agent service starts at milestone 2 and grows with each milestone.

## 9. Open decisions

1. ~~Backend stack~~ — resolved: TypeScript + Fastify + Prisma + better-auth, see [TECH_STACK.md](TECH_STACK.md).
2. Parent login vs. read-only access in v1 (see §5).
3. Hosting region: if users are primarily in mainland China, swap Railway/Pages for Aliyun/Tencent Cloud (see TECH_STACK.md §1 note).
4. Notification channel for check-in/out and renewal reminders (SMS / WeChat / none in v1).
5. Absence/late-cancel deduction policy defaults (see §3.6).
