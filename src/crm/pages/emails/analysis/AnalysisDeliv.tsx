/**
 * Analyse › Délivrabilité : le verdict (Yunit), les quatre indicateurs sur
 * toutes les campagnes avec leur seuil et une barre par campagne, puis le
 * domaine d'envoi (celui de Yuno, déjà authentifié).
 */
import { Link } from 'react-router-dom';
import { Hv } from '@/crm/ui/Hv';
import { Icon } from '@/crm/ui/Icon';
import { EASE } from '@/crm/ui/motion';
import { YunitFace } from '@/crm/ui/YunitFace';
import { useCrmT } from '@/crm/i18n';
import { CRM_ROUTES } from '@/crm/shell/nav';
import { HEALTH_LIMITS, type Campaign } from '@/crm/lib/emailAnalysis';
import { box, h2, subCss } from './analysisUi';

type Key = 'received' | 'bounced' | 'unsub' | 'spam';

export function AnalysisDeliv({ campaigns }: { campaigns: Campaign[] }) {
  const { t, pct } = useCrmT();
  const sum = (f: (c: Campaign) => number) => campaigns.reduce((s, c) => s + f(c), 0);
  const n = sum((c) => c.n);
  const rec = sum((c) => c.received);
  const ratio = (a: number, b: number) => (b > 0 ? a / b : 0);
  const per: Record<Key, (c: Campaign) => number> = {
    received: (c) => ratio(c.received, c.n),
    bounced: (c) => ratio(c.bounced, c.n),
    unsub: (c) => ratio(c.unsub, c.received),
    spam: (c) => ratio(c.complained, c.received),
  };
  const total: Record<Key, number> = {
    received: ratio(rec, n),
    bounced: ratio(sum((c) => c.bounced), n),
    unsub: ratio(sum((c) => c.unsub), rec),
    spam: ratio(sum((c) => c.complained), rec),
  };
  const limit: Partial<Record<Key, number>> = HEALTH_LIMITS;
  const digits: Record<Key, number> = { received: 1, bounced: 1, unsub: 2, spam: 2 };
  const bad = (['bounced', 'unsub', 'spam'] as const).filter((k) => total[k] > (limit[k] ?? 1));
  const last = campaigns.slice(-12);

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 20, animation: `yc-rise 520ms ${EASE} both` }}>
      <section style={{ display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: '18px 26px', padding: 'clamp(20px,2.4vw,28px)', borderRadius: 28, background: bad.length ? 'var(--amber-50)' : 'var(--green-50)', boxShadow: `inset 0 0 0 1px ${bad.length ? '#F2D9A2' : '#BFE6CE'}` }}>
        <YunitFace mood={bad.length ? 'inquiet' : 'ravi'} size={60} />
        <div style={{ flex: '1 1 300px', display: 'flex', flexDirection: 'column', gap: 4 }}>
          <span style={{ fontFamily: 'var(--font-display)', fontWeight: 600, fontSize: 'clamp(22px,2.4vw,28px)', letterSpacing: '-.03em', color: bad.length ? 'var(--amber-700)' : 'var(--green-700)' }}>{t(bad.length ? 'yc.em.an.d.watchT' : 'yc.em.an.d.okT')}</span>
          <span style={{ fontSize: 15, lineHeight: 1.45, color: 'var(--sand-700)', textWrap: 'pretty' }}>{bad.length ? t('yc.em.an.d.watchS', { l: t(`yc.em.an.d.${bad[0]}`) }) : t('yc.em.an.d.okS')}</span>
        </div>
      </section>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit,minmax(min(100%,250px),1fr))', gap: 16 }}>
        {(['received', 'bounced', 'unsub', 'spam'] as const).map((k) => {
          const lim = limit[k];
          const over = lim !== undefined && total[k] > lim;
          const vals = last.map(per[k]);
          const scale = k === 'received' ? null : Math.max(lim ?? 0, ...vals) || 1;
          return (
            <div key={k} style={{ display: 'flex', flexDirection: 'column', gap: 6, padding: '20px 22px', borderRadius: 20, background: '#fff', border: '1px solid var(--sand-200)' }}>
              <span style={{ fontSize: 14, fontWeight: 500, color: 'var(--sand-600)' }}>{t(`yc.em.an.d.${k}`)}</span>
              <span style={{ fontFamily: 'var(--font-display)', fontWeight: 600, fontSize: 40, lineHeight: 1.05, letterSpacing: '-.035em', fontVariantNumeric: 'tabular-nums' }}>{pct(total[k] * 100, digits[k])}</span>
              <span style={{ alignSelf: 'flex-start', height: 22, padding: '0 9px', borderRadius: 99, display: 'inline-flex', alignItems: 'center', gap: 6, fontSize: 12, fontWeight: 600, background: over ? 'var(--amber-50)' : 'var(--green-50)', color: over ? 'var(--amber-700)' : 'var(--green-700)' }}>
                <span style={{ width: 6, height: 6, borderRadius: 99, background: 'currentColor' }} />
                {lim === undefined ? t('yc.em.an.d.good') : t(over ? 'yc.em.an.d.watch' : 'yc.em.an.d.goodUnder', { l: pct(lim * 100, 1) })}
              </span>
              <div title={t('yc.em.an.d.spark')} style={{ marginTop: 6, height: 34, display: 'flex', alignItems: 'flex-end', gap: 4 }}>
                {vals.map((v, i) => {
                  // Reçus : on lit l'écart sous 100 % ; les autres : la part du seuil.
                  const h = scale === null ? 25 + Math.max(0, Math.min(1, (v - 0.9) / 0.1)) * 75 : 15 + Math.min(1, v / scale) * 85;
                  return <div key={i} style={{ flex: 1, height: `${h}%`, borderRadius: '3px 3px 0 0', background: i === vals.length - 1 ? (over ? 'var(--amber-500)' : 'var(--green-500)') : over ? 'var(--amber-50)' : 'var(--green-50)' }} />;
                })}
              </div>
              <span style={{ fontSize: 13, lineHeight: '18px', color: 'var(--sand-500)' }}>{t(`yc.em.an.d.${k}D`)}</span>
            </div>
          );
        })}
      </div>
      <section style={{ ...box, gap: 14 }}>
        <div style={{ display: 'flex', flexWrap: 'wrap', alignItems: 'baseline', justifyContent: 'space-between', gap: 10 }}>
          <div><h2 style={h2}>{t('yc.em.an.dm.t')}</h2><div style={subCss}>{t('yc.em.an.dm.s')}</div></div>
          <Hv as={Link} to={CRM_ROUTES.emailSettings} style={{ fontSize: 14.5, fontWeight: 600, color: 'var(--ink)', textDecoration: 'none' }} hover={{ color: 'var(--red-600)', textDecoration: 'none' }}>{t('yc.em.an.dm.settings')} →</Hv>
        </div>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit,minmax(min(100%,220px),1fr))', gap: 12 }}>
          {(['spf', 'dkim', 'dmarc'] as const).map((k) => (
            <div key={k} style={{ display: 'flex', alignItems: 'center', gap: 14, padding: '16px 18px', borderRadius: 18, background: 'var(--paper)', boxShadow: 'inset 0 0 0 1px var(--sand-100)' }}>
              <span style={{ flex: 'none', width: 36, height: 36, borderRadius: 99, background: 'var(--green-500)', color: '#fff', display: 'grid', placeItems: 'center' }}><Icon name="check" size={18} stroke={3} /></span>
              <span style={{ display: 'flex', flexDirection: 'column' }}>
                <b style={{ fontSize: 15 }}>{k.toUpperCase()}</b>
                <span style={{ fontSize: 12.5, color: 'var(--sand-500)', lineHeight: '16px' }}>{t(`yc.em.an.dm.${k}`)}</span>
              </span>
            </div>
          ))}
        </div>
      </section>
    </div>
  );
}
