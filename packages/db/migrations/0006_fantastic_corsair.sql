CREATE TABLE `admin_audit_log` (
	`id` text PRIMARY KEY NOT NULL,
	`actor_id` text,
	`actor_name` text,
	`actor_role` text,
	`action` text NOT NULL,
	`target_type` text NOT NULL,
	`target_id` text,
	`metadata` text,
	`created_at` integer,
	FOREIGN KEY (`actor_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `admin_audit_target_idx` ON `admin_audit_log` (`target_type`,`target_id`,`created_at`);--> statement-breakpoint
CREATE INDEX `admin_audit_created_at_idx` ON `admin_audit_log` (`created_at`);--> statement-breakpoint
CREATE INDEX `admin_audit_actor_idx` ON `admin_audit_log` (`actor_id`,`created_at`);