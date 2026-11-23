import { describe, expect, it } from 'vitest';
import { MAX_REPLY_UNITS, buildMenu, buildPrices, buildProductReply, loadEitaaProducts, matchMessage, toEitaaEntities, type EitaaProduct } from '../../src/monshi/eitaa/menu';
import { makeTestEnv } from '../helpers/env';
import { q } from '../helpers/seed';

const fa = (n: number) => n.toLocaleString('fa-IR');
const P = (o: Partial<EitaaProduct> & { id: number }): EitaaProduct =>
  ({ name: '‏محصول ' + o.id, price: 100000, is_available: 1, terms_text: null, terms_entities: null, eitaa_keyword: null, compare_at_price: null, ...o }) as EitaaProduct;
const GEM = P({ id: 1, name: '‏جمینای', eitaa_keyword: 'جمینای', price: 500000 });
const GPT = P({ id: 2, name: 'GPT Plus', eitaa_keyword: 'چت جی', price: 800000, compare_at_price: 1000000 });
const OFF = P({ id: 3, name: 'کلود', eitaa_keyword: 'کلود', is_available: 0 });
const NOKW = P({ id: 4, name: 'بدون کلمه' });
const ALL = [GEM, GPT, OFF, NOKW];
const slice = (t: string, e: { offset: number; length: number }) => t.slice(e.offset, e.offset + e.length);

describe('matchMessage', () => {
  it('menu and price words', () => {
    expect(matchMessage('منو', ALL)).toEqual({ kind: 'menu' });
    expect(matchMessage(' «منو»؟ ', ALL)).toEqual({ kind: 'menu' });
    for (const w of ['قیمت', 'قیمتها', 'قیمت ها', 'قیمت‌ها', 'لیست قیمت']) expect(matchMessage(w, ALL), w).toEqual({ kind: 'prices' });
  });
  it('keyword, شرایط/قیمت prefix and خرید', () => {
    expect(matchMessage('جمینای', ALL)).toEqual({ kind: 'product', product: GEM });
    expect(matchMessage('شرایط جمینای', ALL)).toEqual({ kind: 'product', product: GEM });
    expect(matchMessage('قیمت جمینای', ALL)).toEqual({ kind: 'product', product: GEM });
    expect(matchMessage('خرید جمینای', ALL)).toEqual({ kind: 'buy', product: GEM });
    expect(matchMessage('خرید چت جی', ALL)).toEqual({ kind: 'buy', product: GPT });
  });
  it('letter variants, half-space, trailing ؟ and case', () => {
    expect(matchMessage('جميناي', ALL)).toEqual({ kind: 'product', product: GEM });
    expect(matchMessage('جمینای؟', ALL)).toEqual({ kind: 'product', product: GEM });
    expect(matchMessage('چت‌جی', ALL)).toEqual({ kind: 'product', product: GPT });
    expect(matchMessage('شرایط  جمینای!', ALL)).toEqual({ kind: 'product', product: GEM });
    const en = [P({ id: 9, eitaa_keyword: 'ChatGPT' })];
    expect(matchMessage('chatgpt', en)).toMatchObject({ kind: 'product' });
  });
  it('an unavailable product still matches', () => expect(matchMessage('کلود', ALL)).toEqual({ kind: 'product', product: OFF }));
  it('anything else is null', () => {
    expect(matchMessage('جمینای من کار نمیکنه', ALL)).toBeNull(); // 4 words
    expect(matchMessage('یک دو سه چهار', ALL)).toBeNull();
    expect(matchMessage('سلام', ALL)).toBeNull();
    expect(matchMessage('خرید', ALL)).toBeNull();
    expect(matchMessage('خرید ناشناس', ALL)).toBeNull();
    expect(matchMessage('بدون کلمه', ALL)).toBeNull();
    expect(matchMessage(null, ALL)).toBeNull();
    expect(matchMessage('', ALL)).toBeNull();
  });
});

