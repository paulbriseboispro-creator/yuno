import { useLanguage } from '@/contexts/LanguageContext';
import { formatMoney, formatMoneyAxis, formatMoneyNegative, localeFor } from '@/lib/money';

/** Hook : `const { money } = useMoney(); money(12.5)` → « 12,50 € ». */
export function useMoney() {
  const { language } = useLanguage();
  const locale = localeFor(language);
  return {
    locale,
    money: (v: number | string | null | undefined) => formatMoney(v, locale),
    moneyNeg: (v: number) => formatMoneyNegative(v, locale),
    axis: (v: number) => formatMoneyAxis(v, locale),
  };
}
