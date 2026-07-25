PRAGMA foreign_keys=OFF;--> statement-breakpoint
CREATE TABLE `__new_attendance` (
	`lesson_id` text NOT NULL,
	`student_id` text NOT NULL,
	`status` text NOT NULL,
	`checked_in_at` integer,
	`checked_out_at` integer,
	`picked_up_by` text,
	`marked_by` text NOT NULL,
	FOREIGN KEY (`lesson_id`) REFERENCES `lesson`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`student_id`) REFERENCES `person`(`id`) ON UPDATE no action ON DELETE no action,
	CONSTRAINT "attendance_status_check" CHECK("__new_attendance"."status" in ('present', 'absent', 'excused_leave', 'late_cancel')),
	CONSTRAINT "attendance_checkout_check" CHECK(("__new_attendance"."checked_out_at" is null and "__new_attendance"."picked_up_by" is null) or ("__new_attendance"."checked_out_at" is not null and "__new_attendance"."picked_up_by" is not null)),
	CONSTRAINT "attendance_checkout_present_check" CHECK("__new_attendance"."checked_out_at" is null or "__new_attendance"."status" = 'present')
);
--> statement-breakpoint
INSERT INTO `__new_attendance`("lesson_id", "student_id", "status", "checked_in_at", "checked_out_at", "picked_up_by", "marked_by") SELECT "lesson_id", "student_id", "status", "checked_in_at", "checked_out_at", "picked_up_by", "marked_by" FROM `attendance`;--> statement-breakpoint
DROP TABLE `attendance`;--> statement-breakpoint
ALTER TABLE `__new_attendance` RENAME TO `attendance`;--> statement-breakpoint
PRAGMA foreign_keys=ON;--> statement-breakpoint
CREATE UNIQUE INDEX `attendance_lesson_student_unique` ON `attendance` (`lesson_id`,`student_id`);--> statement-breakpoint
CREATE INDEX `attendance_student_id_idx` ON `attendance` (`student_id`);--> statement-breakpoint
CREATE TRIGGER `attendance_target_insert`
BEFORE INSERT ON `attendance`
WHEN NOT EXISTS (
	SELECT 1
	FROM `enrollment`
	INNER JOIN `lesson` ON `lesson`.`id` = `enrollment`.`lesson_id`
	WHERE `enrollment`.`lesson_id` = NEW.`lesson_id`
		AND `enrollment`.`student_id` = NEW.`student_id`
		AND `lesson`.`status` = 'scheduled'
)
AND NOT EXISTS (
	SELECT 1
	FROM `attendance`
	WHERE `attendance`.`lesson_id` = NEW.`lesson_id`
		AND `attendance`.`student_id` = NEW.`student_id`
)
BEGIN
	SELECT RAISE(ABORT, 'invalid_attendance_target');
END;--> statement-breakpoint
CREATE TRIGGER `attendance_core_immutable`
BEFORE UPDATE OF `lesson_id`, `student_id`, `status`, `checked_in_at`, `marked_by` ON `attendance`
BEGIN
	SELECT RAISE(ABORT, 'attendance_core_immutable');
END;--> statement-breakpoint
CREATE TRIGGER `deduction_policy_no_delete`
BEFORE DELETE ON `deduction_policy`
BEGIN
	SELECT RAISE(ABORT, 'deduction_policy_required');
END;--> statement-breakpoint
CREATE TRIGGER `credit_ledger_attendance_integrity`
BEFORE INSERT ON `credit_ledger`
WHEN NEW.`kind` = 'attendance'
  AND (
    NEW.`delta` != -1
    OR NEW.`lesson_id` IS NULL
    OR EXISTS (
      SELECT 1
      FROM `lesson`
      WHERE `lesson`.`id` = NEW.`lesson_id`
        AND `lesson`.`makeup_for_lesson_id` IS NOT NULL
    )
    OR NOT EXISTS (
      SELECT 1
      FROM `attendance`
      INNER JOIN `deduction_policy`
        ON `deduction_policy`.`attendance_status` = `attendance`.`status`
       AND `deduction_policy`.`deducts` = 1
      WHERE `attendance`.`lesson_id` = NEW.`lesson_id`
        AND `attendance`.`student_id` = NEW.`student_id`
    )
  )
BEGIN
	SELECT RAISE(ABORT, 'invalid_attendance_ledger_entry');
END;--> statement-breakpoint
CREATE TRIGGER `enrollment_attendance_freeze_insert`
BEFORE INSERT ON `enrollment`
WHEN EXISTS (
	SELECT 1 FROM `attendance` WHERE `attendance`.`lesson_id` = NEW.`lesson_id`
)
BEGIN
	SELECT RAISE(ABORT, 'attendance_roster_locked');
END;--> statement-breakpoint
CREATE TRIGGER `enrollment_attendance_freeze_delete`
BEFORE DELETE ON `enrollment`
WHEN EXISTS (
	SELECT 1 FROM `attendance` WHERE `attendance`.`lesson_id` = OLD.`lesson_id`
)
BEGIN
	SELECT RAISE(ABORT, 'attendance_roster_locked');
END;--> statement-breakpoint
CREATE TRIGGER `lesson_attendance_completion_guard`
BEFORE UPDATE OF `status` ON `lesson`
WHEN OLD.`status` = 'scheduled'
	AND NEW.`status` = 'completed'
	AND (
		(SELECT COUNT(*) FROM `attendance` WHERE `attendance`.`lesson_id` = OLD.`id`) = 0
		OR (SELECT COUNT(*) FROM `attendance` WHERE `attendance`.`lesson_id` = OLD.`id`)
			!= (SELECT COUNT(*) FROM `enrollment` WHERE `enrollment`.`lesson_id` = OLD.`id`)
	)
BEGIN
	SELECT RAISE(ABORT, 'attendance_roster_mismatch');
END;--> statement-breakpoint
CREATE TRIGGER `lesson_attendance_history_lock`
BEFORE UPDATE OF `start_at`, `end_at`, `status` ON `lesson`
WHEN EXISTS (
	SELECT 1 FROM `attendance` WHERE `attendance`.`lesson_id` = OLD.`id`
)
	AND (
		NEW.`start_at` != OLD.`start_at`
		OR NEW.`end_at` != OLD.`end_at`
		OR (
			NEW.`status` != OLD.`status`
			AND NOT (OLD.`status` = 'scheduled' AND NEW.`status` = 'completed')
		)
	)
BEGIN
	SELECT RAISE(ABORT, 'attendance_history_locked');
END;
