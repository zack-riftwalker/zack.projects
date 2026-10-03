/* How Claude usage readings are named and written, shared by the in-page
 * pill/card (content/usage.js) and the popup's usage tab. A reading is
 * { at, windows: [{ key, pct, resetsAt }], delta, deltaAt }. */
(function (root) {
  const CSR = (root.CSR = root.CSR || {});
  const fa = (n) => Number(n).toLocaleString('fa-IR');

  const LABELS = {
    five_hour: 'جلسه‌ی ۵ ساعته',
    seven_day: 'هفتگی (همه‌ی مدل‌ها)',
    seven_day_opus: 'هفتگی Opus',
    seven_day_sonnet: 'هفتگی Sonnet',
    seven_day_oauth_apps: 'هفتگی برنامه‌های متصل',
    extra_usage: 'اعتبار اضافه',
  };

  const F = (CSR.usageFmt = {});

  F.label = (key) =>
    LABELS[key] ||
    (/^seven_day_(.+)/.test(key) ? 'هفتگی ' + key.slice(10).replace(/_/g, ' ') : /five_hour/.test(key) ? '۵ ساعته ' + key.replace(/five_hour_?/, '') : key.replace(/_/g, ' '));

  /** 5-hour first, then the overall weekly window, then the rest. */
  F.rank = (key) => (key === 'five_hour' ? 0 : key === 'seven_day' ? 1 : 2);

  F.color = (pct) => (pct >= 85 ? '#e03131' : pct >= 60 ? '#f08c00' : '#2f9e44');

  F.pct = (n) => fa(Math.round(n)) + '٪';

  /** "۲ روز و ۵ ساعت" for the weekly windows, "۲ ساعت و ۱۵ دقیقه" below a day. */
  F.until = function (ms) {
    const hours = Math.floor(ms / 3600000);
    if (hours < 24) return CSR.faDuration(ms / 1000);
    const days = Math.floor(hours / 24);
    return hours % 24 ? `${fa(days)} روز و ${fa(hours % 24)} ساعت` : `${fa(days)} روز`;
  };

  F.resetText = function (w) {
    if (!w.resetsAt) return '';
    const left = w.resetsAt - Date.now();
    if (left <= 0) return 'به‌زودی صفر می‌شود';
    const weekly = left > 24 * 3600 * 1000;
    const when = new Date(w.resetsAt).toLocaleString('fa-IR', weekly ? { weekday: 'long', hour: '2-digit', minute: '2-digit' } : { hour: '2-digit', minute: '2-digit' });
    return `صفر می‌شود: ${when} (${F.until(left)} دیگر)`;
  };

  F.delta = (d) => (d < 1 ? 'کمتر از ۱٪' : 'حدود ' + F.pct(d));

  F.ago = (at) => (!at ? '' : Date.now() - at < 60000 ? 'همین الان' : CSR.faDuration((Date.now() - at) / 1000) + ' پیش');

  F.main = (d) => (d && d.windows && d.windows[0]) || null;

  F.errorText = (err) =>
    err === 'auth'
      ? 'برای دیدن مصرف باید در claude.ai وارد حسابت شده باشی.'
      : 'خواندن مصرف از Claude ممکن نشد. شاید Claude این بخش را تغییر داده باشد؛ صفحه‌ی Usage خود Claude را ببین.';
})(typeof globalThis !== 'undefined' ? globalThis : self);
