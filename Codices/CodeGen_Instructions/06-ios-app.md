# 06 — iOS app (`apps/ios`) — milestone 4+

Native SwiftUI app for **teachers** (the admin can use it too). Its one critical job: check-in / check-out after a lesson — the highest-frequency action in the system. Everything else is convenience.

## Stack

- SwiftUI, iOS 17+, Swift concurrency (`async/await`), `URLSession` — no third-party dependencies.
- Auth: better-auth bearer token, stored in **Keychain** (never UserDefaults). Login screen → token → attach `Authorization: Bearer …` in one shared `APIClient` actor.
- Models are hand-written Swift `Codable` structs mirroring `packages/shared` schemas (iOS can't consume TS; keep field names identical to the JSON wire format, snake_case handled via `CodingKeys` or a decoder strategy).
- Config: API base URL in a build setting / xcconfig, not hardcoded.

## Screens (build in this order)

1. **Login.**
2. **今日课程** — the teacher's lessons today (core: `GET /my/teaching-schedule?date=today`), grouped by time, each showing enrolled students and attendance state.
3. **签到 (check-in sheet)** — the core flow: for one lesson, list enrolled students with a status picker per student (出勤 / 缺勤 / 请假 / 迟到取消), then ONE submit → `POST /lessons/:id/attendance` with all students' statuses. The server applies the deduction policy and writes everything atomically — the app never computes deductions and never submits per-student.
4. **本周课表** — week view, read-only.
5. **课后反馈** (when the feature lands) — free-text bullet points per lesson; the agent turns them into polished parent messages server-side.

## Rules

- Timezone: display in Asia/Shanghai regardless of device setting; send timestamps as ISO-8601 UTC.
- Online-only v1: if a submit fails, keep the sheet's local state and show a retry button — do NOT build an offline queue.
- A teacher sees only their own schedule (server enforces; the app just calls `/my/...` endpoints).
- On 401: clear Keychain token, return to login.
- Attendance submit must be idempotent-safe on retry: send the server-provided `lesson_id` + statuses; the server rejects duplicates cleanly — surface its error message, don't auto-merge.
