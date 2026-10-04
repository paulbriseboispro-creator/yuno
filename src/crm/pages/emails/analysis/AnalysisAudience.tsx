/**
 * Analyse › Audience : combien de clients un e-mail peut atteindre (et
 * pourquoi pas les autres), puis la réponse de chaque groupe de clients sur
 * toutes les campagnes envoyées.
 */
import { Link } from 'react-router-dom';
import { Hv } from '@/crm/ui/Hv';
import { EASE, clamp01, useProgress } from '@/crm/ui/motion';
import { useNarrow } from '@/crm/ui/useNarrow';
import { useCrmT } from '@/crm/i18n';
import { CRM_ROUTES } from '@/crm/shell/nav';
import { LIFECYCLES, LIFECYCLE_COLOR } from '@/crm/lib/lifecycle';
import type { EmailAnalysis } from '@/crm/data/emails';
import { box, h2, subCss } from './analysisUi';

export function AnalysisAudience({ a }: { a: EmailAnalysis }) {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 20, animation: `yc-rise 520ms ${EASE} both` }}>
      <Reach aud={a.audience} />
      <Groups a={a} />
    </div>
  );
}

function Reach({ aud }: { aud: EmailAnalysis['audience'] }) {
  const { t, tp, n, pct } = useCrmT();
  const g = useProgress(1100, 300, aud.clients);
  const share = aud.clients ? aud.reachable / aud.clients : 0;
  const notes: { tone: 'amber' | 'sand'; text: string; to?: string }[] = [];
  if (aud.bounced > 0) notes.push({ tone: 'amber', text: tp('yc.em.an.a.bounced', aud.bounced, { n: n(aud.bounced) }), to: `${CRM_ROUTES.clients}?status=unreachable` });
  if (aud.unsub > 0) notes.push({ tone: 'sand', text: tp('yc.em.an.a.unsub', aud.unsub, { n: n(aud.unsub) }) });
  if (aud.no_consent > 0) notes.push({ tone: 'sand', text: tp('yc.em.an.a.consent', aud.no_consent, { n: n(aud.no_consent) }) });
  if (!notes.length) notes.push({ tone: 'sand', text: t('yc.em.an.a.allOk') });

  return (
    <section style={{ ...box, flexDirection: 'row', flexWrap: 'wrap', gap: '22px 36px', alignItems: 'center', boxShadow: 'inset 0 0 0 1px var(--sand-200),var(--shadow-sm)' }}>
      <div style={{ flex: '1 1 320px', display: 'flex', flexDirection: 'column', gap: 12, minWidth: 0 }}>
        <div><h2 style={h2}>{t('yc.em.an.a.t')}</h2><div style={subCss}>{t('yc.em.an.a.s')}</div></div>
        <div style={{ display: 'flex', alignItems: 'baseline', flexWrap: 'wrap', gap: 10 }}>
          <span style={{ fontFamily: 'var(--font-display)', fontWeight: 600, fontSize: 64, lineHeight: 0.95, letterSpacing: '-.05em', fontVariantNumeric: 'tabular-nums' }}>{n(Math.round(aud.reachable * g))}</span>
          <span style={{ fontSize: 16, color: 'var(--sand-500)' }}>{tp('yc.em.an.a.of', aud.clients, { n: n(aud.clients) })}</span>
        </div>
        <div style={{ display: 'flex', height: 14, gap: 2, borderRadius: 99, overflow: 'hidden', background: 'var(--sand-200)' }}>
          <div style={{ width: `${share * 100 * clamp01(g)}%`, background: 'var(--gradient-brand)', transition: 'width 200ms' }} />
        </div>
        <div style={{ display: 'flex', flexWrap: 'wrap', justifyContent: 'space-between', gap: 8, fontSize: 13, color: 'var(--sand-500)' }}>
          <span>{t('yc.em.an.a.ok', { p: pct(share * 100) })}</span>
          <span>{t('yc.em.an.a.ko', { p: pct((1 - share) * 100) })}</span>
        </div>
      </div>
      <div style={{ flex: '1 1 300px', display: 'flex', flexDirection: 'column', gap: 10, minWidth: 0 }}>
        {notes.map((x) => (
          <div key={x.text} style={{ display: 'flex', alignItems: 'center', gap: 12, padding: '14px 16px', borderRadius: 16, background: x.tone === 'amber' ? 'var(--amber-50)' : 'var(--sand-50)' }}>
            <span style={{ flex: 1, fontSize: 14.5, lineHeight: 1.4, color: x.tone === 'amber' ? 'var(--amber-700)' : 'var(--sand-700)', fontWeight: 500, textWrap: 'pretty' }}>{x.text}</span>
            {x.to && <Hv as={Link} to={x.to} style={{ fontSize: 14, fontWeight: 600, color: 'var(--ink)', whiteSpace: 'nowrap', textDecoration: 'none' }} hover={{ color: 'var(--red-600)', textDecoration: 'none' }}>{t('yc.em.an.a.see')}</Hv>}
          </div>
        ))}
      </div>
    </section>
  );
}

