// Ma base de contacts — la page complète (club, organisateur, Yuno).
//
// Une seule base : le fichier importé (mis à jour à chaque campagne) ∪ les
// personnes venues par Yuno (guest list, billets, tables), une ligne par
// email, l'identité Yuno en premier. Tout vient du serveur :
//   • `get_contact_intelligence_overview` : effectifs, engagement, origines,
//     segments avec leur effectif du moment, bilans des dernières campagnes ;
//   • `list_contact_base` : la liste paginée, filtrée, triée, cherchée ;
//   • `export_contact_base` : le tableur complet (engagement, segments, listes) ;
//   • `refresh_contact_engagement` : « Actualiser » (le cron le fait toutes les
//     10 minutes et la fin de chaque envoi aussi).
// Ici on affiche et on filtre ; aucun chiffre n'est recalculé côté front.

import { useCallback, useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  ArrowLeft, ChevronLeft, ChevronRight, Download, Loader2, Mail, MousePointerClick, RefreshCw, Search,
  Sparkles, Upload, UserCheck, Users, X,
} from 'lucide-react';
import { toast } from 'sonner';
import { supabase } from '@/integrations/supabase/client';
import { useLanguage } from '@/contexts/LanguageContext';
import { isPreviewActive } from '@/contexts/PreviewModeContext';
import type { StudioScope } from '@/components/email-studio/hooks';
import { studioScopeArgs, studioScopeId } from '@/components/email-studio/hooks';
import ContactImportDialog, { type ImportScope } from '@/components/contacts/ContactImportDialog';
import CampaignImpactCard, { StatusBar, StatusLegend } from '@/components/contacts/CampaignImpactCard';
import { exportContactBase } from '@/lib/contactBaseExport';
import type { ContactIntelligenceOverview } from '@/lib/contactSegments';
import {
  CONTACT_ORIGINS, ORIGIN_COLOR, STATUS_COLOR, displayName, fill, fmtDate, fmtDateTime, fmtEuro, fmtN, impactFromOverview, segmentDeltas,
  type CampaignImpact, type ContactOrigin, type ContactRow, type ContactSort, type EngagementStatus,
} from '@/lib/contactBase';

const RED = '#E8192C';
const T1 = 'rgba(255,255,255,0.96)';
const T2 = 'rgba(255,255,255,0.58)';
const T3 = 'rgba(255,255,255,0.36)';
const BORDER = 'rgba(255,255,255,0.085)';
const F_BORDER = 'rgba(255,255,255,0.055)';
const INNER_BG = 'rgba(255,255,255,0.032)';
const SUBTLE = 'rgba(255,255,255,0.025)';
const CARD_BG = 'linear-gradient(180deg,rgba(255,255,255,.045) 0%,rgba(255,255,255,.008) 100%),#0a0a0c';
const CARD_SHADOW = '0 1px 0 rgba(255,255,255,.05) inset,0 18px 40px -28px rgba(0,0,0,.9)';
const POS = '#34D399';
const PAGE = 50;

const SORTS: ContactSort[] = ['recent', 'engaged', 'spent', 'events', 'name'];

function toImportScope(scope: StudioScope): ImportScope {
  if (scope.kind === 'venue') return { kind: 'venue', venueId: scope.venueId };
  if (scope.kind === 'organizer') return { kind: 'organizer', organizerId: scope.organizerId };
  return { kind: 'platform' };
}

