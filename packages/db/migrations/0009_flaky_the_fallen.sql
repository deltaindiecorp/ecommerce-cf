CREATE TABLE `store_settings` (
	`id` text PRIMARY KEY NOT NULL,
	`store_name` text DEFAULT 'Deltacommerce' NOT NULL,
	`tagline` text,
	`support_email` text,
	`support_phone` text,
	`address` text,
	`updated_at` integer
);
