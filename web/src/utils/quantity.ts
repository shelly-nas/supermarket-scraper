import { Product } from '../types';

const UNIT_LABELS = { kg: 'kg', l: 'liter', stuk: 'stuk' } as const;

const formatNumber = (value: number) =>
  value.toLocaleString('nl-NL', { maximumFractionDigits: 2 });

/** Pack size: the supermarket's own text, else the parsed quantity ("288 g", "1,5 liter"). */
export function packSize(product: Product): string | null {
  if (product.unit_size) return product.unit_size;
  const { quantity_value: value, quantity_unit: unit } = product;
  if (!value || value <= 0 || !unit) return null;
  if (unit === 'kg') return value < 1 ? `${formatNumber(value * 1000)} g` : `${formatNumber(value)} kg`;
  if (unit === 'l') return value < 1 ? `${formatNumber(value * 1000)} ml` : `${formatNumber(value)} liter`;
  return value === 1 ? '1 stuk' : `${formatNumber(value)} stuks`;
}

/** Price per kilo, liter or piece, rounded to cents; null without a quantity. */
export function pricePerUnit(price: number, product: Product): { value: number; unit: string } | null {
  const { quantity_value: value, quantity_unit: unit } = product;
  if (!value || value <= 0 || !unit) return null;
  return { value: Math.round(Math.round(price * 100) / value) / 100, unit: UNIT_LABELS[unit] };
}
