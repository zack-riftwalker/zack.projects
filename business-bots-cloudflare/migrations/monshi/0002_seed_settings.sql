INSERT OR IGNORE INTO settings (key, value) VALUES
  ('business_hours', '{"sat": "10:00-22:00", "sun": "10:00-22:00", "mon": "10:00-22:00", "tue": "10:00-22:00", "wed": "10:00-22:00", "thu": "10:00-22:00", "fri": null}'),
  ('after_hours_message', 'سلام و وقت بخیر 👋
پیام شما دریافت شد. در حال حاضر خارج از ساعت پاسخ‌گویی هستیم و در اولین فرصت پیام شما بررسی خواهد شد.

برای مشاهده قیمت‌ها، موجودی و ثبت سفارش می‌توانید از ربات فروش استفاده کنید:
🤖 {sales_bot}

⚠️ لطفاً تا زمان بررسی، رمز عبور، کد ورود یا اطلاعات بانکی ارسال نکنید.'),
  ('greeting_message', 'سلام، خوش آمدید 👋
پیام شما دریافت شد و در اولین فرصت پاسخ داده می‌شود.

برای مشاهده قیمت‌ها، موجودی و ثبت سفارش فوری می‌توانید از ربات فروش استفاده کنید:
🤖 {sales_bot}'),
  ('greeting_enabled', '1'),
  ('sales_bot', '@mai_academia_bot'),
  ('ack_cooldown_hours', '8'),
  ('manual_pause_hours', '4'),
  ('mark_read_enabled', '1'),
  ('automation_enabled', '1'),
  ('gemini_enabled', '1'),
  ('faq_threshold', '0.82'),
  ('human_handoff_threshold', '0.68'),
  ('digest_enabled', '1'),
  ('faq_repeat_cooldown_hours', '1'),
  ('price_fallback_message', 'برای استعلام قیمت‌ها، موجودی و ثبت سفارش می‌توانید از ربات فروش استفاده کنید:
🤖 {sales_bot}'),
  ('embedding_version', '3-768');
