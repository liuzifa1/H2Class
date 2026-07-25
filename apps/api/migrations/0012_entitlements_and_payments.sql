CREATE TABLE `entitlement` (
	`id` text PRIMARY KEY NOT NULL,
	`student_id` text NOT NULL,
	`kind` text NOT NULL,
	`class_type_id` text,
	`credits_total` integer,
	`valid_from` text,
	`valid_to` text,
	`price_id` text NOT NULL,
	`status` text DEFAULT 'active' NOT NULL,
	`created_at` integer NOT NULL,
	FOREIGN KEY (`student_id`) REFERENCES `person`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`class_type_id`) REFERENCES `class_type`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`price_id`) REFERENCES `price`(`id`) ON UPDATE no action ON DELETE no action,
	CONSTRAINT `entitlement_kind_check` CHECK(`kind` in ('package', 'subscription')),
	CONSTRAINT `entitlement_status_check` CHECK(`status` in ('active', 'exhausted', 'expired', 'refunded')),
	CONSTRAINT `entitlement_shape_check` CHECK((`kind` = 'package' and `class_type_id` is not null and `credits_total` > 0 and typeof(`credits_total`) = 'integer' and `valid_from` is null and `valid_to` is null) or (`kind` = 'subscription' and `class_type_id` is not null and `credits_total` is null and `valid_from` is not null and `valid_to` is not null and date(`valid_from`, '+0 days') is not null and date(`valid_to`, '+0 days') is not null and date(`valid_from`, '+0 days') = `valid_from` and date(`valid_to`, '+0 days') = `valid_to` and `valid_from` <= `valid_to`))
);--> statement-breakpoint
CREATE INDEX `entitlement_student_created_at_idx` ON `entitlement` (`student_id`,`created_at`);--> statement-breakpoint
CREATE INDEX `entitlement_student_kind_status_idx` ON `entitlement` (`student_id`,`kind`,`status`);--> statement-breakpoint
CREATE INDEX `entitlement_class_type_id_idx` ON `entitlement` (`class_type_id`);--> statement-breakpoint
CREATE INDEX `entitlement_price_id_idx` ON `entitlement` (`price_id`);--> statement-breakpoint
CREATE TABLE `payment` (
	`id` text PRIMARY KEY NOT NULL,
	`entitlement_id` text NOT NULL,
	`price_id` text NOT NULL,
	`guardian_id` text NOT NULL,
	`list_amount_fen` integer NOT NULL,
	`discount_fen` integer DEFAULT 0 NOT NULL,
	`paid_amount_fen` integer NOT NULL,
	`method` text NOT NULL,
	`receipt_no` text NOT NULL,
	`note` text,
	`created_by` text NOT NULL,
	`created_at` integer NOT NULL,
	FOREIGN KEY (`entitlement_id`) REFERENCES `entitlement`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`price_id`) REFERENCES `price`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`guardian_id`) REFERENCES `person`(`id`) ON UPDATE no action ON DELETE no action,
	CONSTRAINT `payment_amount_integer_check` CHECK(typeof(`list_amount_fen`) = 'integer' and typeof(`discount_fen`) = 'integer' and typeof(`paid_amount_fen`) = 'integer'),
	CONSTRAINT `payment_amount_identity_check` CHECK(`paid_amount_fen` = `list_amount_fen` - `discount_fen`),
	CONSTRAINT `payment_amount_sign_check` CHECK((`list_amount_fen` > 0 and `discount_fen` >= 0 and `discount_fen` < `list_amount_fen` and `paid_amount_fen` > 0) or (`list_amount_fen` < 0 and `discount_fen` <= 0 and `discount_fen` >= `list_amount_fen` and `paid_amount_fen` < 0)),
	CONSTRAINT `payment_method_check` CHECK(`method` in ('wechat', 'cash', 'other')),
	CONSTRAINT `payment_receipt_no_check` CHECK(length(trim(`receipt_no`)) > 0)
);--> statement-breakpoint
CREATE UNIQUE INDEX `payment_receipt_no_unique` ON `payment` (`receipt_no`);--> statement-breakpoint
CREATE UNIQUE INDEX `payment_entitlement_purchase_unique` ON `payment` (`entitlement_id`) WHERE `list_amount_fen` >= 0;--> statement-breakpoint
CREATE UNIQUE INDEX `payment_entitlement_refund_unique` ON `payment` (`entitlement_id`) WHERE `list_amount_fen` < 0;--> statement-breakpoint
CREATE INDEX `payment_guardian_created_at_idx` ON `payment` (`guardian_id`,`created_at`);--> statement-breakpoint
CREATE INDEX `payment_price_id_idx` ON `payment` (`price_id`);--> statement-breakpoint
PRAGMA foreign_keys=OFF;--> statement-breakpoint
CREATE TABLE `__new_credit_ledger` (
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
	FOREIGN KEY (`entitlement_id`) REFERENCES `entitlement`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`lesson_id`) REFERENCES `lesson`(`id`) ON UPDATE no action ON DELETE no action,
	CONSTRAINT `credit_ledger_delta_check` CHECK(`delta` != 0 and typeof(`delta`) = 'integer'),
	CONSTRAINT `credit_ledger_kind_check` CHECK(`kind` in ('purchase', 'attendance', 'adjustment', 'refund')),
	CONSTRAINT `credit_ledger_reason_check` CHECK(length(trim(`reason`)) > 0)
);--> statement-breakpoint
INSERT INTO `__new_credit_ledger` (`id`,`student_id`,`entitlement_id`,`delta`,`kind`,`lesson_id`,`reason`,`created_by`,`created_at`)
SELECT `id`,`student_id`,`entitlement_id`,`delta`,`kind`,`lesson_id`,`reason`,`created_by`,`created_at` FROM `credit_ledger`;--> statement-breakpoint
DROP TABLE `credit_ledger`;--> statement-breakpoint
ALTER TABLE `__new_credit_ledger` RENAME TO `credit_ledger`;--> statement-breakpoint
PRAGMA foreign_keys=ON;--> statement-breakpoint
CREATE INDEX `credit_ledger_student_created_at_idx` ON `credit_ledger` (`student_id`,`created_at`);--> statement-breakpoint
CREATE INDEX `credit_ledger_entitlement_id_idx` ON `credit_ledger` (`entitlement_id`);--> statement-breakpoint
CREATE INDEX `credit_ledger_lesson_id_idx` ON `credit_ledger` (`lesson_id`);--> statement-breakpoint
CREATE UNIQUE INDEX `credit_ledger_attendance_unique` ON `credit_ledger` (`lesson_id`,`student_id`) WHERE `kind` = 'attendance';--> statement-breakpoint
CREATE UNIQUE INDEX `credit_ledger_purchase_unique` ON `credit_ledger` (`entitlement_id`) WHERE `kind` = 'purchase';--> statement-breakpoint
CREATE UNIQUE INDEX `credit_ledger_refund_unique` ON `credit_ledger` (`entitlement_id`) WHERE `kind` = 'refund';--> statement-breakpoint
CREATE TRIGGER `entitlement_insert_integrity`
BEFORE INSERT ON `entitlement`
WHEN NEW.`status` != 'active'
	OR NOT EXISTS (
		SELECT 1
		FROM `price`
		INNER JOIN `class_type` ON `class_type`.`id` = `price`.`class_type_id`
		WHERE `price`.`id` = NEW.`price_id`
			AND `price`.`class_type_id` = NEW.`class_type_id`
			AND ((NEW.`kind` = 'subscription' AND `class_type`.`category` = '托管')
				OR (NEW.`kind` = 'package' AND `class_type`.`category` != '托管'))
	)
