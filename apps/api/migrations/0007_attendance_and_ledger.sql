CREATE TABLE `attendance` (
	`lesson_id` text NOT NULL,
	`student_id` text NOT NULL,
	`status` text NOT NULL,
	`checked_in_at` integer,
	`checked_out_at` integer,
	`picked_up_by` text,
	`marked_by` text NOT NULL,
	FOREIGN KEY (`lesson_id`) REFERENCES `lesson`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`student_id`) REFERENCES `person`(`id`) ON UPDATE no action ON DELETE no action,
	CONSTRAINT "attendance_status_check" CHECK("attendance"."status" in ('present', 'absent', 'excused_leave', 'late_cancel'))
);
--> statement-breakpoint
CREATE UNIQUE INDEX `attendance_lesson_student_unique` ON `attendance` (`lesson_id`,`student_id`);--> statement-breakpoint
CREATE INDEX `attendance_student_id_idx` ON `attendance` (`student_id`);--> statement-breakpoint
CREATE TABLE `credit_ledger` (
	`id` text PRIMARY KEY NOT NULL,
	`student_id` text NOT NULL,
	`entitlement_id` text,
	`delta` integer NOT NULL,
	`kind` text NOT NULL,
	`lesson_id` text,
	`reason` text NOT NULL,
	`created_by` text NOT NULL,
	`created_at` integer NOT NULL,
	FOREIGN KEY (`student_id`) REFERENCES `person`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`lesson_id`) REFERENCES `lesson`(`id`) ON UPDATE no action ON DELETE no action,
	CONSTRAINT "credit_ledger_delta_check" CHECK("credit_ledger"."delta" != 0 and typeof("credit_ledger"."delta") = 'integer'),
	CONSTRAINT "credit_ledger_kind_check" CHECK("credit_ledger"."kind" in ('purchase', 'attendance', 'adjustment', 'refund')),
	CONSTRAINT "credit_ledger_reason_check" CHECK(length(trim("credit_ledger"."reason")) > 0)
);
--> statement-breakpoint
CREATE INDEX `credit_ledger_student_created_at_idx` ON `credit_ledger` (`student_id`,`created_at`);--> statement-breakpoint
CREATE INDEX `credit_ledger_entitlement_id_idx` ON `credit_ledger` (`entitlement_id`);--> statement-breakpoint
CREATE INDEX `credit_ledger_lesson_id_idx` ON `credit_ledger` (`lesson_id`);--> statement-breakpoint
CREATE TRIGGER `credit_ledger_no_update`
BEFORE UPDATE ON `credit_ledger`
BEGIN
	SELECT RAISE(ABORT, 'credit_ledger_immutable');
END;--> statement-breakpoint
CREATE TRIGGER `credit_ledger_no_delete`
BEFORE DELETE ON `credit_ledger`
BEGIN
	SELECT RAISE(ABORT, 'credit_ledger_immutable');
END;--> statement-breakpoint
CREATE TABLE `deduction_policy` (
	`attendance_status` text PRIMARY KEY NOT NULL,
	`deducts` integer NOT NULL,
	CONSTRAINT "deduction_policy_status_check" CHECK("deduction_policy"."attendance_status" in ('present', 'absent', 'excused_leave', 'late_cancel')),
	CONSTRAINT "deduction_policy_deducts_check" CHECK("deduction_policy"."deducts" in (0, 1))
);--> statement-breakpoint
INSERT INTO `deduction_policy` (`attendance_status`, `deducts`) VALUES
	('present', 1),
	('absent', 1),
	('excused_leave', 0),
	('late_cancel', 1);
