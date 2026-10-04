/**
 * Soirées · À venir : chiffres clés, la prochaine soirée en vente (ventes,
 * courbe comparée, tarifs, message), puis toutes les soirées à venir avec
 * leurs filtres d'état et leurs messages.
 */
import { Hv } from '@/crm/ui/Hv';
import { Icon } from '@/crm/ui/Icon';
import { EASE } from '@/crm/ui/motion';
import { useCrmT } from '@/crm/i18n';
import type { NightDetail, NightRow } from '@/crm/data/nights';
import { daysUntil, fillOf, lacksMessage, pickMessage, type UpKind } from '@/crm/lib/nights';
import { NightHero } from './NightHero';
import { DateTile, FilterChip, KeyTiles, SearchField, StatusPill } from './nightsUi';
import { ICO, tzDay, tzMonth, tzShort, tzTime, tzWeek } from './nightsFormat';
import type { KeyTile } from './nightsUi';

export type UpFilter = 'all' | UpKind;

const ST_KEY: Record<UpKind, string> = { full: 'yc.ni.st.full', soon: 'yc.ni.st.soon', almost: 'yc.ni.st.almost', sale: 'yc.ni.st.sale' };
const ROW_GRID = 'minmax(0,2.4fr) minmax(0,1.7fr) 170px minmax(0,1.7fr) 20px';

