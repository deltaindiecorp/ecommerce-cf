CREATE TABLE `addresses` (
	`id` text PRIMARY KEY NOT NULL,
	`user_id` text NOT NULL,
	`label` text,
	`recipient_name` text NOT NULL,
	`phone` text NOT NULL,
	`address` text NOT NULL,
	`district` text NOT NULL,
	`city` text NOT NULL,
	`province` text NOT NULL,
	`postal_code` text NOT NULL,
	`rajaongkir_city_id` integer,
	`is_default` integer DEFAULT false NOT NULL,
	`created_at` integer,
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE TABLE `categories` (
	`id` text PRIMARY KEY NOT NULL,
	`parent_id` text,
	`name` text NOT NULL,
	`slug` text NOT NULL,
	`image_url` text,
	`sort_order` integer DEFAULT 0 NOT NULL,
	`is_active` integer DEFAULT true NOT NULL,
	`created_at` integer
);
--> statement-breakpoint
CREATE TABLE `product_variants` (
	`id` text PRIMARY KEY NOT NULL,
	`product_id` text NOT NULL,
	`name` text NOT NULL,
	`sku` text NOT NULL,
	`price` integer,
	`weight` integer,
	`options` text DEFAULT '{}' NOT NULL,
	`image_url` text,
	`is_active` integer DEFAULT true NOT NULL,
	`created_at` integer,
	FOREIGN KEY (`product_id`) REFERENCES `products`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE TABLE `products` (
	`id` text PRIMARY KEY NOT NULL,
	`category_id` text,
	`name` text NOT NULL,
	`slug` text NOT NULL,
	`sku` text NOT NULL,
	`description` text,
	`price` integer NOT NULL,
	`compare_price` integer,
	`weight` integer DEFAULT 0 NOT NULL,
	`width` integer DEFAULT 0,
	`height` integer DEFAULT 0,
	`length` integer DEFAULT 0,
	`images` text DEFAULT '[]' NOT NULL,
	`tags` text DEFAULT '[]',
	`status` text DEFAULT 'draft' NOT NULL,
	`is_featured` integer DEFAULT false NOT NULL,
	`meta_title` text,
	`meta_desc` text,
	`created_at` integer,
	`updated_at` integer,
	FOREIGN KEY (`category_id`) REFERENCES `categories`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE TABLE `users` (
	`id` text PRIMARY KEY NOT NULL,
	`email` text NOT NULL,
	`name` text,
	`phone` text,
	`password` text,
	`role` text DEFAULT 'customer' NOT NULL,
	`is_guest` integer DEFAULT false NOT NULL,
	`is_verified` integer DEFAULT false NOT NULL,
	`created_at` integer,
	`updated_at` integer
);
--> statement-breakpoint
CREATE TABLE `inventory` (
	`id` text PRIMARY KEY NOT NULL,
	`warehouse_id` text NOT NULL,
	`product_id` text NOT NULL,
	`variant_id` text,
	`qty_available` integer DEFAULT 0 NOT NULL,
	`qty_reserved` integer DEFAULT 0 NOT NULL,
	`qty_on_hand` integer DEFAULT 0 NOT NULL,
	`low_stock_alert` integer DEFAULT 5 NOT NULL,
	`updated_at` integer,
	FOREIGN KEY (`warehouse_id`) REFERENCES `warehouses`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`product_id`) REFERENCES `products`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`variant_id`) REFERENCES `product_variants`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE TABLE `inventory_movements` (
	`id` text PRIMARY KEY NOT NULL,
	`warehouse_id` text NOT NULL,
	`product_id` text NOT NULL,
	`variant_id` text,
	`type` text NOT NULL,
	`qty` integer NOT NULL,
	`ref_type` text,
	`ref_id` text,
	`note` text,
	`created_at` integer,
	FOREIGN KEY (`warehouse_id`) REFERENCES `warehouses`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`product_id`) REFERENCES `products`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE TABLE `warehouse_transfers` (
	`id` text PRIMARY KEY NOT NULL,
	`from_warehouse` text NOT NULL,
	`to_warehouse` text NOT NULL,
	`product_id` text NOT NULL,
	`variant_id` text,
	`qty` integer NOT NULL,
	`status` text DEFAULT 'pending' NOT NULL,
	`requested_by` text,
	`note` text,
	`created_at` integer,
	`completed_at` integer,
	FOREIGN KEY (`from_warehouse`) REFERENCES `warehouses`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`to_warehouse`) REFERENCES `warehouses`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`product_id`) REFERENCES `products`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE TABLE `warehouses` (
	`id` text PRIMARY KEY NOT NULL,
	`name` text NOT NULL,
	`code` text NOT NULL,
	`address` text NOT NULL,
	`city` text NOT NULL,
	`province` text NOT NULL,
	`postal_code` text NOT NULL,
	`rajaongkir_city_id` integer NOT NULL,
	`phone` text,
	`pic_name` text,
	`is_active` integer DEFAULT true NOT NULL,
	`priority` integer DEFAULT 1 NOT NULL,
	`created_at` integer
);
--> statement-breakpoint
CREATE TABLE `order_items` (
	`id` text PRIMARY KEY NOT NULL,
	`order_id` text NOT NULL,
	`warehouse_id` text NOT NULL,
	`product_id` text NOT NULL,
	`variant_id` text,
	`product_name` text NOT NULL,
	`variant_name` text,
	`sku` text NOT NULL,
	`image_url` text,
	`price_snapshot` integer NOT NULL,
	`weight_snapshot` integer NOT NULL,
	`qty` integer NOT NULL,
	`subtotal` integer NOT NULL,
	FOREIGN KEY (`order_id`) REFERENCES `orders`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`warehouse_id`) REFERENCES `warehouses`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE TABLE `orders` (
	`id` text PRIMARY KEY NOT NULL,
	`order_no` text NOT NULL,
	`user_id` text,
	`guest_email` text,
	`guest_phone` text,
	`guest_name` text,
	`status` text DEFAULT 'pending_payment' NOT NULL,
	`shipping_address` text NOT NULL,
	`subtotal` integer NOT NULL,
	`shipping_cost` integer DEFAULT 0 NOT NULL,
	`discount` integer DEFAULT 0 NOT NULL,
	`total` integer NOT NULL,
	`voucher_code` text,
	`voucher_discount` integer DEFAULT 0,
	`customer_note` text,
	`admin_note` text,
	`cancel_reason` text,
	`cancelled_at` integer,
	`created_at` integer,
	`updated_at` integer,
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE TABLE `payments` (
	`id` text PRIMARY KEY NOT NULL,
	`order_id` text NOT NULL,
	`gateway` text NOT NULL,
	`gateway_txn_id` text,
	`method` text,
	`va_number` text,
	`amount` integer NOT NULL,
	`status` text DEFAULT 'pending' NOT NULL,
	`expired_at` integer,
	`paid_at` integer,
	`webhook_payload` text,
	`created_at` integer,
	`updated_at` integer,
	FOREIGN KEY (`order_id`) REFERENCES `orders`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE TABLE `shipments` (
	`id` text PRIMARY KEY NOT NULL,
	`order_id` text NOT NULL,
	`warehouse_id` text NOT NULL,
	`courier` text NOT NULL,
	`service` text NOT NULL,
	`etd` text,
	`cost` integer NOT NULL,
	`tracking_no` text,
	`label_url` text,
	`status` text DEFAULT 'waiting_pickup' NOT NULL,
	`last_status` text,
	`last_checked` integer,
	`created_at` integer,
	`updated_at` integer,
	FOREIGN KEY (`order_id`) REFERENCES `orders`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`warehouse_id`) REFERENCES `warehouses`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE UNIQUE INDEX `categories_slug_unique` ON `categories` (`slug`);--> statement-breakpoint
CREATE UNIQUE INDEX `product_variants_sku_unique` ON `product_variants` (`sku`);--> statement-breakpoint
CREATE UNIQUE INDEX `products_slug_unique` ON `products` (`slug`);--> statement-breakpoint
CREATE UNIQUE INDEX `products_sku_unique` ON `products` (`sku`);--> statement-breakpoint
CREATE UNIQUE INDEX `users_email_unique` ON `users` (`email`);--> statement-breakpoint
CREATE UNIQUE INDEX `warehouses_code_unique` ON `warehouses` (`code`);--> statement-breakpoint
CREATE UNIQUE INDEX `orders_order_no_unique` ON `orders` (`order_no`);--> statement-breakpoint
CREATE UNIQUE INDEX `payments_gateway_txn_id_unique` ON `payments` (`gateway_txn_id`);