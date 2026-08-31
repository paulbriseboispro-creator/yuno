import { useState } from 'react';
import { CheckCircle2, Loader2, SendHorizontal, X } from 'lucide-react';
import { supabase } from '@/integrations/supabase/client';
import { useLanguage } from '@/contexts/LanguageContext';
import { BORDER, FONT_UI, PrimaryBtn, RED, SUBTLE, T1, T3, TextInput } from './ui';

/** Modale « Envoyer un test » (prototype) : adresse, envoi réel, confirmation. */
export default function TestEmailDialog({ open, campaignId, onSave, onClose }: {
  open: boolean;
  campaignId: string | null;
  /** Sauvegarde le brouillon avant l'envoi (l'edge lit la ligne en base). */
  onSave: () => Promise<boolean>;
  onClose: () => void;
}) {
  const { t } = useLanguage();
  const [email, setEmail] = useState('');
  const [sending, setSending] = useState(false);
  const [sent, setSent] = useState(false);
  const [error, setError] = useState<string | null>(null);

  if (!open) return null;

  const send = async () => {
    const extra = email.trim();
    if (extra && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(extra)) {
      setError(t('studio.test.invalidEmail'));
      return;
    }
    setSending(true);
    setError(null);
    setSent(false);
    try {
      const saved = await onSave();
      if (!saved || !campaignId) throw new Error(t('studio.test.saveFailed'));
      const { error: fnError } = await supabase.functions.invoke('send-campaign', {
        body: { campaign_id: campaignId, send_test: true, test_emails: extra ? [extra] : undefined },
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
      role="dialog" aria-modal="true" aria-label={t('studio.test.title')}
      style={{
        position: 'fixed', inset: 0, zIndex: 60, display: 'flex', alignItems: 'center',
        justifyContent: 'center', background: 'rgba(0,0,0,0.6)', backdropFilter: 'blur(3px)',
      }}
      onClick={onClose}
    >
      <div
        className="yn-in"
        onClick={(e) => e.stopPropagation()}
        style={{
          width: 420, borderRadius: 18, overflow: 'hidden', border: `1px solid ${BORDER}`,
          background: 'linear-gradient(180deg,rgba(255,255,255,.045) 0%,rgba(255,255,255,.008) 100%),#0a0a0c',
          boxShadow: '0 1px 0 rgba(255,255,255,.05) inset,0 40px 80px -40px #000',
          fontFamily: FONT_UI,
        }}
      >
        <div style={{ padding: '20px 22px 0', display: 'flex', alignItems: 'flex-start', gap: 12 }}>
          <div style={{
            width: 32, height: 32, borderRadius: 11, display: 'flex', alignItems: 'center',
            justifyContent: 'center', background: 'rgba(232,25,44,0.1)',
            border: '1px solid rgba(232,25,44,0.2)', color: RED, flex: 'none',
          }}><SendHorizontal size={16} strokeWidth={1.75} /></div>
          <div style={{ flex: 1 }}>
            <div style={{ color: T1, fontSize: 15.5, fontWeight: 600, letterSpacing: '-0.01em' }}>
              {t('studio.test.title')}
            </div>
            <div style={{ color: T3, fontSize: 11.5, marginTop: 2 }}>{t('studio.test.help')}</div>
          </div>
          <button
            type="button" onClick={onClose} aria-label={t('studio.test.close')}
            style={{
              width: 26, height: 26, borderRadius: 8, display: 'flex', alignItems: 'center',
              justifyContent: 'center', color: T3, cursor: 'pointer', background: 'transparent', border: 'none',
            }}
          ><X size={14} strokeWidth={1.75} /></button>
        </div>
        <div style={{ padding: '18px 22px 22px', display: 'flex', flexDirection: 'column', gap: 12 }}>
          <TextInput
            type="email" inputMode="email" value={email}
            onChange={(e) => setEmail(e.target.value)}
            placeholder={t('studio.test.placeholder')}
            aria-label={t('studio.test.placeholder')}
            style={{ padding: '10px 12px', fontSize: 13 }}
          />
          <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
            <span style={{
              padding: '4px 9px', borderRadius: 999, background: 'rgba(255,255,255,0.04)',
              border: `1px solid ${BORDER}`, color: 'rgba(255,255,255,0.58)', fontSize: 11,
            }}>{t('studio.test.ownerChip')}</span>
          </div>
          {error && (
            <div style={{ color: '#FF5C63', fontSize: 12 }}>{error}</div>
          )}
          {sent && (
            <div style={{
              display: 'flex', alignItems: 'center', gap: 8, padding: '10px 12px', borderRadius: 11,
              background: 'rgba(52,211,153,0.09)', border: '1px solid rgba(52,211,153,0.25)',
            }}>
              <CheckCircle2 size={14} strokeWidth={1.75} style={{ color: '#34D399', flex: 'none' }} />
              <span style={{ color: T1, fontSize: 12 }}>{t('studio.test.sentBanner')}</span>
            </div>
          )}
          <PrimaryBtn
            onClick={send} disabled={sending}
            style={{ marginTop: 2, justifyContent: 'center', padding: 11, fontSize: 13, borderRadius: 11, boxShadow: `0 0 20px -8px ${RED}` }}
          >
            {sending && <Loader2 size={13} className="animate-spin" />}
            {t('studio.test.send')}
          </PrimaryBtn>
          <div style={{ color: T3, fontSize: 10.5, textAlign: 'center', background: SUBTLE, borderRadius: 8, padding: '6px 8px' }}>
            {t('studio.test.varsNote')}
          </div>
        </div>
      </div>
    </div>
  );
}
