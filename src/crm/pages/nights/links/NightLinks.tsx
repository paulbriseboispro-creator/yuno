/**
 * Onglet « Liens » d'une soirée : un lien par story, par bio, par post…
 *
 *   Créer   → un geste (« Nouvelle story »), le lien est copié aussitôt.
 *   Mesurer → clics comptés par Yuno, billets et acheteurs rapportés par
 *             Shotgun (source `yuno-<code>` sur chaque billet), sans rien
 *             inventer : avant la première vente confirmée par Shotgun, on
 *             dit « en attente », jamais « 0 vente ».
 *   Lire    → toutes les sources que Shotgun donne pour la soirée, et ce qui
 *             viendra avec l'intégration partenaire (« Bientôt »).
 */
import { useEffect, useMemo, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { Hv } from '@/crm/ui/Hv';
import { Icon } from '@/crm/ui/Icon';
import { Segmented, Skel } from '@/crm/ui/kit';
import { useCrmToast } from '@/crm/ui/toast';
import { useNarrow } from '@/crm/ui/useNarrow';
import { EASE, SPRING } from '@/crm/ui/motion';
import { useCrmT } from '@/crm/i18n';
import { PUBLIC_BASE_URL } from '@/lib/native';
import { CRM_ROUTES } from '@/crm/shell/nav';
import { CrmRpcError } from '@/crm/lib/rpc';
import { useLinkMutations, useNightLinks, type NightLinksData } from '@/crm/data/links';
import {
  LINK_KINDS, QUICK_KINDS, bestLink, goDisplay, goUrl, groupSources, kindKey, linkConversion, linkState, nextIndex, reusableLink,
  type LinkKind, type NightLink,
} from '@/crm/lib/links';
import { ShotgunSoonCard } from '@/crm/components/ShotgunSoon';
import { PlatformBadge, QrModal, SOURCE_COLOR, Spark } from './linksUi';
import { NewLinkModal } from './NewLinkModal';

async function copyText(text: string): Promise<boolean> {
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch {
    try {
      const ta = document.createElement('textarea');
      ta.value = text; ta.style.position = 'fixed'; ta.style.opacity = '0';
      document.body.appendChild(ta); ta.select();
      const ok = document.execCommand('copy');
      ta.remove();
      return ok;
    } catch {
      return false;
    }
  }
}

export function NightLinks({ eventId }: { eventId: string }) {
  const q = useNightLinks(eventId);
  const d = q.data && q.data.event?.id === eventId ? q.data : undefined;
  if (q.isError) return <ErrorBox onRetry={() => void q.refetch()} />;
  if (!d) {
    return (
      <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
        <Skel h={210} r={24} />
        <Skel h={120} r={24} />
        <Skel h={260} r={24} />
      </div>
    );
  }
  if (d.error === 'not_found') return <ErrorBox />;
  return <Body d={d} />;
}

function ErrorBox({ onRetry }: { onRetry?: () => void }) {
  const { t } = useCrmT();
  return (
    <div style={{ padding: 20, borderRadius: 20, background: 'var(--sand-50)', fontSize: 14.5, color: 'var(--sand-700)', display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12 }}>
      {t('yc.lk.err.load')}
      {onRetry && <button type="button" onClick={onRetry} style={{ border: 0, background: 'none', color: 'var(--red-600)', fontWeight: 600, cursor: 'pointer', fontSize: 14 }}>{t('yc.lk.retry')}</button>}
    </div>
  );
}

function Body({ d }: { d: NightLinksData }) {
  const T = useCrmT();
  const { t, tp, n, eur, pct } = T;
  const toast = useCrmToast();
  const m = useLinkMutations(d.event.id);
  const [busy, setBusy] = useState<string | null>(null);
  const [fresh, setFresh] = useState<string | null>(null);
  const [copied, setCopied] = useState<string | null>(null);
  const [showAll, setShowAll] = useState(false);
  const [showArchived, setShowArchived] = useState(false);
  const [sort, setSort] = useState<'recent' | 'best'>('recent');
  const [qr, setQr] = useState<NightLink | null>(null);
  const [naming, setNaming] = useState<LinkKind | null>(null);
  const freshTimer = useRef<ReturnType<typeof setTimeout>>();
  useEffect(() => () => clearTimeout(freshTimer.current), []);

  const active = d.links.filter((l) => !l.archived);
  const archived = d.links.filter((l) => l.archived);
  const list = useMemo(() => {
    const base = showArchived ? d.links : active;
    return sort === 'best'
      ? [...base].sort((a, b) => b.tickets - a.tickets || b.visitors - a.visitors)
      : base;
  }, [d.links, active, showArchived, sort]);
  const best = bestLink(active);
  const groups = groupSources(d.sources, d.links);
  const totalSold = d.totals.tickets;

  const kindLabel = (k: LinkKind) => t(`yc.lk.kind.${kindKey(k.platform, k.placement)}`);
  const tipFor = (k: Pick<LinkKind, 'placement'>) => t(`yc.lk.tip.${k.placement}`);

  const flash = (id: string) => {
    setFresh(id);
    setCopied(id);
    clearTimeout(freshTimer.current);
    freshTimer.current = setTimeout(() => { setFresh(null); setCopied(null); }, 3200);
  };

  const copyLink = async (l: Pick<NightLink, 'id' | 'code' | 'placement'>) => {
    const ok = await copyText(goUrl(PUBLIC_BASE_URL, l.code));
    if (ok) {
      setCopied(l.id);
      setTimeout(() => setCopied((c) => (c === l.id ? null : c)), 2200);
      toast(tipFor(l));
    } else {
      toast(t('yc.lk.err.copy'));
    }
  };

  const defaultName = (k: LinkKind) => `${kindLabel(k)} ${nextIndex(d.links, k)}`;

  /** Une publication (story, groupe…) se nomme d'abord ; un lien en bio est unique : créé ou recopié d'un geste. */
  const create = async (k: LinkKind, named?: { name: string; imageUrl: string | null }): Promise<boolean> => {
    if (busy) return false;
    const reuse = reusableLink(d.links, k);
    if (reuse) {
      await copyLink(reuse);
      flash(reuse.id);
      return true;
    }
    if (k.perPost && !named) { setNaming(k); return false; }
    setBusy(kindKey(k.platform, k.placement));
    const label = named?.name ?? kindLabel(k);
    try {
      const r = await m.create(k.platform, k.placement, label, named?.imageUrl ?? null);
      setNaming(null);
      const ok = await copyText(goUrl(PUBLIC_BASE_URL, r.code));
      flash(r.id);
      toast(ok ? t('yc.lk.created', { label: r.label }) + ' ' + tipFor(k) : t('yc.lk.createdNoCopy', { label: r.label }));
      setShowAll(false);
      return true;
    } catch (e) {
      const code = e instanceof CrmRpcError ? e.code : undefined;
      toast(code === '25006' ? t('yc.lk.err.readonly') : code === '42501' ? t('yc.lk.err.forbidden') : t('yc.lk.err.create'));
      return false;
    } finally {
      setBusy(null);
    }
  };

  const save = async (l: NightLink, patch: { label?: string; archived?: boolean }) => {
    try {
      await m.update(l.id, patch);
      if (patch.archived !== undefined) toast(t(patch.archived ? 'yc.lk.archived' : 'yc.lk.unarchived', { label: l.label }));
    } catch (e) {
      const code = e instanceof CrmRpcError ? e.code : undefined;
      toast(code === '25006' ? t('yc.lk.err.readonly') : t('yc.lk.err.save'));
    }
  };

  const card = (delay: number) => ({ display: 'flex', flexDirection: 'column' as const, gap: 16, padding: 22, borderRadius: 24, background: '#fff', boxShadow: 'inset 0 0 0 1px var(--sand-200),var(--shadow-xs)', animation: `yc-row 600ms ${EASE} ${delay}ms both` });
  const h3 = { margin: 0, fontSize: 16, fontWeight: 600 } as const;
  const sub = { fontSize: 13.5, lineHeight: 1.45, color: 'var(--sand-600)', textWrap: 'pretty' as const };

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 20 }}>
      {/* ── Créer ──────────────────────────────────────────────────────── */}
      {d.event.upcoming && d.can_write ? (
        <section style={{ position: 'relative', overflow: 'hidden', display: 'flex', flexDirection: 'column', gap: 18, padding: 24, borderRadius: 26, background: 'radial-gradient(80% 90% at 100% 0%,rgba(214,41,118,.28),transparent 60%),radial-gradient(70% 80% at 0% 100%,rgba(255,107,53,.22),transparent 60%),#141012', color: '#fff', animation: `yc-row 600ms ${EASE} 80ms both` }}>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
            <span style={{ fontFamily: 'var(--font-mono)', fontSize: 11.5, letterSpacing: '.1em', textTransform: 'uppercase', color: 'rgba(255,255,255,.6)' }}>{t('yc.lk.k')}</span>
            <span style={{ fontFamily: 'var(--font-display)', fontWeight: 600, fontSize: 'clamp(22px,3vw,28px)', lineHeight: 1.08, letterSpacing: '-.03em', textWrap: 'balance' }}>{t('yc.lk.h')}</span>
            <span style={{ fontSize: 14, lineHeight: 1.5, color: 'rgba(255,255,255,.72)', textWrap: 'pretty', maxWidth: 520 }}>{t('yc.lk.s')}</span>
          </div>
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 10 }}>
            <Hv
              as="button"
              type="button"
              onClick={() => void create(QUICK_KINDS[0])}
              disabled={!!busy}
              style={{ height: 52, padding: '0 22px 0 8px', borderRadius: 99, border: 0, background: '#fff', color: 'var(--ink)', fontSize: 15.5, fontWeight: 600, display: 'inline-flex', alignItems: 'center', gap: 12, cursor: busy ? 'default' : 'pointer', boxShadow: '0 12px 30px -12px rgba(214,41,118,.7)', transition: `transform 220ms ${SPRING}` }}
              hover={{ transform: 'translateY(-2px)' }}
              active={{ transform: 'scale(.97)' }}
            >
              <PlatformBadge platform="instagram" size={38} />
              {busy === kindKey('instagram', 'story') ? t('yc.lk.creating') : t('yc.lk.newStory')}
            </Hv>
            {QUICK_KINDS.slice(1).map((k) => (
              <QuickChip key={kindKey(k.platform, k.placement)} k={k} label={kindLabel(k)} busy={busy === kindKey(k.platform, k.placement)} disabled={!!busy} onClick={() => void create(k)} />
            ))}
            <QuickChip more label={showAll ? t('yc.lk.less') : t('yc.lk.more')} onClick={() => setShowAll((v) => !v)} />
          </div>
          {showAll && (
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill,minmax(160px,1fr))', gap: 8, animation: `yc-row 380ms ${EASE} both` }}>
              {LINK_KINDS.filter((k) => !QUICK_KINDS.includes(k)).map((k) => (
                <QuickChip key={kindKey(k.platform, k.placement)} k={k} label={kindLabel(k)} busy={busy === kindKey(k.platform, k.placement)} disabled={!!busy} onClick={() => void create(k)} block />
              ))}
            </div>
          )}
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit,minmax(150px,1fr))', gap: 10, paddingTop: 4 }}>
            {[1, 2, 3].map((i) => (
              <div key={i} style={{ display: 'flex', gap: 10, alignItems: 'flex-start' }}>
                <span style={{ flex: 'none', width: 22, height: 22, borderRadius: 99, background: 'rgba(255,255,255,.12)', color: '#fff', fontSize: 12, fontWeight: 600, display: 'grid', placeItems: 'center' }}>{i}</span>
                <span style={{ fontSize: 13, lineHeight: 1.4, color: 'rgba(255,255,255,.72)' }}>{t(`yc.lk.step${i}`)}</span>
              </div>
            ))}
          </div>
        </section>
      ) : !d.event.upcoming ? (
        <div style={{ padding: '14px 16px', borderRadius: 16, background: 'var(--sand-50)', fontSize: 14, lineHeight: 1.45, color: 'var(--sand-700)' }}>{t('yc.lk.past')}</div>
      ) : (
        <div style={{ padding: '14px 16px', borderRadius: 16, background: 'var(--sand-50)', fontSize: 14, lineHeight: 1.45, color: 'var(--sand-700)' }}>{t('yc.lk.readonlyRole')}</div>
      )}

      {/* ── Ce que vos liens ont donné ─────────────────────────────────── */}
      {d.links.length > 0 && (
        <section style={card(160)}>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
            <h3 style={h3}>{t('yc.lk.res.t')}</h3>
            <span style={sub}>{t('yc.lk.res.s')}</span>
          </div>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit,minmax(140px,1fr))', gap: 10 }}>
            <Kpi label={t('yc.lk.kpi.visitors')} value={n(d.totals.visitors)} sub={tp('yc.lk.kpi.clicks', d.totals.clicks, { n: n(d.totals.clicks) })} who={t('yc.lk.by.yuno')} />
            <Kpi label={t('yc.lk.kpi.tickets')} value={d.confirmed || d.totals.link_tickets > 0 ? n(d.totals.link_tickets) : '—'} sub={d.confirmed || d.totals.link_tickets > 0 ? (totalSold ? t('yc.lk.kpi.ofSold', { pct: pct((d.totals.link_tickets / totalSold) * 100) }) : '') : t('yc.lk.kpi.waiting')} who={t('yc.lk.by.shotgun')} accent />
            {d.sees_money && <Kpi label={t('yc.lk.kpi.revenue')} value={d.confirmed || d.totals.link_tickets > 0 ? eur(d.totals.link_revenue ?? 0) : '—'} sub={t('yc.lk.kpi.revenueSub')} who={t('yc.lk.by.shotgun')} />}
          </div>
          <DaysChart series={d.series} />
          {best && (
            <div style={{ display: 'flex', alignItems: 'center', gap: 12, padding: '14px 16px', borderRadius: 16, background: 'var(--red-50)' }}>
              <span style={{ flex: 'none', width: 8, height: 8, borderRadius: 99, background: 'var(--red-500)' }} />
              <span style={{ fontSize: 14.5, lineHeight: 1.45, fontWeight: 500 }}>
                {t('yc.lk.best', { label: best.label, tickets: n(best.tickets), visitors: n(best.visitors), pct: pct((linkConversion(best) ?? 0) * 100, 1) })}
              </span>
            </div>
          )}
          {!d.confirmed && d.totals.clicks > 0 && (
            <div style={{ display: 'flex', gap: 12, padding: '14px 16px', borderRadius: 16, background: 'var(--amber-50)', color: 'var(--amber-700)', fontSize: 13.5, lineHeight: 1.5 }}>
              <Icon name="clock" size={16} stroke={2.2} style={{ flex: 'none', marginTop: 2 }} />
              <span>{t('yc.lk.waitingNote')}</span>
            </div>
          )}
        </section>
      )}

      {/* ── Les liens ──────────────────────────────────────────────────── */}
      <section style={card(220)}>
        <div style={{ display: 'flex', flexWrap: 'wrap', alignItems: 'flex-end', justifyContent: 'space-between', gap: '10px 16px' }}>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
            <h3 style={h3}>{tp('yc.lk.list.t', active.length, { n: n(active.length) })}</h3>
            <span style={sub}>{t('yc.lk.list.s')}</span>
          </div>
          {active.length > 1 && (
            <Segmented<'recent' | 'best'> size="sm" value={sort} onChange={setSort} ariaLabel={t('yc.lk.sort')} options={[{ value: 'recent', label: t('yc.lk.sort.recent') }, { value: 'best', label: t('yc.lk.sort.best') }]} />
          )}
        </div>
        {d.links.length === 0 ? (
          <EmptyLinks />
        ) : (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
            {list.map((l, i) => (
              <LinkRow
                key={l.id}
                l={l}
                i={i}
                confirmed={d.confirmed}
                money={d.sees_money}
                canWrite={d.can_write}
                fresh={fresh === l.id}
                copied={copied === l.id}
                onCopy={() => void copyLink(l)}
                onQr={() => setQr(l)}
                onSave={(patch) => void save(l, patch)}
              />
            ))}
          </div>
        )}
        {archived.length > 0 && (
          <button type="button" onClick={() => setShowArchived((v) => !v)} style={{ alignSelf: 'flex-start', border: 0, background: 'none', padding: 0, fontSize: 13.5, fontWeight: 600, color: 'var(--sand-600)', cursor: 'pointer' }}>
            {showArchived ? t('yc.lk.hideArchived') : tp('yc.lk.showArchived', archived.length, { n: n(archived.length) })}
          </button>
        )}
      </section>

      {/* ── Toutes les sources de la soirée (Shotgun) ─────────────────── */}
      {totalSold > 0 && (
        <section style={card(280)}>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
            <h3 style={h3}>{t('yc.lk.src.t')}</h3>
            <span style={sub}>{tp('yc.lk.src.s', totalSold, { n: n(totalSold) })}</span>
          </div>
          <div style={{ display: 'flex', height: 14, gap: 3, borderRadius: 99, overflow: 'hidden' }}>
            {groups.map((g) => (
              <div key={g.kind} title={`${t(`yc.lk.src.${g.kind}`)} : ${n(g.tickets)}`} style={{ flex: `${g.tickets} 1 0`, minWidth: 4, background: SOURCE_COLOR[g.kind], transformOrigin: 'left', animation: `yc-grow-x 900ms ${EASE} 300ms both` }} />
            ))}
          </div>
          <div style={{ display: 'flex', flexDirection: 'column' }}>
            {groups.map((g) => (
              <div key={g.kind} style={{ display: 'grid', gridTemplateColumns: '12px minmax(0,1fr) auto auto', gap: 12, alignItems: 'center', padding: '10px 0', borderTop: '1px solid var(--sand-100)' }}>
                <i style={{ width: 10, height: 10, borderRadius: 99, background: SOURCE_COLOR[g.kind], boxShadow: g.kind === 'offline' ? 'inset 0 0 0 1px var(--sand-300)' : undefined }} />
                <span style={{ minWidth: 0, display: 'flex', flexDirection: 'column' }}>
                  <b style={{ fontSize: 14.5, fontWeight: 600 }}>{t(`yc.lk.src.${g.kind}`)}</b>
                  <span style={{ fontSize: 12.5, color: 'var(--sand-500)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                    {g.kinds.length
                      ? g.kinds.slice(0, 4).map((x) => `${t(`yc.lk.kind.${x.key}`)} ${n(x.tickets)}`).join(' · ')
                      : g.names.length ? g.names.slice(0, 4).join(', ') : t(`yc.lk.src.${g.kind}.d`)}
                  </span>
                </span>
                <span style={{ fontSize: 14, fontWeight: 600, fontVariantNumeric: 'tabular-nums' }}>{n(g.tickets)}</span>
                <span style={{ fontSize: 13, color: 'var(--sand-500)', fontVariantNumeric: 'tabular-nums', minWidth: 44, textAlign: 'right' }}>{pct((g.tickets / totalSold) * 100)}</span>
              </div>
            ))}
          </div>
          <span style={{ fontSize: 12.5, lineHeight: 1.45, color: 'var(--sand-500)' }}>{t('yc.lk.src.foot')}</span>
        </section>
      )}

      {/* ── Bientôt, avec l'intégration partenaire Shotgun ─────────────── */}
      <ShotgunSoonCard items={['visits', 'curious', 'carts']} delay={340} />

      <NewLinkModal
        kind={naming}
        kindLabel={naming ? kindLabel(naming) : ''}
        defaultName={naming ? defaultName(naming) : ''}
        onClose={() => setNaming(null)}
        onCreate={async (name, imageUrl) => { if (naming && !(await create(naming, { name, imageUrl }))) throw new Error('create'); }}
      />
      {qr && <QrModal open={!!qr} onClose={() => setQr(null)} url={goUrl(PUBLIC_BASE_URL, qr.code)} display={goDisplay(PUBLIC_BASE_URL, qr.code)} label={qr.label} />}
    </div>
  );
}

