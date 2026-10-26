import { describe, expect, it } from 'vitest';
import { costToman, finalPrice, markupFor, roundUp10k } from '../../src/store/suppliers/pricing';
import { parseDuration, optionLabel, optionsFromItems, unknownAttributes } from '../../src/store/suppliers/importDraft';
import { pickActiveSource, type SourceRow } from '../../src/store/suppliers/recompute';
import { firstBelowCost } from '../../src/store/suppliers/floor';
import { parseSupplierDefaults } from '../../src/store/supplierDefaults';
import type { CatalogItem } from '../../src/store/suppliers/types';

describe('price formula (§5.2)', () => {
  it('rounds up to the next 10,000 Toman', () => {
    expect(roundUp10k(1_633_975.2)).toBe(1_640_000);
    expect(roundUp10k(1_640_000)).toBe(1_640_000);
    expect(roundUp10k(1)).toBe(10_000);
  });

  it('final = ceil((cost × (1 + percent/100) + fixed) / 10000) × 10000', () => {
    expect(finalPrice(1_420_848, { percent: 15, fixed: 0 })).toBe(1_640_000);
    expect(finalPrice(1_000_000, { percent: 0, fixed: 5_000 })).toBe(1_010_000);
    expect(finalPrice(1_000_000, { percent: 10, fixed: 0 })).toBe(1_100_000);
  });

  it('cost is the USD price times the rate, rounded', () => {
    expect(costToman(5.28, 150000)).toBe(792000);
    expect(costToman(0.333, 150000)).toBe(49950);
  });

  it('the option markup wins when either half is set; a missing half is 0; otherwise the defaults; otherwise none', () => {
    const defaults = { markupPercent: 15, markupFixed: 1000 };
    expect(markupFor({ markup_percent: 20, markup_fixed: null }, defaults)).toEqual({ percent: 20, fixed: 0 });
    expect(markupFor({ markup_percent: null, markup_fixed: 500 }, defaults)).toEqual({ percent: 0, fixed: 500 });
    expect(markupFor({ markup_percent: null, markup_fixed: null }, defaults)).toEqual({ percent: 15, fixed: 1000 });
    expect(markupFor({ markup_percent: null, markup_fixed: null }, { markupPercent: null, markupFixed: null })).toBeNull();
  });
});

describe('supplier defaults validation (§2.7)', () => {
  it('a percent of 0 to 500 and an integer fixed amount are accepted', () => {
    expect(parseSupplierDefaults('{"markupPercent":500,"markupFixed":100000000}')).toEqual({ markupPercent: 500, markupFixed: 100000000 });
    expect(parseSupplierDefaults('{"markupPercent":1.5,"markupFixed":2.5}')).toEqual({ markupPercent: 1.5, markupFixed: null });
  });
});

describe('duration and label parsing (§5.1)', () => {
  it('parse table: days, months (30) and years (365); none-like values are null; everything else is unknown', () => {
    expect(parseDuration('30-days')).toEqual({ days: 30, known: true });
    expect(parseDuration('1-month')).toEqual({ days: 30, known: true });
    expect(parseDuration('3 months')).toEqual({ days: 90, known: true });
    expect(parseDuration('1-Year')).toEqual({ days: 365, known: true });
    for (const none of ['none', 'No', '0', 'no-warranty']) expect(parseDuration(none)).toEqual({ days: null, known: true });
    expect(parseDuration('whenever')).toEqual({ days: null, known: false });
    expect(parseDuration(undefined)).toEqual({ days: null, known: true });
  });

  it('labels: whole months as «N ماهه», other durations as «N روزه», without a duration the attributes or «گزینه K»', () => {
    expect(optionLabel(30, 0, {})).toBe('۱ ماهه');
    expect(optionLabel(90, 0, {})).toBe('۳ ماهه');
    expect(optionLabel(45, 0, {})).toBe('۴۵ روزه');
    expect(optionLabel(null, 0, { region: 'EU', warranty: '7-days' })).toBe('EU');
    expect(optionLabel(null, 2, {})).toBe('گزینه ۳');
  });

  it('unknown attributes: everything except the known keys, plus values that do not parse', () => {
    expect(unknownAttributes({ region: 'EU', warranty: '7-days', duration: '1-month' })).toEqual(['region=EU']);
    expect(unknownAttributes({ warranty: 'soon' })).toEqual(['warranty=soon']);
  });

  it('options from variations: existing sources start unselected and keep the product name', () => {
    const items: CatalogItem[] = [
      { remoteProductId: '1300', remoteVariationId: '', name: 'A', sku: '', priceUsd: 5, attributes: { 'subscription-duration': '1-month' } },
      { remoteProductId: '1300', remoteVariationId: '3m', name: 'A', sku: '', priceUsd: 14, attributes: { 'subscription-duration': '3-months' } },
    ];
    const opts = optionsFromItems(items, new Map([['3m', 'A — ۳ ماهه']]));
    expect(opts.map((o) => [o.label, o.selected, o.existingName])).toEqual([['۱ ماهه', true, null], ['۳ ماهه', false, 'A — ۳ ماهه']]);
  });
});

