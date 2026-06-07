export function formatCurrency(amount: number, currency = 'NGN', locale = 'en-NG'): string {
  return new Intl.NumberFormat(locale, {
    style: 'currency',
    currency,
    minimumFractionDigits: 2,
  }).format(amount);
}

export function stockStatus(current: number, reorderPoint: number): 'ok' | 'low' | 'out' {
  if (current <= 0) return 'out';
  if (current <= reorderPoint) return 'low';
  return 'ok';
}
