// « Où envoyer vos billets ? » — les coordonnées de l'acheteur, puis, repliés,
// les noms des amis. Pas de carte autour des champs, pas d'icône dans les
// champs : la page se lit de haut en bas. Un seul champ « Nom complet »
// (Baymard : 42 % se trompent avec Prénom / Nom), pas de « Confirmer l'e-mail »
// (GOV.UK) mais une correction proposée d'un tap, et le téléphone dit pourquoi
// on le demande (14 % refusent de le donner sans raison).
import { useState, type ReactNode, type Ref } from 'react';
import { ChevronDown, Users } from 'lucide-react';
import { useLanguage } from '@/contexts/LanguageContext';
import { PhoneInputWithCountry } from '@/components/PhoneInputWithCountry';
import type { AttendeeInfo } from '@/lib/buyerForm';
import { FieldError, FieldHint, FieldLabel, FieldValidMark } from './checkoutFieldUi';
import { checkoutInputClass } from './checkoutFieldStyle';

type ContactField = 'name' | 'email' | 'phone';

interface BuyerFieldsProps {
  buyer: AttendeeInfo;
  onChange: (field: keyof AttendeeInfo, value: string) => void;
  onBlur: (field: ContactField) => void;
  /** Messages déjà traduits, seulement pour les champs à signaler. */
  errors: Partial<Record<ContactField, string>>;
  /** Champs quittés avec une valeur juste : coche verte. */
  valid: Partial<Record<ContactField, boolean>>;
  /** Acheteur connecté : l'adresse est celle du compte, le serveur n'en lit pas d'autre. */
  emailReadOnly?: boolean;
  emailSuggestion?: string | null;
  onAcceptSuggestion?: () => void;
  /** Encart sous l'e-mail (« un compte existe déjà »). */
  emailNotice?: ReactNode;
  /** Indicatif pré-choisi : le pays de la soirée. */
  defaultCountry?: string | null;
  fieldRefs: Record<ContactField, Ref<HTMLDivElement>>;
}

export function BuyerFields({
  buyer, onChange, onBlur, errors, valid, emailReadOnly, emailSuggestion, onAcceptSuggestion, emailNotice, defaultCountry, fieldRefs,
}: BuyerFieldsProps) {
  const { t } = useLanguage();
  const validLabel = t('buyer.valid');

  return (
    <>
      <div ref={fieldRefs.name} className="flex scroll-mt-24 flex-col gap-[7px]">
        <FieldLabel htmlFor="ck-name" invalid={!!errors.name}>{t('ticketCheckout.fullName')}</FieldLabel>
        <div className="relative">
          <input
            id="ck-name"
            type="text"
            autoComplete="name"
            autoCapitalize="words"
            enterKeyHint="next"
            placeholder={t('ticketCheckout.fullNamePlaceholder')}
            value={buyer.fullName}
            onChange={(e) => onChange('fullName', e.target.value)}
            onBlur={() => onBlur('name')}
            aria-invalid={!!errors.name || undefined}
            aria-describedby={errors.name ? 'ck-name-err' : undefined}
            className={checkoutInputClass(!!errors.name, valid.name ? 'pr-10' : undefined)}
          />
          {valid.name && !errors.name && <FieldValidMark label={validLabel} />}
        </div>
        {errors.name && <FieldError id="ck-name-err">{errors.name}</FieldError>}
      </div>

      <div ref={fieldRefs.email} className="flex scroll-mt-24 flex-col gap-[7px]">
        <FieldLabel htmlFor="ck-email" invalid={!!errors.email}>{t('ticketCheckout.email')}</FieldLabel>
        <div className="relative">
          <input
            id="ck-email"
            type="email"
            inputMode="email"
            autoComplete="email"
            autoCapitalize="none"
            autoCorrect="off"
            spellCheck={false}
            enterKeyHint="next"
            readOnly={emailReadOnly}
            placeholder={t('ticketCheckout.emailPlaceholder')}
            value={buyer.email}
            onChange={(e) => onChange('email', e.target.value)}
            onBlur={() => onBlur('email')}
            aria-invalid={!!errors.email || undefined}
            aria-describedby="ck-email-hint"
            className={checkoutInputClass(!!errors.email, valid.email ? 'pr-10' : undefined)}
          />
          {valid.email && !errors.email && !emailSuggestion && <FieldValidMark label={validLabel} />}
        </div>
        {errors.email ? (
          <FieldError id="ck-email-hint">{errors.email}</FieldError>
        ) : emailSuggestion && onAcceptSuggestion ? (
          <div
            id="ck-email-hint"
            className="flex items-center gap-2.5 rounded-lg border border-amber-400/35 bg-amber-400/[0.07] px-3 py-2.5"
            role="status"
          >
            <span className="min-w-0 flex-1 text-[13px] leading-[1.4] text-[#E5E5E5] [overflow-wrap:anywhere]">
              {t('buyer.emailSuggestBefore')}
              <strong className="font-semibold text-amber-300">{emailSuggestion}</strong>
              {t('buyer.emailSuggestAfter')}
            </span>
            <button
              type="button"
              onClick={onAcceptSuggestion}
              className="h-9 shrink-0 rounded px-3 font-mono text-[10.5px] font-bold uppercase tracking-[0.08em] text-amber-300 transition-colors hover:bg-amber-400/10"
              style={{ border: '1px solid rgba(251,191,36,0.5)' }}
            >
              {t('buyer.emailSuggestFix')}
            </button>
          </div>
        ) : (
          <FieldHint id="ck-email-hint">{emailReadOnly ? t('ticketCheckout.emailAccountHint') : t('ticketCheckout.emailHint')}</FieldHint>
        )}
        {emailNotice}
      </div>

      <div ref={fieldRefs.phone} className="flex scroll-mt-24 flex-col gap-[7px]">
        <FieldLabel htmlFor="ck-phone" invalid={!!errors.phone}>{t('ticketCheckout.phone')}</FieldLabel>
        <div className="relative">
          <PhoneInputWithCountry
            id="ck-phone"
            value={buyer.phone}
            onChange={(value) => onChange('phone', value)}
            onBlur={() => onBlur('phone')}
            defaultCountry={defaultCountry}
            triggerClassName="h-12 rounded-lg border-white/[0.10] bg-[#1F1F22] px-3"
            inputClassName={checkoutInputClass(!!errors.phone, valid.phone ? 'pr-10' : undefined)}
          />
          {valid.phone && !errors.phone && <FieldValidMark label={validLabel} />}
        </div>
        {errors.phone ? <FieldError>{errors.phone}</FieldError> : <FieldHint>{t('ticketCheckout.phoneHint')}</FieldHint>}
      </div>
    </>
  );
}