function QuickChip({ k, label, onClick, busy, disabled, more, block }: { k?: LinkKind; label: string; onClick: () => void; busy?: boolean; disabled?: boolean; more?: boolean; block?: boolean }) {
  const { t } = useCrmT();
  return (
    <Hv
      as="button"
      type="button"
      onClick={onClick}
      disabled={disabled}
      style={{
        height: block ? 46 : 52, padding: k ? '0 16px 0 7px' : '0 18px', borderRadius: 99, border: 0, boxSizing: 'border-box',
        background: 'rgba(255,255,255,.1)', color: '#fff', fontSize: 14, fontWeight: 600, display: 'inline-flex', alignItems: 'center', gap: 10,
        cursor: disabled ? 'default' : 'pointer', whiteSpace: 'nowrap', boxShadow: 'inset 0 0 0 1px rgba(255,255,255,.14)', transition: `background 160ms, transform 220ms ${SPRING}`,
        opacity: disabled && !busy ? 0.55 : 1,
      }}
      hover={{ background: 'rgba(255,255,255,.18)', transform: 'translateY(-1px)' }}
      active={{ transform: 'scale(.97)' }}
    >
      {k ? <PlatformBadge platform={k.platform} size={block ? 32 : 38} /> : <Icon name={more ? 'more' : 'plus'} size={16} stroke={2.4} />}
      {busy ? t('yc.lk.creating') : label}
    </Hv>
  );
}

