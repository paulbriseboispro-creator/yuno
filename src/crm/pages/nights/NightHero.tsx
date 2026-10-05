/**
 * La prochaine soirée en vente, mise en avant (maquette : affiche, date, lieu,
 * line-up, message ; places vendues, jauge, courbe comparée à la fois d'avant ;
 * tarifs ; « Voir le détail » et « Modifier dans Shotgun »).
 */
import { Link } from 'react-router-dom';
import { Hv } from '@/crm/ui/Hv';
import { Icon } from '@/crm/ui/Icon';
import { CtaButton, PillButton, Skel } from '@/crm/ui/kit';
import { EASE } from '@/crm/ui/motion';
import { useCrmT } from '@/crm/i18n';
import type { NightDetail, NightRow } from '@/crm/data/nights';
import { dayIn, daysUntil, fillOf, pickMessage, type UpKind } from '@/crm/lib/nights';
import { SalesCurve } from './SalesCurve';
import { ShotgunLink } from './nightsUi';
import { ICO, comparedLine, comparedName, messageHref, priceLabel, tzLong, tzShort, tzTime } from './nightsFormat';

export function NightHero({ night: h, detail, kind, progress, cc: c, open: openDr, write: writeTo, intro: shown }: {
  night: NightRow; detail: NightDetail | undefined; kind: UpKind; progress: number; cc: number;
  open: (id: string, view?: 'sales' | 'links') => void; write: (n: NightRow) => void; intro: boolean;
}) {
  const T = useCrmT();
  const { t, tp, n, eur, eur2, pct, locale, dShort } = T;
  const d = daysUntil(h.start_at, h.tz);
  const when = d <= 0 ? t('yc.ni.when.tonight', { time: tzTime(locale, h.start_at, h.tz) })
    : d === 1 ? t('yc.ni.when.tomorrow', { time: tzTime(locale, h.start_at, h.tz) }) : t('yc.ni.when.in', { n: d });
  const f = fillOf(h);
  const m = pickMessage(h.msgs);
  const tiers = h.tiers ?? [];
  const maxSold = Math.max(1, ...tiers.map((x) => x.sold));
  const venue = [h.street, h.city].filter(Boolean).join(', ');
  const msgT = m ? t(m.state === 'draft' ? 'yc.ni.msg.draftT' : m.state === 'plan' ? 'yc.ni.msg.planT' : 'yc.ni.msg.sentT') : t('yc.ni.msg.noneT');
  const msgW = !m ? t('yc.ni.msg.noneS')
    : `${m.name || t('yc.ni.msg.untitled')} · ${m.state === 'draft' ? t('yc.ni.msg.draftW')
      : m.state === 'plan' && m.at ? t('yc.ni.msg.planW', { date: dShort(m.at), time: T.time(m.at) })
        : m.at ? t('yc.ni.msg.sentW', { date: dShort(m.at) }) : ''}`;
  const red = !m || m.state === 'draft';
  const cmpName = detail ? comparedName(detail, t, locale) : '';
  const cmpLine = detail ? comparedLine(detail, t, n, locale) : '';
  const firstPoint = detail?.curve[0];
  const opened = detail?.opened_at ? tzShort(locale, detail.opened_at, h.tz)
    : detail && firstPoint ? new Date(Date.parse(dayIn(h.start_at, h.tz) + 'T12:00:00Z') - firstPoint.d * 86_400_000).toLocaleDateString(locale, { day: 'numeric', month: 'long', timeZone: 'UTC' })
      : null;
  const msgInner = (
    <>
      <span style={{ flex: 'none', width: 36, height: 36, borderRadius: 99, background: '#fff', color: red ? 'var(--red-600)' : 'var(--sand-700)', display: 'grid', placeItems: 'center' }}>
        <Icon d={m?.channel === 'sms' ? ICO.sms : ICO.mail} size={17} stroke={2.2} />
      </span>
      <span style={{ flex: 1, minWidth: 0, display: 'flex', flexDirection: 'column', gap: 1 }}>
        <b style={{ fontSize: 14.5, fontWeight: 600, color: 'var(--ink)' }}>{msgT}</b>
        <span style={{ fontSize: 13.5, color: 'var(--sand-600)' }}>{msgW}</span>
      </span>
      <span style={{ flex: 'none', fontSize: 14, fontWeight: 600, color: red ? 'var(--red-600)' : 'var(--sand-700)' }}>
        {m ? (m.state === 'draft' ? t('yc.ni.msg.open') : t('yc.ni.msg.see')) : t('yc.ni.msg.write')} →
      </span>
    </>
  );
  const msgStyle = { display: 'flex', alignItems: 'center', gap: 14, padding: '14px 16px', borderRadius: 18, border: 0, background: red ? 'var(--red-50)' : 'var(--sand-50)', textAlign: 'left' as const, cursor: 'pointer', textDecoration: 'none', color: 'inherit', transition: `filter 160ms,translate 200ms ${EASE}` };

  return (
    <section style={{
      boxSizing: 'border-box', display: 'flex', flexDirection: 'column', gap: 26, padding: 'clamp(20px,2.4vw,32px)', borderRadius: 28,
      background: 'radial-gradient(60% 50% at 100% 0%,rgba(255,107,53,.08),transparent 70%),#fff', boxShadow: 'inset 0 0 0 1px var(--sand-200),var(--shadow-sm)',
      opacity: shown ? 1 : 0, transform: shown ? 'none' : 'translateY(18px)', transition: `opacity 800ms ${EASE} 460ms,transform 800ms ${EASE} 460ms`,
    }}>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit,minmax(min(100%,430px),1fr))', gap: '28px 40px' }}>
        {/* Identité */}
        <div style={{ display: 'flex', flexDirection: 'column', gap: 22, minWidth: 0 }}>
          <div style={{ display: 'flex', gap: 20, alignItems: 'stretch' }}>
            {h.cover_url ? (
              <img src={h.cover_url} alt="" style={{ flex: 'none', width: 'clamp(112px,12vw,148px)', minHeight: 196, maxHeight: 220, objectFit: 'cover', borderRadius: 20, boxShadow: 'inset 0 0 0 1px var(--sand-200)', background: 'var(--sand-100)' }} />
            ) : (
              <div style={{ flex: 'none', width: 'clamp(112px,12vw,148px)', minHeight: 196, borderRadius: 20, background: 'repeating-linear-gradient(135deg,var(--sand-50) 0 9px,var(--sand-100) 9px 18px)', boxShadow: 'inset 0 0 0 1px var(--sand-200)', display: 'grid', placeItems: 'end start', padding: 12, boxSizing: 'border-box' }}>
                <span style={{ fontFamily: 'var(--font-mono)', fontSize: 10.5, letterSpacing: '.06em', textTransform: 'uppercase', color: 'var(--sand-500)', lineHeight: 1.3 }}>{t('yc.ni.poster')}</span>
              </div>
            )}
            <div style={{ minWidth: 0, display: 'flex', flexDirection: 'column', gap: 12, justifyContent: 'center' }}>
              <span style={{ alignSelf: 'flex-start', height: 28, padding: '0 12px 0 10px', borderRadius: 99, background: 'var(--red-50)', color: 'var(--red-600)', fontSize: 13, fontWeight: 600, display: 'flex', alignItems: 'center', gap: 8 }}>
                <i style={{ width: 8, height: 8, borderRadius: 99, background: 'var(--red-500)', animation: 'yc-ring 1.8s infinite' }} />{when}
              </span>
              <h2 style={{ margin: 0, fontFamily: 'var(--font-display)', fontWeight: 600, fontSize: 'clamp(28px,3vw,38px)', lineHeight: 1.04, letterSpacing: '-.035em', textWrap: 'balance' }}>{h.title}</h2>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 7, fontSize: 14.5, color: 'var(--sand-600)' }}>
                <span style={{ display: 'flex', alignItems: 'center', gap: 9 }}><Icon d={ICO.calendar} size={16} stroke={2.2} color="var(--sand-400)" />{tzLong(locale, h.start_at, h.tz)} · {tzTime(locale, h.start_at, h.tz)} – {tzTime(locale, h.end_at, h.tz)}</span>
                {venue && <span style={{ display: 'flex', alignItems: 'center', gap: 9 }}><Icon d={ICO.pin} size={16} stroke={2.2} color="var(--sand-400)" />{venue}</span>}
                <span style={{ display: 'flex', alignItems: 'flex-start', gap: 9 }}><Icon d={ICO.music} size={16} stroke={2.2} color="var(--sand-400)" style={{ marginTop: 2 }} />{h.lineup.length ? h.lineup.join(', ') : t('yc.ni.lineupNone')}</span>
              </div>
            </div>
          </div>
          {m && m.state !== 'sent' ? (
            <Hv as={Link} to={messageHref(m)} style={msgStyle} hover={{ filter: 'brightness(.97)', translate: '0 -1px', textDecoration: 'none', color: 'inherit' }}>{msgInner}</Hv>
          ) : (
            <Hv as="button" type="button" onClick={() => (m ? openDr(h.id) : writeTo(h))} style={msgStyle} hover={{ filter: 'brightness(.97)', translate: '0 -1px' }}>{msgInner}</Hv>
          )}
        </div>

        {/* Ventes */}
        <div style={{ display: 'flex', flexDirection: 'column', gap: 18, minWidth: 0 }}>
          <div style={{ display: 'flex', flexWrap: 'wrap', alignItems: 'flex-end', justifyContent: 'space-between', gap: '12px 24px' }}>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
              <span style={{ fontFamily: 'var(--font-mono)', fontSize: 11.5, letterSpacing: '.08em', textTransform: 'uppercase', color: 'var(--sand-500)' }}>{t('yc.ni.placesSold')}</span>
              <div style={{ display: 'flex', alignItems: 'baseline', gap: 10, flexWrap: 'wrap' }}>
                <span style={{ fontFamily: 'var(--font-display)', fontWeight: 600, fontSize: 'clamp(56px,6vw,84px)', lineHeight: 0.92, letterSpacing: '-.055em', fontVariantNumeric: 'tabular-nums' }}>{n(h.sold * c)}</span>
                {h.cap ? <span style={{ fontSize: 18, fontWeight: 500, color: 'var(--sand-500)' }}>{t('yc.ni.of', { n: n(h.cap) })}</span> : null}
              </div>
            </div>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 3, textAlign: 'right', paddingBottom: 4 }}>
              <span style={{ fontSize: 16, fontWeight: 600, color: 'var(--green-700)', minHeight: 22 }}>{h.today ? t('yc.ni.todayUp', { n: n(h.today) }) : ''}</span>
              <span style={{ fontSize: 13.5, color: 'var(--sand-500)' }}>{t('yc.ni.caLine', { ca: eur(h.revenue) })}</span>
            </div>
          </div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
            <div style={{ height: 14, borderRadius: 99, background: 'var(--sand-100)', overflow: 'hidden' }}>
              <div style={{ height: '100%', width: `${((f ?? 0) * 100 * c).toFixed(1)}%`, borderRadius: 99, background: 'var(--gradient-brand)' }} />
            </div>
            <div style={{ display: 'flex', justifyContent: 'space-between', gap: 10, fontSize: 13, color: 'var(--sand-500)' }}>
              {f !== null && h.cap ? (
                <><span>{t('yc.ni.filled', { pct: pct(f * 100) })}</span><span>{kind === 'full' ? t('yc.ni.st.full') : tp('yc.ni.left', Math.max(0, h.cap - h.sold), { n: n(Math.max(0, h.cap - h.sold)) })}</span></>
              ) : <span>{t('yc.ni.capUnknown')}</span>}
            </div>
          </div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
            <div style={{ display: 'flex', flexWrap: 'wrap', alignItems: 'baseline', justifyContent: 'space-between', gap: '6px 14px' }}>
              <span style={{ fontSize: 14.5, fontWeight: 600 }}>{t('yc.ni.curve.t')}</span>
              {opened && <span style={{ fontSize: 13, color: 'var(--sand-500)' }}>{t('yc.ni.curve.since', { date: opened })}</span>}
            </div>
            {detail && detail.id === h.id ? (
              <div style={{ paddingTop: 16 }}><SalesCurve detail={detail} progress={progress} /></div>
            ) : <Skel h={150} r={14} />}
            {detail && detail.id === h.id && cmpName && (
              <>
                <div style={{ display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: '6px 18px', fontSize: 13.5, color: 'var(--sand-600)' }}>
                  <span style={{ display: 'flex', alignItems: 'center', gap: 8 }}><i style={{ width: 18, height: 3, borderRadius: 99, background: 'var(--red-500)' }} />{t('yc.ni.curve.this')}</span>
                  <span style={{ display: 'flex', alignItems: 'center', gap: 8 }}><i style={{ width: 18, height: 0, borderTop: '2px dashed var(--sand-400)' }} />{cmpName}</span>
                </div>
                {cmpLine && <span style={{ fontSize: 14, lineHeight: 1.45, color: 'var(--ink)', textWrap: 'pretty' }}>{cmpLine}</span>}
              </>
            )}
          </div>
        </div>
      </div>

      {/* Tarifs */}
      {tiers.length > 0 && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 12, paddingTop: 22, borderTop: '1px solid var(--sand-100)' }}>
          <div style={{ display: 'flex', flexWrap: 'wrap', alignItems: 'baseline', justifyContent: 'space-between', gap: '6px 14px' }}>
            <span style={{ fontSize: 14.5, fontWeight: 600 }}>{t('yc.ni.tiers.t')}</span>
            <span style={{ fontSize: 13, color: 'var(--sand-500)' }}>{t('yc.ni.tiers.s')}</span>
          </div>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit,minmax(min(100%,210px),1fr))', gap: 12 }}>
            {tiers.map((r) => {
              const full = r.cap !== null && r.sold >= r.cap && r.cap > 0;
              const w = r.cap ? Math.min(1, r.sold / r.cap) : r.sold / maxSold;
              const tag = full ? t('yc.ni.tier.full') : r.cap === null ? t('yc.ni.tier.sold', { n: n(r.sold) }) : r.sold === 0 ? t('yc.ni.tier.closed') : t('yc.ni.tier.left', { n: n(r.cap - r.sold) });
              return (
                <div key={r.name} style={{ display: 'flex', flexDirection: 'column', gap: 10, padding: '14px 16px', borderRadius: 18, background: 'var(--sand-50)' }}>
                  <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8 }}>
                    <b style={{ fontSize: 14.5, fontWeight: 600, minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{r.name}</b>
                    <span style={{ fontSize: 14, color: 'var(--sand-600)', fontVariantNumeric: 'tabular-nums', flex: 'none' }}>{priceLabel(r.price, eur, eur2, t('yc.ni.tier.free'))}</span>
                  </div>
                  <div style={{ height: 8, borderRadius: 99, background: 'var(--sand-200)', overflow: 'hidden' }}>
                    <div style={{ height: '100%', width: `${(w * 100 * c).toFixed(1)}%`, borderRadius: 99, background: full ? 'var(--ink)' : r.cap === null ? 'var(--sand-500)' : 'var(--red-500)' }} />
                  </div>
                  <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8, fontSize: 13, color: 'var(--sand-600)' }}>
                    <span style={{ fontVariantNumeric: 'tabular-nums' }}>{r.cap !== null ? `${n(r.sold)} / ${n(r.cap)}` : n(r.sold)}</span>
                    <span style={{ fontWeight: 600, color: full ? 'var(--ink)' : 'var(--sand-500)' }}>{tag}</span>
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      )}

      <div style={{ display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: 10 }}>
        <CtaButton onClick={() => openDr(h.id)}>{t('yc.ni.detail')}</CtaButton>
        <PillButton icon="instagram" onClick={() => openDr(h.id, 'links')}>{t('yc.lk.heroCta')}</PillButton>
        <ShotgunLink href={h.url}>{t('yc.ni.editShotgun')}</ShotgunLink>
      </div>
    </section>
  );
}