function Groups({ a }: { a: EmailAnalysis }) {
  const { t, n, n1, pct } = useCrmT();
  const narrow = useNarrow(720);
  const g = useProgress(1100, 380, a.segments.length);
  const rows = LIFECYCLES.map((l) => a.segments.find((s) => s.seg === l)).filter((s): s is EmailAnalysis['segments'][number] => !!s && s.received > 0);
  const maxPerK = Math.max(0.0001, ...rows.map((s) => (s.purchases / s.received) * 1000));
  const cols = narrow ? 'minmax(0,1fr) 70px' : 'minmax(140px,1.4fr) repeat(3,minmax(0,1fr)) 90px';

  return (
    <section style={{ ...box, gap: 14 }}>
      <div><h2 style={h2}>{t('yc.em.an.g.t')}</h2><div style={subCss}>{t('yc.em.an.g.s')}</div></div>
      {!rows.length ? <div style={{ fontSize: 15, color: 'var(--sand-500)', padding: '8px 0' }}>{t('yc.em.an.g.none')}</div> : (
        <>
          {!narrow && (
            <div style={{ display: 'grid', gridTemplateColumns: cols, gap: '10px 18px', alignItems: 'center', fontFamily: 'var(--font-mono)', fontSize: 11, letterSpacing: '.08em', textTransform: 'uppercase', color: 'var(--sand-400)', padding: '0 4px' }}>
              <span>{t('yc.em.an.g.seg')}</span><span>{t('yc.em.an.g.open')}</span><span>{t('yc.em.an.g.click')}</span><span>{t('yc.em.an.g.perK')}</span><span style={{ textAlign: 'right' }}>{t('yc.em.an.g.reach')}</span>
            </div>
          )}
          <div style={{ display: 'flex', flexDirection: 'column' }}>
            {rows.map((s, i) => {
              const k = clamp01(g * 1.4 - i * 0.05);
              const perK = (s.purchases / s.received) * 1000;
              const metrics = [
                { l: t('yc.em.an.g.open'), v: pct((s.opened / s.received) * 100), w: (s.opened / s.received / 0.8) * 100, fill: 'var(--red-300)' },
                { l: t('yc.em.an.g.click'), v: pct((s.clicked / s.received) * 100), w: (s.clicked / s.received / 0.5) * 100, fill: 'var(--gradient-brand)' },
                { l: t('yc.em.an.g.perK'), v: n1(perK), w: (perK / maxPerK) * 100, fill: 'var(--ink)' },
              ];
              const reach = a.audience.by_seg?.[s.seg] ?? 0;
              return (
                <Hv
                  as={Link}
                  key={s.seg}
                  to={`${CRM_ROUTES.clients}?s=${s.seg}`}
                  style={{ display: 'grid', gridTemplateColumns: cols, gap: '10px 18px', alignItems: 'center', padding: '14px 4px', borderTop: '1px solid var(--sand-100)', color: 'var(--ink)', textDecoration: 'none' }}
                  hover={{ background: 'var(--paper)', color: 'var(--ink)', textDecoration: 'none' }}
                >
                  <span style={{ display: 'flex', alignItems: 'center', gap: 10, minWidth: 0 }}>
                    <i style={{ flex: 'none', width: 12, height: 12, borderRadius: 4, background: LIFECYCLE_COLOR[s.seg as keyof typeof LIFECYCLE_COLOR] ?? 'var(--sand-200)', boxShadow: s.seg === 'none' ? 'inset 0 0 0 1px var(--sand-300)' : undefined }} />
                    <b style={{ fontSize: 14.5, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{t(`yc.cli.seg.${s.seg}`)}</b>
                  </span>
                  {narrow && <span style={{ textAlign: 'right', fontSize: 14, fontVariantNumeric: 'tabular-nums', color: 'var(--sand-600)' }}>{n(reach)}</span>}
                  {metrics.map((m) => (
                    <span key={m.l} style={{ display: 'flex', alignItems: 'center', gap: 8, gridColumn: narrow ? '1 / -1' : undefined }}>
                      {narrow && <span style={{ width: 110, fontSize: 12.5, color: 'var(--sand-500)' }}>{m.l}</span>}
                      <span style={{ flex: 1, height: 8, borderRadius: 99, background: 'var(--sand-100)', overflow: 'hidden' }}>
                        <span style={{ display: 'block', width: `${Math.min(100, m.w) * k}%`, height: '100%', borderRadius: 99, background: m.fill }} />
                      </span>
                      <b style={{ width: 48, fontSize: 14, fontVariantNumeric: 'tabular-nums', textAlign: 'right' }}>{m.v}</b>
                    </span>
                  ))}
                  {!narrow && <span style={{ textAlign: 'right', fontSize: 14, fontVariantNumeric: 'tabular-nums', color: 'var(--sand-600)' }}>{n(reach)}</span>}
                </Hv>
              );
            })}
          </div>
        </>
      )}
    </section>
  );
}
