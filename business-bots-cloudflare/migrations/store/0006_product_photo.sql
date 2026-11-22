-- ============================================================
--  Round-5: new customer UI — optional product photo (see UI_PLAN.md §7)
-- ============================================================
ALTER TABLE customer_products ADD COLUMN photo_file_id TEXT;   -- Telegram file_id of the store bot; NULL = no photo
