/**
 * Yuno Tickets › Clients — la copie de l'écran Clients de Yuno CRM
 * (src/crm/pages/clients/ClientsPage.tsx), sur la base clients de Yuno Tickets
 * (ventes Yuno, contacts et fichiers de la Billetterie, migration 20261109400000).
 *
 *   Qui revient, qui s'éloigne ?          [Importer] [Écrire à…]
 *   Votre base de clients  ·  Joignables · Reviennent · Dépense moyenne
 *   Vos clients, un par un (recherche, segments, filtres, tri, sélection)
 *   Fiche client (volet), Écrire à… (fenêtre), barre de sélection
 *
 * Adresses : `?s=hab` ouvre un groupe, `?status=unreachable` les non
 * joignables, `?nb=1` les clients venus une fois, `?seg=<id>` un segment
 * enregistré, `?c=<email>` une fiche. Tout le calcul vit dans les RPC
 * tix_clients_* ; la page ne fait que mettre en forme.
 */
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { Hv } from '@/crm/ui/Hv';
import { Icon } from '@/crm/ui/Icon';
import { Skel } from '@/tickets/analytics/kit';
import { useTixToast } from '@/tickets/clients/toast';
import { EASE, SPRING, reveal, useIntro, useProgress } from '@/crm/ui/motion';
import { useTixT } from '@/tickets/analytics/i18n';
import { useTixScope, useTixCaps } from '@/tickets/clients/scope';
import { CrmRpcError, rpc } from '@/crm/lib/rpc';
import { downloadCsv } from '@/crm/lib/csv';
import { fullName } from '@/tickets/clients/lib/lifecycle';
import { useClientsList, useClientsOverview, useDeleteSegment, useEventsBrief, useSaveSegment, useSegmentsBrief, hasCriteria } from '@/tickets/clients/data/clients';
import type { ClientCard, ClientFilterDef, Lifecycle, SavedSegment } from '@/tickets/clients/data/clients';
import { useTixClientRoutes } from '@/tickets/clients/routes';
import { WriteModal } from '@/tickets/clients/WriteModal';
import { LoadError } from '@/tickets/analytics/LoadError';
import type { WriteScope } from '@/tickets/clients/WriteModal';
import { ClientsOverview } from './ClientsOverview';
import { ClientsTable } from './ClientsTable';
import { ClientDrawer } from './ClientDrawer';
import { isGlFilter } from '@/crm/lib/guestlist';

const PAGE = 12;
const LIFE: Lifecycle[] = ['hab', 'occ', 'nou', 'end', 'none'];

/** Filtre de départ lu dans l'adresse (liens de l'accueil, des segments, des notifications). */
function defFromParams(sp: URLSearchParams): ClientFilterDef {
  const s = sp.get('s');
  const f: NonNullable<ClientFilterDef['f']> = {};
  if (sp.get('status') === 'unreachable') f.rc = ['none'];
  const nb = sp.get('nb');
  if (nb && ['0', '1', '2', '3-5', '6+'].includes(nb)) f.nb = nb as NonNullable<ClientFilterDef['f']>['nb'];
  const ev = sp.get('ev');
  if (ev) f.ev = [ev];
  // Guest list : depuis une soirée (?glev=) ou depuis Analyses › Guest list (?gl=).
  const glev = sp.get('glev');
  if (glev) f.glev = [glev];
  const gl = sp.get('gl');
  if (isGlFilter(gl)) f.gl = gl;
  const src = sp.get('src');
  if (src && ['yuno', 'import', 'other'].includes(src)) f.src = [src as NonNullable<NonNullable<ClientFilterDef['f']>['src']>[number]];
  return { seg: s && (LIFE as string[]).includes(s) ? (s as Lifecycle) : 'all', f };
}


