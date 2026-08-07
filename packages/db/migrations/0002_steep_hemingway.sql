ALTER TABLE `product_variants` ADD `cost_price` integer;--> statement-breakpoint
ALTER TABLE `products` ADD `cost_price` integer;--> statement-breakpoint
ALTER TABLE `order_items` ADD `cost_snapshot` integer;