-- Milestone 1: activity log (ARCHITECTURE.md §3.8) — written first so every
-- later module's writes are audited from day one.
CREATE TABLE `activity_log` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`actor` text NOT NULL,
	`action` text NOT NULL,
	`entity` text,
	`entity_id` text,
	`summary` text,
	`created_at` integer NOT NULL
);
--> statement-breakpoint
CREATE INDEX `activity_log_created_at_idx` ON `activity_log` (`created_at`);
