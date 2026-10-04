import { useEffect, useMemo, useRef, useState, type CSSProperties } from 'react';
import { Check, ChevronDown, Search } from 'lucide-react';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { cn } from '@/lib/utils';
import {
  COUNTRIES,
  callingCodeOf,
  composePhone,
  countryByCode,
  countryFromInternationalInput,
  countryFromTimezone,
  getCountryName,
  splitPhone,
  type Country,
} from '@/lib/countries';
import { useLanguage } from '@/contexts/LanguageContext';

// LE champ téléphone de Yuno — public, Console, app Pro et super admin. À
// gauche le pays (drapeau + indicatif, liste cherchable), à droite le numéro
// mis en forme selon ce pays. Tout numéro saisi dans Yuno passe par ici : un
// `<input type="tel">` nu laisse un client belge ou anglais taper son numéro
// sans indicatif, et ce numéro devient injoignable (SMS, WhatsApp, porte).
//
// La liste des pays est celle de `@/lib/countries` — une seule source, sinon
// les copies divergent. La valeur rendue est « {indicatif} {numéro} »
// (« +33 6 12 34 56 78 »), ou '' tant qu'aucun chiffre n'est saisi.

/** Pays du navigateur, déduit du fuseau — le meilleur défaut quand l'écran
 *  n'en connaît pas (profil, réglages) : un Espagnol ouvre sur +34. */
function browserCountry(): Country | null {
  try {
    return countryFromTimezone(Intl.DateTimeFormat().resolvedOptions().timeZone);
  } catch {
    return null;
  }
}

function fold(s: string): string {
  return s.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();
}

interface PhoneInputWithCountryProps {
  value: string | null | undefined;
  onChange: (fullPhone: string) => void;
  id?: string;
  name?: string;
  /** Remplace l'exemple de numéro du pays (rarement utile : l'exemple suit le pays choisi). */
  placeholder?: string;
  className?: string;
  /**
   * Indicatif pré-sélectionné tant que le champ est vide — le pays où se
   * déroule la soirée, pas celui du siège de Yuno. Un client à Madrid qui tape
   * « 6xx » sous un drapeau français laisse un numéro injoignable, et personne
   * ne s'en aperçoit avant d'en avoir besoin. Code ISO alpha-2 ; absent = pays
   * du navigateur, puis France.
   */
  defaultCountry?: string | null;
  /** `md` = 44 px (formulaires publics), `sm` = 40 px (dialogues, Console). */
  size?: 'sm' | 'md';
  disabled?: boolean;
  required?: boolean;
  autoFocus?: boolean;
  onBlur?: () => void;
  /** Surcharges de style, pour se fondre dans le design system de l'écran hôte. */
  inputClassName?: string;
  triggerClassName?: string;
  inputStyle?: CSSProperties;
  triggerStyle?: CSSProperties;
  /** `dark` (défaut) : DA publique et Console ; `light` : écrans clairs (Yuno CRM). */
  tone?: 'dark' | 'light';
}

/** Les classes de chaque teinte : le champ, l'indicatif et la liste des pays. */
const TONES = {
  dark: {
    trigger: 'border-white/[0.08] bg-[var(--sf-1f1f22)] hover:border-white/[0.16]',
    code: 'text-white',
    muted: 'text-[var(--tx-5a5a5e)]',
    panel: 'border-white/[0.10] bg-[var(--sf-141414)] text-white shadow-[0_16px_40px_rgba(0,0,0,0.5)]',
    divider: 'border-white/[0.08]',
    search: 'text-white placeholder:text-[var(--tx-5a5a5e)]',
    row: 'hover:bg-white/[0.05]',
    name: 'text-[var(--tx-e5e5e5)]',
    input: 'border-white/[0.08] bg-[var(--sf-1f1f22)] text-white placeholder:text-[var(--tx-5a5a5e)] focus-visible:border-primary/50',
  },
  light: {
    trigger: 'border-[#E9E2DF] bg-white hover:border-[#D9CFCB]',
    code: 'text-[#1C1517]',
    muted: 'text-[#9A8F92]',
    panel: 'border-[#E9E2DF] bg-white text-[#1C1517] shadow-[0_16px_40px_rgba(28,21,23,0.16)]',
    divider: 'border-[#F1ECEA]',
    search: 'text-[#1C1517] placeholder:text-[#9A8F92]',
    row: 'hover:bg-[#F7F3F1]',
    name: 'text-[#3D3437]',
    input: 'border-[#E9E2DF] bg-white text-[#1C1517] placeholder:text-[#B5ABAE] focus-visible:border-[#F25A4D]',
  },
} as const;

