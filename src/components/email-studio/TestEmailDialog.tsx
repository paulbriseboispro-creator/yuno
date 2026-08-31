import { useState } from 'react';
import { Loader2, Send, X } from 'lucide-react';
import { supabase } from '@/integrations/supabase/client';
import { useLanguage } from '@/contexts/LanguageContext';
import { BORDER, FONT_UI, GhostBtn, Help, MicroLabel, PANEL_BG, PrimaryBtn, T1, TextInput } from './ui';

/** Modale « Email de test » : adresse, envoi réel, confirmation inline. */
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
  const [sentTo, setSentTo] = useState<string | null>(null);
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
    setSentTo(null);
    try {
      const saved = await onSave();
      if (!saved || !campaignId) throw new Error(t('studio.test.saveFailed'));
      const { error: fnError } = await supabase.functions.invoke('send-campaign', {
        body: { campaign_id: campaignId, send_test: true, test_emails: extra ? [extra] : undefined },
      });
      if (fnError) throw fnError;
      setSentTo(extra || t('studio.test.yourAddress'));
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
        justifyContent: 'center', background: 'rgba(0,0,0,0.65)',
      }}
      onClick={onClose}
    >
      <div
        className="yn-in"
        onClick={(e) => e.stopPropagation()}
        style={{
          width: 380, background: PANEL_BG, border: `1px solid ${BORDER}`, borderRadius: 12,
          padding: 18, display: 'flex', flexDirection: 'column', gap: 12, fontFamily: FONT_UI,
        }}
      >
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
          <MicroLabel>{t('studio.test.title')}</MicroLabel>
          <button
            type="button" onClick={onClose} aria-label={t('studio.test.close')}
            style={{ background: 'transparent', border: 'none', color: T1, cursor: 'pointer', display: 'flex' }}
          ><X size={15} strokeWidth={1.75} /></button>
        </div>
        <Help>{t('studio.test.help')}</Help>
        <TextInput
          type="email" inputMode="email" value={email}
          onChange={(e) => setEmail(e.target.value)}
          placeholder={t('studio.test.placeholder')}
          aria-label={t('studio.test.placeholder')}
        />
        {error && <Help style={{ color: '#FF5C63' }}>{error}</Help>}
        {sentTo && (
          <Help style={{ color: '#34D399' }}>
            {t('studio.test.sent').replace('{email}', sentTo)}
          </Help>
        )}
        <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8 }}>
          <GhostBtn onClick={onClose}>{t('studio.test.close')}</GhostBtn>
          <PrimaryBtn onClick={send} disabled={sending}>
            {sending ? <Loader2 size={13} className="animate-spin" /> : <Send size={13} strokeWidth={1.75} />}
            {t('studio.test.send')}
          </PrimaryBtn>
        </div>
      </div>
    </div>
  );
}