export default function ContactBasePanel({ scope, basePath }: {
  scope: StudioScope;
  /** Racine des campagnes de la portée (« /owner/campaigns »). */
  basePath: string;
}) {
  const { t, language } = useLanguage();
  const navigate = useNavigate();
  // Les pages passent un objet `scope` neuf à chaque rendu : on ne dépend
  // que de son identité (kind + id), sinon la liste se recharge en boucle.
  const scopeId = studioScopeId(scope);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  const scopeArgs = useMemo(() => studioScopeArgs(scope), [scope.kind, scopeId]);

  const [overview, setOverview] = useState<ContactIntelligenceOverview | null>(null);
  const [loadingOverview, setLoadingOverview] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [exporting, setExporting] = useState(false);
  const [seq, setSeq] = useState(0);
  const [importOpen, setImportOpen] = useState(false);
  const [segmentsOpen, setSegmentsOpen] = useState(false);

  // Filtres de la liste.
  const [search, setSearch] = useState('');
  const [debounced, setDebounced] = useState('');
  const [status, setStatus] = useState<EngagementStatus | null>(null);
  const [origin, setOrigin] = useState<ContactOrigin | null>(null);
  const [segmentId, setSegmentId] = useState<string | null>(null);
  const [listId, setListId] = useState<string | null>(null);
  const [sort, setSort] = useState<ContactSort>('recent');
  const [page, setPage] = useState(0);
  const [rows, setRows] = useState<ContactRow[]>([]);
  const [total, setTotal] = useState(0);
  const [loadingRows, setLoadingRows] = useState(true);

  useEffect(() => {
    const h = setTimeout(() => setDebounced(search.trim()), 300);
    return () => clearTimeout(h);
  }, [search]);
  useEffect(() => { setPage(0); }, [debounced, status, origin, segmentId, listId, sort]);

  // Vue d'ensemble.
  useEffect(() => {
    let cancelled = false;
    setLoadingOverview(true);
    supabase.rpc('get_contact_intelligence_overview' as never, scopeArgs as never).then(({ data, error }) => {
      if (cancelled) return;
      if (error) toast.error(error.message);
      setOverview((data as unknown as ContactIntelligenceOverview) || null);
      setLoadingOverview(false);
    });
    return () => { cancelled = true; };
  }, [scopeArgs, seq]);

  // Liste.
  useEffect(() => {
    let cancelled = false;
    setLoadingRows(true);
    supabase.rpc('list_contact_base' as never, {
      ...scopeArgs,
      p_search: debounced || null,
      p_segment_id: segmentId,
      p_status: status,
      p_origin: origin,
      p_list_import_id: listId,
      p_sort: sort,
      p_limit: PAGE,
      p_offset: page * PAGE,
    } as never).then(({ data, error }) => {
      if (cancelled) return;
      if (error) toast.error(error.message);
      const d = (data as unknown as { total: number; rows: ContactRow[] } | null) || { total: 0, rows: [] };
      setRows(Array.isArray(d.rows) ? d.rows : []);
      setTotal(Number(d.total || 0));
      setLoadingRows(false);
    });
    return () => { cancelled = true; };
  }, [scopeArgs, debounced, segmentId, status, origin, listId, sort, page, seq]);

  const refresh = useCallback(async () => {
    if (refreshing) return;
    setRefreshing(true);
    try {
      const { error } = await supabase.rpc('refresh_contact_engagement' as never, scopeArgs as never);
      if (error) throw error;
      // Les bilans de campagne suivent l'engagement.
      await supabase.rpc('refresh_campaign_list_impacts' as never, scopeArgs as never);
      setSeq((n) => n + 1);
      toast.success(t('cbase.refreshed'));
    } catch (e) {
      toast.error(e instanceof Error ? e.message : String(e));
    } finally {
      setRefreshing(false);
    }
  }, [refreshing, scopeArgs, t]);

  // Export complet : le fichier importé mis à jour + les clients Yuno +
  // l'engagement + les segments. Même fabrique que la page Clients.
  const exportAll = useCallback(async () => {
    if (exporting) return;
    if (isPreviewActive()) { toast.error(t('smsc.previewReadOnly')); return; }
    setExporting(true);
    try {
      const res = await exportContactBase({ scopeArgs, scopeName: scope.name, t, language });
      if (res.outcome === 'downloaded' || res.outcome === 'shared') {
        toast.success(fill(t('cbase.exportDone'), { n: fmtN(res.rows, language) }));
      } else if (res.outcome === 'empty') {
        toast.error(t('cbase.exportEmpty'));
      } else if (res.outcome === 'failed') {
        toast.error(res.error || t('cbase.exportError'));
      }
    } finally {
      setExporting(false);
    }
  }, [exporting, scopeArgs, scope.name, t, language]);

  const impacts: CampaignImpact[] = useMemo(
    () => ((overview as unknown as { impacts?: Parameters<typeof impactFromOverview>[0][] } | null)?.impacts || []).map(impactFromOverview),
    [overview],
  );
  const latestBaseline = useMemo(() => impacts.find((i) => i.baseline?.segments && i.baseline.segments.length > 0) || null, [impacts]);
  const segDeltas = useMemo(() => {
    if (!latestBaseline || !overview) return new Map<string, number>();
    const current = { contacts: overview.contacts, segments: overview.segments.map((s) => ({ id: s.id, name: s.name, contacts: s.counts.contacts, emails: s.counts.emails, phones: s.counts.phones })) };
    return new Map(segmentDeltas(latestBaseline.baseline, current).map((d) => [d.id, d.delta]));
  }, [latestBaseline, overview]);

  const ov = overview as (ContactIntelligenceOverview & {
    engagement?: Record<EngagementStatus, number> & { sent_any?: number };
    origin?: Record<ContactOrigin, number> & { with_account?: number };
    reachable_emails?: number; reachable_phones?: number; refreshed_at?: string | null;
  }) | null;
  const yunoCustomers = (ov?.origin?.yuno || 0) + (ov?.origin?.both || 0);
  const pages = Math.max(1, Math.ceil(total / PAGE));
  const hasFilter = !!(status || origin || segmentId || listId || debounced);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  const importScope = useMemo(() => toImportScope(scope), [scope.kind, scopeId]);

  const btn: React.CSSProperties = {
    display: 'inline-flex', alignItems: 'center', gap: 7, padding: '8px 14px', borderRadius: 10,
    border: `1px solid ${BORDER}`, background: SUBTLE, color: T2, fontSize: 12.5, fontWeight: 500,
  };

  return (
    <div className="min-h-screen pb-24" style={{ background: '#000', position: 'relative' }}>
      <div style={{ position: 'absolute', inset: 0, pointerEvents: 'none', background: 'radial-gradient(120% 60% at 50% -10%,rgba(255,255,255,.025),transparent 55%)' }} />
      <div className="max-w-[1340px] mx-auto px-4 sm:px-6 py-8" style={{ position: 'relative', display: 'flex', flexDirection: 'column', gap: 18 }}>

        {/* ── En-tête ── */}
        <div className="flex flex-wrap items-end gap-3">
          <button onClick={() => navigate(basePath)} aria-label={t('studio.top.back')} className="cursor-pointer"
            style={{ width: 34, height: 34, borderRadius: 11, display: 'flex', alignItems: 'center', justifyContent: 'center', background: INNER_BG, border: `1px solid ${BORDER}`, flex: 'none', marginBottom: 2 }}>
            <ArrowLeft className="w-4 h-4" style={{ color: T2 }} />
          </button>
          <div style={{ flex: '1 1 260px', minWidth: 0 }}>
            <div style={{ color: T3, fontSize: 11, fontWeight: 600, letterSpacing: '0.08em', textTransform: 'uppercase' }}>{scope.name}</div>
            <h1 style={{ margin: '6px 0 0', color: T1, fontSize: 26, fontWeight: 640, letterSpacing: '-0.025em' }}>{t('cbase.title')}</h1>
            <p style={{ margin: '4px 0 0', color: T3, fontSize: 12 }}>
              {ov?.refreshed_at
                ? fill(t('cbase.refreshedAt'), { d: fmtDateTime(ov.refreshed_at, language) })
                : t('cbase.neverRefreshed')}
            </p>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <button onClick={() => void refresh()} className="cursor-pointer" style={btn} disabled={refreshing}>
              {refreshing ? <Loader2 className="w-4 h-4 animate-spin" /> : <RefreshCw className="w-4 h-4" />} {t('cbase.refresh')}
            </button>
            <button onClick={() => setImportOpen(true)} className="cursor-pointer" style={btn}>
              <Upload className="w-4 h-4" /> {t('em.import.button')}
            </button>
            <button onClick={() => setSegmentsOpen(true)} className="cursor-pointer" style={btn}>
              <Sparkles className="w-4 h-4" /> {t('cseg.button')}
            </button>
            <button onClick={() => void exportAll()} className="cursor-pointer" disabled={exporting}
              style={{ ...btn, background: RED, color: '#fff', border: 'none', fontWeight: 600, boxShadow: '0 0 18px -6px #E8192C' }}>
              {exporting ? <Loader2 className="w-4 h-4 animate-spin" /> : <Download className="w-4 h-4" />} {t('cbase.export')}
            </button>
          </div>
        </div>

        {/* ── Effectifs ── */}
        <div className="grid grid-cols-2 lg:grid-cols-4" style={{ gap: 12 }}>
          <Kpi icon={Users} label={t('cbase.kpi.contacts')} value={loadingOverview ? '…' : fmtN(ov?.contacts, language)}
            sub={fill(t('cbase.kpi.lists'), { n: String(ov?.lists?.length || 0) })} />
          <Kpi icon={Mail} label={t('cbase.kpi.reachableEmail')} value={loadingOverview ? '…' : fmtN(ov?.reachable_emails, language)}
            sub={fill(t('cbase.kpi.reachableSms'), { n: fmtN(ov?.reachable_phones, language) })} />
          <Kpi icon={UserCheck} red label={t('cbase.kpi.yuno')} value={loadingOverview ? '…' : fmtN(yunoCustomers, language)}
            sub={fill(t('cbase.kpi.yunoSub'), { both: fmtN(ov?.origin?.both, language), acc: fmtN(ov?.origin?.with_account, language) })} />
          <Kpi icon={MousePointerClick} label={t('cbase.kpi.active')} value={loadingOverview ? '…' : fmtN(ov?.engagement?.active, language)}
            sub={fill(t('cbase.kpi.activeSub'), { n: fmtN(ov?.engagement?.sent_any, language) })} />
        </div>

        {/* ── Engagement ── */}
        <div style={{ background: CARD_BG, border: `1px solid ${BORDER}`, borderRadius: 18, boxShadow: CARD_SHADOW, padding: 20 }}>
          <div className="flex flex-wrap items-baseline justify-between gap-2" style={{ marginBottom: 10 }}>
            <h3 style={{ margin: 0, color: T1, fontSize: 15.5, fontWeight: 600 }}>{t('cbase.engagement.title')}</h3>
            <span style={{ color: T3, fontSize: 11.5 }}>{t('cbase.engagement.hint')}</span>
          </div>
          <StatusBar counts={ov?.engagement} height={10} onPick={(s) => setStatus((cur) => (cur === s ? null : s))} active={status} />
          <div className="mt-3"><StatusLegend counts={ov?.engagement} onPick={setStatus} active={status} /></div>
          <div className="mt-3 flex flex-wrap items-center" style={{ gap: 8 }}>
            <span style={{ color: T3, fontSize: 11.5 }}>{t('cbase.origin.title')}</span>
            {CONTACT_ORIGINS.map((o) => {
              const n = Number(ov?.origin?.[o] || 0);
              const on = origin === o;
              return (
                <button key={o} type="button" onClick={() => setOrigin(on ? null : o)} className="inline-flex items-center gap-1.5 cursor-pointer"
                  style={{ padding: '4px 9px', borderRadius: 999, fontSize: 11.5, background: on ? 'rgba(255,255,255,0.08)' : INNER_BG, border: `1px solid ${on ? 'rgba(255,255,255,0.22)' : BORDER}`, color: on ? T1 : T2 }}>
                  <span style={{ width: 8, height: 8, borderRadius: 999, background: ORIGIN_COLOR[o] }} />
                  <span style={{ fontWeight: 600, color: T1, fontVariantNumeric: 'tabular-nums' }}>{fmtN(n, language)}</span>
                  {t(`cbase.origin.${o}`)}
                </button>
              );
            })}
          </div>
        </div>

        {/* ── Depuis vos dernières campagnes ── */}
        {impacts.length > 0 && (
          <div>
            <div className="flex items-baseline justify-between" style={{ marginBottom: 10 }}>
              <h3 style={{ margin: 0, color: T1, fontSize: 15.5, fontWeight: 600 }}>{t('cbase.impacts.title')}</h3>
              <span style={{ color: T3, fontSize: 11.5 }}>{t('cbase.impacts.hint')}</span>
            </div>
            <div className="grid grid-cols-1 lg:grid-cols-2" style={{ gap: 12 }}>
              {impacts.slice(0, 4).map((i) => <CampaignImpactCard key={i.campaignId} impact={i} basePath={basePath} compact />)}
            </div>
          </div>
        )}

        {/* ── Segments ── */}
        <div style={{ background: CARD_BG, border: `1px solid ${BORDER}`, borderRadius: 18, boxShadow: CARD_SHADOW, padding: 20 }}>
          <div className="flex flex-wrap items-baseline justify-between gap-2" style={{ marginBottom: 10 }}>
            <h3 style={{ margin: 0, color: T1, fontSize: 15.5, fontWeight: 600 }}>
              {t('cbase.segments.title')} <span style={{ color: T3, fontWeight: 400 }}>· {ov?.segments?.length || 0}</span>
            </h3>
            <span style={{ color: T3, fontSize: 11.5 }}>
              {latestBaseline ? fill(t('cbase.segments.sinceHint'), { name: latestBaseline.name }) : t('cbase.segments.hint')}
            </span>
          </div>
          {(ov?.segments?.length || 0) === 0 ? (
            <div style={{ color: T3, fontSize: 12.5 }}>
              {t('cbase.segments.empty')}{' '}
              <button type="button" onClick={() => setSegmentsOpen(true)} className="cursor-pointer" style={{ background: 'none', border: 'none', padding: 0, color: RED, fontWeight: 600, fontSize: 12.5 }}>
                {t('cseg.button')}
              </button>
            </div>
          ) : (
            <div className="flex flex-wrap" style={{ gap: 8 }}>
              {ov!.segments.map((s) => {
                const on = segmentId === s.id;
                const delta = segDeltas.get(s.id);
                return (
                  <button key={s.id} type="button" onClick={() => setSegmentId(on ? null : s.id)} className="cursor-pointer text-left"
                    style={{ padding: '8px 12px', borderRadius: 12, background: on ? 'rgba(232,25,44,0.08)' : INNER_BG, border: `1px solid ${on ? 'rgba(232,25,44,0.35)' : BORDER}` }}>
                    <div style={{ color: T1, fontSize: 12.5, fontWeight: 600 }}>{s.name}</div>
                    <div style={{ color: T3, fontSize: 11, marginTop: 2, fontVariantNumeric: 'tabular-nums' }}>
                      {fmtN(s.counts.contacts, language)} · {fill(t('cbase.segments.reach'), { e: fmtN(s.counts.emails, language) })}
                      {typeof delta === 'number' && delta !== 0 && (
                        <span style={{ color: delta > 0 ? POS : '#FF5C63', fontWeight: 700, marginLeft: 6 }}>{delta > 0 ? '+' : '−'}{fmtN(Math.abs(delta), language)}</span>
                      )}
                    </div>
                  </button>
                );
              })}
            </div>
          )}
        </div>

        {/* ── La liste ── */}
        <div style={{ background: CARD_BG, border: `1px solid ${BORDER}`, borderRadius: 18, boxShadow: CARD_SHADOW, padding: 20, overflow: 'hidden' }}>
          <div className="flex flex-wrap items-center gap-2" style={{ marginBottom: 14 }}>
            <div className="relative" style={{ flex: '1 1 240px', maxWidth: 420 }}>
              <Search className="w-4 h-4 absolute" style={{ left: 11, top: 10, color: T3 }} />
              <input value={search} onChange={(e) => setSearch(e.target.value)} placeholder={t('cbase.search')}
                style={{ width: '100%', padding: '8px 12px 8px 34px', borderRadius: 10, background: INNER_BG, border: `1px solid ${BORDER}`, color: T1, fontSize: 13, outline: 'none' }} />
            </div>
            {(ov?.lists?.length || 0) > 1 && (
              <select value={listId || ''} onChange={(e) => setListId(e.target.value || null)}
                style={{ padding: '8px 10px', borderRadius: 10, background: INNER_BG, border: `1px solid ${BORDER}`, color: T2, fontSize: 12.5 }}>
                <option value="">{t('cbase.allLists')}</option>
                {ov!.lists.map((l) => <option key={l.id} value={l.id}>{l.list_name || (l.filename || '').replace(/\.[a-z0-9]+$/i, '')}</option>)}
              </select>
            )}
            <select value={sort} onChange={(e) => setSort(e.target.value as ContactSort)}
              style={{ padding: '8px 10px', borderRadius: 10, background: INNER_BG, border: `1px solid ${BORDER}`, color: T2, fontSize: 12.5 }}>
              {SORTS.map((s) => <option key={s} value={s}>{t(`cbase.sort.${s}`)}</option>)}
            </select>
            {hasFilter && (
              <button type="button" onClick={() => { setStatus(null); setOrigin(null); setSegmentId(null); setListId(null); setSearch(''); }}
                className="inline-flex items-center gap-1 cursor-pointer" style={{ background: 'none', border: 'none', color: T3, fontSize: 12 }}>
                <X className="w-3.5 h-3.5" /> {t('cbase.clearFilters')}
              </button>
            )}
            <span style={{ marginLeft: 'auto', color: T3, fontSize: 12, fontVariantNumeric: 'tabular-nums' }}>
              {loadingRows ? '…' : fill(t('cbase.count'), { n: fmtN(total, language) })}
            </span>
          </div>

          {/* Filtres actifs */}
          {(status || origin || segmentId) && (
            <div className="flex flex-wrap" style={{ gap: 6, marginBottom: 12 }}>
              {status && <FilterChip label={t(`cbase.status.${status}`)} color={STATUS_COLOR[status]} onClear={() => setStatus(null)} />}
              {origin && <FilterChip label={t(`cbase.origin.${origin}`)} color={ORIGIN_COLOR[origin]} onClear={() => setOrigin(null)} />}
              {segmentId && <FilterChip label={ov?.segments.find((s) => s.id === segmentId)?.name || ''} color={RED} onClear={() => setSegmentId(null)} />}
            </div>
          )}

          <div className="hidden md:grid" style={{ gridTemplateColumns: '2.4fr 0.9fr 1fr 1.1fr 1fr 0.9fr 0.8fr', gap: 12, padding: '0 10px 10px', borderBottom: `1px solid ${F_BORDER}` }}>
            {(['contact', 'origin', 'status', 'emails', 'lastSeen', 'spent', 'events'] as const).map((k) => (
              <span key={k} style={{ color: T3, fontSize: 10.5, fontWeight: 600, letterSpacing: '0.07em', textTransform: 'uppercase', textAlign: k === 'spent' || k === 'events' ? 'right' : 'left' }}>
                {t(`cbase.th.${k}`)}
              </span>
            ))}
          </div>

          {loadingRows ? (
            <div className="flex justify-center py-12"><Loader2 className="w-6 h-6 animate-spin" style={{ color: T3 }} /></div>
          ) : rows.length === 0 ? (
            <div className="text-center py-12" style={{ color: T3, fontSize: 13 }}>{t('cbase.empty')}</div>
          ) : rows.map((r) => (
            <div key={r.id} className="grid grid-cols-2 md:[grid-template-columns:2.4fr_0.9fr_1fr_1.1fr_1fr_0.9fr_0.8fr]"
              style={{ gap: 12, alignItems: 'center', padding: '11px 10px', borderBottom: `1px solid ${F_BORDER}` }}>
              <div className="min-w-0 col-span-2 md:col-span-1">
                <div className="truncate" style={{ color: T1, fontSize: 13, fontWeight: 560 }}>{displayName(r)}</div>
                <div className="truncate" style={{ color: T3, fontSize: 11, marginTop: 2 }}>
                  {r.email || r.phone_e164}{r.city ? ` · ${r.city}` : ''}{r.has_account ? ` · ${t('cbase.hasAccount')}` : ''}
                </div>
              </div>
              <div><OriginPill origin={r.origin} t={t} /></div>
              <div><StatusPill status={r.status} t={t} /></div>
              <div style={{ color: T2, fontSize: 12, fontVariantNumeric: 'tabular-nums' }}>
                {r.emails_sent > 0
                  ? fill(t('cbase.row.mail'), { s: fmtN(r.emails_sent, language), o: fmtN(r.opens, language), c: fmtN(r.clicks, language) })
                  : <span style={{ color: T3 }}>{t('cbase.row.neverSent')}</span>}
              </div>
              <div style={{ color: T2, fontSize: 12 }}>{fmtDate(r.last_seen_at, language)}</div>
              <div className="hidden md:block" style={{ color: r.total_spent ? T1 : T3, fontSize: 12.5, textAlign: 'right', fontVariantNumeric: 'tabular-nums' }}>
                {r.total_spent != null ? fmtEuro(r.total_spent, language) : '—'}
              </div>
              <div className="hidden md:block" style={{ color: T2, fontSize: 12.5, textAlign: 'right', fontVariantNumeric: 'tabular-nums' }}>
                {r.event_count != null ? fmtN(r.event_count, language) : '—'}
                {r.guest_list_count > 0 && <span style={{ color: T3, fontSize: 10.5 }}> · {fill(t('cbase.row.gl'), { n: String(r.guest_list_count) })}</span>}
              </div>
            </div>
          ))}

          {pages > 1 && (
            <div className="flex items-center justify-between" style={{ paddingTop: 12 }}>
              <button type="button" disabled={page === 0} onClick={() => setPage((p) => Math.max(0, p - 1))} className="inline-flex items-center gap-1 cursor-pointer" style={{ ...btn, opacity: page === 0 ? 0.4 : 1 }}>
                <ChevronLeft className="w-4 h-4" /> {t('cbase.prev')}
              </button>
              <span style={{ color: T3, fontSize: 12 }}>{page + 1} / {pages}</span>
              <button type="button" disabled={page + 1 >= pages} onClick={() => setPage((p) => p + 1)} className="inline-flex items-center gap-1 cursor-pointer" style={{ ...btn, opacity: page + 1 >= pages ? 0.4 : 1 }}>
                {t('cbase.next')} <ChevronRight className="w-4 h-4" />
              </button>
            </div>
          )}
        </div>
      </div>

      <ContactImportDialog open={importOpen} onClose={() => setImportOpen(false)} scope={importScope} onChanged={() => setSeq((n) => n + 1)} />
      <ContactImportDialog open={segmentsOpen} mode="analyze" onClose={() => setSegmentsOpen(false)} scope={importScope} onChanged={() => setSeq((n) => n + 1)} />
    </div>
  );
}

