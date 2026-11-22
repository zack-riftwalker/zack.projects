import type { StoreApp } from '../../apps';
import { formatPrice } from '../utils';
import { applyDiscount } from '../handlers/discountCodes';

export interface FloorViolation { name: string; price: number; cost: number }

/** The first option whose discounted price would fall below its cost (SUPPLIER_PLAN.md §5.4). Pure. */
export function firstBelowCost(
  options: { name: string; price: number; cost_toman?: number | null }[],
  code: { discount_type: string; discount_value: number },
): FloorViolation | null {
  for (const o of options) {
    if (o.cost_toman == null) continue;
    if (applyDiscount(o.price, code as any) < o.cost_toman) return { name: o.name, price: o.price, cost: o.cost_toman };
  }
  return null;
}

/** For a code on one product, or on a whole group (every option of it). */
export async function codeFloorViolation(
  app: StoreApp,
  target: { customerProductId: number; productGroupId: number | null | undefined },
  code: { discount_type: string; discount_value: number },
): Promise<FloorViolation | null> {
  const options = target.productGroupId != null
    ? (await app.db.getGroupWithOptions(target.productGroupId)).options
    : [await app.db.getCustomerProductById(target.customerProductId)].filter((p): p is NonNullable<typeof p> => !!p);
  return firstBelowCost(options, code);
}

export function floorMessage(v: FloorViolation): string {
  return '⛔️ با این تخفیف، قیمت «' + v.name + '» (' + formatPrice(v.price) + ' تومان) از قیمت خرید (' + formatPrice(v.cost) +
    ' تومان) کمتر می‌شود. مقدار کمتری وارد کنید.';
}
