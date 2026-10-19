// Date de naissance en trois cases Jour / Mois / Année, clavier numérique,
// remplissage automatique (bday-*) — modèle GOV.UK « memorable date ». La case
// suivante prend le curseur dès que la précédente est pleine, et une date collée
// d'un coup (« 14/03/2001 ») remplit les trois.
import { useRef, type ClipboardEvent, type KeyboardEvent } from 'react';
import { useLanguage } from '@/contexts/LanguageContext';
import { clampDigits, partsFromPaste, type BirthDateField, type BirthDateParts } from '@/lib/birthDate';
import { checkoutInputClass } from './checkoutFieldStyle';

interface BirthDateFieldsProps {
  idPrefix: string;
  value: BirthDateParts;
  onChange: (parts: BirthDateParts) => void;
  onBlur?: () => void;
  /** Case(s) à entourer en rouge : une case précise, ou toutes (`'all'`). */
  invalid?: BirthDateField | 'all' | null;
  describedBy?: string;
}

const FIELDS: { key: BirthDateField; max: number; width: string; label: string; ph: string; ac: string }[] = [
  { key: 'day', max: 2, width: 'w-[72px]', label: 'ticketCheckout.birthDay', ph: 'ticketCheckout.birthDayPh', ac: 'bday-day' },
  { key: 'month', max: 2, width: 'w-[72px]', label: 'ticketCheckout.birthMonth', ph: 'ticketCheckout.birthMonthPh', ac: 'bday-month' },
  { key: 'year', max: 4, width: 'w-[100px]', label: 'ticketCheckout.birthYear', ph: 'ticketCheckout.birthYearPh', ac: 'bday-year' },
];

export function BirthDateFields({ idPrefix, value, onChange, onBlur, invalid, describedBy }: BirthDateFieldsProps) {
  const { t } = useLanguage();
  const refs = useRef<Record<BirthDateField, HTMLInputElement | null>>({ day: null, month: null, year: null });

  const focus = (field: BirthDateField) => refs.current[field]?.focus();

  const set = (field: BirthDateField, raw: string, max: number) => {
    const next = clampDigits(raw, max);
    onChange({ ...value, [field]: next });
    // Case pleine : on passe à la suivante (jamais en arrière, jamais sur l'année).
    if (next.length === max && next !== value[field]) {
      if (field === 'day') focus('month');
      else if (field === 'month') focus('year');
    }
  };

  const onPaste = (e: ClipboardEvent<HTMLInputElement>) => {
    const parts = partsFromPaste(e.clipboardData.getData('text'));
    if (!parts) return;
    e.preventDefault();
    onChange(parts);
    focus('year');
  };

  const onKeyDown = (field: BirthDateField) => (e: KeyboardEvent<HTMLInputElement>) => {
    // Retour arrière sur une case vide : on revient à la précédente.
    if (e.key !== 'Backspace' || value[field]) return;
    if (field === 'year') focus('month');
    else if (field === 'month') focus('day');
  };

  return (
    <div
      className="flex gap-2"
      // Sortie du GROUPE seulement : passer du jour au mois n'est pas « quitter
      // le champ », sinon « Entrez le mois » s'afficherait avant qu'on le tape.
      onBlur={(e) => {
        if (onBlur && !e.currentTarget.contains(e.relatedTarget as Node | null)) onBlur();
      }}
    >
      {FIELDS.map((f) => {
        const isInvalid = invalid === 'all' || invalid === f.key;
        const id = `${idPrefix}-${f.key}`;
        return (
          <div key={f.key} className={`flex flex-col gap-[5px] ${f.width}`}>
            <label htmlFor={id} className="text-[11.5px] text-[#9A9A9A]">{t(f.label)}</label>
            <input
              id={id}
              ref={(el) => { refs.current[f.key] = el; }}
              type="text"
              inputMode="numeric"
              pattern="[0-9]*"
              autoComplete={f.ac}
              maxLength={f.max}
              placeholder={t(f.ph)}
              value={value[f.key]}
              onChange={(e) => set(f.key, e.target.value, f.max)}
              onKeyDown={onKeyDown(f.key)}
              onPaste={onPaste}
              aria-invalid={isInvalid || undefined}
              aria-describedby={describedBy}
              className={checkoutInputClass(isInvalid, 'px-2 text-center tabular-nums')}
            />
          </div>
        );
      })}
    </div>
  );
}