describe('buildMenu / buildPrices', () => {
  it('stock lines for available products only; code entities exactly on the keywords', () => {
    const m = buildMenu('سلام 👋 خوش اومدید', ALL);
    expect(m.text.startsWith('سلام 👋 خوش اومدید\n\n📦 موجودی امروز:\n')).toBe(true);
    expect(m.text).toContain('• جمینای — ' + fa(500000) + ' ت\n');
    expect(m.text).toContain('• GPT Plus — ' + fa(800000) + ' ت 🔥');
    expect(m.text).not.toContain('کلود');
    expect(m.text).not.toContain('‏');
    expect(m.text).toContain('⚡️ جواب سریع (کپی کنید و بفرستید):\nجمینای  ·  چت جی\nقیمت ← لیست قیمت‌ها\nمنو ← همین پیام\n\nیا سؤالتون رو بنویسید 🙂');
    expect(m.entities.every((e) => e.type === 'code')).toBe(true);
    expect(m.entities.map((e) => slice(m.text, e))).toEqual(['جمینای', 'چت جی', 'قیمت', 'منو']);
  });
  it('no products available / no keywords', () => {
    expect(buildMenu('g', [OFF]).text).toContain('📦 فعلاً محصولی موجود نیست.');
    const m = buildMenu('g', [NOKW]);
    expect(m.text).toContain('• بدون کلمه');
    expect(m.text).toContain('کپی کنید و بفرستید):\nقیمت ←');
    expect(m.entities.map((e) => slice(m.text, e))).toEqual(['قیمت', 'منو']);
  });
  it('entity offsets count UTF-16 units (emoji before the keywords)', () => {
    const m = buildMenu('🙂🙂 سلام', [GEM]);
    expect(slice(m.text, m.entities[0])).toBe('جمینای');
  });
  it('the price list ends with the منو line', () => {
    const m = buildPrices(ALL);
    expect(m.text.startsWith('📦 موجودی امروز:')).toBe(true);
    expect(m.text).not.toContain('کلود');
    expect(m.text.endsWith('منو ← منوی کامل')).toBe(true);
    expect(slice(m.text, m.entities.at(-1)!)).toBe('منو');
  });
});

describe('buildProductReply', () => {
  it('available: prices, status, terms with shifted entities, buy line with code entity', () => {
    const terms = 'قانون ۱\nقانون ۲';
    const r = buildProductReply(P({ ...GEM, terms_text: terms, terms_entities: [{ type: 'bold', offset: 0, length: 7 }] as any }));
    expect(r.text).toBe('📦 جمینای\n💰 قیمت: ' + fa(500000) + ' تومان\n✅ موجود\n\n' + terms + '\n\n🛒 برای خرید بنویسید:  خرید جمینای');
    const bold = r.entities.find((e) => e.type === 'bold')!;
    expect(slice(r.text, bold)).toBe('قانون ۱');
    const code = r.entities.find((e) => e.type === 'code')!;
    expect(slice(r.text, code)).toBe('خرید جمینای');
  });
  it('unavailable: says so, no buy line', () => {
    const r = buildProductReply(OFF);
    expect(r.text).toContain('⛔️ فعلاً ناموجود');
    expect(r.text).not.toContain('خرید');
    expect(r.entities).toEqual([]);
  });
  it('a sale: strikethrough exactly over the old price', () => {
    const r = buildProductReply(GPT);
    const s = r.entities.filter((e) => e.type === 'strikethrough');
    expect(s).toHaveLength(1);
    expect(slice(r.text, s[0])).toBe(fa(1000000) + ' تومان');
    expect(r.text).toContain('🔥 قیمت ویژه');
  });
  it('terms over 4000 units are cut at a line break, entities clipped, buy line kept', () => {
    const line = 'x'.repeat(99) + '\n';
    const terms = line.repeat(60); // 6000
    const r = buildProductReply(P({ ...GEM, terms_text: terms, terms_entities: [{ type: 'bold', offset: 0, length: 5999 }, { type: 'italic', offset: 5990, length: 5 }] as any }));
    expect(r.text.length).toBeLessThanOrEqual(4000);
    expect(r.text).toContain('…\n\n🛒 برای خرید بنویسید:  خرید جمینای');
    expect(r.text.includes('xx…')).toBe(true);
    expect(r.entities.find((e) => e.type === 'italic')).toBeUndefined();
    const bold = r.entities.find((e) => e.type === 'bold')!;
    expect(bold.offset + bold.length).toBeLessThanOrEqual(r.text.indexOf('…'));
    expect(slice(r.text, r.entities.find((e) => e.type === 'code')!)).toBe('خرید جمینای');
  });
});

