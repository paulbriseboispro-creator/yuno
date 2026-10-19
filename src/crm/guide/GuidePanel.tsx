/**
 * Le volet « Premiers pas » : la même liste que la carte de l'Accueil, depuis
 * n'importe quelle page (entrée du menu, menu du profil, Compte › Aide). Un
 * guide masqué ou reporté s'y rouvre, et « Remettre sur l'accueil » le rend à
 * l'Accueil.
 */
import { Hv } from '@/crm/ui/Hv';
import { IconButton, Sheet } from '@/crm/ui/kit';
import { useCrmT } from '@/crm/i18n';
import { useGuide } from './GuideProvider';
import { mono, ProgressBar, ProgressRing, StepList } from './guideUi';

export function GuidePanel() {
  const g = useGuide();
  const { t } = useCrmT();
  if (!g) return null;
  const { done, total } = g.progress;
  const p = g.data.pref;
  const hidden = !!(p.dismissed_at || p.finished_at || (p.snoozed_until && new Date(p.snoozed_until) > new Date()));
  return (
    <Sheet open={g.panelOpen} onClose={g.closePanel} width={480} label={t('yc.fs.name')}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 14, padding: '22px 22px 18px', borderBottom: '1px solid var(--sand-100)', background: '#fff' }}>
        <ProgressRing done={done} total={total} size={40} stroke={4} />
        <div style={{ flex: 1, minWidth: 0, display: 'flex', flexDirection: 'column', gap: 2 }}>
          <span style={mono}>{t('yc.fs.name')} · {t('yc.fs.progress', { done, total })}</span>
          <span style={{ fontFamily: 'var(--font-display)', fontWeight: 600, fontSize: 22, letterSpacing: '-.03em', lineHeight: 1.15 }}>
            {t('yc.fs.title.a')}{t('yc.fs.title.accent')}{t('yc.fs.title.b')}
          </span>
        </div>
        <IconButton name="x" label={t('yc.fs.close')} onClick={g.closePanel} tone="bordered" size={36} />
      </div>
      <div style={{ flex: 1, overflowY: 'auto', padding: '18px 14px 24px', display: 'flex', flexDirection: 'column', gap: 16 }}>
        <div style={{ padding: '0 8px' }}><ProgressBar done={done} total={total} /></div>
        <StepList g={g} compact />
      </div>
      <div style={{ display: 'flex', flexWrap: 'wrap', alignItems: 'center', justifyContent: 'space-between', gap: 10, padding: '14px 22px', borderTop: '1px solid var(--sand-100)', background: '#fff' }}>
        {hidden && g.data.holder.is_me ? (
          <Hv as="button" type="button" onClick={() => g.act('resume')} style={{ height: 38, padding: '0 16px', borderRadius: 99, border: '1px solid var(--sand-200)', background: '#fff', fontSize: 14, fontWeight: 600, color: 'var(--ink)', cursor: 'pointer' }} hover={{ borderColor: 'var(--sand-300)', background: 'var(--paper)' }}>
            {t('yc.fs.resume')}
          </Hv>
        ) : <span />}
        {!hidden && g.data.holder.is_me && (
          <Hv as="button" type="button" onClick={() => g.act('dismiss')} style={{ border: 0, background: 'none', padding: '6px 0', fontSize: 13.5, fontWeight: 600, color: 'var(--sand-500)', cursor: 'pointer' }} hover={{ color: 'var(--ink)' }}>
            {t('yc.fs.dismiss')}
          </Hv>
        )}
      </div>
    </Sheet>
  );
}
