# 05 — Parent web client (`apps/web`) — milestone 6

Read-mostly SPA for guardians (parents). Same stack and conventions as the admin console (brief 04) minus the chat/agent parts. UI language: Simplified Chinese, mobile-first layout (parents open it from WeChat's built-in browser).

## Views

1. **Login** — guardian credentials (accounts are created by the owner; no self-signup).
2. **孩子概览** — per linked child: upcoming lessons (next 2 weeks), remaining credits (from core's balance endpoint — never computed client-side), subscription validity.
3. **考勤记录** — attendance history with statuses (出勤/缺勤/请假/迟到取消), trusteeship check-in/out times.
4. **课后反馈** — lesson feedback entries returned by the guardian-scoped feedback endpoint.

## Rules

- **Scoping is server-side**: this app only ever calls guardian-scoped endpoints (`/my/...`), which core filters to the authenticated guardian's linked students. The client obtains children from `/my/students`; none of the other `/my/...` requests accept a student id.
- No write operations in v1 except (later) a leave request (请假) form — everything else is display.
- Keep the bundle small: no UI framework beyond Tailwind, no charts library (simple lists/tables).
- Handle token expiry gracefully — parents will open this weeks apart; silent redirect to login, no error wall.
