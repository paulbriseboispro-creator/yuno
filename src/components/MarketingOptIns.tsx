import { Bell, Mail, MessageSquare, Check, Sparkles } from 'lucide-react';
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
  /**
   * Destinataire de la ligne SMS quand il diffère de l'email. Soirée
   * co-organisée : l'email nomme TOUS les hôtes (le consentement leur est
   * versé à chacun), le SMS ne part qu'à la portée principale — sa case ne
   * nomme donc qu'elle. Absent = `scopeName`.
   */
  smsScopeName?: string;
  /** Consentement email déjà actif pour CE club → la ligne n'est plus montrée. */
  emailAlreadyGranted?: boolean;
  /** Idem pour le SMS. */
  smsAlreadyGranted?: boolean;
  /** Masque la ligne SMS quand aucun numéro n'est collecté sur cette surface. */
  showSms?: boolean;
  /**
   * Masque les lignes du club / de l'organisateur quand son NOM n'a pas pu être
   * résolu. Une case qui ne nomme pas son destinataire ne couvre personne
   * (EDPB 05/2020 §65) : mieux vaut ne rien demander pour lui que demander mal.
   */
  showEmail?: boolean;
  /**
   * Ligne « Yuno » — portée PLATEFORME (les deux colonnes de portée à NULL).
   *
   * C'est un DESTINATAIRE de plus, pas une reformulation du premier : le club
   * nommé au-dessus ne couvre jamais Yuno (EDPB 05/2020 §65). D'où une case
   * séparée, décochée elle aussi, sous un intertitre qui dit qui reçoit quoi.
   * Absente par défaut : seules les surfaces où Yuno se présente comme
   * expéditeur la montrent.
   */
  showYuno?: boolean;
  yunoOptIn?: boolean;
  onYunoChange?: (value: boolean) => void;
  /** Accord Yuno déjà actif → la ligne n'est plus montrée. */
  yunoAlreadyGranted?: boolean;
  /**
   * Lecture du consentement par club encore en cours (RPC get_my_marketing_consent).
   *
   * Tant qu'on ignore si la personne est déjà abonnée à CE club, on n'affiche
   * PAS de case décochée : sinon un abonné de retour voit « on me redemande de
   * cocher » le temps que la lecture réponde, juste avant que la ligne ne
   * disparaisse. On montre un placeholder discret à la place.
   */
  pending?: boolean;
}

/**
 * Consentements marketing (email + SMS + Yuno), groupés dans une carte
 * clairement optionnelle.
 *
 * Un accord se demande UNE fois par destinataire (décision du 2026-10-01) :
 * une fois pour Yuno sur toute la plateforme, une fois par club ou
 * organisateur. Trois états, et la distinction est juridique, pas cosmétique :
 *
 *  - Lecture en cours (`pending`) → placeholder, jamais une case décochée. On ne
 *    redemande pas de cocher à quelqu'un dont on n'a pas encore lu le statut.
 *
 *  - Aucun consentement en cours → case DÉCOCHÉE nommant le destinataire. Jamais
 *    pré-cochée : « silence, pre-ticked boxes or inactivity should not
 *    constitute consent » (RGPD cons. 32 ; CJUE C-673/17, Planet49).
 *
 *  - Consentement déjà donné à ce destinataire → sa ligne N'EST PLUS MONTRÉE ;
 *    quand tout est déjà accordé, la carte entière disparaît. Le retrait vit
 *    dans Réglages → « Mes abonnements » (un retrait par destinataire et par
 *    canal) et en pied de chaque email : aussi simple que l'accord (art. 7(3)
 *    RGPD), sans redemander à chaque réservation ce qui est déjà acquis.
 */