function Kpi({ label, value, sub, who, accent }: { label: string; value: string; sub: string; who: string; accent?: boolean }) {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 4, padding: '14px 16px', borderRadius: 18, background: accent ? 'var(--red-50)' : 'var(--sand-50)' }}>
      <span style={{ fontSize: 13, color: 'var(--sand-600)', fontWeight: 500 }}>{label}</span>
      <b style={{ fontFamily: 'var(--font-display)', fontWeight: 600, fontSize: 30, lineHeight: 1, letterSpacing: '-.04em', fontVariantNumeric: 'tabular-nums', color: accent ? 'var(--red-700)' : 'var(--ink)' }}>{value}</b>
      <span style={{ fontSize: 12.5, color: 'var(--sand-500)', minHeight: 17 }}>{sub}</span>
      <span style={{ fontFamily: 'var(--font-mono)', fontSize: 10.5, letterSpacing: '.06em', textTransform: 'uppercase', color: 'var(--sand-400)' }}>{who}</span>
    </div>
  );
}

/** 14 jours : clics (barres) et billets rapportés par Shotgun (pastilles). */
function DaysChart({ series }: { series: NightLinksData['series'] }) {
  const { t, n, locale } = useCrmT();
  const max = Math.max(1, ...series.map((s) => s.clicks));
  if (!series.some((s) => s.clicks > 0 || s.tickets > 0)) return null;
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
      <div style={{ display: 'grid', gridTemplateColumns: `repeat(${series.length},1fr)`, gap: 4, alignItems: 'end', height: 92 }}>
        {series.map((s, i) => (
          <div key={s.d} title={`${new Date(s.d + 'T12:00:00Z').toLocaleDateString(locale, { day: 'numeric', month: 'short', timeZone: 'UTC' })} · ${t('yc.lk.chart.tip', { c: n(s.clicks), t: n(s.tickets) })}`} style={{ position: 'relative', height: '100%', display: 'flex', alignItems: 'flex-end' }}>
            <div style={{ width: '100%', height: `${Math.max(s.clicks ? 6 : 2, (s.clicks / max) * 76)}px`, borderRadius: 6, background: s.clicks ? 'var(--sand-300)' : 'var(--sand-100)', transformOrigin: 'bottom', animation: `yc-grow-y 700ms ${EASE} ${200 + i * 30}ms both` }} />
            {s.tickets > 0 && (
              <span style={{ position: 'absolute', left: '50%', bottom: `${Math.max(s.clicks ? 6 : 2, (s.clicks / max) * 76) + 4}px`, transform: 'translateX(-50%)', minWidth: 18, height: 18, padding: '0 5px', boxSizing: 'border-box', borderRadius: 99, background: 'var(--red-500)', color: '#fff', fontSize: 10.5, fontWeight: 700, display: 'grid', placeItems: 'center' }}>{s.tickets}</span>
            )}
          </div>
        ))}
      </div>
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: '4px 16px', fontSize: 12.5, color: 'var(--sand-500)' }}>
        <span style={{ display: 'flex', alignItems: 'center', gap: 6 }}><i style={{ width: 10, height: 10, borderRadius: 3, background: 'var(--sand-300)' }} />{t('yc.lk.chart.clicks')}</span>
        <span style={{ display: 'flex', alignItems: 'center', gap: 6 }}><i style={{ width: 10, height: 10, borderRadius: 99, background: 'var(--red-500)' }} />{t('yc.lk.chart.tickets')}</span>
      </div>
    </div>
  );
}

