// L'état d'affichage du formulaire « Vos infos » (billets, tables, guest list) :
// un champ dit son erreur quand on le quitte, sauf « obligatoire », réservé au
// tap sur le bouton ; au tap, la page descend au premier oubli. Les règles
// elles-mêmes vivent dans src/lib/buyerForm.ts (pures, testées).
import { useState } from 'react';
import { useLanguage } from '@/contexts/LanguageContext';
import type { BirthDateField } from '@/lib/birthDate';
import type { BuyerErrorCode, BuyerErrors, BuyerField } from '@/lib/buyerForm';

/** « Obligatoire » ne s'affiche qu'au tap sur le bouton, jamais en quittant un champ vide. */
const REQUIRED_CODES = new Set<BuyerErrorCode>(['name_required', 'email_required', 'phone_required', 'birth_required']);

export function useBuyerFormUi(errors: BuyerErrors) {
  const { t } = useLanguage();
  const [touched, setTouched] = useState<Partial<Record<BuyerField, boolean>>>({});
  const [submitted, setSubmitted] = useState(false);

  const shownError = (f: BuyerField): string | null => {
    const code = errors[f];
    if (!code) return null;
    if (!submitted && (!touched[f] || REQUIRED_CODES.has(code))) return null;
    return t(`buyer.err.${code}`);
  };
  /** Coche verte : champ quitté avec une valeur juste. */
  const fieldValid = (f: 'name' | 'email' | 'phone', value: string) => !!touched[f] && !errors[f] && !!value.trim();
  const markTouched = (f: BuyerField) => setTouched((prev) => (prev[f] ? prev : { ...prev, [f]: true }));
  /** Formulaire vidé pour une autre personne : plus rien n'est signalé. */
  const reset = () => { setTouched({}); setSubmitted(false); };

  return { touched, submitted, setSubmitted, shownError, fieldValid, markTouched, reset };
}

/** La case de la date à entourer en rouge, d'après le code d'erreur. */
export function birthInvalidFieldFor(code: BuyerErrorCode | undefined): BirthDateField | 'all' {
  if (code === 'birth_day') return 'day';
  if (code === 'birth_month') return 'month';
  if (code === 'birth_year') return 'year';
  return 'all';
}

/** Descend au champ et y pose le curseur (le premier en défaut, sinon le premier modifiable). */
export function focusCheckoutField(el: HTMLElement | null) {
  if (!el) return;
  el.scrollIntoView({ behavior: 'smooth', block: 'center' });
  const input = el.querySelector<HTMLElement>('[aria-invalid="true"]') ?? el.querySelector<HTMLElement>('input:not([readonly]), button');
  window.setTimeout(() => input?.focus({ preventScroll: true }), 350);
}
