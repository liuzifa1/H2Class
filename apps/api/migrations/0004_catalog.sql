CREATE TABLE `class_type` (
	`id` text PRIMARY KEY NOT NULL,
	`name` text NOT NULL,
	`capacity` integer NOT NULL,
	`duration_min` integer NOT NULL,
	`category` text NOT NULL,
	`active` integer DEFAULT true NOT NULL,
	CONSTRAINT "class_type_capacity_check" CHECK("class_type"."capacity" > 0),
	CONSTRAINT "class_type_duration_min_check" CHECK("class_type"."duration_min" > 0),
	CONSTRAINT "class_type_category_check" CHECK("class_type"."category" in ('素质类', '托管', '学科'))
);
--> statement-breakpoint
CREATE TABLE `price` (
	`id` text PRIMARY KEY NOT NULL,
	`class_type_id` text NOT NULL,
	`unit_amount_fen` integer NOT NULL,
	`effective_from` integer NOT NULL,
	`created_at` integer NOT NULL,
	FOREIGN KEY (`class_type_id`) REFERENCES `class_type`(`id`) ON UPDATE no action ON DELETE no action,
	CONSTRAINT "price_unit_amount_fen_check" CHECK("price"."unit_amount_fen" >= 0 and typeof("price"."unit_amount_fen") = 'integer')
);
--> statement-breakpoint
CREATE INDEX `price_class_type_effective_from_idx` ON `price` (`class_type_id`,`effective_from`);
--> statement-breakpoint
CREATE TRIGGER `price_immutable_update`
BEFORE UPDATE ON `price`
BEGIN
	SELECT RAISE(ABORT, 'price_rows_are_immutable');
END;
--> statement-breakpoint
CREATE TRIGGER `price_immutable_delete`
BEFORE DELETE ON `price`
BEGIN
	SELECT RAISE(ABORT, 'price_rows_are_immutable');
END;
