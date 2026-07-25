CREATE TABLE `enrollment` (
	`lesson_id` text NOT NULL,
	`student_id` text NOT NULL,
	FOREIGN KEY (`lesson_id`) REFERENCES `lesson`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`student_id`) REFERENCES `person`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE UNIQUE INDEX `enrollment_lesson_student_unique` ON `enrollment` (`lesson_id`,`student_id`);--> statement-breakpoint
CREATE INDEX `enrollment_student_id_idx` ON `enrollment` (`student_id`);--> statement-breakpoint
CREATE TABLE `lesson` (
	`id` text PRIMARY KEY NOT NULL,
	`class_type_id` text NOT NULL,
	`teacher_id` text NOT NULL,
	`start_at` integer NOT NULL,
	`end_at` integer NOT NULL,
	`status` text DEFAULT 'scheduled' NOT NULL,
	`makeup_for_lesson_id` text,
	`term_id` text,
	`created_at` integer NOT NULL,
	FOREIGN KEY (`class_type_id`) REFERENCES `class_type`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`teacher_id`) REFERENCES `person`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`makeup_for_lesson_id`) REFERENCES `lesson`(`id`) ON UPDATE no action ON DELETE set null,
	FOREIGN KEY (`term_id`) REFERENCES `term`(`id`) ON UPDATE no action ON DELETE set null,
	CONSTRAINT "lesson_time_range_check" CHECK("lesson"."start_at" < "lesson"."end_at"),
	CONSTRAINT "lesson_status_check" CHECK("lesson"."status" in ('scheduled', 'completed', 'cancelled'))
);
--> statement-breakpoint
CREATE UNIQUE INDEX `lesson_teacher_start_unique` ON `lesson` (`teacher_id`,`start_at`) WHERE "lesson"."status" != 'cancelled';--> statement-breakpoint
CREATE INDEX `lesson_range_idx` ON `lesson` (`start_at`,`end_at`);--> statement-breakpoint
CREATE INDEX `lesson_teacher_range_idx` ON `lesson` (`teacher_id`,`start_at`,`end_at`);--> statement-breakpoint
CREATE TABLE `message_draft` (
	`id` text PRIMARY KEY NOT NULL,
	`person_id` text NOT NULL,
	`purpose` text NOT NULL,
	`text` text NOT NULL,
	`status` text DEFAULT 'draft' NOT NULL,
	`created_at` integer NOT NULL,
	`sent_at` integer,
	FOREIGN KEY (`person_id`) REFERENCES `person`(`id`) ON UPDATE no action ON DELETE no action,
	CONSTRAINT "message_draft_status_check" CHECK("message_draft"."status" in ('draft', 'sent')),
	CONSTRAINT "message_draft_sent_at_check" CHECK(("message_draft"."status" = 'draft' and "message_draft"."sent_at" is null) or ("message_draft"."status" = 'sent' and "message_draft"."sent_at" is not null))
);
--> statement-breakpoint
CREATE INDEX `message_draft_status_created_at_idx` ON `message_draft` (`status`,`created_at`);--> statement-breakpoint
CREATE INDEX `message_draft_person_id_idx` ON `message_draft` (`person_id`);--> statement-breakpoint
CREATE TRIGGER `lesson_teacher_conflict_insert`
BEFORE INSERT ON `lesson`
WHEN NEW.`status` != 'cancelled'
  AND EXISTS (
    SELECT 1
    FROM `lesson` AS existing
    WHERE existing.`teacher_id` = NEW.`teacher_id`
      AND existing.`status` != 'cancelled'
      AND existing.`start_at` < NEW.`end_at`
      AND existing.`end_at` > NEW.`start_at`
  )
BEGIN
  SELECT RAISE(ABORT, 'teacher_conflict');
END;--> statement-breakpoint
CREATE TRIGGER `lesson_teacher_conflict_update`
BEFORE UPDATE OF `teacher_id`, `start_at`, `end_at`, `status` ON `lesson`
WHEN NEW.`status` != 'cancelled'
  AND EXISTS (
    SELECT 1
    FROM `lesson` AS existing
    WHERE existing.`id` != NEW.`id`
      AND existing.`teacher_id` = NEW.`teacher_id`
      AND existing.`status` != 'cancelled'
      AND existing.`start_at` < NEW.`end_at`
      AND existing.`end_at` > NEW.`start_at`
  )
BEGIN
  SELECT RAISE(ABORT, 'teacher_conflict');
END;--> statement-breakpoint
CREATE TRIGGER `lesson_student_conflict_update`
BEFORE UPDATE OF `start_at`, `end_at`, `status` ON `lesson`
WHEN NEW.`status` != 'cancelled'
  AND EXISTS (
    SELECT 1
    FROM `enrollment` AS moving
    INNER JOIN `enrollment` AS other_enrollment
      ON other_enrollment.`student_id` = moving.`student_id`
     AND other_enrollment.`lesson_id` != NEW.`id`
    INNER JOIN `lesson` AS other_lesson
      ON other_lesson.`id` = other_enrollment.`lesson_id`
    WHERE moving.`lesson_id` = NEW.`id`
      AND other_lesson.`status` != 'cancelled'
      AND other_lesson.`start_at` < NEW.`end_at`
      AND other_lesson.`end_at` > NEW.`start_at`
  )
BEGIN
  SELECT RAISE(ABORT, 'student_conflict');
END;--> statement-breakpoint
CREATE TRIGGER `enrollment_student_conflict_insert`
BEFORE INSERT ON `enrollment`
WHEN EXISTS (
  SELECT 1
  FROM `lesson` AS target
  INNER JOIN `enrollment` AS existing_enrollment
    ON existing_enrollment.`student_id` = NEW.`student_id`
  INNER JOIN `lesson` AS existing_lesson
    ON existing_lesson.`id` = existing_enrollment.`lesson_id`
  WHERE target.`id` = NEW.`lesson_id`
    AND target.`status` != 'cancelled'
    AND existing_lesson.`status` != 'cancelled'
    AND existing_lesson.`start_at` < target.`end_at`
    AND existing_lesson.`end_at` > target.`start_at`
)
BEGIN
  SELECT RAISE(ABORT, 'student_conflict');
END;--> statement-breakpoint
CREATE TRIGGER `enrollment_capacity_insert`
BEFORE INSERT ON `enrollment`
WHEN EXISTS (
  SELECT 1
  FROM `lesson`
  INNER JOIN `class_type`
    ON class_type.`id` = lesson.`class_type_id`
  WHERE lesson.`id` = NEW.`lesson_id`
    AND (
      SELECT COUNT(*)
      FROM `enrollment`
      WHERE enrollment.`lesson_id` = NEW.`lesson_id`
    ) >= class_type.`capacity`
)
BEGIN
  SELECT RAISE(ABORT, 'class_full');
END;
