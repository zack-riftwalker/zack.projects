import { afterEach, expect } from 'vitest';
import { budgets } from './helpers/env';

afterEach(() => {
  const over = budgets.filter((b) => b.exceeded);
  const worst = budgets.reduce((m, b) => Math.max(m, b.used), 0);
  budgets.length = 0;
  expect(over.length, 'an invocation exceeded the 50-call free-plan budget').toBe(0);
  expect(worst).toBeLessThanOrEqual(50);
});
