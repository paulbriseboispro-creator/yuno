/**
 * Clients · Tous les clients (« Clients » du design).
 *
 *   Qui revient, qui s'éloigne ?          [Importer] [Écrire à…]
 *   Votre base de clients  ·  Joignables · Reviennent · Dépense moyenne
 *   Vos clients, un par un (recherche, segments, filtres, tri, sélection)
 *   Fiche client (volet), Écrire à… (fenêtre), barre de sélection
 *
 * Adresses : `?s=hab` ouvre un groupe, `?status=unreachable` les non
 * joignables, `?nb=1` les clients venus une fois, `?seg=<id>` un segment
 * enregistré, `?c=<email>` une fiche. Tout le calcul vit dans les RPC
 * crm_clients_* ; la page ne fait que mettre en forme.
 */
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { Hv } from '@/crm/ui/Hv';
import { Icon } from '@/crm/ui/Icon';
import { Skel } from '@/crm/ui/kit';
import { useCrmToast } from '@/crm/ui/toast';
import { EASE, SPRING, reveal, useIntro, useProgress } from '@/crm/ui/motion';
import { useCrmT } from '@/crm/i18n';
import { useCrmScope, useCrmCaps } from '@/crm/scope';
import { CrmRpcError, rpc } from '@/crm/lib/rpc';
import { downloadCsv } from '@/crm/lib/csv';
import { fullName } from '@/crm/lib/lifecycle';
import {
  useClientsList, useClientsOverview, useDeleteSegment, useEventsBrief, useSaveSegment, useSegmentsBrief,
} from '@/crm/data/clients';
import type { ClientCard, ClientFilterDef, Lifecycle, SavedSegment } from '@/crm/data/clients';
import { CRM_ROUTES } from '@/crm/shell/nav';
import { WriteModal } from '@/crm/components/WriteModal';
import type { WriteScope } from '@/crm/components/WriteModal';
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
  if (src && ['shotgun', 'utm', 'import', 'page', 'other'].includes(src)) f.src = [src as NonNullable<NonNullable<ClientFilterDef['f']>['src']>[number]];
  return { seg: s && (LIFE as string[]).includes(s) ? (s as Lifecycle) : 'all', f };
}

const isEmptyDef = (d: ClientFilterDef) => {
  const f = d.f ?? {};
  return (d.seg ?? 'all') === 'all'
    && !f.ev?.length && !f.last && !f.last_gt_days && !f.nb && !f.sp && !f.rc?.length && !f.src?.length && !f.tags?.length && !f.emails?.length
    && !f.gl && !f.glev?.length;
};