export function PhoneInputWithCountry({
  value,
  onChange,
  id,
  name,
  placeholder,
  className,
  defaultCountry,
  size = 'md',
  disabled,
  required,
  autoFocus,
  onBlur,
  inputClassName,
  triggerClassName,
  inputStyle,
  triggerStyle,
  tone = 'dark',
}: PhoneInputWithCountryProps) {
  const k = TONES[tone];
  const { language, t } = useLanguage();
  const lang = (language === 'fr' || language === 'es' ? language : 'en') as 'en' | 'fr' | 'es';
  const fallback = useMemo(
    () => countryByCode(defaultCountry) ?? browserCountry() ?? COUNTRIES[0],
    [defaultCountry],
  );

  const parsed = splitPhone(value, fallback);

  // Le pays vit dans le composant : choisir « Belgique » avant de taper doit
  // tenir même si la valeur reste vide, et deux pays qui partagent un
  // indicatif (+1 États-Unis / Canada, +262 La Réunion / Mayotte) ne doivent
  // pas se remplacer l'un l'autre à chaque frappe.
  const [country, setCountry] = useState<Country>(parsed.country);
  const picked = useRef(false);

  useEffect(() => {
    if (parsed.recognized) {
      if (callingCodeOf(parsed.country) !== callingCodeOf(country)) setCountry(parsed.country);
    } else if (!picked.current && !(value ?? '').trim() && fallback.code !== country.code) {
      // Le pays de la soirée arrive souvent après le premier rendu.
      setCountry(fallback);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [value, parsed.recognized, parsed.country.code, fallback.code]);

  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState('');

  const results = useMemo(() => {
    const q = fold(query.trim());
    if (!q) return COUNTRIES;
    const digits = q.replace(/\D/g, '');
    return COUNTRIES.filter((c) =>
      fold(c.names.en).includes(q)
      || fold(c.names.fr).includes(q)
      || fold(c.names.es).includes(q)
      || c.code.toLowerCase() === q
      || (digits.length > 0 && callingCodeOf(c).slice(1).startsWith(digits)),
    );
  }, [query]);

  const pick = (next: Country) => {
    picked.current = true;
    setCountry(next);
    setOpen(false);
    setQuery('');
    // Les chiffres déjà tapés sont regroupés au format du nouveau pays.
    onChange(composePhone(parsed.national, next));
  };

  const handleNumber = (raw: string) => {
    // « +44 7911 123456 » collé ou tapé à droite : le pays suit le numéro.
    const intl = countryFromInternationalInput(raw);
    const target = intl && callingCodeOf(intl) !== callingCodeOf(country) ? intl : country;
    if (target !== country) {
      picked.current = true;
      setCountry(target);
    }
    onChange(composePhone(raw, target));
  };

  const h = size === 'sm' ? 'h-10' : 'h-11';

  return (
    <div className={cn('flex w-full min-w-0 gap-2', className)}>
      <Popover open={open} onOpenChange={(o) => { setOpen(o); if (!o) setQuery(''); }}>
        <PopoverTrigger asChild>
          <button
            type="button"
            disabled={disabled}
            aria-label={`${t('phone.countryCode')} : ${getCountryName(country, lang)} ${callingCodeOf(country)}`}
            className={cn(
              h,
              'flex shrink-0 items-center gap-1.5 rounded-lg border px-2.5 transition-colors disabled:cursor-not-allowed disabled:opacity-50',
              k.trigger,
              triggerClassName,
            )}
            style={triggerStyle}
          >
            <span className="text-lg leading-none">{country.flag}</span>
            <span className={cn('text-sm tabular-nums', k.code)}>{callingCodeOf(country)}</span>
            <ChevronDown className={cn('h-3.5 w-3.5 transition-transform', k.muted, open && 'rotate-180')} />
          </button>
        </PopoverTrigger>
        <PopoverContent
          align="start"
          className={cn('w-72 overflow-hidden rounded-xl border p-0', k.panel)}
          onOpenAutoFocus={(e) => {
            // Sur mobile, ouvrir le clavier par-dessus la liste la masquerait.
            if (window.matchMedia?.('(pointer: coarse)').matches) e.preventDefault();
          }}
        >
          <div className={cn('flex items-center gap-2 border-b px-3', k.divider)}>
            <Search className={cn('h-3.5 w-3.5 shrink-0', k.muted)} />
            <input
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter') {
                  e.preventDefault();
                  if (results[0]) pick(results[0]);
                }
              }}
              placeholder={t('phone.searchCountry')}
              className={cn('h-10 w-full bg-transparent text-sm outline-none', k.search)}
            />
          </div>
          <div className="max-h-64 overflow-y-auto overscroll-contain py-1" role="listbox">
            {results.length === 0 && (
              <p className={cn('px-3 py-4 text-center text-xs', k.muted)}>{t('phone.noCountry')}</p>
            )}
            {results.map((c) => {
              const active = c.code === country.code;
              return (
                <button
                  key={c.code}
                  type="button"
                  role="option"
                  aria-selected={active}
                  onClick={() => pick(c)}
                  className={cn(
                    'flex w-full items-center gap-3 px-3 py-2 text-left transition-colors',
                    k.row,
                    active && 'bg-primary/10',
                  )}
                >
                  <span className="text-lg leading-none">{c.flag}</span>
                  <span className={cn('flex-1 truncate text-sm', k.name)}>{getCountryName(c, lang)}</span>
                  <span className={cn('text-xs tabular-nums', k.muted)}>{callingCodeOf(c)}</span>
                  {active && <Check className="h-3.5 w-3.5 text-primary" />}
                </button>
              );
            })}
          </div>
        </PopoverContent>
      </Popover>

      <input
        id={id}
        name={name}
        type="tel"
        inputMode="tel"
        autoComplete="tel-national"
        disabled={disabled}
        required={required}
        autoFocus={autoFocus}
        onBlur={onBlur}
        placeholder={placeholder ?? country.format}
        value={parsed.national}
        onChange={(e) => handleNumber(e.target.value)}
        className={cn(
          h,
          'min-w-0 flex-1 rounded-lg border px-3 text-base outline-none transition-colors disabled:cursor-not-allowed disabled:opacity-50 md:text-sm',
          k.input,
          inputClassName,
        )}
        style={inputStyle}
      />
    </div>
  );
}

export default PhoneInputWithCountry;
