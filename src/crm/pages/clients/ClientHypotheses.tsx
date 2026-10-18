/**
 * Fiche client › Hypothèses (analyse client, migration 20261010140000).
 * Les 1 à 2 hypothèses les plus fortes, chacune = un FAIT + le statut de sa
 * famille sur le compte ; puis les faits de la personne ; puis le droit
 * d'opposition (exclure du profilage). Visible de tout rôle qui voit déjà les
 * clients nommés ; jamais dans un export.
 */
import { useState } from 'react';
import { Hv } from '@/crm/ui/Hv';
import { Icon } from '@/crm/ui/Icon';
import { Badge, Skel } from '@/crm/ui/kit';
import { useCrmToast } from '@/crm/ui/toast';
import { useCrmT } from '@/crm/i18n';
import { useCrmCaps } from '@/crm/scope';
import { useClientAnalysis, useProfileOptout } from '@/crm/data/analysis';
import type { ClientAnalysis } from '@/crm/data/analysis';
import { displayStatus, topHypotheses } from '@/crm/lib/analysis';
import type { Hypothesis } from '@/crm/lib/analysis';
import { evidenceText, sourceName, statusDetail } from '@/crm/components/analysis/hypText';
import { StatusBadge, StrengthBars } from '@/crm/components/analysis/HypBits';

type T = ReturnType<typeof useCrmT>;

export function ClientHypotheses({ email, fromFileOnly }: { email: string; fromFileOnly: boolean }) {
  const T = useCrmT();
  const { t } = T;
  const q = useClientAnalysis(email);
  const d = q.data;
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 12, padding: 18, borderRadius: 20, background: '#fff', boxShadow: 'inset 0 0 0 1px var(--sand-200)' }}>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
        <span style={{ fontSize: 16, fontWeight: 600 }}>{t('yc.why.card.t')}</span>
        <span style={{ fontSize: 13, color: 'var(--sand-500)' }}>{t('yc.why.card.s')}</span>
      </div>
      {q.isError ? (
        <span style={{ fontSize: 14, color: 'var(--sand-600)' }}>{t('yc.why.card.err')}</span>
      ) : !d ? (
        <div aria-busy="true" style={{ display: 'flex', flexDirection: 'column', gap: 10 }}><Skel h={18} w="80%" /><Skel h={14} w="60%" /><Skel h={18} w="70%" /></div>
      ) : (
        <Body d={d} email={email} fromFileOnly={fromFileOnly} T={T} />
      )}
    </div>
  );
}