BEGIN
	SELECT RAISE(ABORT, 'invalid_entitlement_target');
END;--> statement-breakpoint
CREATE TRIGGER `class_type_entitlement_category_guard`
BEFORE UPDATE OF `category` ON `class_type`
WHEN (OLD.`category` = '托管') != (NEW.`category` = '托管')
	AND EXISTS (
		SELECT 1 FROM `entitlement`
		WHERE `entitlement`.`class_type_id` = OLD.`id`
	)
BEGIN
	SELECT RAISE(ABORT, 'class_type_category_locked');
END;--> statement-breakpoint
CREATE TRIGGER `payment_purchase_integrity`
BEFORE INSERT ON `payment`
WHEN NEW.`list_amount_fen` >= 0
	AND NOT EXISTS (
		SELECT 1
		FROM `entitlement`
		INNER JOIN `price` ON `price`.`id` = `entitlement`.`price_id`
		INNER JOIN `guardian_student`
			ON `guardian_student`.`student_id` = `entitlement`.`student_id`
			AND `guardian_student`.`guardian_id` = NEW.`guardian_id`
		WHERE `entitlement`.`id` = NEW.`entitlement_id`
			AND `entitlement`.`status` = 'active'
			AND NEW.`price_id` = `entitlement`.`price_id`
			AND (`entitlement`.`kind` = 'subscription' OR (
				`price`.`unit_amount_fen` <= 9007199254740991 / `entitlement`.`credits_total`
				AND NEW.`list_amount_fen` <= 9007199254740991 / `entitlement`.`credits_total`
			))
			AND NEW.`list_amount_fen` = `price`.`unit_amount_fen` * CASE
				WHEN `entitlement`.`kind` = 'package' THEN `entitlement`.`credits_total`
				ELSE 1
			END
	)
