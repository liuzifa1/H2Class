-- Milestone 2: people, human roles, and guardian-to-student links.
CREATE TABLE `person` (
	`id` text PRIMARY KEY NOT NULL,
	`auth_user_id` text,
	`name` text NOT NULL,
	`phone` text,
	`school` text,
	`grade` text,
	`notes` text,
	`created_at` integer NOT NULL,
	FOREIGN KEY (`auth_user_id`) REFERENCES `user`(`id`) ON UPDATE no action ON DELETE set null
);
--> statement-breakpoint
CREATE UNIQUE INDEX `person_auth_user_id_unique` ON `person` (`auth_user_id`);
--> statement-breakpoint
-- Preserve every existing auth identity and its M2-1 role assignments. Auth
-- ids are UUIDs, so reusing them as the initial person ids preserves the role
-- keys while auth moves to person.auth_user_id.
INSERT INTO `person` (`id`, `auth_user_id`, `name`, `phone`, `school`, `grade`, `notes`, `created_at`)
SELECT `id`, `id`, `name`, NULL, NULL, NULL, NULL, `created_at` FROM `user`;
--> statement-breakpoint
PRAGMA foreign_keys=OFF;
--> statement-breakpoint
CREATE TABLE `__new_person_role` (
	`person_id` text NOT NULL,
	`role` text NOT NULL,
	PRIMARY KEY(`person_id`, `role`),
	FOREIGN KEY (`person_id`) REFERENCES `person`(`id`) ON UPDATE no action ON DELETE cascade,
	CONSTRAINT "person_role_role_check" CHECK("__new_person_role"."role" in ('admin', 'staff', 'teacher', 'guardian'))
);
--> statement-breakpoint
INSERT INTO `__new_person_role` (`person_id`, `role`)
SELECT `person_id`, `role` FROM `person_role`;
--> statement-breakpoint
DROP TABLE `person_role`;
--> statement-breakpoint
ALTER TABLE `__new_person_role` RENAME TO `person_role`;
--> statement-breakpoint
PRAGMA foreign_keys=ON;
--> statement-breakpoint
CREATE INDEX `person_role_person_id_idx` ON `person_role` (`person_id`);
--> statement-breakpoint
CREATE TABLE `guardian_student` (
	`guardian_id` text NOT NULL,
	`student_id` text NOT NULL,
	`created_at` integer NOT NULL,
	FOREIGN KEY (`guardian_id`) REFERENCES `person`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`student_id`) REFERENCES `person`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `guardian_student_pair_unique` ON `guardian_student` (`guardian_id`,`student_id`);
--> statement-breakpoint
CREATE INDEX `guardian_student_student_id_idx` ON `guardian_student` (`student_id`);