export default function ClientsPage() {
  const caps = useCrmCaps();
  const T = useCrmT();
  const { t, tp, n } = T;
  const toast = useCrmToast();
  const { rpc: args } = useCrmScope();
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
  const hasFilt = !isEmptyDef(def) || !!dq;
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
      onSuccess: () => { if (activeSaved === s.id) { setActiveSaved(null); setDefRaw({ seg: 'all', f: {} }); } toast(t('yc.cli.list.segDeleted')); },
      onError: () => toast(t('yc.cli.list.segFailed')),
    });
  };
  const saveSegment = async (name: string): Promise<boolean> => {
    if (!name) { toast(t('yc.cli.list.segNameFirst')); return false; }
    const fixed = sel.length > 0 && !selAll;
    const definition: ClientFilterDef = fixed ? { seg: 'all', f: { emails: sel } } : { seg: def.seg, f: def.f, q: dq || undefined };
    try {
      const r = await saveSeg.mutateAsync({ name, definition });
      setActiveSaved(r.id);
      if (fixed) { setDefRaw(definition); resetView(); }
      toast(fixed ? t('yc.cli.list.segSavedSel', { name, n: n(sel.length) }) : t('yc.cli.list.segSaved', { name }));
      return true;
    } catch {
      toast(t('yc.cli.list.segFailed'));
      return false;
    }
  };

  const doExport = async () => {
    if (exporting) return;
    setExporting(true);
    try {
      const emails = sel.length > 0 && !selAll ? sel : null;
      const r = await rpc<{ columns: string[]; rows: unknown[][] }>('crm_clients_export', { ...args, p_def: emails ? {} : fullDef, p_emails: emails });
      const stamp = new Date().toISOString().slice(0, 10);
      downloadCsv(`yuno-clients-${stamp}.csv`, r.columns, r.rows);
      toast(t('yc.cli.list.exported', { n: n(r.rows.length) }));
    } catch (e) {
      const m = e instanceof CrmRpcError ? e.message : '';
      toast(t(m.includes('support') ? 'yc.cli.list.exportSupport' : m.includes('export_forbidden') ? 'yc.cli.list.exportForbidden' : 'yc.cli.list.exportFailed'));
    } finally {
      setExporting(false);
    }
  };

  const openWrite = (scope: 'header' | 'bulk') => {
    if (sel.length > 0 && !selAll) {
      setWrite({ scope: 'sel', who: tp('yc.cli.list.n', sel.length, { n: n(sel.length) }), def: null, emails: sel, segmentId: null });
    } else if (hasFilt || selAll) {
      setWrite({ scope: selAll && scope === 'bulk' ? 'sel' : 'filtered', who: tp('yc.cli.list.n', total, { n: n(total) }), def: fullDef, emails: null, segmentId: activeSaved });
    } else {
      const all = ov?.total ?? total;
      setWrite({ scope: 'all', who: tp('yc.cli.list.n', all, { n: n(all) }), def: { seg: 'all', f: {} }, emails: null, segmentId: null });
    }
  };
  const writeOne = (c: ClientCard) => {
    const first = c.first_name?.trim() || fullName(c.first_name, c.last_name, c.email);
    setWrite({ scope: 'one', who: first, def: null, emails: [c.email], segmentId: null });
  };

  const writeLabel = selCount ? t('yc.cli.writeSel') : hasFilt ? t('yc.cli.writeThese', { n: n(total) }) : t('yc.cli.writeAll');
  const empty = !!ov && ov.total === 0;

  return (
    <main style={{ flex: 1, width: '100%', maxWidth: 1280, margin: '0 auto', padding: 'clamp(24px,3vw,36px) clamp(16px,3vw,40px) 96px', display: 'flex', flexDirection: 'column', gap: 24 }}>
      <div style={{ display: 'flex', flexWrap: 'wrap', alignItems: 'flex-end', justifyContent: 'space-between', gap: '16px 24px' }}>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 8, minWidth: 0 }}>
          <span style={{ fontFamily: 'var(--font-mono)', fontSize: 12, letterSpacing: '.08em', textTransform: 'uppercase', color: 'var(--sand-500)', ...reveal(intro, 120) }}>{t('yc.cli.eyebrow')}</span>
          <h1 style={{ margin: 0, fontFamily: 'var(--font-display)', fontWeight: 600, fontSize: 'clamp(28px,3vw,36px)', lineHeight: 1.05, letterSpacing: '-.035em', ...reveal(intro, 190) }}>
            {t('yc.cli.title1')}<span style={{ background: 'var(--gradient-brand)', WebkitBackgroundClip: 'text', backgroundClip: 'text', color: 'transparent' }}>{t('yc.cli.titleAccent')}</span>{t('yc.cli.title2')}
          </h1>
          <p style={{ margin: 0, fontSize: 16, lineHeight: 1.45, fontWeight: 500, color: 'var(--sand-600)', textWrap: 'pretty', maxWidth: 640, ...reveal(intro, 260) }}>{t('yc.cli.sub')}</p>
        </div>
        <div style={{ display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: 10, ...reveal(intro, 320) }}>
          {caps.write && <Hv
            as={Link}
            to={CRM_ROUTES.imports}
            style={{ height: 46, padding: '0 20px 0 16px', borderRadius: 99, background: '#fff', border: '1px solid var(--sand-200)', boxShadow: 'var(--shadow-xs)', color: 'var(--ink)', fontSize: 15, fontWeight: 600, display: 'flex', alignItems: 'center', gap: 8, textDecoration: 'none', transition: `translate 240ms ${EASE},box-shadow 240ms,border-color 200ms` }}
            hover={{ translate: '0 -2px', boxShadow: 'var(--shadow-md)', borderColor: 'var(--sand-300)', color: 'var(--ink)', textDecoration: 'none' }}
            active={{ translate: '0 0' }}
          >
            <Icon name="upload" size={18} stroke={2.2} />{t('yc.cli.import')}
          </Hv>}
          {ov && !empty && caps.write && (
            <Hv
              as="button"
              type="button"
              onClick={() => openWrite('header')}
              style={{ height: 46, padding: '0 6px 0 20px', borderRadius: 99, border: 0, background: 'var(--gradient-brand)', color: '#fff', fontSize: 15, fontWeight: 600, display: 'inline-flex', alignItems: 'center', gap: 12, boxShadow: 'var(--shadow-cta)', cursor: 'pointer', whiteSpace: 'nowrap', transition: `transform 200ms ${SPRING},filter 160ms` }}
              hover={{ filter: 'brightness(1.05)', transform: 'translateY(-1px)' }}
              active={{ transform: 'scale(.97)' }}
            >
              {writeLabel}
              <span style={{ width: 34, height: 34, borderRadius: 99, background: '#fff', color: 'var(--red-500)', display: 'grid', placeItems: 'center' }}><Icon name="arrowRight" size={16} stroke={2.4} /></span>
            </Hv>
          )}
        </div>
      </div>

      {overview.isError && !ov && (
        <div role="alert" style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12, padding: '16px 20px', borderRadius: 20, background: 'var(--amber-50)', color: 'var(--amber-700)', fontWeight: 500 }}>
          {t('yc.cli.loadError')}
          <button type="button" onClick={() => overview.refetch()} style={{ border: 0, background: 'none', padding: 0, fontWeight: 600, color: 'var(--ink)', cursor: 'pointer' }}>{t('yc.common.retry')}</button>
        </div>
      )}

      {empty ? (
        <section style={{ display: 'flex', flexDirection: 'column', gap: 16, padding: 'clamp(24px,3vw,40px)', borderRadius: 28, background: 'repeating-linear-gradient(135deg,var(--sand-50) 0 10px,var(--sand-100) 10px 20px)', boxShadow: 'inset 0 0 0 1px var(--sand-200)', ...reveal(intro, 400) }}>
          <span style={{ fontFamily: 'var(--font-mono)', fontSize: 12, letterSpacing: '.08em', textTransform: 'uppercase', color: 'var(--sand-500)' }}>{t('yc.cli.empty.label')}</span>
          <span style={{ fontFamily: 'var(--font-display)', fontWeight: 600, fontSize: 'clamp(24px,3vw,32px)', letterSpacing: '-.03em', lineHeight: 1.1, textWrap: 'balance', maxWidth: 640 }}>{t('yc.cli.empty.title')}</span>
          <span style={{ fontSize: 15.5, lineHeight: 1.5, color: 'var(--sand-600)', maxWidth: 560, textWrap: 'pretty' }}>{t('yc.cli.empty.body')}</span>
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 10, marginTop: 6 }}>
            <Hv as={Link} to={CRM_ROUTES.connectors} style={{ height: 46, padding: '0 22px', borderRadius: 99, background: 'var(--ink)', color: '#fff', fontSize: 15, fontWeight: 600, display: 'flex', alignItems: 'center', textDecoration: 'none' }} hover={{ background: 'var(--sand-700)', color: '#fff', textDecoration: 'none' }}>
              {t('yc.cli.empty.cta')}
            </Hv>
          </div>
        </section>
      ) : ov ? (
        <>
          <ClientsOverview
            data={ov}
            intro={intro}
            cc={cc}
            onSeg={openSeg}
            onUnreachable={() => { setQ(''); setDef({ seg: 'all', f: { rc: ['none'] } }); goList(); }}
            onOnce={() => { setQ(''); setDef({ seg: 'all', f: { nb: '1' } }); goList(); }}
            onSpend={() => { setQ(''); setDef({ seg: 'all', f: {} }); setSort('sp'); setDir(1); goList(); }}
          />
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
          />
        </>
      ) : (
        <OverviewSkeleton />
      )}

      {selCount > 0 && caps.write && (
        <div role="toolbar" aria-label={t('yc.cli.list.selBar')} style={{ position: 'fixed', left: '50%', bottom: 28, translate: '-50% 0', zIndex: 50, display: 'flex', alignItems: 'center', gap: 6, padding: '8px 8px 8px 18px', borderRadius: 99, background: 'var(--ink)', color: '#fff', boxShadow: '0 18px 40px -12px rgba(28,21,23,.5)', animation: `yc-toast-in 360ms ${EASE}`, maxWidth: 'calc(100vw - 24px)' }}>
          <span style={{ fontSize: 14.5, fontWeight: 600, whiteSpace: 'nowrap', marginRight: 8, fontVariantNumeric: 'tabular-nums' }}>{tp('yc.cli.list.selected', selCount, { n: n(selCount) })}</span>
          <Hv as="button" type="button" onClick={() => openWrite('bulk')} style={{ height: 38, padding: '0 18px', borderRadius: 99, border: 0, background: 'var(--gradient-brand)', color: '#fff', fontSize: 14, fontWeight: 600, cursor: 'pointer', whiteSpace: 'nowrap' }} hover={{ filter: 'brightness(1.08)' }}>{t('yc.cli.list.bulkWrite')}</Hv>
          <BarBtn onClick={() => { setSaveSignal((x) => x + 1); goList(); }}>{t('yc.cli.list.bulkSeg')}</BarBtn>
          <BarBtn onClick={() => void doExport()}>{t('yc.cli.list.export')}</BarBtn>
          <Hv as="button" type="button" onClick={() => { setSel([]); setSelAll(false); }} aria-label={t('yc.cli.list.bulkCancel')} style={{ width: 38, height: 38, borderRadius: 99, border: 0, background: 'none', color: 'var(--text-on-night-2)', cursor: 'pointer', display: 'grid', placeItems: 'center' }} hover={{ background: 'rgba(255,255,255,.1)', color: '#fff' }}>
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
      <div style={{ padding: 'clamp(20px,2.4vw,32px)', borderRadius: 28, background: '#fff', boxShadow: 'inset 0 0 0 1px var(--sand-200),var(--shadow-sm)', display: 'flex', flexDirection: 'column', gap: 18 }}>
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
