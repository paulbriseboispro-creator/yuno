/**
 * Clients · Segments (« Segments » du design).
 *
 *   Quels groupes répondent le mieux ?                 [Nouveau segment]
 *   Ce que rapportent vos messages (période, courbe, 4 étapes, constat)
 *   Mes segments · Qui répond le mieux · Derniers envois
 *   Fiche segment (volet), Écrire à…, Nouveau segment (le catalogue)
 *
 * Adresse : `?v=rep|env` la vue, `?p=90d|12m` la période, `?s=<clé>` une fiche,
 * `?new=1` ouvre le catalogue (`?new=rec` : recommandations cochées, depuis la
 * tâche de l'accueil).
 * Tous les chiffres viennent de crm_segments_overview / crm_segment_detail.
 */
import { useCallback, useEffect, useMemo, useState } from 'react';
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
import { useDeleteSegment, useSaveSegment } from '@/crm/data/clients';
import type { ClientFilterDef } from '@/crm/data/clients';
import { SegmentCatalogModal } from '@/crm/components/SegmentCatalog';
import { useSegmentsOverview } from '@/crm/data/segments';
import type { SegPeriod } from '@/crm/data/segments';
import { growthIsBad, segmentColor, segmentName, segmentRule } from '@/crm/lib/segments';
import { CRM_ROUTES } from '@/crm/shell/nav';
import { WriteModal } from '@/crm/components/WriteModal';
import { MessagesCard } from './MessagesCard';
import { SegmentsTable } from './SegmentsTable';
import type { SegGroup, SegSort } from './SegmentsTable';
import { BestView } from './BestView';
import { SendsView } from './SendsView';
import { SegmentDrawer } from './SegmentDrawer';
import { PERIODS, rate } from './segFormat';
import type { SegVM } from './vm';

type View = 'ens' | 'rep' | 'env';