function EmptyLinks() {
  const { t } = useCrmT();
  return (
    <div style={{ display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: 20, padding: '8px 0' }}>
      {/* Une story, son sticker « Lien » : ce que le pro va faire. */}
      <div aria-hidden style={{ flex: 'none', width: 132, height: 232, borderRadius: 26, padding: 6, background: '#141012', boxShadow: '0 20px 40px -24px rgba(40,20,20,.6)', animation: 'yc-float 5s ease-in-out infinite' }}>
        <div style={{ position: 'relative', width: '100%', height: '100%', borderRadius: 20, overflow: 'hidden', background: 'linear-gradient(160deg,#4F5BD5 0%,#962FBF 35%,#D62976 65%,#FA7E1E 100%)' }}>
          <div style={{ position: 'absolute', top: 8, left: 8, right: 8, height: 3, borderRadius: 99, background: 'rgba(255,255,255,.5)' }} />
          <div style={{ position: 'absolute', left: '50%', top: '58%', transform: 'translate(-50%,-50%) rotate(-4deg)', padding: '6px 10px', borderRadius: 10, background: '#fff', color: '#2563eb', fontSize: 9.5, fontWeight: 700, display: 'flex', alignItems: 'center', gap: 4, whiteSpace: 'nowrap', boxShadow: '0 6px 16px -6px rgba(0,0,0,.4)' }}>
            <Icon name="link" size={10} stroke={2.6} />YUNOAPP.EU/GO/…
          </div>
        </div>
      </div>
      <div style={{ flex: '1 1 220px', display: 'flex', flexDirection: 'column', gap: 8 }}>
        <b style={{ fontSize: 16, fontWeight: 600 }}>{t('yc.lk.empty.t')}</b>
        <span style={{ fontSize: 14, lineHeight: 1.5, color: 'var(--sand-600)', textWrap: 'pretty' }}>{t('yc.lk.empty.s')}</span>
      </div>
    </div>
  );
}