interface FriendNamesProps {
  /** Les places des amis : attendees[1…]. */
  friends: AttendeeInfo[];
  /** Nom de l'acheteur, pour dire comment s'affiche un ami sans nom. */
  buyerName: string;
  /** index = position dans `attendees` (1 = premier ami). */
  onChange: (index: number, value: string) => void;
}

/**
 * Les noms des amis, REPLIÉS et facultatifs : chaque place a déjà son QR, et un
 * ami sans nom apparaît comme « <acheteur> +k » (règle serveur, ticket-places.ts).
 * La page ne grandit donc plus avec la quantité.
 */
export function FriendNames({ friends, buyerName, onChange }: FriendNamesProps) {
  const { t } = useLanguage();
  const [open, setOpen] = useState(() => friends.some((f) => f.fullName.trim()));
  if (friends.length === 0) return null;

  const shown = buyerName.trim() || t('ticketCheckout.you');
  const title = friends.length === 1
    ? t('ticketCheckout.friendsAddOne')
    : t('ticketCheckout.friendsAdd').replace('{n}', String(friends.length));

  return (
    <div className="overflow-hidden rounded-[10px] border border-white/[0.08] bg-[#141414]">
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        aria-expanded={open}
        aria-controls="ck-friends"
        className="flex w-full items-center gap-3 p-3.5 text-left"
      >
        <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-white/[0.06]" aria-hidden>
          <Users className="h-[18px] w-[18px] text-[#E5E5E5]" />
        </span>
        <span className="min-w-0 flex-1">
          <span className="block text-sm font-semibold text-white">{title}</span>
          <span className="mt-0.5 block text-[12.5px] leading-[1.4] text-[#9A9A9A]">
            {t('ticketCheckout.friendsHint').replace('{name}', shown)}
          </span>
        </span>
        <ChevronDown className={`h-4 w-4 shrink-0 text-[#9A9A9A] transition-transform ${open ? 'rotate-180' : ''}`} aria-hidden />
      </button>
      {open && (
        <div id="ck-friends" className="flex flex-col gap-3.5 border-t border-white/[0.07] p-3.5">
          {friends.map((friend, i) => {
            const index = i + 1;
            const id = `ck-friend-${index}`;
            return (
              <div key={index} className="flex flex-col gap-[7px]">
                <FieldLabel htmlFor={id}>{t('ticketCheckout.friendLabel').replace('{n}', String(index + 1))}</FieldLabel>
                <input
                  id={id}
                  type="text"
                  autoComplete="off"
                  autoCapitalize="words"
                  placeholder={t('ticketCheckout.friendPlaceholder')}
                  value={friend.fullName}
                  onChange={(e) => onChange(index, e.target.value)}
                  className={checkoutInputClass(false)}
                />
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
