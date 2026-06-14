import { useState, useEffect, useCallback } from 'react';
import { Check, ScrollText } from 'lucide-react';
import { supabase } from '@/integrations/supabase/client';
import { useLanguage } from '@/contexts/LanguageContext';

interface TermsAcceptanceProps {
  userId?: string | null;
  guestEmail?: string | null;
  context: 'drink' | 'ticket' | 'table';
  onAcceptedChange: (accepted: boolean) => void;
}

const SESSION_KEY_PREFIX = 'yuno_terms_accepted_';

export function TermsAcceptance({ userId, guestEmail, context, onAcceptedChange }: TermsAcceptanceProps) {
  const { t } = useLanguage();
  const [termsVersion, setTermsVersion] = useState<string | null>(null);
  const [termsUrl, setTermsUrl] = useState('/legal/cgv-utilisateurs');
  const [alreadyAccepted, setAlreadyAccepted] = useState(false);
  const [checked, setChecked] = useState(false);
  const [loading, setLoading] = useState(true);

  // Fetch current terms version
  useEffect(() => {
    const fetch = async () => {
      const { data } = await supabase
        .from('app_settings')
        .select('terms_version, terms_url')
        .eq('id', 'global')
        .single();
      if (data) {
        setTermsVersion((data as any).terms_version || 'v1.0.0');
        setTermsUrl((data as any).terms_url || '/legal/cgv-utilisateurs');
      } else {
        setTermsVersion('v1.0.0');
      }
    };
    fetch();
  }, []);

  // Check if already accepted
  useEffect(() => {
    if (!termsVersion) return;

    const checkAcceptance = async () => {
      // Logged-in user: check DB
      if (userId) {
        const { data } = await supabase
          .from('terms_acceptances' as any)
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

    if (value && termsVersion) {
      // Record acceptance
      try {
        await supabase.functions.invoke('record-terms-acceptance', {
          body: {
            terms_version: termsVersion,
            context,
            guest_email: !userId ? guestEmail : undefined,
          },
        });

        // For guests, also store in sessionStorage
        if (!userId) {
          sessionStorage.setItem(`${SESSION_KEY_PREFIX}${termsVersion}`, 'true');
        }
      } catch (err) {
        console.error('Terms acceptance recording error:', err);
      }
    }
  }, [termsVersion, context, userId, guestEmail, onAcceptedChange]);

  if (loading || !termsVersion) return null;

  // Already accepted: render nothing
  if (alreadyAccepted) return null;

  return (
    // Same card + row design as the marketing opt-ins (MarketingOptIns), so the
    // required terms consent reads as part of the same checkbox family.
    <div className="rounded-[10px] border border-white/[0.08] bg-[#141414] p-4">
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
        <span className="text-[#5A5A5E] shrink-0"><ScrollText className="h-4 w-4" /></span>
        <span className="text-sm text-[#9A9A9A] leading-snug" onClick={(e) => e.stopPropagation()}>
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
