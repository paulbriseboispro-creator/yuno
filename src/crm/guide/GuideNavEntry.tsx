/**
 * L'entrée « Premiers pas » du menu latéral : l'anneau de progression et la
 * prochaine étape, au-dessus des Yunits, tant que le guide se montre de
 * lui-même. Elle ouvre le volet ; elle disparaît quand le guide est masqué,
 * reporté ou terminé.
 */
import { Hv } from '@/crm/ui/Hv';
import { Icon } from '@/crm/ui/Icon';
import { useCrmT } from '@/crm/i18n';
import { useGuide } from './GuideProvider';
import { ProgressRing } from './guideUi';

export function GuideNavEntry({ expanded, onNavigate }: { expanded: boolean; onNavigate?: () => void }) {
  const g = useGuide();
  const { t } = useCrmT();
  if (!g || !g.auto) return null;
  const { done, total } = g.progress;
  const sub = g.complete ? t('yc.fs.coach.allDone') : g.next ? t(`yc.fs.${g.next.key}.t`) : '';
  return (
    <Hv
      as="button"
      type="button"
      onClick={() => { onNavigate?.(); g.openPanel(); }}
      title={t('yc.fs.nav.aria', { done, total })}
      aria-label={t('yc.fs.nav.aria', { done, total })}
      style={{
        position: 'relative', display: 'flex', alignItems: 'center', justifyContent: expanded ? 'flex-start' : 'center', gap: 12, height: 52, padding: '0 10px',
        marginBottom: 6, borderRadius: 14, border: 0, background: '#fff', boxShadow: 'inset 0 0 0 1px var(--sand-200)', color: 'var(--ink)', cursor: 'pointer', textAlign: 'left', width: '100%',
      }}
      hover={{ boxShadow: 'inset 0 0 0 1px var(--sand-300),var(--shadow-xs)' }}
    >
      <span style={{ position: 'relative', flex: 'none', width: 30, height: 30, display: 'grid', placeItems: 'center' }}>
        <ProgressRing done={done} total={total} size={30} stroke={3} />
        <span style={{ position: 'absolute', inset: 0, display: 'grid', placeItems: 'center', fontFamily: 'var(--font-mono)', fontSize: 10.5, fontWeight: 600, color: g.complete ? 'var(--green-700)' : 'var(--ink)' }}>{done}</span>
      </span>
      {expanded && (
        <>
          <span style={{ flex: 1, minWidth: 0, display: 'flex', flexDirection: 'column', gap: 1 }}>
            <span style={{ fontSize: 14.5, fontWeight: 600, lineHeight: '18px' }}>{t('yc.fs.name')}</span>
            <span style={{ fontSize: 12.5, lineHeight: '15px', color: 'var(--sand-500)', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{sub}</span>
          </span>
          <Icon name="chevronRight" size={16} stroke={2.2} color="var(--sand-400)" />
        </>
      )}
    </Hv>
  );
}
