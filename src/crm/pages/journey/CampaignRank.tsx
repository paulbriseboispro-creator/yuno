/**
 * Section 3 du Parcours — « Quelle campagne convertit le plus ? » : le taux
 * par canal (l'e-mail, seul canal qui envoie aujourd'hui ; SMS et Instagram
 * arrivent), puis les campagnes classées par conversion, acheteurs ou ventes.
 * Une ligne ouvre le détail de la campagne dans un tiroir.
 */
import { forwardRef, useState } from 'react';
import type { CSSProperties, KeyboardEvent } from 'react';
import { Hv } from '@/crm/ui/Hv';
import { Icon } from '@/crm/ui/Icon';
import { EASE } from '@/crm/ui/motion';
import type { useCrmT } from '@/crm/i18n';
import type { JrCampaign, JrFilters, Journey } from '@/crm/data/journey';
import { Note, SecHead } from './jrUi';
import { JR_IC, avgConvOf, campConv, clamp01, pc } from './jrLib';

type T = ReturnType<typeof useCrmT>;
type SortKey = 'conv' | 'b' | 'sales';

const GRID = (money: boolean) => (money
  ? '34px minmax(200px,2.4fr) minmax(110px,1fr) minmax(110px,.9fr) minmax(160px,1.5fr) minmax(90px,.9fr)'
  : '34px minmax(200px,2.4fr) minmax(110px,1fr) minmax(110px,.9fr) minmax(160px,1.5fr)');

