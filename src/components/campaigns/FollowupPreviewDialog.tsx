// Aperçu de la RELANCE après clic, telle qu'elle partira pour CETTE soirée,
// et envoi de test.
//
// La relance ne se compose jamais dans le studio : elle est montée par le cron
// depuis un modèle, au moment où le premier contact devient dû. Le pro règle
// donc un email qu'il n'a jamais vu. Ici on rejoue exactement le rendu de
// l'envoi — mêmes blocs, même thème, mêmes données live de la soirée reliée à
// la campagne — et l'envoi de test passe par la même edge function que
// n'importe quel test de campagne (`send-campaign`, drapeau `send_test` +
// `followup_template_id`), donc par le même builder côté serveur.

import { useMemo, useState } from 'react';
import { CheckCircle2, Eye, Loader2, SendHorizontal, X } from 'lucide-react';
import { supabase } from '@/integrations/supabase/client';
import { useLanguage } from '@/contexts/LanguageContext';
import { renderEmailHtml, type EmailTemplate } from '@/lib/email';
import { useStudioLiveData, type StudioScope } from '@/components/email-studio/hooks';

const RED = '#E8192C';
const T1 = 'rgba(255,255,255,0.96)';
const T2 = 'rgba(255,255,255,0.58)';
const T3 = 'rgba(255,255,255,0.36)';
const BORDER = 'rgba(255,255,255,0.085)';
const POS = '#34D399';

const PUBLIC_BASE_URL = (import.meta.env.VITE_APP_BASE_URL as string | undefined) || 'https://yunoapp.eu';

