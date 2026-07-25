# H2Class deployment manual

This project deploys entirely to Cloudflare:

| Component | Cloudflare product | Suggested hostname |
|---|---|---|
| `apps/api` | Worker + D1 database `h2class` | `api.example.com` |
| `apps/agent` | Worker + D1 database `h2class-agent` + Cron Triggers | `agent.example.com` |
| `apps/admin` | Pages | `admin.example.com` |
| `apps/web` | Pages | `app.example.com` |

Replace `example.com` and all example vendor values below with real values.
The Worker and Pages-generated `*.workers.dev` and `*.pages.dev` addresses can
be used instead of custom domains for an initial test.

## 1. Prerequisites

- A Cloudflare account. The Workers paid plan is recommended because password
  hashing needs more CPU and paid D1 retains Time Travel history for longer.
- A domain added to Cloudflare, if custom hostnames are wanted.
- Node.js 22 and pnpm 10.20.0.
- An API key, base URL, and model ID from an OpenAI-compatible model provider.
- For automatic Pages deployment, a GitHub or GitLab repository containing
  this project. Manual Pages deployment does not require a Git remote.

Install and validate the project before touching production:

```sh
pnpm install --frozen-lockfile
pnpm typecheck
pnpm --filter @h2class/agent test
pnpm build:admin
pnpm build:web
```

Log in to the Cloudflare account:

```sh
pnpm --filter @h2class/api exec wrangler login
```

## 2. Prepare the two production D1 databases

Create the core database:

```sh
pnpm --filter @h2class/api exec wrangler d1 create h2class
```

Copy the printed `database_id` into `apps/api/wrangler.jsonc`, replacing the
all-zero placeholder.

Create the agent database:

```sh
pnpm --filter @h2class/agent exec wrangler d1 create h2class-agent
```

Copy that `database_id` into `apps/agent/wrangler.jsonc`, also replacing its
all-zero placeholder. Do not exchange the two IDs; the databases have separate
schemas and responsibilities.

Apply every migration:

```sh
pnpm db:migrate:remote
pnpm db:migrate:agent:remote
```

Check that nothing is still pending:

```sh
pnpm --filter @h2class/api exec wrangler d1 migrations list h2class --remote
pnpm --filter @h2class/agent exec wrangler d1 migrations list h2class-agent --remote
```

## 3. Configure production variables

### Core API

Add this top-level block to `apps/api/wrangler.jsonc` (beside
`d1_databases`), using the real Pages/custom origins:

```jsonc
"vars": {
  "CLIENT_ORIGINS": "https://admin.example.com,https://app.example.com"
}
```

Values must be origins only: scheme plus hostname, with no path. If the
`*.pages.dev` sites will also be used, add both of those exact origins to this
comma-separated value. The browser clients will fail CORS checks if their
origins are absent.

### Agent Worker

Replace the placeholder entries already in `apps/agent/wrangler.jsonc`:

```jsonc
"vars": {
  "CORE_API_URL": "https://api.example.com",
  "OPENAI_BASE_URL": "https://your-model-provider.example/v1",
  "OPENAI_MODEL": "your-provider-model-id",
  "AGENT_DISABLED": "0"
}
```

`OPENAI_BASE_URL` normally includes the provider's `/v1` prefix. The model
must support OpenAI-compatible Chat Completions and function/tool calling.
`OPENAI_MODEL` is used by scheduled jobs; the admin site also sends a model ID
for interactive chat.

Keep these non-secret values in Wrangler configuration so a later
`wrangler deploy` does not accidentally restore localhost or placeholder
settings.

## 4. Deploy and initialize the core API

Deploy the Worker:

```sh
pnpm deploy:api
```

Create two independent random secrets and store them in a password manager:

```sh
openssl rand -base64 32
openssl rand -hex 32
```

Use the first value as `BETTER_AUTH_SECRET`. Use the second value as both the
core's `AGENT_SERVICE_TOKEN` and the agent's `CORE_API_TOKEN`. Enter values only
at Wrangler's hidden prompts:

```sh
pnpm --filter @h2class/api exec wrangler secret put BETTER_AUTH_SECRET
pnpm --filter @h2class/api exec wrangler secret put AGENT_SERVICE_TOKEN
```

Do not reuse the Better Auth secret as the service token.

Attach `api.example.com` in Cloudflare Dashboard:

1. Open **Workers & Pages** and select `h2class-api`.
2. Open **Settings > Domains & Routes**.
3. Choose **Add > Custom Domain** and enter `api.example.com`.