export default function ClientsPage() {
  const caps = useTixCaps();
  const TIX_ROUTES = useTixClientRoutes();
  const T = useTixT();
  const { t, tp, n } = T;
  const toast = useTixToast();
  const { rpc: args } = useTixScope();
  const [sp, setSp] = useSearchParams();

  const overview = useClientsOverview();
  const ov = overview.data;
  const intro = useIntro(!!ov);
  const cc = useProgress(1500, 450, ov ? 'ready' : 'wait', !!ov);

  const [def, setDefRaw] = useState<ClientFilterDef>(() => defFromParams(sp));
  const [activeSaved, setActiveSaved] = useState<string | null>(() => sp.get('seg'));
  const [q, setQ] = useState(() => sp.get('q') ?? '');
  const [dq, setDq] = useState(() => sp.get('q') ?? '');
  const [sort, setSort] = useState('last');
  const [dir, setDir] = useState(1);
  const [limit, setLimit] = useState(PAGE);
  const [sel, setSel] = useState<string[]>([]);
  const [selAll, setSelAll] = useState(false);
  const [saveSignal, setSaveSignal] = useState(0);
  const [write, setWrite] = useState<{ scope: WriteScope; who: string; def: ClientFilterDef | null; emails: string[] | null; segmentId: string | null } | null>(null);
  const [exporting, setExporting] = useState(false);
  const drawerEmail = sp.get('c');

  useEffect(() => { const h = setTimeout(() => setDq(q.trim()), 250); return () => clearTimeout(h); }, [q]);

  const fullDef = useMemo<ClientFilterDef>(() => ({ ...def, q: dq || undefined }), [def, dq]);
  const list = useClientsList(fullDef, sort, dir, limit);
  const saved = useSegmentsBrief();
  const events = useEventsBrief(12);
  const saveSeg = useSaveSegment();
  const delSeg = useDeleteSegment();

  // Un segment enregistré ouvert depuis l'adresse (?seg=) prend sa définition dès qu'elle arrive.
  const seededSaved = useRef(!sp.get('seg'));
  useEffect(() => {
    if (seededSaved.current || !activeSaved || !saved.data) return;
    seededSaved.current = true;
    const s = saved.data.find((x) => x.id === activeSaved);
    if (s) setDefRaw({ seg: s.definition.seg ?? 'all', f: { ...(s.definition.f ?? {}) } });
    else setActiveSaved(null);
  }, [activeSaved, saved.data]);

  const resetView = () => { setLimit(PAGE); setSel([]); setSelAll(false); };
  const setDef = (d: ClientFilterDef) => { setDefRaw(d); setActiveSaved(null); resetView(); };
  useEffect(() => { setLimit(PAGE); setSel([]); setSelAll(false); }, [dq, sort, dir]);

  const goList = () => setTimeout(() => document.getElementById('liste')?.scrollIntoView({ behavior: 'smooth', block: 'start' }), 60);
  const openSeg = (k: Lifecycle) => { setQ(''); setDef({ seg: k, f: {} }); goList(); };

  const total = list.data?.total ?? 0;
  const rows = useMemo(() => list.data?.rows ?? [], [list.data]);
  const hasFilt = hasCriteria(def) || !!dq;
  const selCount = selAll ? total : sel.length;

  const openDrawer = useCallback((email: string | null) => {
    setSp((prev) => {
      const p = new URLSearchParams(prev);
      if (email) p.set('c', email); else p.delete('c');
      return p;
    }, { replace: true });
  }, [setSp]);
  const posIdx = drawerEmail ? rows.findIndex((r) => r.email === drawerEmail) : -1;
  const step = useCallback((d: 1 | -1) => {
    if (posIdx < 0) return;
    const next = rows[posIdx + d];
    if (next) openDrawer(next.email);
    else if (d === 1 && rows.length < total) setLimit((l) => l + PAGE);
  }, [posIdx, rows, total, openDrawer]);

  const onSort = (k: string) => {
    if (sort === k) setDir(-dir);
    else { setSort(k); setDir(1); }
  };

  const pickSaved = (s: SavedSegment) => {
    setQ('');
    setDefRaw({ seg: s.definition.seg ?? 'all', f: { ...(s.definition.f ?? {}) } });
    setActiveSaved(s.id);
    resetView();
  };
  const deleteSaved = (s: SavedSegment) => {
    delSeg.mutate(s.id, {
      onSuccess: () => { if (activeSaved === s.id) { setActiveSaved(null); setDefRaw({ seg: 'all', f: {} }); } toast(t('ya.cli.list.segDeleted')); },
      onError: () => toast(t('ya.cli.list.segFailed')),
    });
  };
  const saveSegment = async (name: string): Promise<boolean> => {
    if (!name) { toast(t('ya.cli.list.segNameFirst')); return false; }
    const fixed = sel.length > 0 && !selAll;
    const definition: ClientFilterDef = fixed ? { seg: 'all', f: { emails: sel } } : { seg: def.seg, f: def.f, q: dq || undefined };
    try {
      const r = await saveSeg.mutateAsync({ name, definition });
      setActiveSaved(r.id);
      if (fixed) { setDefRaw(definition); resetView(); }
      toast(fixed ? t('ya.cli.list.segSavedSel', { name, n: n(sel.length) }) : t('ya.cli.list.segSaved', { name }));
      return true;
    } catch {
      toast(t('ya.cli.list.segFailed'));
      return false;
    }
  };

  const doExport = async () => {
    if (exporting) return;
    setExporting(true);
    try {
      const emails = sel.length > 0 && !selAll ? sel : null;
      const r = await rpc<{ columns: string[]; rows: unknown[][] }>('tix_clients_export', { ...args, p_def: emails ? {} : fullDef, p_emails: emails });
      const stamp = new Date().toISOString().slice(0, 10);
      downloadCsv(`yuno-clients-${stamp}.csv`, r.columns, r.rows);
      toast(t('ya.cli.list.exported', { n: n(r.rows.length) }));
    } catch (e) {
      const m = e instanceof CrmRpcError ? e.message : '';
      toast(t(m.includes('support') ? 'ya.cli.list.exportSupport' : m.includes('export_forbidden') ? 'ya.cli.list.exportForbidden' : 'ya.cli.list.exportFailed'));
    } finally {
      setExporting(false);
    }
  };

  const openWrite = (scope: 'header' | 'bulk') => {
    if (sel.length > 0 && !selAll) {
      setWrite({ scope: 'sel', who: tp('ya.cli.list.n', sel.length, { n: n(sel.length) }), def: null, emails: sel, segmentId: null });
    } else if (hasFilt || selAll) {
      setWrite({ scope: selAll && scope === 'bulk' ? 'sel' : 'filtered', who: tp('ya.cli.list.n', total, { n: n(total) }), def: fullDef, emails: null, segmentId: activeSaved });
    } else {
      const all = ov?.total ?? total;
      setWrite({ scope: 'all', who: tp('ya.cli.list.n', all, { n: n(all) }), def: { seg: 'all', f: {} }, emails: null, segmentId: null });
    }
  };
  const writeOne = (c: ClientCard) => {
    const first = c.first_name?.trim() || fullName(c.first_name, c.last_name, c.email);
    setWrite({ scope: 'one', who: first, def: null, emails: [c.email], segmentId: null });
  };

  const writeLabel = selCount ? t('ya.cli.writeSel') : hasFilt ? t('ya.cli.writeThese', { n: n(total) }) : t('ya.cli.writeAll');
  const empty = !!ov && ov.total === 0;
  // Lectures en échec (délai de 30 s compris) : la vue d'ensemble et la liste
  // se rendent chacune seule ; une base vide ne se déduit jamais d'un échec.
  const listError = list.isError && !list.data ? list.error : null;
  const bothDown = overview.isError && !ov && !!listError;

  return (
    <main style={{ flex: 1, width: '100%', maxWidth: 1280, margin: '0 auto', padding: 'clamp(24px,3vw,36px) clamp(16px,3vw,40px) 96px', display: 'flex', flexDirection: 'column', gap: 24 }}>
      <div style={{ display: 'flex', flexWrap: 'wrap', alignItems: 'flex-end', justifyContent: 'space-between', gap: '16px 24px' }}>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 8, minWidth: 0 }}>
          <span style={{ fontFamily: 'var(--ya-font-mono)', fontSize: 12, letterSpacing: '.08em', textTransform: 'uppercase', color: 'var(--ya-sand-500)', ...reveal(intro, 120) }}>{t('ya.cli.eyebrow')}</span>
          <h1 style={{ margin: 0, fontFamily: 'var(--ya-font-display)', fontWeight: 600, fontSize: 'clamp(28px,3vw,36px)', lineHeight: 1.05, letterSpacing: '-.035em', ...reveal(intro, 190) }}>
            {t('ya.cli.title1')}<span style={{ background: 'var(--ya-gradient-brand)', WebkitBackgroundClip: 'text', backgroundClip: 'text', color: 'transparent' }}>{t('ya.cli.titleAccent')}</span>{t('ya.cli.title2')}
          </h1>
          <p style={{ margin: 0, fontSize: 16, lineHeight: 1.45, fontWeight: 500, color: 'var(--ya-sand-600)', textWrap: 'pretty', maxWidth: 640, ...reveal(intro, 260) }}>{t('ya.cli.sub')}</p>
        </div>
        <div style={{ display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: 10, ...reveal(intro, 320) }}>
          {caps.write && <Hv
            as={Link}
            to={TIX_ROUTES.imports}
            style={{ height: 46, padding: '0 20px 0 16px', borderRadius: 99, background: 'var(--ya-card)', border: '1px solid var(--ya-sand-200)', boxShadow: 'var(--ya-shadow-xs)', color: 'var(--ya-ink)', fontSize: 15, fontWeight: 600, display: 'flex', alignItems: 'center', gap: 8, textDecoration: 'none', transition: `translate 240ms ${EASE},box-shadow 240ms,border-color 200ms` }}
            hover={{ translate: '0 -2px', boxShadow: 'var(--ya-shadow-md)', borderColor: 'var(--ya-sand-300)', color: 'var(--ya-ink)', textDecoration: 'none' }}
            active={{ translate: '0 0' }}
          >
            <Icon name="upload" size={18} stroke={2.2} />{t('ya.cli.import')}
          </Hv>}
          {ov && !empty && caps.send && (
            <Hv
              as="button"
              type="button"
              onClick={() => openWrite('header')}
              style={{ height: 46, padding: '0 6px 0 20px', borderRadius: 99, border: 0, background: 'var(--ya-gradient-brand)', color: '#fff', fontSize: 15, fontWeight: 600, display: 'inline-flex', alignItems: 'center', gap: 12, boxShadow: 'var(--ya-shadow-cta)', cursor: 'pointer', whiteSpace: 'nowrap', transition: `transform 200ms ${SPRING},filter 160ms` }}
              hover={{ filter: 'brightness(1.05)', transform: 'translateY(-1px)' }}
              active={{ transform: 'scale(.97)' }}
            >
              {writeLabel}
              <span style={{ width: 34, height: 34, borderRadius: 99, background: '#fff', color: 'var(--ya-red-500)', display: 'grid', placeItems: 'center' }}><Icon name="arrowRight" size={16} stroke={2.4} /></span>
            </Hv>
          )}
        </div>
      </div>

      {empty ? (
        <section style={{ display: 'flex', flexDirection: 'column', gap: 16, padding: 'clamp(24px,3vw,40px)', borderRadius: 28, background: 'repeating-linear-gradient(135deg,var(--ya-sand-50) 0 10px,var(--ya-sand-100) 10px 20px)', boxShadow: 'inset 0 0 0 1px var(--ya-sand-200)', ...reveal(intro, 400) }}>
          <span style={{ fontFamily: 'var(--ya-font-mono)', fontSize: 12, letterSpacing: '.08em', textTransform: 'uppercase', color: 'var(--ya-sand-500)' }}>{t('ya.cli.empty.label')}</span>
          <span style={{ fontFamily: 'var(--ya-font-display)', fontWeight: 600, fontSize: 'clamp(24px,3vw,32px)', letterSpacing: '-.03em', lineHeight: 1.1, textWrap: 'balance', maxWidth: 640 }}>{t('ya.cli.empty.title')}</span>
          <span style={{ fontSize: 15.5, lineHeight: 1.5, color: 'var(--ya-sand-600)', maxWidth: 560, textWrap: 'pretty' }}>{t('ya.cli.empty.body')}</span>
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 10, marginTop: 6 }}>
            <Hv as={Link} to={TIX_ROUTES.imports} style={{ height: 46, padding: '0 22px', borderRadius: 99, background: 'var(--ya-ink)', color: 'var(--ya-on-ink)', fontSize: 15, fontWeight: 600, display: 'flex', alignItems: 'center', textDecoration: 'none' }} hover={{ background: 'var(--ya-sand-700)', color: 'var(--ya-on-ink)', textDecoration: 'none' }}>
              {t('ya.cli.empty.cta')}
            </Hv>
          </div>
        </section>
      ) : bothDown ? (
        <LoadError error={overview.error} onRetry={() => { void overview.refetch(); void list.refetch(); }} retrying={overview.isFetching || list.isFetching} />
      ) : ov || overview.isError ? (
        <>
          {ov ? (
            <ClientsOverview
              data={ov}
              intro={intro}
              cc={cc}
              onSeg={openSeg}
              onUnreachable={() => { setQ(''); setDef({ seg: 'all', f: { rc: ['none'] } }); goList(); }}
              onOnce={() => { setQ(''); setDef({ seg: 'all', f: { nb: '1' } }); goList(); }}
              onSpend={() => { setQ(''); setDef({ seg: 'all', f: {} }); setSort('sp'); setDir(1); goList(); }}
            />
          ) : (
            <LoadError error={overview.error} onRetry={() => { void overview.refetch(); }} retrying={overview.isFetching} />
          )}
          <ClientsTable
            intro={intro}
            def={def}
            setDef={setDef}
            q={q}
            setQ={setQ}
            sort={sort}
            dir={dir}
            onSort={onSort}
            list={list.data}
            loading={list.isFetching}
            limit={limit}
            onMore={() => setLimit((l) => l + PAGE)}
            events={events.data ?? []}
            saved={saved.data ?? []}
            activeSaved={activeSaved}
            onPickSaved={pickSaved}
            onDeleteSaved={deleteSaved}
            onSaveSegment={saveSegment}
            sel={sel}
            setSel={setSel}
            selAll={selAll}
            setSelAll={setSelAll}
            onOpen={(e) => openDrawer(e)}
            onExport={() => void doExport()}
            saveSignal={saveSignal}
            error={listError}
            onRetry={() => { void list.refetch(); }}
          />
        </>
      ) : (
        <OverviewSkeleton />
      )}

      {selCount > 0 && caps.write && (
        <div role="toolbar" aria-label={t('ya.cli.list.selBar')} style={{ position: 'fixed', left: '50%', bottom: 28, translate: '-50% 0', zIndex: 50, display: 'flex', alignItems: 'center', gap: 6, padding: '8px 8px 8px 18px', borderRadius: 99, background: 'var(--ya-tip-bg)', color: '#fff', boxShadow: '0 18px 40px -12px rgba(0,0,0,.6)', animation: `ya-toast-in 360ms ${EASE}`, maxWidth: 'calc(100vw - 24px)' }}>
          <span style={{ fontSize: 14.5, fontWeight: 600, whiteSpace: 'nowrap', marginRight: 8, fontVariantNumeric: 'tabular-nums' }}>{tp('ya.cli.list.selected', selCount, { n: n(selCount) })}</span>
          {caps.send && <Hv as="button" type="button" onClick={() => openWrite('bulk')} style={{ height: 38, padding: '0 18px', borderRadius: 99, border: 0, background: 'var(--ya-gradient-brand)', color: '#fff', fontSize: 14, fontWeight: 600, cursor: 'pointer', whiteSpace: 'nowrap' }} hover={{ filter: 'brightness(1.08)' }}>{t('ya.cli.list.bulkWrite')}</Hv>}
          <BarBtn onClick={() => { setSaveSignal((x) => x + 1); goList(); }}>{t('ya.cli.list.bulkSeg')}</BarBtn>
          <BarBtn onClick={() => void doExport()}>{t('ya.cli.list.export')}</BarBtn>
          <Hv as="button" type="button" onClick={() => { setSel([]); setSelAll(false); }} aria-label={t('ya.cli.list.bulkCancel')} style={{ width: 38, height: 38, borderRadius: 99, border: 0, background: 'none', color: 'var(--ya-text-on-night-2)', cursor: 'pointer', display: 'grid', placeItems: 'center' }} hover={{ background: 'rgba(255,255,255,.1)', color: '#fff' }}>
            <Icon name="x" size={15} stroke={2.4} />
          </Hv>
        </div>
      )}

      <ClientDrawer
        email={drawerEmail}
        onClose={() => openDrawer(null)}
        pos={posIdx >= 0 ? { i: posIdx, n: total } : null}
        onStep={step}
        onWrite={writeOne}
        guardEscape={!!write}
      />

      {write && (
        <WriteModal
          open
          onClose={() => setWrite(null)}
          scope={write.scope}
          who={write.who}
          def={write.def}
          emails={write.emails}
          segmentId={write.segmentId}
        />
      )}
    </main>
  );
}