describe('active source (§6.3 step 1)', () => {
  const src = (over: Partial<SourceRow>): SourceRow => ({
    id: 1, supplier_id: 1, priority: 1, is_enabled: 1, listed: 1, price_usd: 5, oos_until: null, sup_enabled: 1, ...over,
  });
  const NOW = '2026-10-25 12:00:00';

  it('the first enabled, listed, priced, in-stock source of an enabled supplier', () => {
    const sources = [
      src({ id: 1, priority: 1, is_enabled: 0 }),
      src({ id: 2, priority: 2, listed: 0 }),
      src({ id: 3, priority: 3, price_usd: null }),
      src({ id: 4, priority: 4, sup_enabled: 0 }),
      src({ id: 5, priority: 5, oos_until: '2026-10-25 13:00:00' }),
      src({ id: 6, priority: 6, oos_until: '2026-10-25 11:00:00' }),
    ];
    expect(pickActiveSource(sources, NOW)?.id).toBe(6);
    expect(pickActiveSource([src({ is_enabled: 0 })], NOW)).toBeNull();
  });
});

describe('floor check on a list of options (§5.4)', () => {
  it('reports the first option whose discounted price is below its cost', () => {
    const opts = [
      { name: 'A', price: 1_000_000, cost_toman: 700_000 },
      { name: 'B', price: 900_000, cost_toman: 800_000 },
      { name: 'C', price: 900_000, cost_toman: null },
    ];
    expect(firstBelowCost(opts, { discount_type: 'percent', discount_value: 20 })).toEqual({ name: 'B', price: 900_000, cost: 800_000 });
    expect(firstBelowCost(opts, { discount_type: 'percent', discount_value: 5 })).toBeNull();
    expect(firstBelowCost(opts, { discount_type: 'fixed', discount_value: 150_000 })).toEqual({ name: 'B', price: 900_000, cost: 800_000 });
  });
});

describe('price formula is integer-safe (review should-fix 1)', () => {
  // each line: cost, percent → hard-coded expected price (not computed with finalPrice)
  const cases: [number, number, number][] = [
    [100_000, 10, 110_000], [200_000, 10, 220_000], [400_000, 10, 440_000], [700_000, 10, 770_000], [900_000, 10, 990_000],
    [750_000, 12, 840_000], [1_250_000, 12, 1_400_000],
    [1_420_848, 15, 1_640_000],
  ];
  it.each(cases)('cost $0 + $1 percent → $2', (cost, percent, expected) => {
    expect(finalPrice(cost, { percent, fixed: 0 })).toBe(expected);
  });

  it('a fixed amount is added before the round-up, and a fraction of a percent still counts', () => {
    expect(finalPrice(100_000, { percent: 10, fixed: 10_000 })).toBe(120_000);
    expect(finalPrice(100_000, { percent: 10, fixed: 1 })).toBe(120_000);
    expect(finalPrice(100_000, { percent: 12.5, fixed: 0 })).toBe(120_000);
    expect(finalPrice(80_000, { percent: 12.5, fixed: 0 })).toBe(90_000);
  });
});
