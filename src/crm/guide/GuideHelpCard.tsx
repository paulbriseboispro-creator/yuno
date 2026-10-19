/**
 * Compte › Aide : la porte qui rouvre les premiers pas, même masqués ou
 * terminés (« Ouvrir le guide », « Remettre sur l'accueil »).
 */
import { Hv } from '@/crm/ui/Hv';
import { useCrmT } from '@/crm/i18n';
import { useGuide } from './GuideProvider';
import { ProgressRing } from './guideUi';

export function GuideHelpCard() {
  const g = useGuide();
  const { t, dShort } = useCrmT();
  if (!g) return null;
  const { done, total } = g.progress;
  const p = g.data.pref;
  const hidden = !g.auto && g.data.holder.is_me;
  return (
    <section style={{ display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: '14px 20px', padding: '20px 24px', borderRadius: 28, background: '#fff', boxShadow: 'inset 0 0 0 1px var(--sand-200),var(--shadow-sm)' }}>
      <span style={{ position: 'relative', flex: 'none', width: 48, height: 48, display: 'grid', placeItems: 'center' }}>
        <ProgressRing done={done} total={total} size={48} stroke={4} />
        <span style={{ position: 'absolute', inset: 0, display: 'grid', placeItems: 'center', fontFamily: 'var(--font-mono)', fontSize: 13, fontWeight: 600 }}>{done}/{total}</span>
      </span>
      <div style={{ flex: '1 1 260px', minWidth: 0, display: 'flex', flexDirection: 'column', gap: 3 }}>
        <span style={{ fontFamily: 'var(--font-display)', fontWeight: 600, fontSize: 20, letterSpacing: '-.02em' }}>{t('yc.fs.name')}</span>
        <span style={{ fontSize: 14, lineHeight: 1.45, color: 'var(--sand-600)', textWrap: 'pretty' }}>
          {g.complete && p.finished_at ? t('yc.fs.help.finished', { date: dShort(p.finished_at) }) : `${t('yc.fs.help.s', { done, total })} · ${t('yc.fs.help.d')}`}
        </span>
      </div>
      <div style={{ flex: 'none', display: 'flex', alignItems: 'center', flexWrap: 'wrap', gap: 10 }}>
        {hidden && (
          <Hv as="button" type="button" onClick={() => g.act('resume')} style={{ height: 40, padding: '0 16px', borderRadius: 99, border: 0, background: 'none', fontSize: 14, fontWeight: 600, color: 'var(--sand-600)', cursor: 'pointer' }} hover={{ background: 'var(--sand-50)', color: 'var(--ink)' }}>
            {t('yc.fs.resume')}
          </Hv>
        )}
        <Hv as="button" type="button" onClick={g.openPanel} style={{ height: 40, padding: '0 18px', borderRadius: 99, border: 0, background: 'var(--ink)', color: '#fff', fontSize: 14, fontWeight: 600, cursor: 'pointer' }} hover={{ background: 'var(--sand-700)' }}>
          {t('yc.fs.openGuide')}
        </Hv>
      </div>
    </section>
  );
}