function LinkRow({ l, i, confirmed, money, canWrite, fresh, copied, onCopy, onQr, onSave }: {
  l: NightLink; i: number; confirmed: boolean; money: boolean; canWrite: boolean; fresh: boolean; copied: boolean;
  onCopy: () => void; onQr: () => void; onSave: (p: { label?: string; archived?: boolean }) => void;
}) {
  const T = useCrmT();
  const { t, tp, n, eur, pct, dShort, time } = T;
  const [open, setOpen] = useState(false);
  const [edit, setEdit] = useState(false);
  const [name, setName] = useState(l.label);
  const [menu, setMenu] = useState(false);
  const narrow = useNarrow(600);
  const rowRef = useRef<HTMLDivElement>(null);
  useEffect(() => { if (fresh) rowRef.current?.scrollIntoView({ behavior: 'smooth', block: 'nearest' }); }, [fresh]);
  useEffect(() => { setName(l.label); }, [l.label]);
  const st = linkState(l, confirmed);
  const conv = linkConversion(l);
  const url = goUrl(PUBLIC_BASE_URL, l.code);
  const commit = () => {
    setEdit(false);
    const v = name.trim();
    if (v && v !== l.label) onSave({ label: v });
    else setName(l.label);
  };
  const stateLine = st === 'selling'
    ? [tp('yc.lk.row.tickets', l.tickets, { n: n(l.tickets) }), money && l.revenue !== null ? eur(l.revenue) : null, l.new_buyers ? tp('yc.lk.row.newBuyers', l.new_buyers, { n: n(l.new_buyers) }) : null].filter(Boolean).join(' · ')
    : t(`yc.lk.state.${st}`);
  const iconBtn = (label: string, icon: Parameters<typeof Icon>[0]['name'], onClick: () => void, on?: boolean) => (
    <Hv
      as="button"
      type="button"
      aria-label={label}
      title={label}
      onClick={(e: React.MouseEvent) => { e.stopPropagation(); onClick(); }}
      style={{ width: narrow ? 34 : 38, height: narrow ? 34 : 38, borderRadius: 99, border: 0, background: on ? 'var(--green-50)' : 'var(--sand-100)', color: on ? 'var(--green-700)' : 'var(--ink)', display: 'grid', placeItems: 'center', cursor: 'pointer', flex: 'none', transition: `background 160ms, transform 220ms ${SPRING}` }}
      hover={{ background: on ? 'var(--green-50)' : 'var(--sand-200)' }}
      active={{ transform: 'scale(.92)' }}
    >
      <Icon name={on ? 'check' : icon} size={16} stroke={2.4} />
    </Hv>
  );

  return (
    <div
      ref={rowRef}
      style={{
        borderRadius: 18, background: fresh ? 'var(--red-50)' : l.archived ? 'var(--sand-50)' : '#fff',
        boxShadow: fresh ? '0 0 0 2px var(--red-300)' : 'inset 0 0 0 1px var(--sand-200)', opacity: l.archived ? 0.7 : 1,
        animation: `yc-row 520ms ${EASE} ${Math.min(i, 8) * 50}ms both${fresh ? ', yc-glow-red 1.4s 2' : ''}`, transition: 'background 300ms, box-shadow 300ms',
      }}
    >
      <div
        role="button"
        tabIndex={0}
        aria-expanded={open}
        onClick={() => setOpen((v) => !v)}
        onKeyDown={(e) => { if ((e.key === 'Enter' || e.key === ' ') && e.target === e.currentTarget) { e.preventDefault(); setOpen((v) => !v); } }}
        className="yc-focus-ring"
        style={{ display: 'flex', alignItems: 'center', gap: 14, padding: '12px 12px 12px 14px', cursor: 'pointer', outline: 'none', flexWrap: 'wrap' }}
      >
        {l.image_url ? (
          <span style={{ position: 'relative', flex: 'none' }}>
            <img src={l.image_url} alt={l.label} loading="lazy" style={{ width: 42, height: 56, objectFit: 'cover', borderRadius: 10, display: 'block', boxShadow: 'inset 0 0 0 1px var(--sand-200)' }} />
            <span style={{ position: 'absolute', right: -6, bottom: -6 }}><PlatformBadge platform={l.platform} size={20} /></span>
          </span>
        ) : (
          <PlatformBadge platform={l.platform} placement={l.placement} size={42} />
        )}
        <span style={{ flex: narrow ? '1 1 0' : '1 1 180px', minWidth: 0, display: 'flex', flexDirection: 'column', gap: 2 }}>
          {edit ? (
            <input
              autoFocus
              value={name}
              maxLength={60}
              onClick={(e) => e.stopPropagation()}
              onChange={(e) => setName(e.target.value)}
              onBlur={commit}
              onKeyDown={(e) => { e.stopPropagation(); if (e.key === 'Enter') commit(); if (e.key === 'Escape') { setName(l.label); setEdit(false); } }}
              aria-label={t('yc.lk.rename')}
              style={{ height: 30, padding: '0 10px', borderRadius: 10, border: '1px solid var(--sand-300)', fontSize: 15, fontWeight: 600, font: 'inherit', outline: 'none' }}
            />
          ) : (
            <b style={{ fontSize: 15, fontWeight: 600, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{l.label}</b>
          )}
          <span style={{ fontFamily: 'var(--font-mono)', fontSize: 12, color: 'var(--sand-500)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{goDisplay(PUBLIC_BASE_URL, l.code)}</span>
        </span>
        {/* Téléphone : chiffres sur leur propre ligne, sous le nom ; actions à droite du nom. */}
        <span style={narrow
          ? { order: 3, flex: '1 1 100%', display: 'flex', alignItems: 'center', gap: 16, paddingLeft: 56, marginTop: -4 }
          : { flex: 'none', display: 'flex', alignItems: 'center', gap: 12 }}>
          <Spark values={l.spark} width={72} height={26} />
          <span style={{ display: 'flex', flexDirection: 'column', alignItems: 'flex-end', minWidth: 64 }}>
            <b style={{ fontSize: 15, fontWeight: 600, fontVariantNumeric: 'tabular-nums' }}>{n(l.visitors)}</b>
            <span style={{ fontSize: 12, color: 'var(--sand-500)' }}>{tp('yc.lk.row.visitors', l.visitors)}</span>
          </span>
          <span style={{ display: 'flex', flexDirection: 'column', alignItems: 'flex-end', minWidth: 56 }}>
            <b style={{ fontSize: 15, fontWeight: 600, fontVariantNumeric: 'tabular-nums', color: st === 'selling' ? 'var(--red-600)' : st === 'waiting' ? 'var(--sand-400)' : 'var(--ink)' }}>{st === 'waiting' ? '—' : n(l.tickets)}</b>
            <span style={{ fontSize: 12, color: 'var(--sand-500)' }}>{tp('yc.lk.row.ticketsShort', l.tickets)}</span>
          </span>
        </span>
        <span style={{ flex: 'none', display: 'flex', gap: 6, order: narrow ? 2 : undefined }}>
          {iconBtn(copied ? t('yc.lk.copied') : t('yc.lk.copy'), 'copy', onCopy, copied)}
          {(!narrow || !canWrite) && iconBtn(t('yc.lk.qr'), 'qr', onQr)}
          {canWrite && (
            <span style={{ position: 'relative' }}>
              {iconBtn(t('yc.lk.menu'), 'more', () => setMenu((v) => !v))}
              {menu && (
                <>
                  <span onClick={(e) => { e.stopPropagation(); setMenu(false); }} style={{ position: 'fixed', inset: 0, zIndex: 5 }} />
                  <span onClick={(e) => e.stopPropagation()} style={{ position: 'absolute', right: 0, top: 44, zIndex: 6, minWidth: 190, padding: 6, borderRadius: 16, background: '#fff', boxShadow: 'var(--shadow-md),0 0 0 1px var(--sand-200)', display: 'flex', flexDirection: 'column', animation: `yc-pop 200ms ${EASE} both` }}>
                    {([
                      // Téléphone : le QR passe dans ce menu, pour laisser la place au nom.
                      ...(narrow ? [['qr', t('yc.lk.qr'), () => { setMenu(false); onQr(); }]] as const : []),
                      ['edit', t('yc.lk.rename'), () => { setMenu(false); setEdit(true); }],
                      ['eye', t('yc.lk.test'), () => { setMenu(false); window.open(`${url}?t=1`, '_blank', 'noopener'); }],
                      ['x', l.archived ? t('yc.lk.unarchive') : t('yc.lk.archive'), () => { setMenu(false); onSave({ archived: !l.archived }); }],
                    ] as const).map(([ic, lab, fn]) => (
                      <Hv key={lab} as="button" type="button" onClick={fn} style={{ height: 40, padding: '0 12px', borderRadius: 10, border: 0, background: 'none', display: 'flex', alignItems: 'center', gap: 10, fontSize: 14, fontWeight: 500, color: 'var(--ink)', cursor: 'pointer', textAlign: 'left' }} hover={{ background: 'var(--sand-50)' }}>
                        <Icon name={ic} size={15} stroke={2.2} />{lab}
                      </Hv>
                    ))}
                  </span>
                </>
              )}
            </span>
          )}
        </span>
      </div>
      <div style={{ padding: '0 14px 12px 70px', marginTop: -6, fontSize: 13, color: st === 'selling' ? 'var(--ink)' : 'var(--sand-500)', fontWeight: st === 'selling' ? 500 : 400 }}>
        {stateLine}
        {conv !== null && st === 'selling' && <span style={{ color: 'var(--sand-500)', fontWeight: 400 }}> · {t('yc.lk.row.conv', { pct: pct(conv * 100, 1) })}</span>}
      </div>
      {open && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 14, padding: '14px 16px 16px', borderTop: '1px solid var(--sand-100)', animation: `yc-row 360ms ${EASE} both` }}>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit,minmax(120px,1fr))', gap: 8 }}>
            {([
              [t('yc.lk.det.clicks'), n(l.clicks)],
              [t('yc.lk.det.today'), n(l.clicks_24h)],
              [t('yc.lk.det.mobile'), l.mobile_pct !== null ? pct(l.mobile_pct) : '—'],
              [t('yc.lk.det.lastClick'), l.last_click_at ? `${dShort(l.last_click_at)} · ${time(l.last_click_at)}` : '—'],
              [t('yc.lk.det.orders'), st === 'waiting' ? '—' : n(l.orders)],
              [t('yc.lk.det.created'), dShort(l.created_at)],
            ] as const).map(([k, v]) => (
              <div key={k} style={{ display: 'flex', flexDirection: 'column', gap: 2, padding: '10px 12px', borderRadius: 12, background: 'var(--sand-50)' }}>
                <span style={{ fontSize: 12, color: 'var(--sand-500)' }}>{k}</span>
                <b style={{ fontSize: 14.5, fontWeight: 600, fontVariantNumeric: 'tabular-nums' }}>{v}</b>
              </div>
            ))}
          </div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
            <b style={{ fontSize: 14, fontWeight: 600 }}>{t('yc.lk.people.t')}</b>
            {l.people.length === 0 ? (
              <span style={{ fontSize: 13.5, lineHeight: 1.45, color: 'var(--sand-600)' }}>{t(st === 'waiting' ? 'yc.lk.people.waiting' : 'yc.lk.people.none')}</span>
            ) : (
              <div style={{ display: 'flex', flexDirection: 'column' }}>
                {l.people.map((p) => (
                  <Hv key={p.email} as={Link} to={`${CRM_ROUTES.clients}?c=${encodeURIComponent(p.email)}`} style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '9px 8px', margin: '0 -8px', borderRadius: 12, textDecoration: 'none', color: 'inherit' }} hover={{ background: 'var(--sand-50)', textDecoration: 'none', color: 'inherit' }}>
                    <span style={{ flex: 'none', width: 30, height: 30, borderRadius: 99, background: p.is_new ? 'var(--red-50)' : 'var(--sand-100)', color: p.is_new ? 'var(--red-600)' : 'var(--sand-700)', display: 'grid', placeItems: 'center', fontSize: 12.5, fontWeight: 700 }}>
                      {(p.name || p.email).slice(0, 1).toUpperCase()}
                    </span>
                    <span style={{ flex: 1, minWidth: 0, display: 'flex', flexDirection: 'column' }}>
                      <b style={{ fontSize: 14, fontWeight: 600, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{p.name || p.email}</b>
                      <span style={{ fontSize: 12.5, color: 'var(--sand-500)' }}>{tp('yc.lk.people.line', p.tickets, { n: n(p.tickets), date: dShort(p.at) })}</span>
                    </span>
                    {p.is_new && <span style={{ flex: 'none', height: 22, padding: '0 9px', borderRadius: 99, background: 'var(--red-50)', color: 'var(--red-700)', fontSize: 11.5, fontWeight: 600, display: 'grid', placeItems: 'center' }}>{t('yc.lk.people.new')}</span>}
                    <Icon name="chevronRight" size={15} stroke={2.2} color="var(--sand-400)" />
                  </Hv>
                ))}
              </div>
            )}
            <span style={{ fontSize: 12.5, lineHeight: 1.45, color: 'var(--sand-500)' }}>{t('yc.lk.people.foot')}</span>
          </div>
        </div>
      )}
    </div>
  );
}