export default function FollowupPreviewDialog({ template, scope, eventId, campaignId, onClose }: {
  /** Modèle choisi pour la relance — son design est ce qui partira. */
  template: EmailTemplate;
  scope: StudioScope;
  /** Soirée de la campagne : c'est elle qui alimente les blocs Yuno. */
  eventId: string | null;
  /** Campagne mère : porte la portée et l'expéditeur du test. */
  campaignId: string | null;
  onClose: () => void;
}) {
  const { t } = useLanguage();
  const [email, setEmail] = useState('');
  const [sending, setSending] = useState(false);
  const [sent, setSent] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const live = useStudioLiveData(template.blocks, eventId);

  const html = useMemo(() => renderEmailHtml(template.blocks, template.theme, {
    venueName: scope.name,
    city: scope.city,
    logoUrl: template.logoUrl || scope.logoUrl,
    emailType: template.type,
    subject: template.subject,
    preheader: template.preheader,
    recipient: { email: 'apercu@exemple.com', firstName: 'Camille' },
    unsubscribeUrl: '#',
    socialLinks: template.socialLinks,
    baseUrl: PUBLIC_BASE_URL,
    live,
    ignoreConds: true,
  }), [template, scope, live]);

  const sendTest = async () => {
    const extra = email.trim();
    if (extra && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(extra)) {
      setError(t('studio.test.invalidEmail'));
      return;
    }
    if (!campaignId) { setError(t('studio.test.saveFailed')); return; }
    setSending(true); setError(null); setSent(false);
    try {
      const { error: fnError } = await supabase.functions.invoke('send-campaign', {
        body: {
          campaign_id: campaignId,
          send_test: true,
          followup_template_id: template.id,
          test_emails: extra ? [extra] : undefined,
        },
      });
      if (fnError) throw fnError;
      setSent(true);
    } catch (e) {
      setError(e instanceof Error ? e.message : t('studio.test.sendFailed'));
    } finally {
      setSending(false);
    }
  };

  return (
    <div
      role="dialog" aria-modal="true" aria-label={t('studio.sched.fu.previewTitle')}
      onClick={onClose}
      style={{
        position: 'fixed', inset: 0, zIndex: 70, display: 'flex', alignItems: 'center',
        justifyContent: 'center', padding: 16, background: 'rgba(0,0,0,0.68)', backdropFilter: 'blur(3px)',
      }}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        style={{
          width: '100%', maxWidth: 660, maxHeight: '92vh', display: 'flex', flexDirection: 'column',
          borderRadius: 18, overflow: 'hidden', border: `1px solid ${BORDER}`,
          background: 'linear-gradient(180deg,rgba(255,255,255,.045) 0%,rgba(255,255,255,.008) 100%),#0a0a0c',
          boxShadow: '0 1px 0 rgba(255,255,255,.05) inset,0 40px 80px -40px #000',
        }}
      >
        <div style={{ padding: '18px 20px 14px', display: 'flex', alignItems: 'flex-start', gap: 12, borderBottom: `1px solid ${BORDER}` }}>
          <div style={{
            width: 32, height: 32, borderRadius: 11, display: 'flex', alignItems: 'center', justifyContent: 'center',
            background: 'rgba(232,25,44,0.1)', border: '1px solid rgba(232,25,44,0.2)', color: RED, flex: 'none',
          }}><Eye size={16} strokeWidth={1.75} /></div>
          <div style={{ flex: 1, minWidth: 0 }}>
            <div style={{ color: T1, fontSize: 15, fontWeight: 600, letterSpacing: '-0.01em' }}>{t('studio.sched.fu.previewTitle')}</div>
            <div className="truncate" style={{ color: T3, fontSize: 11.5, marginTop: 2 }}>
              {template.subject || template.name}
            </div>
          </div>
          <button
            type="button" onClick={onClose} aria-label={t('studio.test.close')}
            style={{
              width: 26, height: 26, borderRadius: 8, display: 'flex', alignItems: 'center', justifyContent: 'center',
              color: T3, cursor: 'pointer', background: 'transparent', border: 'none', flex: 'none',
            }}
          ><X size={14} strokeWidth={1.75} /></button>
        </div>

        <div style={{ flex: 1, overflowY: 'auto', padding: 14 }}>
          <div style={{ color: T3, fontSize: 11.5, lineHeight: 1.5, marginBottom: 10 }}>
            {eventId ? t('studio.sched.fu.previewNote') : t('studio.sched.fu.previewNoEvent')}
          </div>
          <iframe
            srcDoc={html}
            title="followup-preview"
            className="bg-white rounded-lg w-full"
            style={{ height: 620, border: 'none', display: 'block' }}
          />
        </div>

        <div style={{ padding: '14px 16px 16px', borderTop: `1px solid ${BORDER}`, display: 'flex', flexDirection: 'column', gap: 10 }}>
          <div className="flex flex-wrap items-center gap-2">
            <input
              type="email" inputMode="email" value={email}
              onChange={(e) => setEmail(e.target.value)}
              placeholder={t('studio.test.placeholder')}
              aria-label={t('studio.test.placeholder')}
              style={{
                flex: 1, minWidth: 200, height: 38, borderRadius: 10, padding: '0 12px', colorScheme: 'dark',
                background: 'rgba(255,255,255,0.04)', border: `1px solid ${BORDER}`, color: T1, fontSize: 13,
              }}
            />
            <button
              type="button" onClick={() => void sendTest()} disabled={sending || !campaignId}
              className="inline-flex items-center gap-2 cursor-pointer"
              style={{
                padding: '10px 14px', borderRadius: 10, border: 'none', background: RED, color: '#fff',
                fontSize: 12.5, fontWeight: 600, opacity: sending || !campaignId ? 0.6 : 1,
                boxShadow: `0 0 20px -8px ${RED}`,
              }}
            >
              {sending ? <Loader2 size={13} className="animate-spin" /> : <SendHorizontal size={13} strokeWidth={1.75} />}
              {t('studio.sched.fu.sendTest')}
            </button>
          </div>
          <div style={{ color: T3, fontSize: 11 }}>{t('studio.sched.fu.testNote')}</div>
          {error && <div style={{ color: '#FF5C63', fontSize: 12 }}>{error}</div>}
          {sent && (
            <div className="flex items-center gap-2" style={{ padding: '9px 12px', borderRadius: 11, background: 'rgba(52,211,153,0.09)', border: '1px solid rgba(52,211,153,0.25)' }}>
              <CheckCircle2 size={14} strokeWidth={1.75} style={{ color: POS, flex: 'none' }} />
              <span style={{ color: T2, fontSize: 12 }}>{t('studio.test.sentBanner')}</span>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