BEGIN
	SELECT RAISE(ABORT, 'invalid_payment_target');
END;--> statement-breakpoint
CREATE TRIGGER `payment_refund_integrity`
BEFORE INSERT ON `payment`
WHEN NEW.`list_amount_fen` < 0
	AND NOT EXISTS (
		SELECT 1
		FROM `entitlement`
		INNER JOIN `payment` AS `original_payment`
			ON `original_payment`.`entitlement_id` = `entitlement`.`id`
			AND `original_payment`.`list_amount_fen` >= 0
		WHERE `entitlement`.`id` = NEW.`entitlement_id`
			AND `entitlement`.`kind` = 'package'
			AND `entitlement`.`status` = 'active'
			AND NEW.`price_id` = `original_payment`.`price_id`
			AND NEW.`guardian_id` = `original_payment`.`guardian_id`
			AND (SELECT COALESCE(SUM(`delta`), 0) FROM `credit_ledger` WHERE `entitlement_id` = `entitlement`.`id`) > 0
			AND NEW.`list_amount_fen` = -((`original_payment`.`list_amount_fen` * (SELECT SUM(`delta`) FROM `credit_ledger` WHERE `entitlement_id` = `entitlement`.`id`)) / `entitlement`.`credits_total`)
			AND NEW.`paid_amount_fen` = -((`original_payment`.`paid_amount_fen` * (SELECT SUM(`delta`) FROM `credit_ledger` WHERE `entitlement_id` = `entitlement`.`id`)) / `entitlement`.`credits_total`)
	)
BEGIN
	SELECT RAISE(ABORT, 'refund_quote_stale');
END;--> statement-breakpoint
CREATE TRIGGER `payment_no_update`
BEFORE UPDATE ON `payment`
BEGIN
	SELECT RAISE(ABORT, 'payment_immutable');
END;--> statement-breakpoint
CREATE TRIGGER `payment_no_delete`
BEFORE DELETE ON `payment`
BEGIN
	SELECT RAISE(ABORT, 'payment_immutable');
END;--> statement-breakpoint
CREATE TRIGGER `credit_ledger_entitlement_match`
BEFORE INSERT ON `credit_ledger`
WHEN NEW.`entitlement_id` IS NOT NULL
	AND NOT EXISTS (
		SELECT 1 FROM `entitlement`
		WHERE `entitlement`.`id` = NEW.`entitlement_id`
			AND `entitlement`.`student_id` = NEW.`student_id`
	)
BEGIN
	SELECT RAISE(ABORT, 'invalid_ledger_entitlement');
