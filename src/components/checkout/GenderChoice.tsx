// Le genre d'une inscription guest list à quotas Femme / Homme : deux choix
// côte à côte, jamais un menu déroulant. Un genre imposé par le lien (`?gender=`)
// s'affiche seul, déjà choisi.
import type { Ref } from 'react';
import { useLanguage } from '@/contexts/LanguageContext';
import { cn } from '@/lib/utils';
import { FieldError, FieldLabel } from './checkoutFieldUi';

export type GuestGender = 'female' | 'male';

interface GenderChoiceProps {
  value: string;
  onChange: (gender: GuestGender) => void;
  /** Genres encore ouverts (un quota à 0 retire le sien). */
  options: GuestGender[];
  /** Message déjà traduit (au tap, quand rien n'est choisi). */
  error?: string | null;
  anchorRef?: Ref<HTMLDivElement>;
  /** Genre fixé par le lien : montré, pas modifiable. */
  locked?: boolean;
}

export function GenderChoice({ value, onChange, options, error, anchorRef, locked }: GenderChoiceProps) {
  const { t } = useLanguage();
  return (
    <div ref={anchorRef} className="flex scroll-mt-24 flex-col gap-[7px]">
      <FieldLabel id="ck-gender-label" invalid={!!error}>{t('guestList.gender')}</FieldLabel>
      <div role="radiogroup" aria-labelledby="ck-gender-label" className="grid grid-cols-2 gap-2">
        {options.map((g) => {
          const selected = value === g;
          return (
            <button
              key={g}
              type="button"
              role="radio"
              aria-checked={selected}
              aria-invalid={!!error || undefined}
              disabled={locked}
              onClick={() => onChange(g)}
              className={cn(
                'h-12 rounded-lg border text-base font-medium transition-colors disabled:cursor-default',
                selected
                  ? 'border-white/70 bg-white/[0.10] text-white'
                  : error
                    ? 'border-2 border-[#FF5A68] bg-[#241618] text-[#E5E5E5]'
                    : 'border-white/[0.10] bg-[#1F1F22] text-[#E5E5E5] hover:border-white/30',
              )}
            >
              {t(g === 'female' ? 'guestList.female' : 'guestList.male')}
            </button>
          );
        })}
      </div>
      {error && <FieldError>{error}</FieldError>}
    </div>
  );
}
