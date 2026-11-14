/**
 * « Vos billets, soirée par soirée » : d'où viennent les places d'une soirée —
 * des clients déjà venus (place scannée à une soirée plus ancienne), des gens
 * qui avaient déjà une place sans être venus, ou de nouveaux visages. Avoir une
 * place et être venu sont deux faits : le cycle de vie de l'écran Clients
 * compte des soirées faites et ne regarde jamais une soirée précise ; cette
 * carte répond à « parmi mes billets vendus, lesquels viennent de quelqu'un qui
 * est déjà venu ? ». Chaque groupe ouvre la liste (`rel` du filtre, migration
 * 20261210100000). Tout le calcul est serveur (`tix_night_audience`).
 */
import { Hv } from '@/crm/ui/Hv';
import { Icon } from '@/crm/ui/Icon';
import { clamp01, reveal } from '@/crm/ui/motion';
import { useTixT } from '@/tickets/analytics/i18n';
import type { NightAudience as Data, NightGroup, NightRel } from '@/tickets/clients/data/clients';

const GROUPS: { k: Exclude<NightRel, 'away'>; color: string }[] = [
  { k: 'back', color: 'var(--ya-red-500)' },
  { k: 'held', color: 'var(--ya-tangerine-500)' },
  { k: 'new', color: 'var(--ya-red-200)' },
];

/** Aucun pourcentage sous 10 personnes (règle du dictionnaire des chiffres). */
const MIN_SAMPLE = 10;