export const CampaignRank = forwardRef<HTMLElement, {
  d: Journey; f: JrFilters; T: T; a3: number; style: CSSProperties; thin: boolean; money: boolean;
  campName: string | null; setF: (p: Partial<JrFilters>) => void; onOpen: (id: string) => void;
}>(function CampaignRank({ d, f, T, a3, style, thin, money, campName, setF, onOpen }, ref) {
  const { t, tp, n, eur, dShort } = T;
  const [sort, setSort] = useState<SortKey>('conv');
  const [all, setAll] = useState(false);
  const [swap, setSwap] = useState(0);

  const emailLive = f.channel === 'all' || f.channel === 'email';
  const eConv = emailLive && d.funnel[0] ? d.funnel[3] / d.funnel[0] : null;
  const tiles = [
    { k: 'email' as const, n: t('yc.jr.ch.email'), d: JR_IC.mail, soon: false },
    { k: 'sms' as const, n: t('yc.jr.ch.sms'), d: JR_IC.sms, soon: true },
    { k: 'ig' as const, n: t('yc.jr.ch.ig'), d: JR_IC.send, soon: true },
  ];

  const list = d.campaigns;
  const sortKey: SortKey = sort === 'sales' && !money ? 'conv' : sort;
  const vOf = (c: JrCampaign) => (sortKey === 'conv' ? campConv(c) : sortKey === 'sales' ? Number(c.revenue ?? 0) : c.buyers);
  const sorted = [...list].sort((a, b) => vOf(b) - vOf(a) || b.received - a.received);
  const avg = avgConvOf(list);
  const byConv = [...list].sort((a, b) => campConv(b) - campConv(a));
  const bestId = byConv.length >= 3 && campConv(byConv[0]) > 0 ? byConv[0].id : null;
  const maxConv = Math.max(0.001, ...list.map(campConv));
  const shown = all ? sorted : sorted.slice(0, 6);
  const sumRc = list.reduce((a, c) => a + c.received, 0);
  const best = byConv[0];
  const ratio = best && avg > 0 ? campConv(best) / avg : 0;
  const rankInsight = !thin && byConv.length >= 3 && sumRc >= 300 && best && best.received >= 50 && ratio >= 1.2
    ? t('yc.jr.s3.insight', { name: best.name, date: dShort(best.sent_at), x: T.n1(Math.round(ratio * 10) / 10), a: pc(T, campConv(best)), b: pc(T, avg) })
    : '';
  const foot = d.cover && d.cover.buyers > 0
    ? t('yc.jr.s3.foot', { n: n(Math.max(0, d.cover.buyers - d.cover.attributed)), t: n(d.cover.buyers) })
    : '';
  const rowAnim = `${swap % 2 ? 'yc-row-a' : 'yc-row-b'} 420ms ${EASE}`;
  const sorts: { k: SortKey; l: string }[] = [
    { k: 'conv', l: t('yc.jr.s3.sort.conv') }, { k: 'b', l: t('yc.jr.s3.sort.b') }, ...(money ? [{ k: 'sales' as const, l: t('yc.jr.s3.sort.sales') }] : []),
  ];

  return (
    <section ref={ref} style={{ boxSizing: 'border-box', display: 'flex', flexDirection: 'column', gap: 20, padding: 'clamp(20px,2.4vw,32px)', borderRadius: 28, background: '#fff', boxShadow: 'inset 0 0 0 1px var(--sand-200)', minWidth: 0, ...style }}>
      <SecHead title={t('yc.jr.s3.title')} sub={`${t('yc.jr.s3.sub')}${campName ? ` ${t('yc.jr.s3.subCamp', { name: campName })}` : ''}`} />

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit,minmax(min(100%,220px),1fr))', gap: 12 }}>
        {tiles.map((x, i) => {
          const on = !x.soon && f.channel === 'email';
          const head = (
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8 }}>
              <span style={{ display: 'inline-flex', alignItems: 'center', gap: 8, fontSize: 14.5, fontWeight: 600 }}>
                <span style={{ width: 30, height: 30, borderRadius: 10, display: 'grid', placeItems: 'center', background: 'var(--sand-100)', color: 'var(--ink)' }}><Icon d={x.d} size={16} stroke={2} /></span>
                {x.n}
              </span>
              {x.soon && <span style={{ height: 22, padding: '0 9px', borderRadius: 99, display: 'inline-flex', alignItems: 'center', fontSize: 12, fontWeight: 600, background: 'var(--sand-100)', color: 'var(--sand-600)' }}>{t('yc.jr.soon')}</span>}
            </div>
          );
          if (x.soon) {
            return (
              <div key={x.k} style={{ display: 'flex', flexDirection: 'column', gap: 10, padding: '16px 18px', borderRadius: 18, border: '1.5px dashed var(--sand-200)', background: 'var(--paper)', color: 'var(--sand-500)' }}>
                {head}
                <span style={{ fontFamily: 'var(--font-display)', fontWeight: 600, fontSize: 36, lineHeight: 1, letterSpacing: '-.035em', color: 'var(--sand-300)' }}>—</span>
                <div style={{ height: 6, borderRadius: 99, background: 'var(--sand-100)' }} />
                <span style={{ fontSize: 12.5, lineHeight: '17px' }}>{t(x.k === 'sms' ? 'yc.jr.s3.soonSms' : 'yc.jr.s3.soonIg')}</span>
              </div>
            );
          }
          return (
            <Hv
              key={x.k}
              as="button"
              type="button"
              onClick={() => setF({ channel: f.channel === 'email' ? 'all' : 'email' })}
              aria-pressed={on}
              style={{ display: 'flex', flexDirection: 'column', gap: 10, padding: '16px 18px', borderRadius: 18, border: `1.5px solid ${on ? 'var(--ink)' : 'var(--sand-200)'}`, background: on ? 'var(--sand-50)' : '#fff', textAlign: 'left', cursor: 'pointer', color: 'var(--ink)', transition: `border-color 160ms,background 160ms,transform 200ms ${EASE}` }}
              hover={{ transform: 'translateY(-3px)', borderColor: 'var(--sand-400)' }}
            >
              {head}
              <span style={{ fontFamily: 'var(--font-display)', fontWeight: 600, fontSize: 36, lineHeight: 1, letterSpacing: '-.035em', fontVariantNumeric: 'tabular-nums' }}>{eConv !== null ? pc(T, eConv) : '—'}</span>
              <div style={{ height: 6, borderRadius: 99, background: 'var(--sand-100)', overflow: 'hidden' }}>
                <div style={{ height: '100%', width: `${(eConv !== null ? Math.min(100, eConv * 100) * clamp01(a3 * 1.3 - i * 0.1) : 0).toFixed(1)}%`, borderRadius: 99, background: 'var(--gradient-brand)' }} />
              </div>
              <span style={{ fontSize: 12.5, lineHeight: '17px', color: 'var(--sand-500)' }}>
                {eConv !== null
                  ? `${tp('yc.jr.s2.buyers', d.funnel[3], { n: n(d.funnel[3]) })} · ${tp('yc.jr.s3.rec', d.funnel[0], { n: n(d.funnel[0]) })}`
                  : t('yc.jr.s3.emailNone')}
              </span>
            </Hv>
          );
        })}
      </div>
      <span style={{ fontSize: 12.5, color: 'var(--sand-500)', marginTop: -8 }}>{t('yc.jr.s3.rate')}</span>

      {list.length > 0 ? (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
          <div style={{ display: 'flex', flexWrap: 'wrap', alignItems: 'center', justifyContent: 'space-between', gap: '10px 16px' }}>
            <span style={{ fontSize: 17, fontWeight: 600, letterSpacing: '-.01em' }}>{t('yc.jr.s3.list')}</span>
            <div role="group" aria-label={t('yc.jr.s3.sortBy')} style={{ display: 'inline-flex', alignItems: 'center', gap: 2, padding: 3, background: 'var(--sand-100)', borderRadius: 99 }}>
              {sorts.map((s) => {
                const on = sortKey === s.k;
                return (
                  <button
                    key={s.k}
                    type="button"
                    aria-pressed={on}
                    onClick={() => { setSort(s.k); setSwap((x) => x + 1); }}
                    style={{ height: 32, padding: '0 14px', border: 0, borderRadius: 99, background: on ? '#fff' : 'transparent', boxShadow: on ? 'var(--shadow-xs)' : 'none', fontSize: 13.5, fontWeight: 600, color: on ? 'var(--ink)' : 'var(--sand-600)', cursor: 'pointer', transition: 'background 160ms,color 160ms' }}
                  >
                    {s.l}
                  </button>
                );
              })}
            </div>
          </div>
          {rankInsight && <Note>{rankInsight}</Note>}
          <div className="yc-noscroll" style={{ overflowX: 'auto', margin: '0 -8px', padding: '0 8px' }}>
            <div style={{ minWidth: money ? 780 : 680, display: 'flex', flexDirection: 'column' }}>
              <div style={{ display: 'grid', gridTemplateColumns: GRID(money), gap: 12, padding: '0 12px 8px', fontFamily: 'var(--font-mono)', fontSize: 11, letterSpacing: '.08em', textTransform: 'uppercase', color: 'var(--sand-400)' }}>
                <span />
                <span>{t('yc.jr.s3.col.camp')}</span>
                <span>{t('yc.jr.s3.col.rc')}</span>
                <span>{t('yc.jr.s3.col.b')}</span>
                <span>{t('yc.jr.s3.col.conv')}</span>
                {money && <span style={{ textAlign: 'right' }}>{t('yc.jr.s3.col.sales')}</span>}
              </div>
              {shown.map((c, i) => {
                const cv = campConv(c);
                const top1 = c.id === bestId;
                const weak = !top1 && list.length >= 4 && cv < avg * 0.6;
                const sel = f.campaign === c.id;
                const tag = top1 ? { l: t('yc.jr.s3.best'), bg: 'var(--green-50)', fg: 'var(--green-700)' } : weak ? { l: t('yc.jr.s3.weak'), bg: 'var(--amber-50)', fg: 'var(--amber-700)' } : null;
                return (
                  <Hv
                    key={c.id}
                    role="button"
                    tabIndex={0}
                    onClick={() => onOpen(c.id)}
                    onKeyDown={(e: KeyboardEvent) => { if (e.key === 'Enter' && e.target === e.currentTarget) { e.preventDefault(); onOpen(c.id); } }}
                    style={{ display: 'grid', gridTemplateColumns: GRID(money), gap: 12, alignItems: 'center', padding: 12, borderTop: '1px solid var(--sand-100)', borderRadius: 14, background: sel ? 'var(--red-50)' : 'transparent', cursor: 'pointer', animation: `${rowAnim} ${Math.min(i, 8) * 40}ms backwards`, transition: 'background 140ms' }}
                    hover={{ background: sel ? 'var(--red-50)' : 'var(--sand-50)' }}
                  >
                    <span style={{ width: 28, height: 28, borderRadius: 99, display: 'grid', placeItems: 'center', fontSize: 13, fontWeight: 600, background: i === 0 ? 'var(--gradient-brand)' : 'var(--sand-100)', color: i === 0 ? '#fff' : 'var(--sand-700)' }}>{i + 1}</span>
                    <span style={{ minWidth: 0, display: 'flex', flexDirection: 'column', gap: 3 }}>
                      <span style={{ display: 'flex', alignItems: 'center', gap: 8, minWidth: 0 }}>
                        <b style={{ fontSize: 14.5, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{c.name}</b>
                        {tag && <span style={{ flex: 'none', height: 20, padding: '0 8px', borderRadius: 99, display: 'inline-flex', alignItems: 'center', fontSize: 11.5, fontWeight: 600, background: tag.bg, color: tag.fg }}>{tag.l}</span>}
                      </span>
                      <span style={{ fontSize: 12.5, color: 'var(--sand-500)', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                        {[t('yc.jr.ch.email'), dShort(c.sent_at), c.event_title].filter(Boolean).join(' · ')}
                      </span>
                    </span>
                    <span style={{ display: 'flex', flexDirection: 'column' }}>
                      <b style={{ fontSize: 14.5, fontVariantNumeric: 'tabular-nums' }}>{n(c.received)}</b>
                      <span style={{ fontSize: 12.5, color: 'var(--sand-500)' }}>{t('yc.jr.s3.clicked', { p: pc(T, c.received ? c.clicked / c.received : 0) })}</span>
                    </span>
                    <span style={{ display: 'flex', flexDirection: 'column' }}>
                      <b style={{ fontSize: 14.5, fontVariantNumeric: 'tabular-nums' }}>{n(c.buyers)}</b>
                      <span style={{ fontSize: 12.5, color: 'var(--sand-500)' }}>{tp('yc.jr.s3.ticket', c.ticket_clicks, { n: n(c.ticket_clicks) })}</span>
                    </span>
                    <span style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                      <b style={{ width: 52, fontSize: 15, fontVariantNumeric: 'tabular-nums' }}>{pc(T, cv)}</b>
                      <span style={{ flex: 1, height: 8, borderRadius: 99, background: 'var(--sand-100)', overflow: 'hidden' }}>
                        <span style={{ display: 'block', height: '100%', width: `${((cv / maxConv) * 100 * clamp01(a3 * 1.3 - i * 0.08)).toFixed(1)}%`, borderRadius: 99, background: top1 ? 'var(--gradient-brand)' : weak ? 'var(--amber-500)' : 'var(--sand-500)' }} />
                      </span>
                    </span>
                    {money && <b style={{ textAlign: 'right', fontSize: 14.5, fontVariantNumeric: 'tabular-nums' }}>{c.revenue === null ? '—' : eur(Number(c.revenue))}</b>}
                  </Hv>
                );
              })}
            </div>
          </div>
          <div style={{ display: 'flex', flexWrap: 'wrap', alignItems: 'center', justifyContent: 'space-between', gap: '10px 16px' }}>
            {sorted.length > 6 ? (
              <Hv
                as="button"
                type="button"
                onClick={() => setAll((x) => !x)}
                style={{ height: 40, padding: '0 16px', borderRadius: 99, border: '1px solid var(--sand-200)', background: '#fff', fontSize: 14, fontWeight: 600, color: 'var(--ink)', cursor: 'pointer' }}
                hover={{ borderColor: 'var(--sand-300)', background: 'var(--paper)' }}
              >
                {all ? t('yc.jr.s3.less') : t('yc.jr.s3.more', { n: sorted.length })}
              </Hv>
            ) : <span />}
            {foot && <span style={{ fontSize: 13, color: 'var(--sand-500)' }}>{foot}</span>}
          </div>
        </div>
      ) : (
        <div style={{ padding: '22px 20px', borderRadius: 16, background: 'var(--sand-50)', fontSize: 14.5, lineHeight: 1.5, color: 'var(--sand-600)' }}>
          {emailLive ? t('yc.jr.s3.noRank') : t('yc.jr.empty.soon')}
        </div>
      )}
    </section>
  );
});