function BarBtn({ children, onClick }: { children: React.ReactNode; onClick: () => void }) {
  return (
    <Hv as="button" type="button" onClick={onClick} style={{ height: 38, padding: '0 14px', borderRadius: 99, border: 0, background: 'rgba(255,255,255,.1)', color: '#fff', fontSize: 14, fontWeight: 500, cursor: 'pointer', whiteSpace: 'nowrap' }} hover={{ background: 'rgba(255,255,255,.18)' }}>
      {children}
    </Hv>
  );
}

function OverviewSkeleton() {
  return (
    <div aria-busy="true" style={{ display: 'flex', flexDirection: 'column', gap: 24 }}>
      <div style={{ padding: 'clamp(20px,2.4vw,32px)', borderRadius: 28, background: 'var(--ya-card)', boxShadow: 'inset 0 0 0 1px var(--ya-sand-200),var(--ya-shadow-sm)', display: 'flex', flexDirection: 'column', gap: 18 }}>
        <Skel w={220} h={22} />
        <Skel w={180} h={64} r={12} />
        <Skel h={14} r={99} />
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit,minmax(160px,1fr))', gap: 12 }}>{[0, 1, 2, 3].map((i) => <Skel key={i} h={62} r={12} />)}</div>
      </div>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit,minmax(260px,1fr))', gap: 16 }}>
        {[0, 1, 2].map((i) => <Skel key={i} h={176} r={24} />)}
      </div>
      <Skel h={420} r={28} />
    </div>
  );
}
