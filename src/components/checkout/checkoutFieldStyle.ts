// Styles des champs du paiement public, partagés par les composants de champ.
import { cn } from '@/lib/utils';

export const CHECKOUT_ERROR = '#FF5A68';

export function checkoutInputClass(invalid = false, extra?: string) {
  return cn(
    'h-12 w-full min-w-0 rounded-lg border px-3.5 text-base text-white outline-none transition-colors',
    'placeholder:text-[#8A8A8F] disabled:cursor-not-allowed read-only:text-[#E5E5E5]',
    invalid
      ? 'border-2 border-[#FF5A68] bg-[#241618]'
      : 'border-white/[0.10] bg-[#1F1F22] focus:border-white/45 focus:bg-[#232327]',
    extra,
  );
}
