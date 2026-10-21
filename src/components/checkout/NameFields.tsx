// « Prénom » et « Nom » sur la même ligne. La donnée reste UN nom complet
// (`full_name` partout : reçus, liste de porte, e-mails) : les deux cases se recomposent
// par `composeFullName` à chaque frappe, et un nom déjà connu (profil, brouillon) se range
// dans les deux cases par `splitFullName`. Les attributs `autocomplete` (given-name /
// family-name) laissent le navigateur remplir chaque case : c'est ce qui évite le pseudo
// recopié dans un champ sans attribut (« Inactif », 11/09/2026).
import { useEffect, useState } from 'react';
import { useLanguage } from '@/contexts/LanguageContext';
import { cleanNamePart, composeFullName, splitFullName } from '@/lib/guestName';
import { FieldLabel, FieldValidMark } from './checkoutFieldUi';
import { checkoutInputClass } from './checkoutFieldStyle';

interface NameFieldsProps {
  /** Le nom complet tel que le porte le formulaire. */
  value: string;
  onChange: (fullName: string) => void;
  /** Préfixe des ids : `${id}-first` et `${id}-last`. */
  id: string;
  invalid?: boolean;
  /** Coche verte quand le nom est juste. */
  valid?: boolean;
  onBlur?: () => void;
  describedBy?: string;
  firstAutoComplete?: string;
  lastAutoComplete?: string;
  /** Texte d'aide des cases (défaut : « Prénom » / « Nom »). */
  firstPlaceholder?: string;
  lastPlaceholder?: string;
  /** Un libellé visible au-dessus de chaque case (« Prénom », « Nom »), pas seulement un texte d'aide. */
  showLabels?: boolean;
}

export function NameFields({
  value, onChange, id, invalid = false, valid = false, onBlur, describedBy,
  firstAutoComplete = 'given-name', lastAutoComplete = 'family-name', firstPlaceholder, lastPlaceholder, showLabels = false,
}: NameFieldsProps) {
  const { t } = useLanguage();
  const [parts, setParts] = useState(() => splitFullName(value));

  // Un nom qui arrive d'ailleurs (profil lu après coup, quantité changée) : on le range
  // dans les deux cases, sans toucher à ce que la personne est en train de taper.
  useEffect(() => {
    if (composeFullName(parts.first, parts.last) !== cleanNamePart(value)) setParts(splitFullName(value));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [value]);

  const update = (next: { first: string; last: string }) => {
    setParts(next);
    onChange(composeFullName(next.first, next.last));
  };

  return (
    <div className="grid grid-cols-2 gap-3">
      <div className="flex min-w-0 flex-col gap-[7px]">
        {showLabels && <FieldLabel htmlFor={`${id}-first`} invalid={invalid}>{t('ticketCheckout.firstName')}</FieldLabel>}
        <div className="relative">
        <input
          id={`${id}-first`}
          type="text"
          autoComplete={firstAutoComplete}
          autoCapitalize="words"
          enterKeyHint="next"
          placeholder={firstPlaceholder ?? t('ticketCheckout.firstNamePlaceholder')}
          aria-label={t('ticketCheckout.firstName')}
          value={parts.first}
          onChange={(e) => update({ ...parts, first: e.target.value })}
          onBlur={onBlur}
          aria-invalid={invalid || undefined}
          aria-describedby={describedBy}
          className={checkoutInputClass(invalid)}
        />
        </div>
      </div>
      <div className="flex min-w-0 flex-col gap-[7px]">
        {showLabels && <FieldLabel htmlFor={`${id}-last`} invalid={invalid}>{t('ticketCheckout.lastName')}</FieldLabel>}
        <div className="relative">
        <input
          id={`${id}-last`}
          type="text"
          autoComplete={lastAutoComplete}
          autoCapitalize="words"
          enterKeyHint="next"
          placeholder={lastPlaceholder ?? t('ticketCheckout.lastNamePlaceholder')}
          aria-label={t('ticketCheckout.lastName')}
          value={parts.last}
          onChange={(e) => update({ ...parts, last: e.target.value })}
          onBlur={onBlur}
          aria-invalid={invalid || undefined}
          aria-describedby={describedBy}
          className={checkoutInputClass(invalid, valid ? 'pr-10' : undefined)}
        />
        {valid && !invalid && <FieldValidMark label={t('buyer.valid')} />}
        </div>
      </div>
    </div>
  );
}
