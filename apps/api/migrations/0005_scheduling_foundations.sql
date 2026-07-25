CREATE TABLE `availability_exception` (
	`teacher_id` text NOT NULL,
	`date` text NOT NULL,
	`available` integer NOT NULL,
	`start_min` integer,
	`end_min` integer,
	FOREIGN KEY (`teacher_id`) REFERENCES `person`(`id`) ON UPDATE no action ON DELETE cascade,
	CONSTRAINT "availability_exception_available_check" CHECK("availability_exception"."available" in (0, 1)),
	CONSTRAINT "availability_exception_time_check" CHECK(("availability_exception"."start_min" is null and "availability_exception"."end_min" is null) or ("availability_exception"."start_min" >= 0 and "availability_exception"."start_min" < "availability_exception"."end_min" and "availability_exception"."end_min" <= 1440))
);
--> statement-breakpoint
CREATE UNIQUE INDEX `availability_exception_teacher_date_unique` ON `availability_exception` (`teacher_id`,`date`);--> statement-breakpoint
CREATE TABLE `closure_day` (
	`date` text NOT NULL,
	`reason` text NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `closure_day_date_unique` ON `closure_day` (`date`);--> statement-breakpoint
CREATE TABLE `teacher_availability` (
	`teacher_id` text NOT NULL,
	`weekday` integer NOT NULL,
	`start_min` integer NOT NULL,
	`end_min` integer NOT NULL,
	FOREIGN KEY (`teacher_id`) REFERENCES `person`(`id`) ON UPDATE no action ON DELETE cascade,
	CONSTRAINT "teacher_availability_weekday_check" CHECK("teacher_availability"."weekday" between 0 and 6),
	CONSTRAINT "teacher_availability_time_check" CHECK("teacher_availability"."start_min" >= 0 and "teacher_availability"."start_min" < "teacher_availability"."end_min" and "teacher_availability"."end_min" <= 1440)
);
--> statement-breakpoint
CREATE UNIQUE INDEX `teacher_availability_slot_unique` ON `teacher_availability` (`teacher_id`,`weekday`,`start_min`,`end_min`);--> statement-breakpoint
CREATE TABLE `term` (
	`id` text PRIMARY KEY NOT NULL,
	`name` text NOT NULL,
	`start_date` text NOT NULL,
	`end_date` text NOT NULL,
	CONSTRAINT "term_date_range_check" CHECK("term"."start_date" <= "term"."end_date")
);
--> statement-breakpoint
CREATE INDEX `term_start_date_idx` ON `term` (`start_date`);