/* Shared constants for the content script, popup and library page. */
(function (root) {
  const CSR = (root.CSR = root.CSR || {});

  // Unicode ranges that a Persian font should be used for. Everything else
  // (Latin letters, digits, punctuation) falls through to the Latin font.
  const ARABIC_RANGE =
    'U+0600-06FF, U+0750-077F, U+0870-08FF, U+200C-200F, U+FB50-FDFF, U+FE70-FEFF';

  // Bundled font files, per font id.
  CSR.FONT_FILES = {
    vazirmatn: [{ file: 'vazirmatn-arabic-wght-normal.woff2', weight: '100 900' }],
    estedad: [{ file: 'estedad-arabic-wght-normal.woff2', weight: '100 900' }],
    sahel: [{ file: 'sahel-vf.woff2', weight: '300 900' }],
    samim: [
      { file: 'samim-400.woff2', weight: '400' },
      { file: 'samim-700.woff2', weight: '700' },
    ],
    shabnam: [
      { file: 'shabnam-400.woff2', weight: '400' },
      { file: 'shabnam-700.woff2', weight: '700' },
    ],
    naskh: [{ file: 'noto-naskh-arabic-arabic-wght-normal.woff2', weight: '400 700' }],
    'vazirmatn-latin': [{ file: 'vazirmatn-latin-wght-normal.woff2', weight: '100 900' }],
    'estedad-latin': [{ file: 'estedad-latin-wght-normal.woff2', weight: '100 900' }],
    inter: [
      { file: 'inter-latin-wght-normal.woff2', weight: '100 900' },
      { file: 'inter-latin-wght-italic.woff2', weight: '100 900', style: 'italic' },
    ],
    literata: [
      { file: 'literata-latin-wght-normal.woff2', weight: '200 900' },
      { file: 'literata-latin-wght-italic.woff2', weight: '200 900', style: 'italic' },
    ],
    lexend: [{ file: 'lexend-latin-wght-normal.woff2', weight: '100 900' }],
    atkinson: [
      { file: 'atkinson-hyperlegible-latin-400-normal.woff2', weight: '400' },
      { file: 'atkinson-hyperlegible-latin-400-italic.woff2', weight: '400', style: 'italic' },
      { file: 'atkinson-hyperlegible-latin-700-normal.woff2', weight: '700' },
      { file: 'atkinson-hyperlegible-latin-700-italic.woff2', weight: '700', style: 'italic' },
    ],
  };

  CSR.ARABIC_RANGE = ARABIC_RANGE;

  // kind: 'bundled' (FONT_FILES), 'local' (installed on the OS), 'stack' (plain CSS stack)
  CSR.PERSIAN_FONTS = [
    { id: 'vazirmatn', label: 'وزیرمتن', kind: 'bundled' },
    { id: 'estedad', label: 'استعداد', kind: 'bundled' },
    { id: 'sahel', label: 'ساحل', kind: 'bundled' },
    { id: 'samim', label: 'صمیم', kind: 'bundled' },
    { id: 'shabnam', label: 'شبنم', kind: 'bundled' },
    { id: 'naskh', label: 'نسخ (کتابی)', kind: 'bundled' },
    { id: 'tahoma', label: 'Tahoma', kind: 'local', local: 'Tahoma' },
    { id: 'default', label: 'پیش‌فرض Claude', kind: 'none' },
    { id: 'custom', label: 'فونت نصب‌شده روی سیستم…', kind: 'custom' },
  ];

  CSR.LATIN_FONTS = [
    { id: 'default', label: 'پیش‌فرض Claude', kind: 'none' },
    { id: 'inter', label: 'Inter', kind: 'bundled' },
    { id: 'literata', label: 'Literata (کتابی)', kind: 'bundled' },
    { id: 'atkinson', label: 'Atkinson Hyperlegible (خوانایی بالا)', kind: 'bundled' },
    { id: 'lexend', label: 'Lexend (کمک به تمرکز)', kind: 'bundled' },
    { id: 'vazirmatn-latin', label: 'هماهنگ با وزیرمتن', kind: 'bundled' },
    { id: 'estedad-latin', label: 'هماهنگ با استعداد', kind: 'bundled' },
    { id: 'system', label: 'فونت سیستم', kind: 'stack', stack: 'system-ui, -apple-system, "Segoe UI", Roboto' },
    { id: 'georgia', label: 'Georgia', kind: 'stack', stack: 'Georgia, "Times New Roman"' },
    { id: 'custom', label: 'فونت نصب‌شده روی سیستم…', kind: 'custom' },
  ];

  // Highlight palette. `light` is used on light backgrounds, `dark` on dark ones.
  CSR.HIGHLIGHTS = [
    { id: 'yellow', label: 'زرد', light: '#fff176', dark: 'rgba(255, 225, 90, 0.38)', swatch: '#ffd43b' },
    { id: 'green', label: 'سبز', light: '#b9f6b0', dark: 'rgba(120, 220, 120, 0.33)', swatch: '#69db7c' },
    { id: 'blue', label: 'آبی', light: '#b3e0ff', dark: 'rgba(100, 180, 255, 0.35)', swatch: '#4dabf7' },
    { id: 'pink', label: 'صورتی', light: '#ffc4d8', dark: 'rgba(255, 120, 170, 0.35)', swatch: '#f783ac' },
    { id: 'orange', label: 'نارنجی', light: '#ffd6a5', dark: 'rgba(255, 160, 70, 0.36)', swatch: '#ffa94d' },
    { id: 'purple', label: 'بنفش', light: '#dcd0ff', dark: 'rgba(170, 140, 255, 0.36)', swatch: '#9775fa' },
  ];

  CSR.TEXT_COLORS = [
    { id: 'red', label: 'قرمز', light: '#d6336c', dark: '#ff8787' },
    { id: 'blue', label: 'آبی', light: '#1c7ed6', dark: '#74c0fc' },
    { id: 'green', label: 'سبز', light: '#2b8a3e', dark: '#8ce99a' },
    { id: 'purple', label: 'بنفش', light: '#7048e8', dark: '#b197fc' },
  ];

  CSR.PEN_COLORS = ['#e03131', '#1c7ed6', '#2f9e44', '#f08c00', '#7048e8', '#212529', '#ffffff'];

  CSR.DIVIDER_STYLES = [
    { id: 'solid', label: 'ساده' },
    { id: 'dashed', label: 'خط‌چین' },
    { id: 'dotted', label: 'نقطه‌چین' },
    { id: 'double', label: 'دوخطی' },
    { id: 'fade', label: 'محو' },
  ];

  // Reading themes. `null` colors mean "keep Claude's own".
  CSR.THEMES = [
    { id: 'claude', label: 'پیش‌فرض Claude', dark: null },
    { id: 'paper', label: 'کاغذی', dark: false, bg: '#faf9f6', text: '#23262b', heading: '#0f1115', link: '#1a5fb4', accent: '#c2410c' },
    { id: 'sepia', label: 'سپیا', dark: false, bg: '#f4ecd8', text: '#5b4636', heading: '#3e2c1f', link: '#8a4b08', accent: '#a0522d' },
    { id: 'mint', label: 'نعنایی', dark: false, bg: '#e7f2ea', text: '#1e3a2b', heading: '#10281c', link: '#0b6e4f', accent: '#2e7d57' },
    { id: 'solarized-light', label: 'سولارایز روشن', dark: false, bg: '#fdf6e3', text: '#586e75', heading: '#073642', link: '#268bd2', accent: '#cb4b16' },
    { id: 'night', label: 'شب', dark: true, bg: '#1e1f24', text: '#d6d6d6', heading: '#ffffff', link: '#7ab8ff', accent: '#e0a96d' },
    { id: 'dusk', label: 'کهربایی (شب‌خوان)', dark: true, bg: '#1f1a14', text: '#e6d5b8', heading: '#f5e6c8', link: '#e0a458', accent: '#d08c60' },
    { id: 'nord', label: 'نورد', dark: true, bg: '#2e3440', text: '#d8dee9', heading: '#eceff4', link: '#88c0d0', accent: '#ebcb8b' },
    { id: 'solarized-dark', label: 'سولارایز تیره', dark: true, bg: '#002b36', text: '#93a1a1', heading: '#eee8d5', link: '#268bd2', accent: '#b58900' },
    { id: 'oled', label: 'مشکی کامل', dark: true, bg: '#000000', text: '#c9c9c9', heading: '#ededed', link: '#6ea8fe', accent: '#f2b66d' },
    { id: 'custom', label: 'سفارشی', dark: null },
  ];

  CSR.DEFAULT_SETTINGS = {
    enabled: true,
    // typography (0 = keep Claude's default)
    persianFont: 'vazirmatn',
    latinFont: 'default',
    customPersianFont: '',
    customLatinFont: '',
    fontSize: 0,
    lineHeight: 0,
    fontWeight: 0,
    wordSpacing: 0,
    paragraphSpacing: 0,
    contentWidth: 0,
    applyToUser: true,
    // theme
    theme: 'claude',
    custom: { bg: '#fbf7ef', text: '#2b2b2b', heading: '#111111', link: '#1a5fb4', accent: '#c2410c', dark: false },
    // direction
    rtlMode: 'auto', // off | auto | force
    rtlInput: true,
    persianListNumbers: false,
    // tools
    showDock: true,
    dockCollapsed: false,
    dockSide: 'right',
    selectionToolbar: true,
    highlighterMode: false,
    activeHighlight: 'yellow',
    penColor: '#e03131',
    penWidth: 3,
    dividerStyle: 'solid',
    // reading ruler & bookmarks
    rulerPattern: 'termeh',
    rulerLines: 2,
    rulerDim: 0.35,
    bookmarkPattern: 'termeh',
    // focus mode
    focusHideUser: false,
    focusFullscreen: true,
    // translation
    translateEmail: '',
    // text to speech
    ttsRate: 1,
    ttsFaVoice: '',
    ttsEnVoice: '',
    // dictionary
    dictDblclick: true,
    // progress
    autoProgress: true,
    resumePrompt: true,
    // study timer & pomodoro (minutes)
    showTimer: true,
    pomoFocus: 25,
    pomoShort: 5,
    pomoLong: 15,
    pomoCycles: 4,
    pomoAutoBreak: true,
    pomoAutoFocus: false,
    pomoSound: true,
    pomoNotify: true,
    pomoPattern: 'termeh',
  };

  // Where new versions are announced (public GitHub repo). The newest version
  // found in any of these files wins.
  const RAW = 'https://raw.githubusercontent.com/zack-riftwalker/zack.projects';
  CSR.UPDATE_SOURCES = [`${RAW}/main/claude-reader/update.json`, `${RAW}/claude/brave-franklin-agv173/claude-reader/update.json`];

  /** -1, 0 or 1 for dotted versions like "0.3.10". */
  CSR.compareVersions = function (a, b) {
    const x = String(a).split('.').map(Number);
    const y = String(b).split('.').map(Number);
    for (let i = 0; i < Math.max(x.length, y.length); i++) {
      const d = (x[i] || 0) - (y[i] || 0);
      if (d) return d > 0 ? 1 : -1;
    }
    return 0;
  };

  /** Document order of two annotations: by conversation row (Claude's virtual
   * list index; older anchors only have the rendered message index), then by
   * position inside the message. */
  CSR.compareAnchors = function (x, y) {
    const a = x.anchor || {};
    const b = y.anchor || {};
    return (a.row ?? a.msg ?? 0) - (b.row ?? b.msg ?? 0) || (a.start ?? a.block ?? 0) - (b.start ?? b.block ?? 0);
  };

  CSR.DEFAULT_TAGS = ['امتحان', 'مهم', 'مرور', 'سؤال', 'تعریف', 'فرمول', 'مثال'];

  /** Local date key (YYYY-MM-DD) for study statistics. */
  CSR.dayKey = function (d = new Date()) {
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
  };

  /** "۲ ساعت و ۵ دقیقه" / "۱۲ دقیقه" / "کمتر از یک دقیقه" */
  CSR.faDuration = function (secs) {
    const m = Math.floor(secs / 60);
    if (m < 1) return 'کمتر از یک دقیقه';
    const h = Math.floor(m / 60);
    const mm = m % 60;
    const fa = (n) => n.toLocaleString('fa-IR');
    if (!h) return `${fa(mm)} دقیقه`;
    return mm ? `${fa(h)} ساعت و ${fa(mm)} دقیقه` : `${fa(h)} ساعت`;
  };

  /** "۲۴:۵۹" */
  CSR.faClock = function (ms) {
    const t = Math.max(0, Math.ceil(ms / 1000));
    const m = Math.floor(t / 60);
    const s = t % 60;
    return `${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`.replace(/\d/g, (d) => '۰۱۲۳۴۵۶۷۸۹'[d]);
  };

  // ---------- helpers ----------

  CSR.deepMerge = function deepMerge(base, extra) {
    const out = Array.isArray(base) ? base.slice() : { ...base };
    if (!extra || typeof extra !== 'object') return out;
    for (const [k, v] of Object.entries(extra)) {
      if (v && typeof v === 'object' && !Array.isArray(v) && base && typeof base[k] === 'object' && !Array.isArray(base[k])) {
        out[k] = deepMerge(base[k], v);
      } else if (v !== undefined) {
        out[k] = v;
      }
    }
    return out;
  };

  CSR.uid = function uid(prefix = 'a') {
    return prefix + '_' + Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
  };

  CSR.themeById = function (id) {
    return CSR.THEMES.find((t) => t.id === id) || CSR.THEMES[0];
  };

  /** Resolved theme colors for a settings object, or null for "keep Claude's". */
  CSR.resolveTheme = function (settings) {
    const t = CSR.themeById(settings.theme);
    if (t.id === 'claude') return null;
    if (t.id === 'custom') return { id: 'custom', ...settings.custom, dark: !!settings.custom.dark };
    return t;
  };

  /** False once the extension was reloaded or updated: this page's old copy
   * of the content scripts can't use chrome.* anymore and should stay quiet. */
  CSR.alive = function () {
    try {
      return !!(globalThis.chrome && chrome.runtime && chrome.runtime.id);
    } catch (e) {
      return false;
    }
  };

  // ---------- color utils ----------

  const Color = (CSR.color = {});

  Color.hexToRgb = function (hex) {
    let h = String(hex || '').replace('#', '').trim();
    if (h.length === 3) h = h.split('').map((c) => c + c).join('');
    const n = parseInt(h, 16);
    if (Number.isNaN(n) || h.length !== 6) return { r: 0, g: 0, b: 0 };
    return { r: (n >> 16) & 255, g: (n >> 8) & 255, b: n & 255 };
  };

  Color.rgbToHex = function ({ r, g, b }) {
    const c = (x) => Math.round(Math.max(0, Math.min(255, x))).toString(16).padStart(2, '0');
    return '#' + c(r) + c(g) + c(b);
  };

  Color.mix = function (a, b, t) {
    const x = Color.hexToRgb(a);
    const y = Color.hexToRgb(b);
    return Color.rgbToHex({ r: x.r + (y.r - x.r) * t, g: x.g + (y.g - x.g) * t, b: x.b + (y.b - x.b) * t });
  };

  Color.rgbToHsl = function ({ r, g, b }) {
    r /= 255; g /= 255; b /= 255;
    const max = Math.max(r, g, b);
    const min = Math.min(r, g, b);
    let h = 0;
    let s = 0;
    const l = (max + min) / 2;
    if (max !== min) {
      const d = max - min;
      s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
      if (max === r) h = (g - b) / d + (g < b ? 6 : 0);
      else if (max === g) h = (b - r) / d + 2;
      else h = (r - g) / d + 4;
      h *= 60;
    }
    return { h, s: s * 100, l: l * 100 };
  };

  /** "H S% L%" — the channel format Claude's CSS variables use. */
  Color.hslChannels = function (hex) {
    const { h, s, l } = Color.rgbToHsl(Color.hexToRgb(hex));
    return `${h.toFixed(1)} ${s.toFixed(1)}% ${l.toFixed(1)}%`;
  };

  Color.luminance = function (hex) {
    const { r, g, b } = Color.hexToRgb(hex);
    const f = (c) => {
      c /= 255;
      return c <= 0.03928 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4);
    };
    return 0.2126 * f(r) + 0.7152 * f(g) + 0.0722 * f(b);
  };

  Color.isDark = function (hex) {
    return Color.luminance(hex) < 0.2;
  };
})(typeof globalThis !== 'undefined' ? globalThis : self);
