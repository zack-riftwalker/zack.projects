/* Conversations of the mock claude.ai page. Loaded by the page (as a plain
 * script) and by test.mjs, which also serves them as Claude's API. */
const CONVS = {
  '11111111-2222-3333-4444-555555555555': {
    title: 'آموزش React Hooks',
    messages: [
      { role: 'user', text: 'useEffect در React دقیقاً چه کاری انجام می‌دهد؟ لطفاً ساده توضیح بده.' },
      {
        role: 'assistant',
        blocks: [
          ['h2', 'useEffect چیست؟'],
          ['p', 'هوک useEffect به شما اجازه می‌دهد بعد از رندر شدن کامپوننت، کارهای جانبی (side effects) انجام دهید؛ مثلاً گرفتن داده از API یا تنظیم یک تایمر.'],
          ['p', 'این هوک دو ورودی می‌گیرد: یک تابع و یک آرایه‌ی وابستگی (dependency array). React هر بار که یکی از وابستگی‌ها تغییر کند، تابع را دوباره اجرا می‌کند.'],
          ['ul', ['اگر آرایه خالی باشد، فقط یک بار بعد از mount اجرا می‌شود.', 'اگر آرایه را ندهید، بعد از هر render اجرا می‌شود.', 'تابع برگشتی (cleanup) قبل از اجرای بعدی صدا زده می‌شود.']],
          ['pre', "useEffect(() => {\n  const id = setInterval(tick, 1000);\n  return () => clearInterval(id);\n}, []);"],
          ['blockquote', 'نکته: هیچ‌وقت state را بدون شرط داخل useEffect تغییر ندهید، وگرنه حلقه‌ی بی‌نهایت می‌سازید.'],
          ['p', 'In English: useEffect lets you synchronize a component with an external system, such as a network request or a browser API.'],
          ['table', [['حالت', 'زمان اجرا'], ['[]', 'فقط یک بار'], ['[a, b]', 'وقتی a یا b عوض شود']]],
          ['ol', ['کامپوننت رندر می‌شود.', 'DOM به‌روزرسانی می‌شود.', 'useEffect اجرا می‌شود.']],
          ['tools', 'Read a file, created a file, ran a command'],
          ['artifact', 'آزمون فصل ۲: آماده‌سازی درس'],
          ['pre-dark', 'این متن را Claude داخل بلوک کد نوشته و باید خوانا بماند.\nخط دوم همین متن.'],
          ['p-faint', 'این جمله با رنگ ثابتِ روشن نوشته شده است.'],
        ],
      },
      { role: 'user', text: 'مرسی! یک مثال واقعی هم بزن.' },
      {
        role: 'assistant',
        blocks: [
          ['p', 'حتماً. فرض کنید می‌خواهیم لیست کاربران را از سرور بگیریم و نمایش دهیم. ابتدا یک state به نام users می‌سازیم.'],
          ['p', 'سپس در useEffect با fetch درخواست می‌فرستیم و نتیجه را با setUsers ذخیره می‌کنیم. این الگو در بیشتر پروژه‌های واقعی دیده می‌شود.'],
          ['h2', 'مدیریت خطا'],
          ...Array.from({ length: 10 }, (_, i) => ['p', `نکته‌ی شماره‌ی ${i + 1} درباره‌ی مدیریت خطا: همیشه حالت‌های بارگذاری و خطا را جداگانه نگه دارید تا کاربر بداند چه اتفاقی افتاده است. این کار تجربه‌ی کاربری را بهتر می‌کند و اشکال‌زدایی را ساده‌تر.`]),
        ],
      },
    ],
  },
  '99999999-8888-7777-6666-555555555555': {
    title: 'Other chat',
    messages: [
      { role: 'user', text: 'What is photosynthesis?' },
      { role: 'assistant', blocks: [['p', 'Photosynthesis is the process plants use to turn light into chemical energy.']] },
    ],
  },
};

// ---- virtual list like the current claude.ai (rows with data-index, only
// rows near the viewport are rendered, scroll position gets corrected)
const VTURNS = [];
for (let i = 0; i < 12; i++) {
  VTURNS.push({ role: 'user', text: `سؤال شماره ${i + 1}: درباره‌ی مبحث ${i + 1} توضیح بده.` });
  VTURNS.push({
    role: 'assistant',
    blocks: [
      ['h2', `مبحث ${i + 1}: مقدمه`],
      ['p', `این پاراگراف اول مبحث ${i + 1} است و برای آزمایش فهرست خودکار نوشته شده. متن کمی طولانی است تا ارتفاع ردیف واقعی‌تر باشد و اسکرول معنا داشته باشد.`],
      ['p', `جمله‌ی دوم مبحث ${i + 1}: فهرست باید بتواند حتی وقتی این بخش در صفحه نیست، به آن برسد.`],
      ['h3', `مبحث ${i + 1}: جمع‌بندی`],
      ['p', `جمع‌بندی مبحث ${i + 1}: اگر روی این عنوان در فهرست کلیک شود، صفحه باید دقیقاً به همین‌جا بیاید.`],
      ['p', 'یک پاراگراف دیگر برای پر کردن صفحه و نزدیک‌تر شدن به ارتفاع پاسخ‌های واقعی Claude که معمولاً چند پاراگراف دارند.'],
    ],
  });
}


// a second long conversation (virtual list) to switch to
const VTURNS2 = [];
for (let i = 0; i < 8; i++) {
  VTURNS2.push({ role: 'user', text: `فصل ${i + 1} کتاب زیست را خلاصه کن.` });
  VTURNS2.push({
    role: 'assistant',
    blocks: [
      ['h2', `خلاصه‌ی فصل ${i + 1}`],
      ['p', `فصل ${i + 1} درباره‌ی یاخته و بافت است. این متن فقط برای آزمایش تعویض گفتگو نوشته شده و چند جمله دارد تا ردیف بلند شود.`],
      ['p', 'یک پاراگراف دیگر برای پر کردن صفحه، مثل پاسخ‌های واقعی Claude که چند پاراگراف دارند و ارتفاع ردیف را بیشتر می‌کنند.'],
      ['h3', `نکته‌های فصل ${i + 1}`],
      ['p', `نکته‌ی مهم فصل ${i + 1}: تعریف‌ها را دقیق حفظ کن.`],
    ],
  });
}
const VCONVS = { '22222222-3333-4444-5555-666666666666': VTURNS, '33333333-4444-5555-6666-777777777777': VTURNS2 };