Cloudflare creates the required DNS record and certificate. If the hostname
already has a CNAME, remove or move that conflicting record first.

Create the first owner account after migrations have completed:

```sh
pnpm --filter @h2class/api seed:admin:remote -- \
  --email owner@example.com \
  --name Owner
```

The command prompts for the password without displaying it. Use a unique,
strong password. Running the seed again with the same email will fail rather
than overwrite the existing owner.

Verify the API and database:

```sh
curl --fail-with-body https://api.example.com/health
curl -i https://api.example.com/me
```

The first command should return `"status":"ok"` and a reachable database.
The unauthenticated `/me` request should return HTTP 401; that is expected.

## 5. Deploy the agent Worker

Make sure `CORE_API_URL` in `apps/agent/wrangler.jsonc` is the now-working API
URL, then deploy:

```sh
pnpm deploy:agent
```

Set the model key and the service token. `CORE_API_TOKEN` must be exactly the
same random value entered as the core's `AGENT_SERVICE_TOKEN`:

```sh
pnpm --filter @h2class/agent exec wrangler secret put OPENAI_API_KEY
pnpm --filter @h2class/agent exec wrangler secret put CORE_API_TOKEN
```

Attach `agent.example.com` to `h2class-agent` through **Settings > Domains &
Routes > Add > Custom Domain**, in the same way as the API.

Verify it:

```sh
curl --fail-with-body https://agent.example.com/health
```

The result should show all of these as `true`:

- `modelApiKeyConfigured`
- `jobModelConfigured`
- `coreTokenConfigured`
- `coreReachable`

The three cron schedules in `apps/agent/wrangler.jsonc` deploy with the Worker.
They are UTC schedules corresponding to daily 07:00 and 21:00 Asia/Shanghai,
and Friday 17:00 Asia/Shanghai.

## 6. Deploy the two Pages sites

### Recommended: Git integration

First commit this project and push it to GitHub or GitLab. Then create two
Cloudflare Pages projects connected to the same repository. Leave the root
directory at the repository root.

Use these build settings for the admin project:

| Setting | Value |
|---|---|
| Project name | `h2class-admin` |
| Production branch | `main` |
| Build command | `pnpm build:admin` |
| Build output directory | `apps/admin/dist` |
| `NODE_VERSION` | `22` |
| `PNPM_VERSION` | `10.20.0` |
| `VITE_CORE_URL` | `https://api.example.com` |
| `VITE_AGENT_URL` | `https://agent.example.com` |
| `VITE_AGENT_MODEL` | the interactive model ID |

Use these settings for the guardian web project:

| Setting | Value |
|---|---|
| Project name | `h2class-web` |
| Production branch | `main` |
| Build command | `pnpm build:web` |
| Build output directory | `apps/web/dist` |
| `NODE_VERSION` | `22` |
| `PNPM_VERSION` | `10.20.0` |
| `VITE_CORE_URL` | `https://api.example.com` |

The `VITE_*` values are public build-time configuration, not secrets. Never
put API keys or service tokens into a `VITE_*` variable. A change to any of
these values requires a new Pages build.

Attach `admin.example.com` to `h2class-admin` and `app.example.com` to
`h2class-web` in each Pages project's **Custom domains** settings.

### Alternative: direct upload from this computer

Build with production URLs embedded in the bundles:

```sh
VITE_CORE_URL=https://api.example.com \
VITE_AGENT_URL=https://agent.example.com \
VITE_AGENT_MODEL=your-provider-model-id \
pnpm build:admin

VITE_CORE_URL=https://api.example.com pnpm build:web
```

Create the Pages projects once:

```sh
pnpm --filter @h2class/api exec wrangler pages project create h2class-admin \
  --production-branch main
pnpm --filter @h2class/api exec wrangler pages project create h2class-web \
  --production-branch main
```

Upload the built folders. These paths are relative to `apps/api`, where the
workspace's installed Wrangler command runs:

```sh
pnpm --filter @h2class/api exec wrangler pages deploy ../admin/dist \
  --project-name h2class-admin --branch main
pnpm --filter @h2class/api exec wrangler pages deploy ../web/dist \
  --project-name h2class-web --branch main
```

Direct Upload is manual. If automatic deployments may be wanted later, start
with Git integration instead; Cloudflare does not convert an existing Direct
Upload Pages project into a Git-integrated project.

## 7. End-to-end acceptance check

