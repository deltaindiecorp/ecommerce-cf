-- Alamat bayar dari gateway (Snap redirect_url Midtrans / invoice_url Xendit).
--
-- Sebelumnya hanya dikembalikan sekali di respons payment/create lalu hilang.
-- Pembeli yang menutup tab dan kembali ke /payment ditolak dengan 409
-- "pembayaran sudah dibuat", tanpa cara apa pun mendapatkan alamat bayarnya
-- lagi — pesanan yang sah jadi buntu sampai kedaluwarsa 24 jam.
--
-- NULL untuk COD, yang memang tidak melibatkan gateway.
ALTER TABLE `payments` ADD `payment_url` text;
