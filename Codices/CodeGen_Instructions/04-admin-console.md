# 04 — Admin console (`apps/admin`) — milestone 3+

The owner/staff SPA. React + Vite + TypeScript, deployed as a static site (Cloudflare Pages). UI language: **Simplified Chinese**. This is where the owner lives — the chat is the primary surface, forms are the fallback.

## Stack & conventions

- Dependencies (do not add beyond these without approval): `react`, `react-dom`, `react-router-dom`, `@tanstack/react-query`, `tailwindcss`. Component style: small function components, co-located per view; no state library — server state via React Query, local state via hooks.
- API access: two bases from env — `VITE_CORE_URL`, `VITE_AGENT_URL` — plus the selected vendor model id in `VITE_AGENT_MODEL`. Bearer token from better-auth login, held in memory + localStorage; attach via a single `fetchJson` helper typed from `@h2class/shared` (never hand-type response shapes).
- All times displayed in Asia/Shanghai; all money displayed from integer fen (分).

## Views (build in this order)

1. **Login** — email/phone + password against core (better-auth). On 401 anywhere, drop to login.
2. **Chat** (primary) — conversation list + thread with the agent:
   - Stream from `POST {AGENT}/v1/chat/completions` using OpenAI-compatible SSE chunks. Render text deltas live and do not expose raw tool JSON.
   - **Pending-action cards** inline when the agent proposes: human summary + expandable exact payload + 确认/拒绝 buttons → core `POST /pending-actions/:id/execute` (or reject). Disable after action; show result state.
3. **Drafts queue (待发消息)** — list of `message_draft` rows: contact name, purpose, text, 复制 button (clipboard), 已发送 button (marks sent via core). Unsent items sorted oldest-first, badge count in nav.
4. **Pending actions (待确认)** — same cards as chat, listed; badge count in nav.
5. **People / Lessons / Calendar** — plain tables + forms as the manual fallback; week calendar for lessons (no drag-drop needed v1).
6. **Activity log** — read-only table, filter by actor/date.

## Rules

- The console never computes business results client-side (no balance math, no conflict checks) — display what core returns.
- Confirm buttons call core directly with the *owner's* token (that's the whole security model — the agent can't execute, the owner can).
- Handle 403 distinctly from 401: 403 = "你没有权限执行此操作", not a logout.
- Empty/loading/error states for every list; Chinese labels; no toast spam — inline states preferred.
