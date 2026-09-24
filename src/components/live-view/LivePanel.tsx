import type { LiveSnapshot, LiveStage } from '@/lib/liveView';
import { classifyPath, fmtEuro, fmtInt, placeLabel } from '@/lib/liveView';
import { BigNumber, Label, LV, Muted, Section, SectionTitle, ThinBar, Tile } from './liveViewUi';
import { LiveFeed } from './LiveFeed';

const STAGES: LiveStage[] = ['browsing', 'cart', 'checkout', 'paid'];

function Metric({ label, value, format, sub, highlight = false }: { label: string; value: number; format: (n: number) => string; sub?: string; highlight?: boolean }) {
  return (
    <Tile highlight={highlight}>
      <Label className="block" size={10}>{label}</Label>
      <div className="mt-1.5"><BigNumber value={value} format={format} size="22px" /></div>
      {sub && <Muted className="mt-1 block truncate" size={11}>{sub}</Muted>}
    </Tile>
  );
}

export function LivePanel({ snapshot, freshIds, nowMs, t, language, reducedMotion, showDrinks }: {
  snapshot: LiveSnapshot;
  freshIds: Set<string>;
  nowMs: number;
  t: (k: string) => string;
  language: string;
  reducedMotion: boolean;
  showDrinks: boolean;
}) {
  const s = snapshot.sales;
  const salesAmount = s.tickets.amount + s.tables.amount + (showDrinks ? s.drinks.amount : 0);
  const ordersCount = s.tickets.orders + s.tables.orders + (showDrinks ? s.drinks.orders : 0);
  const breakdown = [
    `${fmtInt(s.tickets.qty, language)} ${t('lv.unit.tickets')}`,
    `${fmtInt(s.tables.orders, language)} ${t('lv.unit.tables')}`,
    ...(showDrinks ? [`${fmtInt(s.drinks.orders, language)} ${t('lv.unit.drinks')}`] : []),
  ].join(' · ');

  const behaviorMax = Math.max(1, ...STAGES.map((k) => snapshot.behavior?.[k] ?? 0));
  const locMax = Math.max(1, ...snapshot.locations.map((l) => l.n));
  const pageMax = Math.max(1, ...snapshot.pages.map((p) => p.n));

  return (
    <div className="flex flex-col gap-3">
      <div className="grid grid-cols-2 gap-2.5">
        <Metric label={t('lv.sessionsToday')} value={snapshot.sessionsToday} format={(n) => fmtInt(n, language)} />
        <Metric label={t('lv.salesToday')} value={salesAmount} format={(n) => fmtEuro(n, language)} highlight={salesAmount > 0} />
        <Metric label={t('lv.ordersToday')} value={ordersCount} format={(n) => fmtInt(n, language)} sub={breakdown} />
        <Metric label={t('lv.guestsToday')} value={s.guestlist.orders} format={(n) => fmtInt(n, language)} />
      </div>

      <Section>
        <SectionTitle right={<Muted>{t('lv.behaviorSub')}</Muted>}>{t('lv.behavior')}</SectionTitle>
        <div className="mt-4 space-y-3">
          {STAGES.map((stage) => {
            const n = snapshot.behavior?.[stage] ?? 0;
            const accent = stage === 'paid' || stage === 'checkout';
            return (
              <div key={stage}>
                <div className="flex items-baseline justify-between gap-3">
                  <span className="text-[13px] font-medium" style={{ color: n > 0 ? LV.t2 : LV.t3 }}>{t(`lv.stage.${stage}`)}</span>
                  <span className="text-[13.5px] tabular-nums" style={{ color: n > 0 && stage === 'paid' ? LV.pos : n > 0 ? LV.t1 : LV.t3, fontWeight: 620, letterSpacing: '-0.01em' }}>
                    {fmtInt(n, language)}
                  </span>
                </div>
                <div className="mt-1.5"><ThinBar pct={(n / behaviorMax) * 100} accent={accent && n > 0} /></div>
              </div>
            );
          })}
        </div>
      </Section>

      <Section>
        <SectionTitle right={<Muted>{t('lv.locationsSub')}</Muted>}>{t('lv.locations')}</SectionTitle>
        {snapshot.locations.length === 0 ? (
          <p className="m-0 mt-3 text-[13px]" style={{ color: LV.t3 }}>—</p>
        ) : (
          <ol className="m-0 mt-4 list-none space-y-3 p-0">
            {snapshot.locations.map((loc, i) => (
              <li key={`${loc.city}-${loc.country}`} className="grid items-center gap-3" style={{ gridTemplateColumns: '20px 1fr auto' }}>
                <span className="text-[12.5px] tabular-nums" style={{ color: LV.t3 }}>{String(i + 1).padStart(2, '0')}</span>
                <div className="min-w-0">
                  <div className="truncate text-[13px] font-[560]" style={{ color: LV.t1 }}>{placeLabel(loc, t('lv.unknownPlace'))}</div>
                  <div className="mt-1.5"><ThinBar pct={(loc.n / locMax) * 100} accent={i === 0} height={4} /></div>
                </div>
                <span className="text-[13.5px] tabular-nums" style={{ color: LV.t1, fontWeight: 620, letterSpacing: '-0.01em' }}>{fmtInt(loc.n, language)}</span>
              </li>
            ))}
          </ol>
        )}
      </Section>

      <Section>
        <SectionTitle>{t('lv.pagesNow')}</SectionTitle>
        {snapshot.pages.length === 0 ? (
          <p className="m-0 mt-3 text-[13px] leading-relaxed" style={{ color: LV.t3 }}>{t('lv.nobody')}</p>
        ) : (
          <ul className="m-0 mt-4 list-none space-y-3 p-0">
            {snapshot.pages.map((p) => {
              const kind = classifyPath(p.path);
              return (
                <li key={p.path}>
                  <div className="flex items-baseline gap-3">
                    <span className="min-w-0 flex-1 truncate">
                      <span className="text-[13px] font-[560]" style={{ color: LV.t1 }}>{t(`lv.page.${kind}`)}</span>
                      {p.eventTitle && <span className="text-[12px]" style={{ color: LV.t3 }}> · {p.eventTitle}</span>}
                    </span>
                    <span className="flex-none text-[13.5px] tabular-nums" style={{ color: LV.t1, fontWeight: 620, letterSpacing: '-0.01em' }}>{fmtInt(p.n, language)}</span>
                  </div>
                  <div className="mt-1.5"><ThinBar pct={(p.n / pageMax) * 100} height={4} /></div>
                </li>
              );
            })}
          </ul>
        )}
      </Section>

      <Section>
        <SectionTitle right={<Muted>{t('lv.feedSub')}</Muted>}>{t('lv.feed')}</SectionTitle>
        <div className="mt-2">
          <LiveFeed items={snapshot.feed} freshIds={freshIds} nowMs={nowMs} t={t} language={language} reducedMotion={reducedMotion} />
        </div>
        <p className="m-0 mt-4 text-[11px] leading-relaxed" style={{ color: LV.t3 }}>{t('lv.consentNote')}</p>
      </Section>
    </div>
  );
}
