CREATE UNIQUE INDEX `credit_ledger_attendance_unique` ON `credit_ledger` (`lesson_id`,`student_id`) WHERE "credit_ledger"."kind" = 'attendance';