describe('toEitaaEntities', () => {
  it('maps the known types, keeps offsets, drops the rest', () => {
    const out = toEitaaEntities([
      { type: 'bold', offset: 1, length: 2 }, { type: 'italic', offset: 3, length: 1 }, { type: 'underline', offset: 0, length: 1 },
      { type: 'strikethrough', offset: 0, length: 2 }, { type: 'code', offset: 5, length: 3 }, { type: 'pre', offset: 0, length: 4 },
      { type: 'text_link', offset: 2, length: 3, url: 'https://x.y' }, { type: 'blockquote', offset: 0, length: 9 },
      { type: 'url', offset: 0, length: 1 }, { type: 'mention', offset: 0, length: 1 }, { type: 'hashtag', offset: 0, length: 1 },
      { type: 'spoiler', offset: 0, length: 1 }, { type: 'custom_emoji', offset: 0, length: 1, custom_emoji_id: '1' },
    ] as any);
    expect(out.map((e) => e._)).toEqual([
      'messageEntityBold', 'messageEntityItalic', 'messageEntityUnderline', 'messageEntityStrike', 'messageEntityCode', 'messageEntityPre',
      'messageEntityTextUrl', 'messageEntityBlockquote', 'messageEntityUrl', 'messageEntityMention', 'messageEntityHashtag',
    ]);
    expect(out[0]).toEqual({ _: 'messageEntityBold', offset: 1, length: 2 });
    expect(out[5]).toMatchObject({ language: '' });
    expect(out[6]).toMatchObject({ url: 'https://x.y' });
    expect(toEitaaEntities(null)).toEqual([]);
  });
});

describe('loadEitaaProducts', () => {
  it('one statement; active only; catalog order (standalone and groups by sort_order, options by sortOptions)', async () => {
    const t = makeTestEnv({});
    const apps = t.apps();
    q(t.storeDb, "INSERT INTO product_groups (name, sort_order) VALUES ('G', 5)");
    q(t.storeDb, `INSERT INTO customer_products (name, price, sort_order, group_id, option_label, duration_days, eitaa_keyword, is_active) VALUES
      ('B', 1, 1, NULL, NULL, NULL, 'bb', 1), ('A', 1, 9, NULL, NULL, NULL, 'aa', 1),
      ('G — 3', 1, 0, 1, '3', 90, NULL, 1), ('G — 1', 1, 0, 1, '1', 30, NULL, 1), ('Dead', 1, 0, NULL, NULL, NULL, 'dd', 0)`);
    const app = apps.monshi!;
    const before = apps.budget.remaining();
    const list = (await loadEitaaProducts(app))!;
    expect(before - apps.budget.remaining()).toBe(1);
    expect(list.map((p) => p.name)).toEqual(['B', 'G — 1', 'G — 3', 'A']);
    expect(list[0].eitaa_keyword).toBe('bb');
  });
  it('no store → null', async () => {
    const t = makeTestEnv({ store: false });
    expect(await loadEitaaProducts(t.apps().monshi!)).toBeNull();
  });
});

describe('length cap and cutting', () => {
  const MANY = Array.from({ length: 200 }, (_, i) => P({ id: 100 + i, name: 'محصول شماره ' + i, eitaa_keyword: 'k' + i }));
  it('200 products: the stock list stops with «…», the quick-reply section stays intact, the text stays under the cap', () => {
    const m = buildMenu('سلام', MANY);
    expect(m.text.length).toBeLessThanOrEqual(3500);
    expect(m.text).toContain('\n…\n\n⚡️ جواب سریع');
    expect(m.text.endsWith('یا سؤالتون رو بنویسید 🙂')).toBe(true);
    const codes = m.entities.map((x) => slice(m.text, x));
    expect(codes).toHaveLength(202);
    expect(codes[0]).toBe('k0');
    expect(codes.at(-3)).toBe('k199');
    expect(codes.slice(-2)).toEqual(['قیمت', 'منو']);
    const p = buildPrices(MANY);
    expect(p.text.length).toBeLessThanOrEqual(3500);
    expect(p.text).toContain('\n…\n\nمنو');
  });
  it('a short list has no «…»', () => {
    expect(buildMenu('سلام', ALL).text).not.toContain('…');
  });
  it('a cut without a line break never splits a surrogate pair', () => {
    for (const k of [0, 1]) { // one of the two puts the cut between the halves of an emoji
      const terms = 'x'.repeat(k) + '😀'.repeat(2000); // no newline
      const r = buildProductReply(P({ id: 9, terms_text: terms, terms_entities: [] }));
      expect(r.text.length).toBeLessThanOrEqual(MAX_REPLY_UNITS);
      expect(r.text).not.toMatch(/[\uD800-\uDBFF]…/);
      expect(r.text).not.toMatch(/(^|[^\uD800-\uDBFF])[\uDC00-\uDFFF]/);
    }
  });
});
