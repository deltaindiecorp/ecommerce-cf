-- Siapa yang memicu pergerakan stok. NULL untuk yang dipicu sistem dan untuk
-- baris lama sebelum kolom ini ada.
ALTER TABLE `inventory_movements` ADD `created_by` text REFERENCES users(id);--> statement-breakpoint

-- Rekonsiliasi WAJIB sebelum kolomnya dijatuhkan.
--
-- qty_available dan qty_on_hand seharusnya selalu sama, tapi penyelesaian
-- transfer versi lama hanya mengurangi/menambah qty_available dan tidak pernah
-- menyentuh qty_on_hand. Akibatnya qty_on_hand gudang asal kelebihan dan gudang
-- tujuan kekurangan, sebesar total transfer yang pernah terjadi.
--
-- qty_available adalah kolom yang terpelihara di semua jalur (adjust, deduct,
-- transfer), jadi itu yang dijadikan sumber kebenaran. Tanpa baris ini, drift
-- yang ada akan terkunci permanen di kolom yang tersisa.
UPDATE `inventory` SET `qty_on_hand` = `qty_available`;--> statement-breakpoint

ALTER TABLE `inventory` DROP COLUMN `qty_available`;