export function UpcomingView({
  nights, rows, kinds, fs, fm, q, setFs, setFm, setQ, drId, upd, open, write, intro, cc, hero, heroDetail, heroProgress,
}: {
  nights: NightRow[];
  rows: NightRow[];
  kinds: Map<string, UpKind>;
  fs: UpFilter;
  fm: boolean;
  q: string;
  setFs: (f: UpFilter) => void;
  setFm: (v: boolean) => void;
  setQ: (v: string) => void;
  drId: string | null;
  upd: string | null;
  open: (id: string) => void;
  write: (n: NightRow) => void;
  intro: boolean;
  cc: number;
  hero: NightRow | null;
  heroDetail: NightDetail | undefined;
  heroProgress: number;
}) {
  const T = useCrmT();
  const { t, tp, n, eur, locale, dShort } = T;
  const kindOf = (e: NightRow) => kinds.get(e.id) ?? 'sale';

  // ── Chiffres clés
  const onSale = nights.filter((e) => kindOf(e) !== 'soon');
  const nSoon = nights.length - onSale.length;
  const sold = onSale.reduce((a, e) => a + e.sold, 0);
  const capKnown = onSale.filter((e) => e.cap).reduce((a, e) => a + (e.cap ?? 0), 0);
  const today = nights.reduce((a, e) => a + e.today, 0);
  const revenue = nights.reduce((a, e) => a + e.revenue, 0);
  const noMsg = nights.filter((e) => lacksMessage(e, kindOf(e))).length;
  const tiles: KeyTile[] = [
    { label: t('yc.ni.t.up'), big: n(nights.length * cc), sub: nSoon ? tp('yc.ni.t.upSoon', nSoon) : t('yc.ni.t.upAll'), icon: ICO.calendar },
    { label: t('yc.ni.t.sold'), big: n(sold * cc), sub: capKnown ? t('yc.ni.t.soldOf', { n: n(capKnown) }) : t('yc.ni.t.soldShotgun'), delta: today ? t('yc.ni.todayUp', { n: n(today) }) : '', icon: ICO.ticket },
    { label: t('yc.ni.t.ca'), big: eur(revenue * cc), sub: t('yc.ni.t.caSub'), icon: ICO.euro },
    {
      label: t('yc.ni.t.noMsg'), big: n(noMsg * cc), sub: noMsg ? t('yc.ni.t.noMsgSub') : t('yc.ni.t.noMsgNone'),
      delta: noMsg ? t('yc.ni.t.noMsgSee') : '', deltaColor: 'var(--red-600)', icon: ICO.mail, hot: noMsg > 0,
      onClick: noMsg ? () => { setFm(true); setFs('all'); setQ(''); document.getElementById('yc-ni-list')?.scrollIntoView({ behavior: 'smooth', block: 'start' }); } : undefined,
    },
  ];

  // ── Filtres
  const cnt: Record<UpFilter, number> = { all: nights.length, sale: 0, almost: 0, full: 0, soon: 0 };
  nights.forEach((e) => { cnt[kindOf(e)] += 1; });
  const chips: { k: UpFilter; l: string }[] = ([
    ['all', 'yc.ni.chip.all'], ['sale', 'yc.ni.chip.sale'], ['almost', 'yc.ni.chip.almost'], ['full', 'yc.ni.chip.full'], ['soon', 'yc.ni.chip.soon'],
  ] as [UpFilter, string][]).filter(([k]) => k === 'all' || cnt[k] > 0 || fs === k).map(([k, l]) => ({ k, l: t(l) }));

  return (
    <>
      <KeyTiles tiles={tiles} intro={intro} />
      {hero && <NightHero night={hero} detail={heroDetail} kind={kindOf(hero)} progress={heroProgress} cc={cc} open={open} write={write} intro={intro} />}

      <section
        id="yc-ni-list"
        style={{
          boxSizing: 'border-box', display: 'flex', flexDirection: 'column', gap: 18, padding: 'clamp(20px,2.4vw,28px)', borderRadius: 28, background: '#fff',
          boxShadow: 'inset 0 0 0 1px var(--sand-200),var(--shadow-sm)', scrollMarginTop: 80,
          opacity: intro ? 1 : 0, transform: intro ? 'none' : 'translateY(18px)', transition: `opacity 800ms ${EASE} 560ms,transform 800ms ${EASE} 560ms`,
        }}
      >
        <div style={{ display: 'flex', flexWrap: 'wrap', alignItems: 'flex-end', justifyContent: 'space-between', gap: '12px 20px' }}>
          <div>
            <h2 style={{ margin: 0, fontFamily: 'var(--font-display)', fontWeight: 600, fontSize: 22, letterSpacing: '-.02em' }}>{t('yc.ni.list.t')}</h2>
            <div style={{ fontSize: 13.5, color: 'var(--sand-500)', marginTop: 2 }}>{t('yc.ni.list.s')}</div>
          </div>
          <SearchField value={q} onChange={setQ} placeholder={t('yc.ni.search')} />
        </div>
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8 }}>
          {chips.map((c) => <FilterChip key={c.k} on={!fm && fs === c.k} label={c.l} n={cnt[c.k]} onClick={() => { setFs(c.k); setFm(false); }} />)}
          {fm && <FilterChip on tone="red" label={t('yc.ni.chip.noMsg')} n={noMsg} onClick={() => setFm(false)} />}
        </div>
        <div style={{ overflowX: 'auto', margin: '0 -6px', padding: '0 6px' }}>
          <div style={{ minWidth: 860, display: 'flex', flexDirection: 'column' }}>
            <div style={{ display: 'grid', gridTemplateColumns: ROW_GRID, gap: 16, padding: '0 14px 10px', fontFamily: 'var(--font-mono)', fontSize: 11, letterSpacing: '.08em', textTransform: 'uppercase', color: 'var(--sand-400)', borderBottom: '1px solid var(--sand-100)' }}>
              <span>{t('yc.ni.col.night')}</span><span>{t('yc.ni.col.sales')}</span><span>{t('yc.ni.col.status')}</span><span>{t('yc.ni.col.msgs')}</span><span />
            </div>
            {rows.length === 0 && (
              <div style={{ padding: '36px 14px', textAlign: 'center', display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 12 }}>
                <span style={{ fontSize: 15, color: 'var(--sand-600)' }}>{t('yc.ni.list.none')}</span>
                <Hv as="button" type="button" onClick={() => { setFs('all'); setFm(false); setQ(''); }} style={{ height: 40, padding: '0 18px', borderRadius: 99, border: '1px solid var(--sand-300)', background: '#fff', fontSize: 14, fontWeight: 600, cursor: 'pointer' }} hover={{ background: 'var(--sand-50)' }}>
                  {t('yc.ni.list.reset')}
                </Hv>
              </div>
            )}
            {rows.map((e, i) => {
              const k = kindOf(e);
              const m = pickMessage(e.msgs);
              const hot = daysUntil(e.start_at, e.tz) <= 0;
              const f = fillOf(e);
              const place = e.city || e.street;
              const go = () => open(e.id);
              return (
                <Hv
                  key={e.id}
                  role="button"
                  tabIndex={0}
                  onClick={go}
                  onKeyDown={(ev: React.KeyboardEvent) => { if (ev.key === 'Enter' || ev.key === ' ') { ev.preventDefault(); go(); } }}
                  style={{
                    display: 'grid', gridTemplateColumns: ROW_GRID, gap: 16, alignItems: 'center', padding: 14, marginTop: 2, borderRadius: 18,
                    background: drId === e.id ? 'var(--red-50)' : 'transparent', cursor: 'pointer', outline: 'none',
                    animation: `yc-row 650ms ${EASE} ${560 + i * 70}ms both`, transition: 'background 160ms',
                  }}
                  hover={{ background: drId === e.id ? 'var(--red-50)' : 'var(--sand-50)' }}
                  className="yc-focus-ring"
                >
                  <div style={{ display: 'flex', alignItems: 'center', gap: 14, minWidth: 0 }}>
                    <DateTile month={tzMonth(locale, e.start_at, e.tz)} day={tzDay(e.start_at, e.tz)} hot={hot} />
                    <span style={{ minWidth: 0, display: 'flex', flexDirection: 'column', gap: 3 }}>
                      <span style={{ display: 'flex', alignItems: 'center', gap: 8, minWidth: 0 }}>
                        <b style={{ fontSize: 16, fontWeight: 600, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{e.title}</b>
                        {upd === e.id && <span style={{ flex: 'none', height: 22, padding: '0 9px', borderRadius: 99, background: 'var(--green-50)', color: 'var(--green-700)', fontSize: 12, fontWeight: 600, display: 'grid', placeItems: 'center', animation: 'yc-glow 1.6s 3' }}>{t('yc.ni.updated')}</span>}
                      </span>
                      <span style={{ fontSize: 13.5, color: 'var(--sand-500)', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                        {[tzWeek(locale, e.start_at, e.tz), tzTime(locale, e.start_at, e.tz), place].filter(Boolean).join(' · ')}
                      </span>
                    </span>
                  </div>
                  <div style={{ display: 'flex', flexDirection: 'column', gap: 7, minWidth: 0 }}>
                    {k !== 'soon' ? (
                      <>
                        <div style={{ display: 'flex', alignItems: 'baseline', justifyContent: 'space-between', gap: 8 }}>
                          <span style={{ fontSize: 15, fontWeight: 600, fontVariantNumeric: 'tabular-nums' }}>
                            {n(e.sold * cc)}{e.cap ? <span style={{ fontWeight: 400, color: 'var(--sand-500)' }}> / {n(e.cap)}</span> : null}
                          </span>
                          {e.today > 0 && <span style={{ fontSize: 13, fontWeight: 600, color: 'var(--green-700)' }}>{t('yc.ni.todayUp', { n: n(e.today) })}</span>}
                        </div>
                        {f !== null && (
                          <div style={{ height: 8, borderRadius: 99, background: 'var(--sand-100)', overflow: 'hidden' }}>
                            <div style={{ height: '100%', width: `${(f * 100 * cc).toFixed(1)}%`, borderRadius: 99, background: 'var(--gradient-brand)' }} />
                          </div>
                        )}
                      </>
                    ) : (
                      <>
                        <span style={{ fontSize: 14, fontWeight: 500, color: 'var(--ink)' }}>
                          {e.sale_opens_at ? t('yc.ni.opens', { date: tzShort(locale, e.sale_opens_at, e.tz), time: tzTime(locale, e.sale_opens_at, e.tz) }) : t('yc.ni.st.soon')}
                        </span>
                        <span style={{ fontSize: 13, color: 'var(--sand-500)' }}>{e.cap ? t('yc.ni.capTotal', { n: n(e.cap) }) : t('yc.ni.capTotalUnknown')}</span>
                      </>
                    )}
                  </div>
                  <StatusPill up={k}>{t(ST_KEY[k])}</StatusPill>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 10, minWidth: 0 }}>
                    {m ? (
                      <>
                        <span style={{
                          flex: 'none', width: 32, height: 32, borderRadius: 99, display: 'grid', placeItems: 'center',
                          background: m.state === 'draft' ? 'var(--red-50)' : m.state === 'plan' ? 'var(--sand-100)' : 'var(--green-50)',
                          color: m.state === 'draft' ? 'var(--red-600)' : m.state === 'plan' ? 'var(--sand-700)' : 'var(--green-700)',
                        }}>
                          <Icon d={m.channel === 'sms' ? ICO.sms : ICO.mail} size={15} stroke={2.2} />
                        </span>
                        <span style={{ minWidth: 0, display: 'flex', flexDirection: 'column' }}>
                          <b style={{ fontSize: 14, fontWeight: 600, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{t(`yc.ni.row.${m.state}`)}</b>
                          <span style={{ fontSize: 13, color: 'var(--sand-500)', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                            {m.state === 'sent' && m.at ? t('yc.ni.row.sentOn', { date: dShort(m.at) }) : m.name || t('yc.ni.msg.untitled')}
                          </span>
                        </span>
                      </>
                    ) : k !== 'full' ? (
                      <Hv
                        as="button"
                        type="button"
                        onClick={(ev: React.MouseEvent) => { ev.stopPropagation(); write(e); }}
                        style={{ height: 36, padding: '0 14px 0 12px', borderRadius: 99, border: '1px dashed var(--sand-300)', background: 'transparent', color: 'var(--sand-600)', fontSize: 13.5, fontWeight: 600, display: 'flex', alignItems: 'center', gap: 7, cursor: 'pointer', whiteSpace: 'nowrap', transition: 'background 160ms,border-color 160ms,color 160ms' }}
                        hover={{ background: 'var(--red-50)', borderColor: 'var(--red-300)', color: 'var(--red-600)' }}
                      >
                        <Icon name="plus" size={14} stroke={2.4} />{t('yc.ni.row.write')}
                      </Hv>
                    ) : (
                      <span style={{ fontSize: 13.5, color: 'var(--sand-500)' }}>{t('yc.ni.row.fullNothing')}</span>
                    )}
                  </div>
                  <Icon name="chevronRight" size={18} stroke={2.2} color="var(--sand-400)" />
                </Hv>
              );
            })}
          </div>
        </div>
      </section>
    </>
  );
}
