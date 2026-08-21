CREATE INDEX `categories_active_sort_idx` ON `categories` (`is_active`,`sort_order`);--> statement-breakpoint
CREATE INDEX `product_variants_product_id_idx` ON `product_variants` (`product_id`);--> statement-breakpoint
CREATE INDEX `products_status_created_at_idx` ON `products` (`status`,`created_at`);--> statement-breakpoint
CREATE INDEX `products_category_id_idx` ON `products` (`category_id`);--> statement-breakpoint
CREATE INDEX `products_is_featured_idx` ON `products` (`is_featured`);--> statement-breakpoint
CREATE INDEX `users_role_guest_created_at_idx` ON `users` (`role`,`is_guest`,`created_at`);--> statement-breakpoint
CREATE INDEX `inventory_wh_product_variant_idx` ON `inventory` (`warehouse_id`,`product_id`,`variant_id`);--> statement-breakpoint
CREATE INDEX `inventory_product_id_idx` ON `inventory` (`product_id`);--> statement-breakpoint
CREATE INDEX `inventory_movements_ref_idx` ON `inventory_movements` (`ref_type`,`ref_id`,`type`);--> statement-breakpoint
CREATE INDEX `warehouses_active_priority_idx` ON `warehouses` (`is_active`,`priority`);--> statement-breakpoint
CREATE INDEX `order_items_order_id_idx` ON `order_items` (`order_id`);--> statement-breakpoint
CREATE INDEX `orders_created_at_idx` ON `orders` (`created_at`);--> statement-breakpoint
CREATE INDEX `orders_status_created_at_idx` ON `orders` (`status`,`created_at`);--> statement-breakpoint
CREATE INDEX `payments_order_id_idx` ON `payments` (`order_id`);--> statement-breakpoint
CREATE INDEX `payments_status_expired_at_idx` ON `payments` (`status`,`expired_at`);--> statement-breakpoint
CREATE INDEX `shipments_order_id_idx` ON `shipments` (`order_id`);--> statement-breakpoint
CREATE INDEX `shipments_status_idx` ON `shipments` (`status`);