1. Open `https://admin.example.com` in a private browser window.
2. Sign in with the seeded owner email and password.
3. Confirm that the People, Drafts, Pending Actions, and Chat screens load.
4. Send a harmless read-only chat message such as “今天有什么课程？” and
   confirm that streamed text appears.
5. Create a guardian/student test record in the admin console and provision a
   guardian login if that workflow is being launched.
6. Open `https://app.example.com`, sign in as the test guardian, and confirm
   that only linked-student information is visible.
7. Check both Workers under **Observability > Logs** for unexpected errors.

If browser calls fail but direct `curl` calls work, check `CLIENT_ORIGINS`
first. It must contain the exact origin currently displayed in the browser.

## 8. Normal production updates

Before every release:

```sh
pnpm install --frozen-lockfile
pnpm typecheck
pnpm --filter @h2class/agent test
pnpm build:admin
pnpm build:web
```

When new migration files exist, capture the current D1 Time Travel bookmarks,
then apply migrations before deploying code that requires them:

```sh
pnpm --filter @h2class/api exec wrangler d1 time-travel info h2class
pnpm --filter @h2class/agent exec wrangler d1 time-travel info h2class-agent
pnpm db:migrate:remote
pnpm db:migrate:agent:remote
pnpm deploy:api
pnpm deploy:agent
```

Git-integrated Pages sites rebuild after the push to the production branch.
For Direct Upload, repeat the production build and `pages deploy` commands in
section 6.

## 9. Logs, rollback, backup, and emergency stop

Stream live Worker logs from two terminals:

```sh
pnpm --filter @h2class/api exec wrangler tail
pnpm --filter @h2class/agent exec wrangler tail
```

Worker and Pages code can be rolled back from each project's **Deployments**
screen in the Cloudflare dashboard.

D1 Time Travel is automatically enabled; it is not a dashboard switch. Record
bookmarks before migrations. A restore overwrites the live database, so inspect
the target time carefully and use the Cloudflare-documented `d1 time-travel
restore` command only during a deliberate recovery. For retention beyond Time
Travel's window, schedule D1 exports to R2 or another protected storage system.

To stop autonomous and interactive AI work without taking the core system
offline, set `AGENT_DISABLED` to `"1"` in `apps/agent/wrangler.jsonc` and run:

```sh
pnpm deploy:agent
```

For a stronger agent kill switch, replace the core's `AGENT_SERVICE_TOKEN`
with a new random value. The existing agent then loses all core API access. Do
not update `CORE_API_TOKEN` until access should be restored.

## 10. Common failures

| Symptom | Likely cause | Fix |
|---|---|---|
| D1 binding or database error | Placeholder/wrong `database_id` | Put the matching D1 ID in each Wrangler file and redeploy |
| Admin says service URL is not configured | Missing Pages `VITE_CORE_URL` or `VITE_AGENT_URL` | Set the build variables and rebuild Pages |
| Browser CORS error | Current Pages origin absent from `CLIENT_ORIGINS` | Add the exact origin and redeploy the API |
| Agent health says `coreReachable: false` | `CORE_API_URL` is still localhost, DNS is not ready, or API is down | Correct the URL, confirm `/health`, and redeploy the agent |
| Agent returns `agent_not_configured` | Missing model key, core token, base URL, or model | Set the variables/secrets and redeploy |
| Agent gets 401 from the core | `CORE_API_TOKEN` differs from `AGENT_SERVICE_TOKEN` | Enter the same service-token value on both Workers |
| Chat works manually but cron jobs fail | `OPENAI_MODEL` missing/invalid | Set it in the agent's Wrangler `vars` and redeploy |
| SPA route refresh returns 404 | `_redirects` missing from Pages output | Confirm `apps/*/public/_redirects` is present, rebuild, and redeploy |
| Login fails immediately after first deploy | Migrations/admin seed/secrets incomplete | Apply migrations, set `BETTER_AUTH_SECRET`, and seed the owner |

## 11. Cloudflare references

- [D1 migration commands](https://developers.cloudflare.com/workers/wrangler/commands/d1/)
- [D1 Time Travel and backups](https://developers.cloudflare.com/d1/reference/time-travel/)
- [Workers custom domains](https://developers.cloudflare.com/workers/configuration/routing/custom-domains/)
- [Pages monorepo configuration](https://developers.cloudflare.com/pages/configuration/monorepos/)
- [Pages Git integration](https://developers.cloudflare.com/pages/get-started/git-integration/)
- [Pages direct upload](https://developers.cloudflare.com/pages/get-started/direct-upload/)