function Body({ d, email, fromFileOnly, T }: { d: ClientAnalysis; email: string; fromFileOnly: boolean; T: T }) {
  const { t, n } = T;
  const caps = useCrmCaps();
  const toast = useCrmToast();
  const optout = useProfileOptout();
  const [all, setAll] = useState(false);

  const toggle = (on: boolean) => optout.mutate({ email, on }, {
    onSuccess: () => toast(t(on ? 'yc.why.card.optedOut' : 'yc.why.card.included')),
    onError: (e) => toast(String((e as Error).message).includes('support_session') ? t('yc.why.card.supportRefused') : t('yc.why.card.err')),
  });

  if (d.excluded) {
    return (
      <div style={{ display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: 10 }}>
        <span style={{ flex: '1 1 220px', fontSize: 14, color: 'var(--sand-700)', textWrap: 'pretty' }}>{t('yc.why.card.excluded')}</span>
        {caps.write && (
          <Hv as="button" type="button" disabled={optout.isPending} onClick={() => toggle(false)} style={{ height: 36, padding: '0 14px', borderRadius: 99, border: '1px solid var(--sand-200)', background: '#fff', fontSize: 13.5, fontWeight: 600, color: 'var(--ink)', cursor: 'pointer' }} hover={{ borderColor: 'var(--sand-300)' }}>
            {t('yc.why.card.include')}
          </Hv>
        )}
      </div>
    );
  }
  if (!d.profile) {
    return <span style={{ fontSize: 14, color: 'var(--sand-600)', textWrap: 'pretty' }}>{t(fromFileOnly ? 'yc.why.card.noneFile' : 'yc.why.card.none')}</span>;
  }

  const hyps = (d.hyps ?? []).filter((h) => displayStatus(h) !== 'off');
  const top = topHypotheses(hyps, 2);
  const shown: Hypothesis[] = all ? hyps : top;
  const f = d.first;
  const a = d.agg;
  const facts: { l: string; v: string }[] = [];
  if (f) {
    facts.push({ l: t('yc.why.card.f.first'), v: `${f.title ?? '—'} · ${T.dShort(f.start_at)}` });
    const lead = f.lead_days === null || f.lead_days === undefined ? null
      : f.lead_days < 1 ? t('yc.why.card.f.leadSame') : t('yc.why.card.f.leadDays', { n: n(f.lead_days) });
    const launch = f.since_launch_h !== null && f.since_launch_h !== undefined && f.since_launch_h >= 0 && f.since_launch_h <= 72
      ? t('yc.why.card.f.sinceLaunch', { n: n(f.since_launch_h) }) : null;
    if (lead || launch) facts.push({ l: t('yc.why.card.f.lead'), v: [lead, launch].filter(Boolean).join(' · ') });
    if (f.src || f.invitation) facts.push({ l: t('yc.why.card.f.src'), v: sourceName(f.invitation ? 'gl' : f.src, T) });
    if (f.order_size > 0) facts.push({ l: t('yc.why.card.f.order'), v: f.order_size > 1 ? t('yc.why.card.f.orderN', { n: n(f.order_size) }) : t('yc.why.card.f.orderOne') });
    if (f.deal && f.tier_rank && f.tier_count && f.tier_count > 1) facts.push({ l: t('yc.why.card.f.tier'), v: t('yc.why.card.f.tierOf', { deal: f.deal, r: f.tier_rank, n: f.tier_count }) });
    if (d.dist_km !== null && d.dist_km !== undefined) facts.push({ l: t('yc.why.card.f.dist'), v: t('yc.why.card.f.km', { n: n(d.dist_km) }) });
  }
  if (a?.artists?.length) facts.push({ l: t('yc.why.card.f.artists'), v: a.artists.slice(0, 4).map((x) => (x.n > 1 ? t('yc.why.card.f.times', { name: x.name ?? '—', n: x.n }) : x.name ?? '—')).join(', ') });
  if (a?.genres?.length) facts.push({ l: t('yc.why.card.f.genres'), v: a.genres.slice(0, 3).map((x) => x.v.charAt(0).toUpperCase() + x.v.slice(1)).join(', ') });
  if (a?.series?.length) facts.push({ l: t('yc.why.card.f.series'), v: a.series.slice(0, 2).map((x) => (x.n > 1 ? t('yc.why.card.f.times', { name: x.v, n: x.n }) : x.v)).join(', ') });

  return (
    <>
      {hyps.length === 0 ? (
        <span style={{ fontSize: 14, color: 'var(--sand-600)' }}>{t('yc.why.card.none')}</span>
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
          {shown.map((h, i) => (
            <div key={`${h.f}-${h.k}-${i}`} style={{ display: 'flex', gap: 12, paddingTop: i ? 12 : 0, borderTop: i ? '1px solid var(--sand-100)' : 0 }}>
              <span style={{ paddingTop: 3 }}><StrengthBars s={h.s} label={t(`yc.why.str.${h.s}`)} /></span>
              <div style={{ flex: 1, minWidth: 0, display: 'flex', flexDirection: 'column', gap: 6 }}>
                <span style={{ fontSize: 14.5, fontWeight: 600, lineHeight: 1.4, textWrap: 'pretty' }}>{evidenceText(h, T)}</span>
                <div style={{ display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: '6px 8px' }}>
                  <span style={{ fontSize: 13, color: 'var(--sand-600)' }}>{t('yc.why.hypOf', { family: t(`yc.why.fam.${h.f}`).toLowerCase() })}</span>
                  <StatusBadge f={h} T={T} />
                </div>
                <span style={{ fontSize: 12.5, lineHeight: 1.45, color: 'var(--sand-500)', textWrap: 'pretty' }}>{statusDetail(h, T)}</span>
              </div>
            </div>
          ))}
          {hyps.length > top.length && (
            <Hv as="button" type="button" onClick={() => setAll(!all)} style={{ alignSelf: 'flex-start', border: 0, background: 'none', padding: 0, fontSize: 14, fontWeight: 600, color: 'var(--ink)', cursor: 'pointer', display: 'inline-flex', alignItems: 'center', gap: 6 }} hover={{ color: 'var(--red-600)' }}>
              {all ? t('yc.why.card.less') : t('yc.why.card.more', { n: hyps.length })}
              <Icon name="chevronDown" size={14} stroke={2.4} style={{ transform: `rotate(${all ? 180 : 0}deg)` }} />
            </Hv>
          )}
          {(d.nights ?? 0) === 1 && <span style={{ fontSize: 12.5, color: 'var(--sand-500)', textWrap: 'pretty' }}>{t('yc.why.card.once')}</span>}
        </div>
      )}

      {(d.chances?.length ?? 0) > 0 && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 8, paddingTop: 12, borderTop: '1px solid var(--sand-100)' }}>
          <span style={{ fontFamily: 'var(--font-mono)', fontSize: 11.5, letterSpacing: '.08em', textTransform: 'uppercase', color: 'var(--sand-500)' }}>{t('yc.sc.card.t')}</span>
          {d.chances!.map((c) => (
            <div key={c.event_id} style={{ display: 'flex', flexDirection: 'column', gap: 3 }}>
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12, fontSize: 14 }}>
                <span style={{ minWidth: 0, fontWeight: 500, overflowWrap: 'anywhere' }}>{`${c.title} · ${T.dShort(c.start_at)}`}</span>
                <Badge tone={c.label === 'high' ? 'done' : c.label === 'medium' ? 'warn' : 'wait'}>{t(`yc.sc.label.${c.label}`)}</Badge>
              </div>
              {c.reasons.length > 0 && (
                <span style={{ fontSize: 12.5, color: 'var(--sand-600)' }}>
                  {c.reasons.map((r) => t(`yc.sc.reason.${r}`)).join(' · ')}
                </span>
              )}
            </div>
          ))}
          <span style={{ fontSize: 12.5, color: 'var(--sand-500)', textWrap: 'pretty' }}>{t('yc.sc.card.hint')}</span>
        </div>
      )}

      {facts.length > 0 && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 8, paddingTop: 12, borderTop: '1px solid var(--sand-100)' }}>
          <span style={{ fontFamily: 'var(--font-mono)', fontSize: 11.5, letterSpacing: '.08em', textTransform: 'uppercase', color: 'var(--sand-500)' }}>{t('yc.why.card.facts')}</span>
          {facts.map((x) => (
            <div key={x.l} style={{ display: 'flex', alignItems: 'baseline', justifyContent: 'space-between', gap: 16, fontSize: 14 }}>
              <span style={{ flex: 'none', width: 110, color: 'var(--sand-500)' }}>{x.l}</span>
              <span style={{ flex: 1, minWidth: 0, textAlign: 'right', fontWeight: 500, overflowWrap: 'anywhere' }}>{x.v}</span>
            </div>
          ))}
        </div>
      )}

      {caps.write && (
        <div style={{ display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: '6px 12px', paddingTop: 12, borderTop: '1px solid var(--sand-100)' }}>
          <Hv as="button" type="button" disabled={optout.isPending} onClick={() => toggle(true)} style={{ border: 0, background: 'none', padding: 0, fontSize: 13.5, fontWeight: 600, color: 'var(--sand-700)', cursor: 'pointer', textDecoration: 'underline', textUnderlineOffset: 3 }} hover={{ color: 'var(--ink)' }}>
            {t('yc.why.card.optout')}
          </Hv>
          <span style={{ fontSize: 12.5, color: 'var(--sand-500)' }}>{t('yc.why.card.optoutHelp')}</span>
        </div>
      )}
    </>
  );
}