END;--> statement-breakpoint
CREATE TRIGGER `credit_ledger_purchase_integrity`
BEFORE INSERT ON `credit_ledger`
WHEN NEW.`kind` = 'purchase'
	AND NOT EXISTS (
		SELECT 1
		FROM `entitlement`
		INNER JOIN `payment` ON `payment`.`entitlement_id` = `entitlement`.`id`
			AND `payment`.`list_amount_fen` >= 0
		WHERE `entitlement`.`id` = NEW.`entitlement_id`
			AND `entitlement`.`kind` = 'package'
			AND `entitlement`.`status` = 'active'
			AND `entitlement`.`student_id` = NEW.`student_id`
			AND `entitlement`.`credits_total` = NEW.`delta`
			AND NEW.`lesson_id` IS NULL
	)
BEGIN
	SELECT RAISE(ABORT, 'invalid_purchase_ledger_entry');
END;--> statement-breakpoint
CREATE TRIGGER `credit_ledger_attendance_integrity`
BEFORE INSERT ON `credit_ledger`
WHEN NEW.`kind` = 'attendance'
	AND (
		NEW.`delta` != -1
		OR NEW.`lesson_id` IS NULL
		OR NEW.`entitlement_id` IS NULL
		OR EXISTS (
			SELECT 1 FROM `lesson`
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
		OR NEW.`entitlement_id` IS NOT (
			SELECT `entitlement`.`id`
			FROM `entitlement`
			INNER JOIN `lesson` ON `lesson`.`id` = NEW.`lesson_id`
			WHERE `entitlement`.`student_id` = NEW.`student_id`
				AND `entitlement`.`kind` = 'package'
				AND `entitlement`.`status` = 'active'
				AND `entitlement`.`class_type_id` = `lesson`.`class_type_id`
				AND (SELECT COALESCE(SUM(`delta`), 0) FROM `credit_ledger` WHERE `entitlement_id` = `entitlement`.`id`) > 0
			ORDER BY `entitlement`.`created_at`, `entitlement`.`id`
			LIMIT 1
		)
	)
BEGIN
	SELECT RAISE(ABORT, 'no_eligible_entitlement');
END;--> statement-breakpoint
CREATE TRIGGER `credit_ledger_refund_integrity`
BEFORE INSERT ON `credit_ledger`
WHEN NEW.`kind` = 'refund'
	AND NOT EXISTS (
		SELECT 1
		FROM `entitlement`
		INNER JOIN `payment` ON `payment`.`entitlement_id` = `entitlement`.`id`
			AND `payment`.`list_amount_fen` < 0
		WHERE `entitlement`.`id` = NEW.`entitlement_id`
			AND `entitlement`.`kind` = 'package'
			AND `entitlement`.`status` = 'active'
			AND `entitlement`.`student_id` = NEW.`student_id`
			AND NEW.`lesson_id` IS NULL
			AND NEW.`delta` = -(SELECT COALESCE(SUM(`delta`), 0) FROM `credit_ledger` WHERE `entitlement_id` = `entitlement`.`id`)
			AND NEW.`delta` < 0
	)
BEGIN
	SELECT RAISE(ABORT, 'refund_quote_stale');
END;--> statement-breakpoint
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
CREATE TRIGGER `entitlement_refund_only_update`
BEFORE UPDATE ON `entitlement`
WHEN NOT (
	OLD.`status` = 'active'
	AND NEW.`status` = 'refunded'
	AND NEW.`id` IS OLD.`id`
	AND NEW.`student_id` IS OLD.`student_id`
	AND NEW.`kind` IS OLD.`kind`
	AND NEW.`class_type_id` IS OLD.`class_type_id`
	AND NEW.`credits_total` IS OLD.`credits_total`
	AND NEW.`valid_from` IS OLD.`valid_from`
	AND NEW.`valid_to` IS OLD.`valid_to`
	AND NEW.`price_id` IS OLD.`price_id`
	AND NEW.`created_at` IS OLD.`created_at`
	AND EXISTS (SELECT 1 FROM `payment` WHERE `entitlement_id` = OLD.`id` AND `list_amount_fen` < 0)
	AND EXISTS (SELECT 1 FROM `credit_ledger` WHERE `entitlement_id` = OLD.`id` AND `kind` = 'refund')
)
BEGIN
	SELECT RAISE(ABORT, 'entitlement_immutable');
END;--> statement-breakpoint
CREATE TRIGGER `entitlement_no_delete`
BEFORE DELETE ON `entitlement`
BEGIN
	SELECT RAISE(ABORT, 'entitlement_immutable');
END;--> statement-breakpoint
CREATE TRIGGER `attendance_entitlement_guard`
BEFORE INSERT ON `attendance`
WHEN (
	EXISTS (
		SELECT 1
		FROM `lesson`
		INNER JOIN `class_type` ON `class_type`.`id` = `lesson`.`class_type_id`
		WHERE `lesson`.`id` = NEW.`lesson_id`
			AND `class_type`.`category` = '托管'
			AND NEW.`checked_in_at` IS NOT NULL
	)
	AND NOT EXISTS (
		SELECT 1
		FROM `entitlement`
		INNER JOIN `lesson` ON `lesson`.`id` = NEW.`lesson_id`
		WHERE `entitlement`.`student_id` = NEW.`student_id`
			AND `entitlement`.`kind` = 'subscription'
			AND `entitlement`.`status` = 'active'
			AND `entitlement`.`class_type_id` = `lesson`.`class_type_id`
			AND date(`lesson`.`start_at`, 'unixepoch', '+8 hours') BETWEEN `entitlement`.`valid_from` AND `entitlement`.`valid_to`
	)
)
OR (
	EXISTS (
		SELECT 1
		FROM `lesson`
		INNER JOIN `class_type` ON `class_type`.`id` = `lesson`.`class_type_id`
		INNER JOIN `deduction_policy` ON `deduction_policy`.`attendance_status` = NEW.`status`
		WHERE `lesson`.`id` = NEW.`lesson_id`
			AND `class_type`.`category` != '托管'
			AND `lesson`.`makeup_for_lesson_id` IS NULL
			AND `deduction_policy`.`deducts` = 1
	)
	AND NOT EXISTS (
		SELECT 1
		FROM `entitlement`
		INNER JOIN `lesson` ON `lesson`.`id` = NEW.`lesson_id`
		WHERE `entitlement`.`student_id` = NEW.`student_id`
			AND `entitlement`.`kind` = 'package'
			AND `entitlement`.`status` = 'active'
			AND `entitlement`.`class_type_id` = `lesson`.`class_type_id`
			AND (SELECT COALESCE(SUM(`delta`), 0) FROM `credit_ledger` WHERE `entitlement_id` = `entitlement`.`id`) > 0
	)
)
BEGIN
	SELECT RAISE(ABORT, 'no_eligible_entitlement');
END;--> statement-breakpoint
CREATE TRIGGER `attendance_checkout_subscription_guard`
BEFORE UPDATE OF `checked_out_at`, `picked_up_by` ON `attendance`
WHEN NEW.`checked_out_at` IS NOT NULL
	AND EXISTS (
		SELECT 1
		FROM `lesson`
		INNER JOIN `class_type` ON `class_type`.`id` = `lesson`.`class_type_id`
		WHERE `lesson`.`id` = NEW.`lesson_id`
			AND `class_type`.`category` = '托管'
	)
	AND NOT EXISTS (
		SELECT 1
		FROM `entitlement`
		INNER JOIN `lesson` ON `lesson`.`id` = NEW.`lesson_id`
		WHERE `entitlement`.`student_id` = NEW.`student_id`
			AND `entitlement`.`kind` = 'subscription'
			AND `entitlement`.`status` = 'active'
			AND `entitlement`.`class_type_id` = `lesson`.`class_type_id`
			AND date(`lesson`.`start_at`, 'unixepoch', '+8 hours') BETWEEN `entitlement`.`valid_from` AND `entitlement`.`valid_to`
	)
BEGIN
	SELECT RAISE(ABORT, 'no_eligible_entitlement');
END;
