CREATE TABLE `pending_action` (
	`id` text PRIMARY KEY NOT NULL,
	`endpoint_name` text NOT NULL,
	`payload_json` text NOT NULL,
	`summary` text NOT NULL,
	`status` text DEFAULT 'pending' NOT NULL,
	`created_by` text NOT NULL,
	`created_at` integer NOT NULL,
	`expires_at` integer NOT NULL,
	`resolved_by` text,
	`resolved_at` integer,
	`result_json` text,
	CONSTRAINT "pending_action_status_check" CHECK("pending_action"."status" in ('pending', 'executed', 'rejected', 'expired')),
	CONSTRAINT "pending_action_time_check" CHECK("pending_action"."expires_at" > "pending_action"."created_at"),
	CONSTRAINT "pending_action_resolution_check" CHECK(("pending_action"."status" in ('pending', 'expired') and "pending_action"."resolved_by" is null and "pending_action"."resolved_at" is null) or ("pending_action"."status" in ('executed', 'rejected') and "pending_action"."resolved_by" is not null and "pending_action"."resolved_at" is not null))
);--> statement-breakpoint
CREATE INDEX `pending_action_status_created_at_idx` ON `pending_action` (`status`,`created_at`);--> statement-breakpoint
CREATE INDEX `pending_action_expires_at_idx` ON `pending_action` (`expires_at`);--> statement-breakpoint
CREATE TABLE `pending_action_resolution` (
	`pending_action_id` text PRIMARY KEY NOT NULL,
	`claimed_at` integer NOT NULL,
	FOREIGN KEY (`pending_action_id`) REFERENCES `pending_action`(`id`) ON UPDATE no action ON DELETE cascade
);--> statement-breakpoint
CREATE TRIGGER `pending_action_claim_expired`
BEFORE INSERT ON `pending_action_resolution`
WHEN EXISTS (
	SELECT 1 FROM `pending_action`
	WHERE `pending_action`.`id` = NEW.`pending_action_id`
		AND `pending_action`.`status` = 'pending'
		AND `pending_action`.`expires_at` <= unixepoch()
)
BEGIN
	SELECT RAISE(ABORT, 'pending_action_expired');
END;--> statement-breakpoint
CREATE TRIGGER `pending_action_claim_not_pending`
BEFORE INSERT ON `pending_action_resolution`
WHEN NOT EXISTS (
	SELECT 1 FROM `pending_action`
	WHERE `pending_action`.`id` = NEW.`pending_action_id`
		AND `pending_action`.`status` = 'pending'
)
BEGIN
	SELECT RAISE(ABORT, 'pending_action_not_pending');
END;--> statement-breakpoint
CREATE TRIGGER `pending_action_resolution_no_update`
BEFORE UPDATE ON `pending_action_resolution`
BEGIN
	SELECT RAISE(ABORT, 'pending_action_resolution_immutable');
END;--> statement-breakpoint
CREATE TRIGGER `pending_action_resolution_no_delete`
BEFORE DELETE ON `pending_action_resolution`
BEGIN
	SELECT RAISE(ABORT, 'pending_action_resolution_immutable');
END;
