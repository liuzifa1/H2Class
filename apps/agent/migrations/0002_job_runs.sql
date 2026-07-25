PRAGMA foreign_keys = ON;

CREATE TABLE job_run (
  id TEXT PRIMARY KEY NOT NULL,
  job_name TEXT NOT NULL,
  cron TEXT NOT NULL,
  conversation_id TEXT NOT NULL UNIQUE
    REFERENCES conversation(id) ON DELETE RESTRICT,
  status TEXT NOT NULL
    CHECK (status IN ('running', 'completed', 'partial', 'failed')),
  scheduled_at INTEGER NOT NULL,
  started_at INTEGER NOT NULL DEFAULT (unixepoch()),
  finished_at INTEGER,
  iteration_count INTEGER NOT NULL DEFAULT 0 CHECK (iteration_count >= 0),
  finish_reason TEXT,
  summary_text TEXT,
  metrics_json TEXT NOT NULL DEFAULT '{}',
  error_code TEXT,
  CHECK (
    (status = 'running' AND finished_at IS NULL)
    OR (status <> 'running' AND finished_at IS NOT NULL)
  )
);

CREATE INDEX job_run_name_scheduled_idx
  ON job_run (job_name, scheduled_at DESC);
CREATE INDEX job_run_status_scheduled_idx
  ON job_run (status, scheduled_at DESC);

CREATE TRIGGER job_run_identity_immutable
BEFORE UPDATE ON job_run
WHEN NEW.id <> OLD.id
  OR NEW.job_name <> OLD.job_name
  OR NEW.cron <> OLD.cron
  OR NEW.conversation_id <> OLD.conversation_id
  OR NEW.scheduled_at <> OLD.scheduled_at
  OR NEW.started_at <> OLD.started_at
BEGIN
  SELECT RAISE(ABORT, 'job_run_identity_immutable');
END;

CREATE TRIGGER job_run_terminal_immutable
BEFORE UPDATE ON job_run
WHEN OLD.status <> 'running'
BEGIN
  SELECT RAISE(ABORT, 'job_run_terminal_immutable');
END;

CREATE TRIGGER job_run_no_delete
BEFORE DELETE ON job_run
BEGIN
  SELECT RAISE(ABORT, 'job_run_delete_forbidden');
END;
