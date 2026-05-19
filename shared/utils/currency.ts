// Currency symbols and locale map
const CURRENCY_CONFIG: Record<string, { symbol: string; locale: string }> = {
  NGN: { symbol: '₦', locale: 'en-NG' },
  GHS: { symbol: '₵', locale: 'en-GH' },
  KES: { symbol: 'KSh', locale: 'en-KE' },
  ZAR: { symbol: 'R', locale: 'en-ZA' },
  USD: { symbol: '$', locale: 'en-US' },
  GBP: { symbol: '£', locale: 'en-GB' },
  EUR: { symbol: '€', locale: 'de-DE' },
};

/**
 * Format a price value with the correct currency symbol and locale.
 * @param value - The numeric price (wrap Prisma Decimal in Number() before calling)
 * @param currency - ISO 4217 currency code (defaults to NGN)
 */
export function formatPrice(value: number | string, currency = 'NGN'): string {
  const config = CURRENCY_CONFIG[currency] ?? CURRENCY_CONFIG['NGN'];
  const formatted = Number(value).toLocaleString(config.locale, {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });
  return config.symbol + formatted;
}