export function NightAudience({
  data, intro, cc, onPick, onSeg,
}: {
  data: Data;
  intro: boolean;
  cc: number;
  onPick: (eventId: string) => void;
  onSeg: (eventId: string, k: NightRel) => void;
}) {
  const { t, tp, n, pct, eur, dShort } = useTixT();
  const night = data.night;
  if (!night || !data.groups || !data.total || !data.pool) return null;
  const { groups, total, pool } = data;
  const title = night.title ?? '—';
  const tot = Math.max(1, total.people);
  const showPct = total.people >= MIN_SAMPLE;
  const money = (g: NightGroup) => (g.revenue === null || g.revenue === undefined ? null : eur(g.revenue));

  return (
    <Hv
      as="section"
      style={{
        display: 'flex', flexDirection: 'column', gap: 20, padding: 'clamp(20px,2.4vw,32px)', borderRadius: 18,
        background: 'var(--ya-card)', boxShadow: 'inset 0 0 0 1px var(--ya-border),var(--ya-card-shadow)', ...reveal(intro, 420),
      }}
      hover={{ boxShadow: 'inset 0 0 0 1px var(--ya-sand-300),var(--ya-shadow-md)' }}
    >
      <div style={{ display: 'flex', flexWrap: 'wrap', alignItems: 'flex-start', justifyContent: 'space-between', gap: '12px 24px' }}>
        <div style={{ minWidth: 0 }}>
          <h2 style={{ margin: 0, fontFamily: 'var(--ya-font-display)', fontWeight: 600, fontSize: 16, letterSpacing: '-.01em' }}>{t('ya.na.title')}</h2>
          <div style={{ fontSize: 13.5, color: 'var(--ya-sand-500)', marginTop: 2, maxWidth: 560, textWrap: 'pretty' }}>{t('ya.na.sub')}</div>
        </div>
        <select
          value={night.id}
          onChange={(e) => onPick(e.target.value)}
          aria-label={t('ya.na.pick')}
          style={{ height: 40, maxWidth: '100%', padding: '0 34px 0 14px', borderRadius: 12, border: '1px solid var(--ya-sand-200)', background: 'var(--ya-card)', color: 'var(--ya-ink)', font: '500 14px/1 var(--ya-font-body)', cursor: 'pointer' }}
        >
          {data.nights.map((e) => (
            <option key={e.id} value={e.id}>{`${e.title ?? '—'} · ${e.upcoming ? `${t('ya.na.upcoming')} · ` : ''}${dShort(e.start_at)}`}</option>
          ))}
        </select>
      </div>

      {total.people === 0 ? (
        <div style={{ fontSize: 14.5, color: 'var(--ya-sand-500)' }}>{t('ya.na.empty')}</div>
      ) : (
        <>
          <div style={{ display: 'flex', flexWrap: 'wrap', alignItems: 'baseline', gap: '4px 16px' }}>
            <span style={{ fontFamily: 'var(--ya-font-num)', fontWeight: 650, fontSize: 'clamp(28px,3vw,36px)', lineHeight: 1, letterSpacing: '-.025em', fontVariantNumeric: 'tabular-nums' }}>
              {tp('ya.na.people', Math.round(total.people * clamp01(cc)))}
            </span>
            <span style={{ fontSize: 15, color: 'var(--ya-sand-500)' }}>
              {[tp('ya.na.tickets', total.tickets), money(total), !night.upcoming && data.here ? t('ya.na.here', { n: n(data.here.came) }) : null].filter(Boolean).join(' · ')}
            </span>
          </div>

          <div style={{ display: 'flex', height: 16, gap: 3, borderRadius: 99, overflow: 'hidden' }}>
            {GROUPS.filter((g) => groups[g.k].people > 0).map((g) => (
              <Hv
                key={g.k}
                as="button"
                type="button"
                onClick={() => onSeg(night.id, g.k)}
                aria-label={`${t(`ya.na.g.${g.k}`)} : ${n(groups[g.k].people)}`}
                title={`${t(`ya.na.g.${g.k}`)} : ${n(groups[g.k].people)}`}
                style={{ flex: `${groups[g.k].people} 1 0`, minWidth: 6, height: '100%', border: 0, padding: 0, background: g.color, cursor: 'pointer' }}
                hover={{ filter: 'brightness(.94)' }}
              />
            ))}
          </div>

          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit,minmax(min(100%,200px),1fr))', gap: 6 }}>
            {GROUPS.map((g) => {
              const x = groups[g.k];
              const sub = [tp('ya.na.tickets', x.tickets), money(x)].filter(Boolean).join(' · ');
              return (
                <Hv
                  as="button"
                  type="button"
                  key={g.k}
                  onClick={() => x.people > 0 && onSeg(night.id, g.k)}
                  style={{ textAlign: 'left', display: 'flex', flexDirection: 'column', gap: 3, padding: '12px 14px', border: 0, borderRadius: 16, background: 'transparent', cursor: x.people > 0 ? 'pointer' : 'default' }}
                  hover={{ background: x.people > 0 ? 'var(--ya-sand-50)' : 'transparent' }}
                >
                  <span style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 14, fontWeight: 500, color: 'var(--ya-sand-600)' }}>
                    <i style={{ width: 10, height: 10, borderRadius: 3, background: g.color, display: 'inline-block' }} />
                    {t(`ya.na.g.${g.k}`)}
                  </span>
                  <span style={{ display: 'flex', alignItems: 'baseline', gap: 8 }}>
                    <span style={{ fontFamily: 'var(--ya-font-num)', fontWeight: 650, fontSize: 28, letterSpacing: '-.025em', lineHeight: 1.1, fontVariantNumeric: 'tabular-nums', color: 'var(--ya-ink)' }}>{n(x.people * clamp01(cc))}</span>
                    {showPct && <span style={{ fontSize: 13, color: 'var(--ya-sand-500)', fontVariantNumeric: 'tabular-nums' }}>{pct(Math.round((x.people / tot) * 100))}</span>}
                  </span>
                  <span style={{ fontSize: 13, color: 'var(--ya-sand-600)', fontVariantNumeric: 'tabular-nums' }}>{sub}</span>
                  <span style={{ fontSize: 12.5, lineHeight: '17px', color: 'var(--ya-sand-500)' }}>{t(`ya.na.g.${g.k}.def`)}</span>
                </Hv>
              );
            })}
          </div>
        </>
      )}

      {pool.came_before === 0 ? (
        <div style={{ fontSize: 14, color: 'var(--ya-sand-500)' }}>{t('ya.na.pool.none')}</div>
      ) : (
        <div style={{ display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: '10px 14px', padding: '14px 18px', borderRadius: 16, background: 'var(--ya-red-50)' }}>
          <span style={{ flex: 'none', width: 8, height: 8, borderRadius: 99, background: 'var(--ya-red-500)' }} />
          <span style={{ flex: '1 1 320px', fontSize: 15, lineHeight: 1.45, fontWeight: 500 }}>
            {tp('ya.na.pool', pool.rebought, { a: n(pool.came_before), night: title })}
            {pool.pct !== null && <span style={{ color: 'var(--ya-sand-500)', fontWeight: 400 }}> {t('ya.na.pool.rate', { pct: pct(pool.pct, 1) })}</span>}
          </span>
          {pool.away > 0 && (
            <Hv
              as="button"
              type="button"
              onClick={() => onSeg(night.id, 'away')}
              style={{ flex: 'none', border: 0, background: 'none', padding: 0, fontSize: 14.5, fontWeight: 600, color: 'var(--ya-red-700)', cursor: 'pointer', display: 'inline-flex', alignItems: 'center', gap: 6 }}
              hover={{ color: 'var(--ya-red-600)' }}
            >
              {t('ya.na.away.cta', { n: n(pool.away) })}<Icon name="arrowRight" size={15} stroke={2.4} />
            </Hv>
          )}
        </div>
      )}

      <div style={{ fontSize: 12.5, lineHeight: '17px', color: 'var(--ya-sand-500)', textWrap: 'pretty' }}>{t('ya.na.note')}</div>
    </Hv>
  );
}