function Kpi({ icon: Icon, label, value, sub, red }: { icon: typeof Users; label: string; value: string; sub?: string; red?: boolean }) {
  return (
    <div style={{ background: CARD_BG, border: `1px solid ${red ? 'rgba(232,25,44,0.22)' : BORDER}`, borderRadius: 18, boxShadow: CARD_SHADOW, padding: 18 }}>
      <div className="flex items-center gap-2" style={{ color: T3, fontSize: 11, fontWeight: 600, letterSpacing: '0.06em', textTransform: 'uppercase' }}>
        <Icon className="w-3.5 h-3.5" style={{ color: red ? RED : T3 }} /> {label}
      </div>
      <div style={{ color: T1, fontSize: 26, fontWeight: 700, letterSpacing: '-0.02em', marginTop: 8, fontVariantNumeric: 'tabular-nums' }}>{value}</div>
      {sub && <div style={{ color: T3, fontSize: 11.5, marginTop: 2 }}>{sub}</div>}
    </div>
  );
}

function StatusPill({ status, t }: { status: EngagementStatus; t: (k: string) => string }) {
  return (
    <span className="inline-flex items-center gap-1.5" style={{ padding: '3px 8px', borderRadius: 999, fontSize: 11, fontWeight: 600, background: INNER_BG, border: `1px solid ${BORDER}`, color: T1 }}>
      <span style={{ width: 7, height: 7, borderRadius: 999, background: STATUS_COLOR[status] }} />{t(`cbase.status.${status}`)}
    </span>
  );
}

function OriginPill({ origin, t }: { origin: ContactOrigin; t: (k: string) => string }) {
  return (
    <span className="inline-flex items-center gap-1.5" style={{ padding: '3px 8px', borderRadius: 999, fontSize: 11, background: INNER_BG, border: `1px solid ${BORDER}`, color: T2 }}>
      <span style={{ width: 7, height: 7, borderRadius: 999, background: ORIGIN_COLOR[origin] }} />{t(`cbase.origin.${origin}`)}
    </span>
  );
}

function FilterChip({ label, color, onClear }: { label: string; color: string; onClear: () => void }) {
  return (
    <span className="inline-flex items-center gap-1.5" style={{ padding: '4px 9px', borderRadius: 999, fontSize: 11.5, background: 'rgba(255,255,255,0.06)', border: `1px solid rgba(255,255,255,0.18)`, color: T1 }}>
      <span style={{ width: 7, height: 7, borderRadius: 999, background: color }} />{label}
      <button type="button" onClick={onClear} aria-label="×" className="cursor-pointer" style={{ background: 'none', border: 'none', padding: 0, color: T3, display: 'inline-flex' }}><X className="w-3 h-3" /></button>
    </span>
  );
}
