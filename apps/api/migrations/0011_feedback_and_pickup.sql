ALTER TABLE `person` ADD `medical_notes` text;--> statement-breakpoint
CREATE TABLE `lesson_feedback` (
	`lesson_id` text NOT NULL,
	`student_id` text NOT NULL,
	`content_covered` text NOT NULL,
	`homework` text NOT NULL,
	`performance_note` text NOT NULL,
	`created_by` text NOT NULL,
	`created_at` integer NOT NULL,
	FOREIGN KEY (`lesson_id`) REFERENCES `lesson`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`student_id`) REFERENCES `person`(`id`) ON UPDATE no action ON DELETE no action,
	CONSTRAINT `lesson_feedback_text_check` CHECK(length(trim(`content_covered`)) > 0 and length(trim(`homework`)) > 0 and length(trim(`performance_note`)) > 0)
);--> statement-breakpoint
CREATE UNIQUE INDEX `lesson_feedback_lesson_student_unique` ON `lesson_feedback` (`lesson_id`,`student_id`);--> statement-breakpoint
CREATE INDEX `lesson_feedback_student_created_at_idx` ON `lesson_feedback` (`student_id`,`created_at`);--> statement-breakpoint
CREATE TRIGGER `lesson_feedback_target_insert`
BEFORE INSERT ON `lesson_feedback`
WHEN NOT EXISTS (
	SELECT 1
	FROM `enrollment`
	WHERE `enrollment`.`lesson_id` = NEW.`lesson_id`
		AND `enrollment`.`student_id` = NEW.`student_id`
)
BEGIN
	SELECT RAISE(ABORT, 'student_not_enrolled');
END;--> statement-breakpoint
CREATE TABLE `pickup_person` (
	`student_id` text NOT NULL,
	`name` text NOT NULL,
	`phone` text NOT NULL,
	`relation` text NOT NULL,
	FOREIGN KEY (`student_id`) REFERENCES `person`(`id`) ON UPDATE no action ON DELETE cascade,
	CONSTRAINT `pickup_person_text_check` CHECK(length(trim(`name`)) > 0 and length(trim(`phone`)) > 0 and length(trim(`relation`)) > 0)
);--> statement-breakpoint
CREATE UNIQUE INDEX `pickup_person_student_name_unique` ON `pickup_person` (`student_id`,`name`);--> statement-breakpoint
CREATE INDEX `pickup_person_student_id_idx` ON `pickup_person` (`student_id`);--> statement-breakpoint
CREATE TRIGGER `attendance_checkout_once`
BEFORE UPDATE OF `checked_out_at`, `picked_up_by` ON `attendance`
WHEN OLD.`checked_out_at` IS NOT NULL OR OLD.`picked_up_by` IS NOT NULL
BEGIN
	SELECT RAISE(ABORT, 'already_checked_out');
END;