export default function SegmentsPage() {
  const caps = useCrmCaps();
  const T = useCrmT();
  const { t, tp, n, pct, n1 } = T;
  const toast = useCrmToast();
  const { rpc: args } = useCrmScope();
  const [sp, setSp] = useSearchParams();
  const view = (['rep', 'env'].includes(sp.get('v') ?? '') ? sp.get('v') : 'ens') as View;
  const period = ((PERIODS as string[]).includes(sp.get('p') ?? '') ? sp.get('p') : '30d') as SegPeriod;
  const sel = sp.get('s');

  const ov = useSegmentsOverview(period);
  const data = ov.data;
  const intro = useIntro(!!data);
  // Les compteurs se rejouent quand la période change, pas à chaque relecture.
  const cc = useProgress(1500, 450, data ? data.period : 'wait', !!data);
  const [sort, setSort] = useState<SegSort>('n');
  const [dir, setDir] = useState(1);
  const [group, setGroup] = useState<SegGroup>('all');
  const [envSeg, setEnvSeg] = useState('*');
  const [nw, setNw] = useState(() => caps.write && !!sp.get('new'));
  const nwRec = sp.get('new') === 'rec';
  const [write, setWrite] = useState<SegVM | null>(null);
  const saveSeg = useSaveSegment();
  const delSeg = useDeleteSegment();

  const patch = useCallback((p: Record<string, string | null>) => {
    setSp((prev) => {
      const q = new URLSearchParams(prev);
      for (const [k, v] of Object.entries(p)) { if (v === null) q.delete(k); else q.set(k, v); }
      return q;
    }, { replace: true });
  }, [setSp]);
  const setView = (v: View) => patch({ v: v === 'ens' ? null : v });
  const setPeriod = (p: SegPeriod) => patch({ p: p === '30d' ? null : p });

  const rules = data?.rules;
  const segs = useMemo<SegVM[]>(() => {
    if (!data) return [];
    const r = { min: rules?.regular_min_nights ?? 3, win: rules?.regular_window_months ?? 6, lapse: rules?.lapse_months ?? 4 };
    let ci = 0;
    return data.segments
      .filter((s) => s.kind === 'custom' || s.key !== 'none' || s.n > 0)
      .map((s) => {
        const color = segmentColor(s, s.kind === 'custom' ? ci++ : 0);
        return {
          ...s,
          label: segmentName(s, t),
          rule: segmentRule(s, t, r),
          color,
          good: !growthIsBad(s),
          delta: s.n_start === null ? null : s.n - s.n_start,
        };
      });
  }, [data, rules, t]);
  const selSeg = sel ? segs.find((s) => s.key === sel) ?? null : null;
  const posIdx = selSeg ? segs.indexOf(selSeg) : -1;

  // Un segment ouvert par l'adresse qui n'existe plus (supprimé) : on referme.
  const fetching = ov.isFetching;
  useEffect(() => { if (data && !fetching && sel && !segs.some((s) => s.key === sel)) patch({ s: null }); }, [data, fetching, sel, segs, patch]);

  const tot = data?.totals;
  const avg = tot ?? { received: 0, clicked: 0, ticketing: 0, bought: 0, buyers: 0, revenue: 0 };
  const insight = useMemo(() => {
    const auto = segs.filter((s) => s.kind === 'auto' && s.msg.received >= 30)
      .sort((a, b) => rate(b.msg.clicked, b.msg.received) - rate(a.msg.clicked, a.msg.received));
    if (auto.length < 2) return null;
    const b = auto[0];
    const w = auto[auto.length - 1];
    const rb = rate(b.msg.clicked, b.msg.received);
    const rw = rate(w.msg.clicked, w.msg.received);
    if (rw <= 0 || rb / rw < 1.5) return null;
    const p = (x: number) => (x * 100 < 10 ? pct(x * 100, 1) : pct(x * 100));
    return t('yc.seg.ins', { best: b.label, worst: w.label, x: n1(rb / rw), pb: p(rb), pw: p(rw) });
  }, [segs, t, pct, n1]);

  const empty = !!data && segs.every((s) => s.n === 0);
  const defOf = (s: SegVM): ClientFilterDef => (s.kind === 'auto' ? { seg: s.key as ClientFilterDef['seg'], f: {} } : s.definition);

  const step = useCallback((d: 1 | -1) => {
    if (posIdx < 0) return;
    const next = segs[posIdx + d];
    if (next) patch({ s: next.key });
  }, [posIdx, segs, patch]);

  const doExport = async (s: SegVM) => {
    try {
      const r = await rpc<{ columns: string[]; rows: unknown[][] }>('crm_clients_export', { ...args, p_def: defOf(s), p_emails: null });
      const slug = s.label.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || 'segment';
      downloadCsv(`yuno-segment-${slug}-${new Date().toISOString().slice(0, 10)}.csv`, r.columns, r.rows);
      toast(t('yc.cli.list.exported', { n: n(r.rows.length) }));
    } catch (e) {
      const m = e instanceof CrmRpcError ? e.message : '';
      toast(t(m.includes('support') ? 'yc.cli.list.exportSupport' : m.includes('export_forbidden') ? 'yc.cli.list.exportForbidden' : 'yc.cli.list.exportFailed'));
    }
  };
  const rename = (s: SegVM, name: string) => {
    saveSeg.mutate({ id: s.key, name, definition: s.definition }, {
      onSuccess: () => toast(t('yc.seg.dr.renamed')),
      onError: () => toast(t('yc.cli.list.segFailed')),
    });
  };
  const remove = (s: SegVM) => {
    patch({ s: null });
    delSeg.mutate(s.key, {
      onSuccess: () => toast(t('yc.cli.list.segDeleted'), {
        label: t('yc.seg.dr.undo'),
        onClick: () => saveSeg.mutate({ name: s.label, definition: s.definition, template: s.template, description: s.description }),
      }),
      onError: () => toast(t('yc.cli.list.segFailed')),
    });
  };
  const closeNew = () => { setNw(false); if (sp.get('new')) patch({ new: null }); };
  // Un seul segment créé : sa fiche s'ouvre ; plusieurs : la liste les montre.
  const created = (c: { template: string; id: string }[]) => {
    setGroup('all');
    patch({ v: null, new: null, s: c.length === 1 ? c[0].id : null });
  };
  const seeSends = (s: SegVM) => {
    const targeted = (data?.sends ?? []).some((e) => e.target === s.key);
    setEnvSeg(targeted ? s.key : '*');
    patch({ s: null, v: 'env' });
  };

  const tabs: { k: View; l: string; c: number | null }[] = [
    { k: 'ens', l: t('yc.seg.tab.ens'), c: data ? segs.length : null },
    { k: 'rep', l: t('yc.seg.tab.rep'), c: null },
    { k: 'env', l: t('yc.seg.tab.env'), c: data ? data.sends.length : null },
  ];

  return (
    <main style={{ flex: 1, width: '100%', maxWidth: 1280, margin: '0 auto', padding: 'clamp(24px,3vw,36px) clamp(16px,3vw,40px) 96px', display: 'flex', flexDirection: 'column', gap: 24 }}>
      <div style={{ display: 'flex', flexWrap: 'wrap', alignItems: 'flex-end', justifyContent: 'space-between', gap: '16px 24px' }}>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 8, minWidth: 0 }}>
          <span style={{ fontFamily: 'var(--font-mono)', fontSize: 12, letterSpacing: '.08em', textTransform: 'uppercase', color: 'var(--sand-500)', ...reveal(intro, 120) }}>{t('yc.seg.eyebrow')}</span>
          <h1 style={{ margin: 0, fontFamily: 'var(--font-display)', fontWeight: 600, fontSize: 'clamp(28px,3vw,36px)', lineHeight: 1.05, letterSpacing: '-.035em', ...reveal(intro, 190) }}>
            {t('yc.seg.title1')}<span style={{ background: 'var(--gradient-brand)', WebkitBackgroundClip: 'text', backgroundClip: 'text', color: 'transparent' }}>{t('yc.seg.titleAccent')}</span>{t('yc.seg.title2')}
          </h1>
          <p style={{ margin: 0, fontSize: 16, lineHeight: 1.45, fontWeight: 500, color: 'var(--sand-600)', textWrap: 'pretty', maxWidth: 660, ...reveal(intro, 260) }}>{t('yc.seg.sub')}</p>
        </div>
        {caps.write && <div style={reveal(intro, 320)}>
          <Hv
            as="button"
            type="button"
            onClick={() => setNw(true)}
            style={{ height: 46, padding: '0 6px 0 20px', borderRadius: 99, border: 0, background: 'var(--gradient-brand)', color: '#fff', fontSize: 15, fontWeight: 600, display: 'inline-flex', alignItems: 'center', gap: 12, boxShadow: 'var(--shadow-cta)', cursor: 'pointer', whiteSpace: 'nowrap', transition: `transform 200ms ${SPRING},filter 160ms` }}
            hover={{ filter: 'brightness(1.05)', transform: 'translateY(-1px)' }}
            active={{ transform: 'scale(.97)' }}
          >
            {t('yc.seg.new')}
            <span style={{ width: 34, height: 34, borderRadius: 99, background: '#fff', color: 'var(--red-500)', display: 'grid', placeItems: 'center' }}><Icon name="plus" size={16} stroke={2.6} /></span>
          </Hv>
        </div>}
      </div>

      {ov.isError && !data && (
        <div role="alert" style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12, padding: '16px 20px', borderRadius: 20, background: 'var(--amber-50)', color: 'var(--amber-700)', fontWeight: 500 }}>
          {t('yc.seg.loadError')}
          <button type="button" onClick={() => ov.refetch()} style={{ border: 0, background: 'none', padding: 0, fontWeight: 600, color: 'var(--ink)', cursor: 'pointer' }}>{t('yc.common.retry')}</button>
        </div>
      )}

      {empty ? (
        <section style={{ display: 'flex', flexDirection: 'column', gap: 16, padding: 'clamp(24px,3vw,40px)', borderRadius: 28, background: 'repeating-linear-gradient(135deg,var(--sand-50) 0 10px,var(--sand-100) 10px 20px)', boxShadow: 'inset 0 0 0 1px var(--sand-200)', ...reveal(intro, 400) }}>
          <span style={{ fontFamily: 'var(--font-mono)', fontSize: 12, letterSpacing: '.08em', textTransform: 'uppercase', color: 'var(--sand-500)' }}>{t('yc.seg.empty.label')}</span>
          <span style={{ fontFamily: 'var(--font-display)', fontWeight: 600, fontSize: 'clamp(24px,3vw,32px)', letterSpacing: '-.03em', lineHeight: 1.1, textWrap: 'balance', maxWidth: 640 }}>{t('yc.seg.empty.title')}</span>
          <span style={{ fontSize: 15.5, lineHeight: 1.5, color: 'var(--sand-600)', maxWidth: 580, textWrap: 'pretty' }}>{t('yc.seg.empty.body')}</span>
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 10, marginTop: 6 }}>
            <Hv as={Link} to={CRM_ROUTES.connectors} style={{ height: 46, padding: '0 22px', borderRadius: 99, background: 'var(--ink)', color: '#fff', fontSize: 15, fontWeight: 600, display: 'flex', alignItems: 'center', textDecoration: 'none' }} hover={{ background: 'var(--sand-700)', color: '#fff', textDecoration: 'none' }}>
              {t('yc.seg.empty.cta')}
            </Hv>
          </div>
        </section>
      ) : (
        <>
          {data ? (
            <MessagesCard
              data={data}
              period={period}
              setPeriod={setPeriod}
              intro={intro}
              cc={cc}
              busy={ov.isFetching && data.period !== period}
              insight={insight}
              onCompare={() => setView('rep')}
            />
          ) : (
            <div aria-busy="true" style={{ display: 'flex', flexDirection: 'column', gap: 22, padding: 'clamp(20px,2.4vw,32px)', borderRadius: 28, background: '#fff', boxShadow: 'inset 0 0 0 1px var(--sand-200),var(--shadow-sm)' }}>
              <Skel w={280} h={22} />
              <div style={{ display: 'flex', flexWrap: 'wrap', gap: 24, alignItems: 'flex-end' }}><Skel w={300} h={70} r={14} /><Skel w={420} h={84} r={12} /></div>
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit,minmax(min(100%,210px),1fr))', gap: 12 }}>{[0, 1, 2, 3].map((i) => <Skel key={i} h={150} r={20} />)}</div>
            </div>
          )}

          <div role="tablist" aria-label={t('yc.seg.tab.ens')} style={{ display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: 8, ...reveal(intro, 520) }}>
            {tabs.map((x) => {
              const act = view === x.k;
              return (
                <Hv key={x.k} as="button" type="button" role="tab" aria-selected={act} onClick={() => setView(x.k)} style={{ height: 44, padding: '0 18px', borderRadius: 99, border: `1px solid ${act ? 'var(--ink)' : 'var(--sand-200)'}`, background: act ? 'var(--ink)' : '#fff', color: act ? '#fff' : 'var(--ink)', fontSize: 15, fontWeight: 600, display: 'inline-flex', alignItems: 'center', gap: 8, cursor: 'pointer', transition: 'background 160ms,color 160ms,border-color 160ms' }} hover={{ borderColor: 'var(--sand-400)' }}>
                  {x.l}{x.c !== null && <span style={{ fontSize: 13, fontWeight: 500, color: act ? 'rgba(255,255,255,.7)' : 'var(--sand-500)', fontVariantNumeric: 'tabular-nums' }}>{n(x.c)}</span>}
                </Hv>
              );
            })}
          </div>

          <div key={view} style={{ animation: `yc-rise 520ms ${EASE} both` }}>
            {view === 'ens' && (
              <SegmentsTable
                segs={segs}
                period={period}
                sort={sort}
                dir={dir}
                onSort={(k) => { if (sort === k) setDir(-dir); else { setSort(k); setDir(1); } }}
                group={group}
                setGroup={setGroup}
                loading={!data}
                onOpen={(k) => patch({ s: k })}
                onNew={caps.write ? () => setNw(true) : undefined}
              />
            )}
            {view === 'rep' && data && <BestView segs={segs} period={period} onOpen={(k) => patch({ s: k })} />}
            {view === 'env' && data && <SendsView sends={data.sends} segs={segs} period={period} seg={envSeg} setSeg={setEnvSeg} />}
          </div>
        </>
      )}

      <SegmentDrawer
        seg={selSeg}
        pos={posIdx >= 0 ? { i: posIdx, n: segs.length } : null}
        period={period}
        setPeriod={setPeriod}
        avg={avg}
        computedAt={data?.computed_at ?? null}
        onClose={() => patch({ s: null })}
        onStep={step}
        onWrite={(s) => setWrite(s)}
        onExport={(s) => void doExport(s)}
        onRename={rename}
        onDelete={remove}
        onSeeSends={seeSends}
        guardEscape={!!write}
      />

      {write && (
        <WriteModal
          open
          onClose={() => setWrite(null)}
          scope="filtered"
          eyebrow={t('yc.seg.write.eyebrow', { name: write.label })}
          who={tp('yc.cli.list.n', write.n, { n: n(write.n) })}
          def={defOf(write)}
          segmentId={write.kind === 'custom' ? write.key : null}
        />
      )}

      <SegmentCatalogModal open={nw} onClose={closeNew} context="manual" preselect={nwRec} onCreated={created} />
    </main>
  );
}
