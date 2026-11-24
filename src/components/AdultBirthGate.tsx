import { useState, useEffect, type Ref } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { useLanguage } from '@/contexts/LanguageContext';
import { ageOn, readBirthDate, splitIsoBirthDate, type BirthDateField, type BirthDateParts, type BirthDateState } from '@/lib/birthDate';
import { BirthDateFields } from '@/components/checkout/BirthDateFields';
import { FieldError, FieldHint } from '@/components/checkout/checkoutFieldUi';
import { CHECKOUT_ERROR } from '@/components/checkout/checkoutFieldStyle';

interface AdultBirthGateProps {
  userId?: string | null;
  /** Vrai quand la date est connue ET que la personne a 18 ans ou plus. */
  onReady: (ready: boolean) => void;
  /** Date de naissance valide (AAAA-MM-JJ) d'une personne majeure, sinon null. */
  onBirthDate?: (iso: string | null) => void;
  /** Ce que la personne a tapé, lu par le formulaire de la page ; null = date
   *  déjà connue par le profil, rien à demander. */
  onBirthState?: (state: BirthDateState | null) => void;
  /** Message de saisie posé par la page (au tap, ou en quittant les cases). */
  error?: string | null;
  invalidField?: BirthDateField | 'all' | null;
  onBlur?: () => void;
  /** Ancre : la page y descend quand la date est le premier oubli. */
  anchorRef?: Ref<HTMLFieldSetElement>;
  /** Ligne sous la date. */
  hint?: string;
}

// Porte d'âge des paiements (billet, table). Yuno est réservé aux majeurs : une
// date de naissance est exigée, et une personne de moins de 18 ans ne peut pas
// acheter. Une date saisie par un compte connecté est gardée sur le profil et
// n'est plus jamais redemandée.
export function AdultBirthGate({
  userId, onReady, onBirthDate, onBirthState, error, invalidField, onBlur, anchorRef, hint,
}: AdultBirthGateProps) {
  const { t } = useLanguage();
  const [parts, setParts] = useState<BirthDateParts>({ day: '', month: '', year: '' });
  // Date lue sur le profil : on ne la redemande pas.
  const [prefilled, setPrefilled] = useState(false);
  // Compte dont le profil a été lu. Tant qu'il ne l'est pas, rien ne s'affiche :
  // sinon les cases apparaissent le temps de la lecture, puis disparaissent, et
  // la personne croit qu'on lui redemande une date qu'elle a déjà donnée.
  const [checkedFor, setCheckedFor] = useState<string | null>(null);
  const profileChecked = !userId || checkedFor === userId;

  const birthState = readBirthDate(parts);
  const birthDate = birthState.status === 'valid' ? birthState.iso : '';
  const age = birthDate ? ageOn(birthDate) : null;
  const isAdult = age !== null && age >= 18;
  const underage = age !== null && age < 18;

  useEffect(() => {
    if (!userId) return;
    let cancelled = false;
    supabase
      .from('profiles')
      .select('birth_date')
      .eq('id', userId)
      .maybeSingle()
      .then(({ data }) => {
        if (cancelled) return;
        if (data?.birth_date) {
          setParts(splitIsoBirthDate(data.birth_date));
          setPrefilled(true);
        }
        // Lecture en échec : les cases s'affichent, on ne bloque pas l'achat.
        setCheckedFor(userId);
      });
    return () => { cancelled = true; };
  }, [userId]);

  // Clé texte : l'objet est recréé à chaque rendu, la lecture non.
  // `onBirthState` doit être stable (un setter de useState).
  const stateKey = JSON.stringify(birthState);
  useEffect(() => {
    onBirthState?.(prefilled ? null : (JSON.parse(stateKey) as BirthDateState));
  }, [prefilled, stateKey, onBirthState]);

  useEffect(() => {
    onReady(isAdult);
    onBirthDate?.(isAdult ? birthDate : null);
  }, [birthDate]); // eslint-disable-line react-hooks/exhaustive-deps

  // Une date saisie par un compte connecté est gardée pour les prochaines fois.
  useEffect(() => {
    if (!userId || prefilled || age === null) return;
    supabase.from('profiles').update({ birth_date: birthDate }).eq('id', userId).then(() => {});
  }, [birthDate]); // eslint-disable-line react-hooks/exhaustive-deps

  // Profil pas encore lu, ou majeur déjà connu → rien à demander, rien à montrer.
  if (!profileChecked || (prefilled && isAdult)) return null;

  const hintId = 'ck-birth-hint';
  const shownError = error && !prefilled ? error : null;

  return (
    <fieldset ref={anchorRef} className="m-0 min-w-0 scroll-mt-24 border-0 p-0">
      {!prefilled && (
        <>
          <legend
            className="p-0 font-mono text-[11px] font-semibold uppercase tracking-[0.08em]"
            style={{ color: shownError || underage ? CHECKOUT_ERROR : '#9A9A9A' }}
          >
            {t('birthGate.label')}
          </legend>
          <div className="mt-[7px]">
            <BirthDateFields
              idPrefix="ck-birth"
              value={parts}
              onChange={setParts}
              onBlur={onBlur}
              invalid={shownError ? (invalidField ?? 'all') : underage ? 'all' : null}
              describedBy={hintId}
            />
          </div>
        </>
      )}

      <div id={hintId} className="mt-[7px]">
        {underage ? (
          <FieldError>{t('birthGate.mustBeAdult')}</FieldError>
        ) : shownError ? (
          <FieldError>{shownError}</FieldError>
        ) : !prefilled ? (
          <FieldHint>{hint ?? t('ticketCheckout.birthHintAdults')}</FieldHint>
        ) : null}
      </div>
    </fieldset>
  );
}
