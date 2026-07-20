import { useState } from 'react';
import { Bell, Mail, MessageSquare, Check, Loader2 } from 'lucide-react';
import { useLanguage } from '@/contexts/LanguageContext';
import { marketingConsentWording } from '@/hooks/useMarketingConsent';

interface MarketingOptInsProps {
  newsletterOptIn: boolean;
  onNewsletterChange: (value: boolean) => void;
  smsOptIn: boolean;
  onSmsChange: (value: boolean) => void;
  /**
   * Nom du club (ou de l'organisateur) qui recevra le consentement. Il est
   * affiché dans la case elle-même : un consentement doit nommer son
   * destinataire, sinon il ne couvre personne (EDPB 05/2020 §65).
   */
  scopeName?: string;
  /** Consentement email déjà actif pour CE club → statut + retrait, pas de case. */
  emailAlreadyGranted?: boolean;
  /** Idem pour le SMS. */
  smsAlreadyGranted?: boolean;
  /** Retrait en un clic. Renvoie `false` si l'opération a échoué. */
  onWithdraw?: (channel: 'email' | 'sms', wordingText: string) => Promise<boolean>;
  /** Masque la ligne SMS quand aucun numéro n'est collecté sur cette surface. */
  showSms?: boolean;
}

/**
 * Consentements marketing (email + SMS), groupés dans une carte clairement
 * optionnelle.
 *
 * Deux états par canal, et la distinction est juridique, pas cosmétique :
 *
 *  - Aucun consentement en cours → case DÉCOCHÉE nommant le club. Jamais
 *    pré-cochée : « silence, pre-ticked boxes or inactivity should not
 *    constitute consent » (RGPD cons. 32 ; CJUE C-673/17, Planet49).
 *
 *  - Consentement déjà donné à ce club → on ne redemande pas, mais on ne
 *    masque pas non plus en silence : on affiche l'état et un retrait
 *    immédiat, dans cette même interface (EDPB 05/2020 §114). Un consentement
 *    invisible est un consentement qu'on ne peut pas retirer, et §116 précise
 *    qu'un retrait non conforme invalide tout le mécanisme.
 *
 * Ne pas revenir à un simple `showNewsletter={false}` : masquer la ligne sans
 * rien afficher était précisément le défaut corrigé ici.
 */
export function MarketingOptIns({
  newsletterOptIn,
  onNewsletterChange,
  smsOptIn,
  onSmsChange,
  scopeName,
  emailAlreadyGranted = false,
  smsAlreadyGranted = false,
  onWithdraw,
  showSms = true,
}: MarketingOptInsProps) {
  const { t } = useLanguage();

  const { email: emailLabel, sms: smsLabel } = marketingConsentWording(t, scopeName);

  const bothGranted = emailAlreadyGranted && (smsAlreadyGranted || !showSms);

  return (
    <div className="rounded-[10px] border border-white/[0.08] bg-[#141414] p-4">
      <div className="flex items-center justify-between mb-2">
        <div className="flex items-center gap-2">
          <Bell className="h-4 w-4 text-[#5A5A5E]" />
          <span className="font-mono uppercase text-[11px] font-semibold tracking-[0.10em] text-[#E5E5E5]">
            {t('consent.stayInformed')}
          </span>
        </div>
        <span className="font-mono uppercase text-[9px] font-semibold tracking-[0.12em] text-[#5A5A5E]">
          {bothGranted ? t('consent.active') : t('consent.optional')}
        </span>
      </div>

      <div className="divide-y divide-white/[0.06]">
        {emailAlreadyGranted ? (
          <GrantedRow
            icon={<Mail className="h-4 w-4" />}
            label={emailLabel}
            onWithdraw={onWithdraw ? () => onWithdraw('email', emailLabel) : undefined}
          />
        ) : (
          <ConsentRow
            icon={<Mail className="h-4 w-4" />}
            label={emailLabel}
            checked={newsletterOptIn}
            onToggle={() => onNewsletterChange(!newsletterOptIn)}
          />
        )}

        {showSms &&
          (smsAlreadyGranted ? (
            <GrantedRow
              icon={<MessageSquare className="h-4 w-4" />}
              label={smsLabel}
              onWithdraw={onWithdraw ? () => onWithdraw('sms', smsLabel) : undefined}
            />
          ) : (
            <ConsentRow
              icon={<MessageSquare className="h-4 w-4" />}
              label={smsLabel}
              checked={smsOptIn}
              onToggle={() => onSmsChange(!smsOptIn)}
            />
          ))}
      </div>

      {bothGranted && (
        <p className="mt-2.5 text-[11px] leading-snug text-[#5A5A5E]">
          {t('consent.alreadySubscribedHint')}
        </p>
      )}
    </div>
  );
}

function ConsentRow({
  icon,
  label,
  checked,
  onToggle,
}: {
  icon: React.ReactNode;
  label: string;
  checked: boolean;
  onToggle: () => void;
}) {
  return (
    <button
      type="button"
      role="checkbox"
      aria-checked={checked}
      onClick={onToggle}
      className="flex items-center gap-3 w-full text-left py-2.5 transition-colors"
    >
      <span
        className={[
          'shrink-0 h-5 w-5 rounded-[4px] border flex items-center justify-center transition-colors',
          checked ? 'bg-primary border-primary' : 'bg-transparent border-white/25',
        ].join(' ')}
      >
        {checked && <Check className="h-3 w-3 text-white" strokeWidth={3} />}
      </span>
      <span className="text-[#5A5A5E] shrink-0">{icon}</span>
      <span className="text-sm text-[#9A9A9A] leading-snug">{label}</span>
    </button>
  );
}

/**
 * Canal déjà accepté pour ce club : état lisible + retrait en un clic, sans
 * navigation ni changement d'écran (EDPB 05/2020 §114, et son Exemple 22 qui
 * prend justement une billetterie en ligne comme contre-exemple).
 */
function GrantedRow({
  icon,
  label,
  onWithdraw,
}: {
  icon: React.ReactNode;
  label: string;
  onWithdraw?: () => Promise<boolean>;
}) {
  const { t } = useLanguage();
  const [busy, setBusy] = useState(false);

  const handleWithdraw = async () => {
    if (!onWithdraw || busy) return;
    setBusy(true);
    try {
      await onWithdraw();
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="flex items-center gap-3 w-full py-2.5">
      <span className="shrink-0 h-5 w-5 rounded-[4px] bg-primary border border-primary flex items-center justify-center">
        <Check className="h-3 w-3 text-white" strokeWidth={3} />
      </span>
      <span className="text-[#5A5A5E] shrink-0">{icon}</span>
      <span className="text-sm text-[#9A9A9A] leading-snug flex-1 min-w-0">{label}</span>
      {onWithdraw && (
        <button
          type="button"
          onClick={handleWithdraw}
          disabled={busy}
          className="shrink-0 text-[11px] font-medium text-[#5A5A5E] underline underline-offset-2 hover:text-white transition-colors disabled:opacity-50"
        >
          {busy ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : t('consent.unsubscribe')}
        </button>
      )}
    </div>
  );
}
