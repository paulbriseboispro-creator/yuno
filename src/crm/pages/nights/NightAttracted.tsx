/**
 * Tiroir d'une soirée › « Ce qu'elle a attiré » (analyse client, RPC
 * crm_night_analysis). Ses nouveaux venus comparés à une soirée habituelle du
 * compte, son rythme de vente, d'où viennent les nouveaux (canal, distance,
 * à plusieurs), son line-up (rareté, 1re fois chez vous) et, après 6 mois,
 * le retour de ses nouveaux. Aucun taux sous 10 personnes.
 */
import { Skel } from '@/crm/ui/kit';
import { useCrmT } from '@/crm/i18n';
import { CrmLoadError } from '@/crm/errors/CrmLoadError';
import { useNightAnalysis } from '@/crm/data/analysis';
import type { NightAnalysis } from '@/crm/data/analysis';
import { rateText, sourceName } from '@/crm/components/analysis/hypText';
import { ArtistAvatar } from '@/crm/components/analysis/HypBits';

type T = ReturnType<typeof useCrmT>;

export function NightAttracted({ eventId }: { eventId: string }) {
  const T = useCrmT();
  const q = useNightAnalysis(eventId);
  return (
    <div style={{ flex: 1, minHeight: 0, overflowY: 'auto', padding: '20px 20px 32px', display: 'flex', flexDirection: 'column', gap: 16 }}>
      {q.isError ? <CrmLoadError error={q.error} onRetry={() => { void q.refetch(); }} retrying={q.isFetching} />
        : !q.data ? <div aria-busy="true" style={{ display: 'flex', flexDirection: 'column', gap: 14 }}><Skel h={28} w={220} /><Skel h={90} r={16} /><Skel h={140} r={16} /></div>
          : !q.data.profile ? <span style={{ fontSize: 14.5, color: 'var(--sand-600)', textWrap: 'pretty' }}>{T.t('yc.why.night.none')}</span>
            : <Body d={q.data} T={T} />}
    </div>
  );
}

function Box({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 10, padding: 18, borderRadius: 20, background: '#fff', boxShadow: 'inset 0 0 0 1px var(--sand-200)' }}>
      <span style={{ fontSize: 15.5, fontWeight: 600 }}>{title}</span>
      {children}
    </div>
  );
}

function Body({ d, T }: { d: NightAnalysis; T: T }) {
  const { t, n, pct } = T;
  const min = d.min_sample ?? 10;
  const o = d.origin;
  const src = Object.entries(o?.src ?? {}).sort((a, b) => b[1] - a[1]).slice(0, 5);
  const newTotal = d.new_people ?? 0;
  const hyps = Object.entries(d.newcomers?.by_family ?? {}).sort((a, b) => b[1] - a[1]).slice(0, 5);
  return (
    <>
      <Box title={t('yc.why.night.new')}>
        <span style={{ fontFamily: 'var(--font-display)', fontWeight: 600, fontSize: 26, letterSpacing: '-.03em', lineHeight: 1.1 }}>
          {t('yc.why.night.newOf', { n: n(newTotal), e: n(d.entries ?? 0) })}
        </span>
        {d.new_share !== null && d.new_share !== undefined && (
          <span style={{ fontSize: 14, color: 'var(--sand-600)' }}>
            {d.usual?.new_share !== null && d.usual?.new_share !== undefined
              ? t('yc.why.night.newPct', { p: pct(d.new_share * 100), u: pct(d.usual.new_share * 100) })
              : t('yc.why.night.newPctOnly', { p: pct(d.new_share * 100) })}
          </span>
        )}
      </Box>

      <Box title={t('yc.why.night.pace')}>
        {d.launch_known && d.launch_48h_share !== null && d.launch_48h_share !== undefined ? (
          <span style={{ fontSize: 14.5 }}>
            {t('yc.why.night.pace48', { p: pct(d.launch_48h_share * 100) })}
            {d.usual?.launch_48h_share !== null && d.usual?.launch_48h_share !== undefined ? ` · ${t('yc.why.night.paceUsual', { u: pct(d.usual.launch_48h_share * 100) })}` : ''}
          </span>
        ) : <span style={{ fontSize: 14, color: 'var(--sand-500)' }}>{t('yc.why.night.paceNone')}</span>}
      </Box>

      {newTotal > 0 && o && (
        <Box title={t('yc.why.night.origin')}>
          {src.map(([k, v]) => (
            <div key={k} style={{ display: 'flex', justifyContent: 'space-between', gap: 10, fontSize: 14 }}>
              <span>{sourceName(k, T)}</span>
              <span style={{ color: 'var(--sand-600)', fontVariantNumeric: 'tabular-nums' }}>{rateText(v, newTotal, T, min)}</span>
            </div>
          ))}
          <div style={{ display: 'flex', flexDirection: 'column', gap: 4, paddingTop: 8, borderTop: '1px solid var(--sand-100)', fontSize: 13.5, color: 'var(--sand-700)' }}>
            {o.far > 0 && <span>{t('yc.why.night.far', { n: n(o.far), km: n(d.far_km ?? 80) })}</span>}
            {o.foreign > 0 && <span>{t('yc.why.night.foreign', { n: n(o.foreign) })}</span>}
            {o.group > 0 && <span>{t('yc.why.night.group', { n: n(o.group) })}</span>}
            {o.invited > 0 && <span>{t('yc.why.night.invited', { n: n(o.invited) })}</span>}
            {o.lead_days !== null && o.lead_days !== undefined && <span>{t('yc.why.night.lead', { d: n(o.lead_days) })}</span>}
          </div>
        </Box>
      )}

      {(d.artists?.length ?? 0) > 0 && (
        <Box title={t('yc.why.night.artists')}>
          {d.artists!.map((a) => (
            <div key={a.k} style={{ display: 'flex', alignItems: 'center', gap: 10, fontSize: 14 }}>
              <ArtistAvatar src={a.avatar} size={32} />
              <span style={{ flex: 1, minWidth: 0, display: 'flex', flexDirection: 'column' }}>
                <span style={{ fontWeight: 600, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{a.name ?? '—'}</span>
                <span style={{ fontSize: 12.5, color: 'var(--sand-500)' }}>
                  {[a.first ? t('yc.why.art.firstTime') : null, a.resident ? t('yc.why.art.resident') : null,
                    a.new_brought ? `${t('yc.why.art.new')} · ${n(a.new_brought)}` : null].filter(Boolean).join(' · ')}
                </span>
              </span>
            </div>
          ))}
        </Box>
      )}

      {hyps.length > 0 && (
        <Box title={t('yc.why.night.hyps')}>
          {hyps.map(([f, c]) => (
            <div key={f} style={{ display: 'flex', justifyContent: 'space-between', gap: 10, fontSize: 14 }}>
              <span>{t(`yc.why.fam.${f}`)}</span>
              <span style={{ color: 'var(--sand-600)', fontVariantNumeric: 'tabular-nums' }}>{rateText(c, d.newcomers?.n ?? 0, T, min)}</span>
            </div>
          ))}
        </Box>
      )}

      <Box title={t('yc.why.night.return')}>
        <span style={{ fontSize: 14.5, color: 'var(--sand-700)' }}>
          {!d.return || d.return.eligible === 0 ? t('yc.why.night.returnRecent')
            : d.return.rate !== null ? t('yc.why.night.returnRate', { r: pct(d.return.rate * 100) })
              : t('yc.why.night.returnCounts', { a: n(d.return.returned), b: n(d.return.eligible) })}
        </span>
      </Box>
    </>
  );
}
