# Agent migration notes

Migration `0001_agent_init.sql` creates the agent-owned conversation and
message history. Migration `0002_job_runs.sql` adds one explicit lifecycle row
per autonomous invocation, linked one-to-one to its summary conversation.
Terminal run rows and run identity fields are immutable; rows cannot be
deleted. Migration `0003_conversation_titles.sql` adds a nullable display title
so autonomous summaries such as `今日简报` are recognizable; interactive
conversations remain untitled.

Apply locally with:

```sh
pnpm --filter @h2class/agent db:migrate:local
```

Autonomous jobs require `OPENAI_MODEL` in addition to the existing
OpenAI-compatible endpoint/key and core service token. The model id is not a
secret; the API key and core token remain Wrangler secrets.
