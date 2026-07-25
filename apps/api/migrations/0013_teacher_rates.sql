CREATE TABLE `teacher_rate` (
	`teacher_id` text NOT NULL,
	`class_type_id` text NOT NULL,
	`rate_fen` integer NOT NULL,
	`effective_from` integer NOT NULL,
	FOREIGN KEY (`teacher_id`) REFERENCES `person`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`class_type_id`) REFERENCES `class_type`(`id`) ON UPDATE no action ON DELETE no action,
	CONSTRAINT "teacher_rate_fen_check" CHECK("teacher_rate"."rate_fen" >= 0 and "teacher_rate"."rate_fen" <= 9007199254740991 and typeof("teacher_rate"."rate_fen") = 'integer'),
	CONSTRAINT "teacher_rate_effective_from_check" CHECK(typeof("teacher_rate"."effective_from") = 'integer')
);
--> statement-breakpoint
CREATE UNIQUE INDEX `teacher_rate_version_unique` ON `teacher_rate` (`teacher_id`,`class_type_id`,`effective_from`);--> statement-breakpoint
CREATE INDEX `teacher_rate_class_type_id_idx` ON `teacher_rate` (`class_type_id`);--> statement-breakpoint
CREATE TRIGGER `teacher_rate_teacher_role_guard`
BEFORE INSERT ON `teacher_rate`
WHEN NOT EXISTS (
	SELECT 1 FROM `person_role`
	WHERE `person_role`.`person_id` = NEW.`teacher_id`
		AND `person_role`.`role` = 'teacher'
)
BEGIN
	SELECT RAISE(ABORT, 'teacher_role_required');
END;--> statement-breakpoint
CREATE TRIGGER `teacher_rate_no_update`
BEFORE UPDATE ON `teacher_rate`
BEGIN
	SELECT RAISE(ABORT, 'teacher_rate_immutable');
END;--> statement-breakpoint
CREATE TRIGGER `teacher_rate_no_delete`
BEFORE DELETE ON `teacher_rate`
BEGIN
	SELECT RAISE(ABORT, 'teacher_rate_immutable');
END;
