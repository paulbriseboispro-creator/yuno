import { useState, useEffect, useCallback } from 'react';
import { DEFAULT_TERMS_URL, SESSION_KEY_PREFIX, recordTermsAcceptance, useTermsSettings } from '@/lib/termsAcceptance';
import { Check, ScrollText } from 'lucide-react';
import { supabase } from '@/integrations/supabase/client';
import { useLanguage } from '@/contexts/LanguageContext';

interface TermsAcceptanceProps {
  userId?: string | null;
  guestEmail?: string | null;
  context: 'drink' | 'ticket' | 'table';
  onAcceptedChange: (accepted: boolean) => void;
}

export function TermsAcceptance({ userId, guestEmail, context, onAcceptedChange }: TermsAcceptanceProps) {
  const { t } = useLanguage();
  const settings = useTermsSettings();
  const termsVersion = settings?.version ?? null;
  const termsUrl = settings?.url ?? DEFAULT_TERMS_URL;
  const [alreadyAccepted, setAlreadyAccepted] = useState(false);
  const [checked, setChecked] = useState(false);
  const [loading, setLoading] = useState(true);

  // Check if already accepted
  useEffect(() => {
    if (!termsVersion) return;

    const checkAcceptance = async () => {
      // Logged-in user: check DB
      if (userId) {
        const { data } = await supabase
          .from('terms_acceptances')
          .select('id')
          .eq('user_id', userId)
          .eq('terms_version', termsVersion)
          .maybeSingle();
        if (data) {
          setAlreadyAccepted(true);
          onAcceptedChange(true);
          setLoading(false);
          return;
        }
      }

      // Guest: check sessionStorage
      if (!userId && guestEmail) {
        const sessionKey = `${SESSION_KEY_PREFIX}${termsVersion}`;
        if (sessionStorage.getItem(sessionKey) === 'true') {
          setAlreadyAccepted(true);
          onAcceptedChange(true);
          setLoading(false);
          return;
        }
      }

      setLoading(false);
    };

    checkAcceptance();
  }, [termsVersion, userId]); // eslint-disable-line react-hooks/exhaustive-deps

  const handleCheck = useCallback(async (value: boolean) => {
    setChecked(value);
    onAcceptedChange(value);
    if (value) await recordTermsAcceptance({ userId, guestEmail, context });
  }, [context, userId, guestEmail, onAcceptedChange]);

  if (loading || !termsVersion) return null;

  // Already accepted: render nothing
  if (alreadyAccepted) return null;

  return (
    // Same card + row design as the marketing opt-ins (MarketingOptIns), so the
    // required terms consent reads as part of the same checkbox family.
    <div className="rounded-[10px] border border-white/[0.08] bg-[var(--sf-141414)] p-4">
      <button
        type="button"
        onClick={() => handleCheck(!checked)}
        className="flex items-center gap-3 w-full text-left transition-colors"
      >
        <span
          className={[
            'shrink-0 h-5 w-5 rounded-[4px] border flex items-center justify-center transition-colors',
            checked ? 'bg-primary border-primary' : 'bg-transparent border-white/25',
          ].join(' ')}
        >
          {checked && <Check className="h-3 w-3 text-white" strokeWidth={3} />}
        </span>
        <span className="text-[var(--tx-5a5a5e)] shrink-0"><ScrollText className="h-4 w-4" /></span>
        <span className="text-sm text-[var(--tx-9a9a9a)] leading-snug" onClick={(e) => e.stopPropagation()}>
          {t('cgv.acceptText')}{' '}
          <a
            href={termsUrl}
            target="_blank"
            rel="noopener noreferrer"
            className="text-primary underline hover:text-primary/80"
            onClick={(e) => e.stopPropagation()}
          >
            {t('cgv.linkText')}
          </a>
        </span>
      </button>
    </div>
  );
}

/**
 * La phrase posée sous le bouton de paiement : « En continuant, vous acceptez les
 * conditions de vente. » Le clic sur le bouton vaut acceptation et la page la
 * trace par `recordTermsAcceptance` (décision de Paul du 19/10/2026 : plus de
 * case CGV sur la page de paiement billet, puis table). `lead` remplace le début
 * de la phrase : la table y ajoute la déclaration d'âge (« vous certifiez avoir
 * 18 ans ou plus et acceptez les… »), qui remplaçait elle aussi une case.
 */
export function TermsNotice({ className, lead }: { className?: string; lead?: string }) {
  const { t } = useLanguage();
  const settings = useTermsSettings();
  return (
    <span className={className}>
      {lead ?? t('ticketCheckout.termsBefore')}
      <a
        href={settings?.url ?? DEFAULT_TERMS_URL}
        target="_blank"
        rel="noopener noreferrer"
        className="text-[#E5E5E5] underline underline-offset-2 hover:text-white"
      >
        {t('ticketCheckout.termsLink')}
      </a>
      {t('ticketCheckout.termsAfter')}
    </span>
  );
}
