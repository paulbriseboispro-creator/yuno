/**
 * Bandeau de connexion de la Console : hors connexion, reconnexion, rétablie.
 * Texte HONNÊTE : la Console ne met rien en file, donc rien ne s'enregistre ni
 * ne part tant que le réseau n'est pas revenu.
 */
import { useEffect, useRef, useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { useCrmT } from '@/crm/i18n';
import { Icon } from '@/crm/ui/Icon';
import { Hv } from '@/crm/ui/Hv';
import { useOnline } from './useOnline';

type Phase = 'ok' | 'off' | 'reconnecting' | 'back';

export function OfflineBar() {
  const { t } = useCrmT();
  const online = useOnline();
  const qc = useQueryClient();
  const [phase, setPhase] = useState<Phase>(online ? 'ok' : 'off');
  const wasOffline = useRef(!online);

  useEffect(() => {
    if (!online) { wasOffline.current = true; setPhase('off'); return; }
    if (!wasOffline.current) return;
    wasOffline.current = false;
    setPhase('back');
    void qc.invalidateQueries();
    const id = setTimeout(() => setPhase('ok'), 3200);
    return () => clearTimeout(id);
  }, [online, qc]);

  const retry = () => {
    setPhase('reconnecting');
    setTimeout(() => { if (navigator.onLine) { wasOffline.current = true; setPhase('back'); void qc.invalidateQueries(); setTimeout(() => setPhase('ok'), 3200); } else setPhase('off'); }, 900);
  };

  if (phase === 'ok') return null;
  const tone = phase === 'back'
    ? { bg: 'rgba(16,185,129,.12)', fg: '#05603A', icon: 'check' as const }
    : { bg: 'rgba(255,176,32,.16)', fg: '#7a4d00', icon: 'alert' as const };
  const text = phase === 'off' ? t('yc.er.bar.off') : phase === 'reconnecting' ? t('yc.er.bar.reconnecting') : t('yc.er.bar.back');
  return (
    <div role="status" aria-live="polite" style={{ display: 'flex', alignItems: 'center', gap: 10, minHeight: 44, padding: '8px 24px', background: tone.bg, color: tone.fg, fontSize: 13.5, animation: 'yc-fade 240ms both' }}>
      <Icon name={tone.icon} size={16} stroke={2.2} />
      <span style={{ flex: 1, minWidth: 0 }}>{text}</span>
      {phase === 'off' && (
        <Hv as="button" type="button" onClick={retry} style={{ height: 30, padding: '0 14px', borderRadius: 99, border: '1px solid rgba(0,0,0,.12)', background: '#fff', color: 'var(--ink)', fontSize: 13, fontWeight: 600, cursor: 'pointer' }} hover={{ background: 'var(--sand-50)' }}>{t('yc.er.bar.retry')}</Hv>
      )}
    </div>
  );
}