export function MarketingOptIns({
  newsletterOptIn,
  onNewsletterChange,
  smsOptIn,
  onSmsChange,
  scopeName,
  smsScopeName,
  emailAlreadyGranted = false,
  smsAlreadyGranted = false,
  showSms = true,
  showEmail = true,
  showYuno = false,
  yunoOptIn = false,
  onYunoChange,
  yunoAlreadyGranted = false,
  pending = false,
}: MarketingOptInsProps) {
  const { t } = useLanguage();

  const { email: emailLabel } = marketingConsentWording(t, scopeName);
  const { sms: smsLabel } = marketingConsentWording(t, smsScopeName ?? scopeName);
  const yunoLabel = t('consent.yunoOffers');

  // Ce qu'il reste à demander : une ligne déjà acquise n'est plus posée.
  const askEmail = showEmail && !emailAlreadyGranted;
  const askSms = showEmail && showSms && !smsAlreadyGranted;
  const askYuno = showYuno && !yunoAlreadyGranted;

  // Tout est déjà accepté (ou rien à demander sur cette surface) : la carte
  // disparaît, elle ne redemande ni ne résume.
  if (!pending && !askEmail && !askSms && !askYuno) return null;

  return (
    <div className="rounded-[10px] border border-white/[0.08] bg-[var(--sf-141414)] p-4">
      <div className="flex items-center justify-between mb-2">
        <div className="flex items-center gap-2">
          <Bell className="h-4 w-4 text-[var(--tx-5a5a5e)]" />
          <span className="font-mono uppercase text-[11px] font-semibold tracking-[0.10em] text-[var(--tx-e5e5e5)]">
            {t('consent.stayInformed')}
          </span>
        </div>
        <span className="font-mono uppercase text-[9px] font-semibold tracking-[0.12em] text-[var(--tx-5a5a5e)]">
          {pending ? '' : t('consent.optional')}
        </span>
      </div>

      {pending ? (
        <PendingRows showEmail={askEmail} showSms={askSms} showYuno={askYuno} label={t('consent.checkingPreferences')} />
      ) : (
        <>
          {(askEmail || askSms) && (
            <div className="divide-y divide-white/[0.06]">
              {askEmail && (
                <ConsentRow
                  icon={<Mail className="h-4 w-4" />}
                  label={emailLabel}
                  checked={newsletterOptIn}
                  onToggle={() => onNewsletterChange(!newsletterOptIn)}
                />
              )}

              {askSms && (
                <ConsentRow
                  icon={<MessageSquare className="h-4 w-4" />}
                  label={smsLabel}
                  checked={smsOptIn}
                  onToggle={() => onSmsChange(!smsOptIn)}
                />
              )}
            </div>
          )}

          {/* Yuno = un autre destinataire, sous son propre intertitre : une
              case qui ne dit pas QUI écrit ne couvre personne. */}
          {askYuno && (
            <div className={askEmail || askSms ? 'mt-1 border-t border-white/[0.06] pt-1' : ''}>
              <p className="pt-2 font-mono uppercase text-[9px] font-semibold tracking-[0.12em] text-[var(--tx-5a5a5e)]">
                {t('consent.fromYuno')}
              </p>
              <ConsentRow
                icon={<Sparkles className="h-4 w-4" />}
                label={yunoLabel}
                checked={yunoOptIn}
                onToggle={() => onYunoChange?.(!yunoOptIn)}
              />
            </div>
          )}
        </>
      )}
    </div>
  );
}

/**
 * Placeholder pendant la lecture du consentement par club. On ne montre jamais
 * une case décochée avant de savoir : un abonné de retour ne doit pas voir « on
 * me redemande de cocher » le temps d'un aller-retour réseau.
 */
function PendingRows({ showEmail = true, showSms, showYuno, label }: { showEmail?: boolean; showSms: boolean; showYuno?: boolean; label: string }) {
  return (
    <div className="py-1" aria-busy="true">
      {showEmail && (
        <div className="flex items-center gap-3 py-2.5">
          <span className="shrink-0 h-5 w-5 rounded-[4px] border border-white/10 bg-white/[0.04] animate-pulse" />
          <span className="h-3 flex-1 max-w-[70%] rounded bg-white/[0.06] animate-pulse" />
        </div>
      )}
      {showSms && (
        <div className="flex items-center gap-3 py-2.5">
          <span className="shrink-0 h-5 w-5 rounded-[4px] border border-white/10 bg-white/[0.04] animate-pulse" />
          <span className="h-3 flex-1 max-w-[55%] rounded bg-white/[0.06] animate-pulse" />
        </div>
      )}
      {showYuno && (
        <div className="flex items-center gap-3 py-2.5">
          <span className="shrink-0 h-5 w-5 rounded-[4px] border border-white/10 bg-white/[0.04] animate-pulse" />
          <span className="h-3 flex-1 max-w-[62%] rounded bg-white/[0.06] animate-pulse" />
        </div>
      )}
      <span className="sr-only">{label}</span>
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
      <span className="text-[var(--tx-5a5a5e)] shrink-0">{icon}</span>
      <span className="text-sm text-[var(--tx-9a9a9a)] leading-snug">{label}</span>
    </button>
  );
}
