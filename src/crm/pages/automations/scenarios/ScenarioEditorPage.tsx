/**
 * L'éditeur d'un scénario, plein écran : `/crm/automations/scenarios/:id`.
 *
 * Flux vertical à gauche, inspecteur à droite (volet au téléphone). Le
 * brouillon s'enregistre tout seul ; la validation (miroir exact du serveur)
 * marque chaque étape fautive ; « Avant de publier » dit qui entrerait
 * aujourd'hui, l'estimation par semaine et le plafond de Yunits ; chaque
 * message se teste gratuitement. Un scénario publié montre ses résultats
 * étape par étape. Au téléphone : lecture, pause, modifications simples.
 */
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { useQueryClient } from '@tanstack/react-query';
import { Hv } from '@/crm/ui/Hv';
import { Icon } from '@/crm/ui/Icon';
import { CtaButton, Sheet, Skel } from '@/crm/ui/kit';
import { useCrmToast } from '@/crm/ui/toast';
import { useNarrow } from '@/crm/ui/useNarrow';
import { YunitFace } from '@/crm/ui/YunitFace';
import { useCrmT } from '@/crm/i18n';
import { useCrmScope } from '@/crm/scope';
import { CRM_ROUTES } from '@/crm/shell/nav';
import { CrmLoadError } from '@/crm/errors/CrmLoadError';
import { useCrmShell } from '@/crm/data/shell';
import { useNights } from '@/crm/data/nights';
import { useSegmentsOverview } from '@/crm/data/segments';
import { useSignupPages } from '@/crm/data/signupPages';
import { useHoldoutSettings } from '@/crm/data/holdout';
import { smsErrorKey, useSmsSettings } from '@/crm/data/sms';
import {
  createScenarioEmail, scnErrorCode, testScenarioEmail, testScenarioSms, useScenario, useScenarioActions, useScenarioEmailTemplates, useScenarioReport,
  useScenarios, type ScnIssue,
} from '@/crm/data/scenarios';
import { defaultSender } from '@/crm/lib/sms';
import { EVENT_TRIGGERS, graphErrors, type ScenarioGraph } from '@/crm/lib/scenarioGraph';
import { blankNode, flowLayout, insertAt, nodesInFlowOrder, removalPlan, type Inlet } from '@/crm/lib/scenarioEdit';
import { newNodeId } from '@/crm/lib/scenarioTemplates';
import type { CrmTemplateKind } from '@/crm/lib/emailTemplates';
import { FlowView } from './FlowView';
import { Inspector, type InspectorRefs, type Selection } from './Inspector';
import { AddStepModal, PublishModal, ReportSummary, TestModal, type TestState } from './Panels';
import { condSummary, nodeSummary, triggerSummary } from './scnText';
import { SmallButton, StateBadge } from './scnUi';
import { useMeasuredHeight } from './scnStyle';

/** Codes que seule la base peut dire (le reste est recalculé ici, à chaque frappe). */
const CONTENT_CODES = new Set(['unknown_segment', 'unknown_page', 'page_without_event', 'unknown_template', 'unknown_event', 'event_past', 'sms_identity']);

type SaveState = 'idle' | 'saving' | 'saved' | 'error' | 'conflict';

export default function ScenarioEditorPage() {
  const { id = '' } = useParams();
  const q = useScenario(id);
  const T = useCrmT();
  const { t } = T;

  if (q.isError && !q.data) {
    const notFound = String((q.error as Error | null)?.message ?? '').includes('not_found');
    return (
      <div style={{ minHeight: '100dvh', display: 'grid', placeItems: 'center', padding: 24 }}>
        {notFound ? (
          <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 14, textAlign: 'center' }}>
            <YunitFace mood="inquiet" size={60} />
            <b style={{ fontFamily: 'var(--font-display)', fontSize: 22 }}>{t('yc.scn.ed.notFound')}</b>
            <CtaButton to={`${CRM_ROUTES.automations}?tab=scenarios`} icon={null}>{t('yc.scn.ed.back')}</CtaButton>
          </div>
        ) : <CrmLoadError error={q.error} onRetry={() => { void q.refetch(); }} retrying={q.isFetching} />}
      </div>
    );
  }
  if (!q.data) return <EditorSkeleton />;
  return <Editor key={q.data.id} />;
}

function EditorSkeleton() {
  return (
    <div style={{ minHeight: '100dvh', display: 'flex', flexDirection: 'column' }}>
      <div style={{ height: 64, borderBottom: '1px solid var(--sand-100)', display: 'flex', alignItems: 'center', gap: 12, padding: '0 20px' }}><Skel w={40} h={40} r={99} /><Skel w={220} h={20} /></div>
      <div style={{ flex: 1, display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 18, padding: 32 }}>
        {[0, 1, 2, 3].map((i) => <Skel key={i} w="min(420px,100%)" h={86} r={18} />)}
      </div>
    </div>
  );
}

function Editor() {
  const { id = '' } = useParams();
  const qc = useQueryClient();
  const T = useCrmT();
  const { t, lang } = T;
  const toast = useCrmToast();
  const narrow = useNarrow(980);
  const { space, qk } = useCrmScope();
  const q = useScenario(id);
  const d = q.data!;
  const list = useScenarios();
  const act = useScenarioActions();
  const shell = useCrmShell();
  const nights = useNights();
  const segs = useSegmentsOverview('30d');
  const pages = useSignupPages();
  const hold = useHoldoutSettings();
  const smsSettings = useSmsSettings();
  const templates = useScenarioEmailTemplates();
  const { ref: bodyRef, height } = useMeasuredHeight<HTMLDivElement>();

  const [graph, setGraphRaw] = useState<ScenarioGraph>(() => d.draft);
  const [name, setName] = useState(d.name);
  const [status, setStatus] = useState(d.status);
  const [dirty, setDirty] = useState(false);
  const [save, setSave] = useState<SaveState>('idle');
  const expected = useRef<string | null>(d.draft_updated_at);
  const [sel, setSel] = useState<Selection>({ kind: 'start' });
  const [sheet, setSheet] = useState(false);
  const [adding, setAdding] = useState<{ at: Inlet; allowEnd: boolean } | null>(null);
  const [publishing, setPublishing] = useState(false);
  const [testing, setTesting] = useState(false);
  const [testState, setTestState] = useState<TestState>({});
  const [results, setResults] = useState(false);
  const [busy, setBusy] = useState(false);

  const readOnly = !d.can_edit || status === 'archived';
  const published = d.version > 0;
  const report = useScenarioReport(id, results && published);
  const row = list.data?.scenarios.find((s) => s.id === id) ?? null;
  const state = status === 'active' ? (d.state === 'frozen' || d.state === 'plan_paused' ? d.state : 'active') : status;

  const setGraph = useCallback((fn: (g: ScenarioGraph) => ScenarioGraph) => {
    if (readOnly) return;
    setGraphRaw((g) => fn(g));
    setDirty(true);
  }, [readOnly]);

  // ── Enregistrement automatique ───────────────────────────────────────────
  const latest = useRef({ graph, name });
  latest.current = { graph, name };
  const doSave = useCallback(async (): Promise<boolean> => {
    if (readOnly) return true;
    setSave('saving');
    try {
      const r = await act.save({ id, name: latest.current.name.trim() || t('yc.scn.untitled'), graph: latest.current.graph, expected: expected.current });
      expected.current = r.draft_updated_at;
      setDirty(false);
      setSave('saved');
      // Les contrôles qui lisent la base (modèle, identité SMS, segment…) suivent l'enregistrement.
      void qc.invalidateQueries({ queryKey: ['crm', qk, 'scenario', id], exact: true });
      return true;
    } catch (e) {
      setSave(scnErrorCode(e) === 'draft_changed' ? 'conflict' : 'error');
      return false;
    }
  }, [act, id, qc, qk, readOnly, t]);
  const saveRef = useRef(doSave);
  saveRef.current = doSave;
  useEffect(() => {
    if (!dirty || readOnly || save === 'conflict') return;
    const h = window.setTimeout(() => { void saveRef.current(); }, 900);
    return () => window.clearTimeout(h);
  }, [dirty, readOnly, graph, name, save]);
  useEffect(() => {
    if (!dirty) return;
    const warn = (e: BeforeUnloadEvent) => { e.preventDefault(); };
    window.addEventListener('beforeunload', warn);
    return () => window.removeEventListener('beforeunload', warn);
  }, [dirty]);
  const flush = useCallback(async () => (dirty ? saveRef.current() : true), [dirty]);

  // ── Ce que l'écran nomme ─────────────────────────────────────────────────
  const order = useMemo(() => nodesInFlowOrder(graph), [graph]);
  const nodeLabel = useCallback((nid: string) => {
    const n = graph.nodes[nid];
    if (!n) return t('yc.scn.node.missing');
    const same = order.filter((x) => graph.nodes[x]?.type === n.type);
    const base = t(`yc.scn.node.${n.type}`);
    return same.length > 1 ? `${base} ${same.indexOf(nid) + 1}` : base;
  }, [graph, order, t]);
  const nightList = useMemo(() => (nights.data?.nights ?? []).slice().sort((a, b) => a.start_at.localeCompare(b.start_at)), [nights.data]);
  const nextNight = nightList.find((x) => x.upcoming)?.id ?? null;
  const eventName = useCallback((eid: string) => nightList.find((x) => x.id === eid)?.title ?? t('yc.scn.ev.unknown'), [nightList, t]);
  const segList = useMemo(() => (segs.data?.segments ?? []).filter((s) => s.kind === 'custom').map((s) => ({ id: s.key, name: s.name ?? '—' })), [segs.data]);
  const segmentName = useCallback((sid: string) => segList.find((s) => s.id === sid)?.name ?? t('yc.scn.seg.unknown'), [segList, t]);
  const pageList = useMemo(() => (pages.data?.pages ?? []).map((p) => ({ id: p.id, title: p.title || p.slug })), [pages.data]);
  const tplList = useMemo(() => templates.data ?? [], [templates.data]);
  const textCtx = useMemo(() => ({
    nodeName: nodeLabel, eventName, segmentName,
    // Tant que la liste des modèles charge, on ne dit pas « introuvable ».
    template: (tid: string) => tplList.find((x) => x.id === tid)?.name ?? (templates.isLoading ? '…' : t('yc.scn.email.unknownTpl')),
  }), [nodeLabel, eventName, segmentName, tplList, templates.isLoading, t]);
  const hasEvent = (EVENT_TRIGGERS as readonly string[]).includes(graph.trigger?.type ?? '');

  // ── Validation : la forme ici, le contenu lu en base ─────────────────────
  const issues: ScnIssue[] = useMemo(() => {
    const shape = graphErrors(graph).errors as ScnIssue[];
    const content = [...(q.data?.errors ?? []).filter((e) => CONTENT_CODES.has(e.code)), ...(q.data?.warnings ?? [])]
      .filter((e) => e.node === null || graph.nodes[e.node]);
    return [...shape, ...content];
  }, [graph, q.data]);
  const blocking = issues.filter((e) => e.code !== 'family_not_confirmed' && e.code !== 'chance_unavailable').length;

  const layout = useMemo(() => flowLayout(graph), [graph]);
  const goalText = graph.goal ? t(`yc.scn.goal.${graph.goal.type}`) : t('yc.scn.goal.none');
  const start = {
    trigger: triggerSummary(T, graph, { segment: segmentName, page: (pid) => pageList.find((p) => p.id === pid)?.title ?? t('yc.scn.page.unknown') }),
    who: graph.entry?.filter ? condSummary(T, graph.entry.filter, textCtx) : t('yc.scn.cond.everyone'),
    goal: goalText,
  };

  const refs: InspectorRefs = {
    nights: nightList.map((x) => ({ id: x.id, title: x.title, start_at: x.start_at, upcoming: x.upcoming })),
    segments: segList,
    emailNodes: order.filter((x) => graph.nodes[x]?.type === 'email').map((x) => ({ id: x, name: nodeLabel(x) })),
    smsNodes: order.filter((x) => graph.nodes[x]?.type === 'sms').map((x) => ({ id: x, name: nodeLabel(x) })),
    hasEvent,
    templates: tplList.map((x) => ({ id: x.id, name: x.name })),
    pages: pageList,
    holdoutPct: hold.data?.pct ?? 10,
    rates: { email: d.rates.email, fr: d.rates.sms.fr, intl: d.rates.sms.intl },
    senderName: smsSettings.data?.sender_name || defaultSender(space.name),
    venueName: space.name,
    nodeLabel,
  };

  // ── Gestes ───────────────────────────────────────────────────────────────
  const select = (s: Selection) => { setSel(s); if (narrow) setSheet(true); };
  const insert = (type: string) => {
    if (!adding) return;
    const nid = newNodeId(Object.keys(graph.nodes), type.slice(0, 1));
    setGraph((g) => insertAt(g, adding.at, nid, blankNode(type, { hasEvent, smsBody: t('yc.scn.sms.default') })));
    setAdding(null);
    select({ kind: 'node', id: nid });
  };
  const remove = (nid: string) => {
    const plan = removalPlan(graph, nid);
    if (plan.removed.length > 1 && !window.confirm(T.tp('yc.scn.ed.confirmRemove', plan.removed.length - 1))) return;
    setGraph(() => plan.graph);
    setSel({ kind: 'start' });
    setSheet(false);
  };
  const createEmail = async (nodeId: string, kind: CrmTemplateKind) => {
    try {
      const tid = await createScenarioEmail({
        kind, name: `${name || t('yc.scn.untitled')} · ${nodeLabel(nodeId)}`, venueId: space.venueId,
        organizerUserId: space.venueId ? null : space.organizerUserId, venueName: space.name, lang, t,
      });
      await qc.invalidateQueries({ queryKey: ['crm', qk, 'scenario-email-templates'] });
      setGraph((g) => ({ ...g, nodes: { ...g.nodes, [nodeId]: { ...g.nodes[nodeId], template_id: tid } } }));
      toast(t('yc.scn.email.created'));
    } catch {
      toast(t('yc.scn.err.generic'));
    }
  };
  const openStudio = async (tid: string) => {
    await flush();
    window.open(`${CRM_ROUTES.emailStudio(tid)}?template=scenario`, '_blank', 'noopener');
  };
  const sendTest = async (nid: string) => {
    const n = graph.nodes[nid];
    if (!n) return;
    setTestState((s) => ({ ...s, [nid]: 'sending' }));
    if (!(await flush())) { setTestState((s) => ({ ...s, [nid]: 'yc.scn.test.err.save' })); return; }
    const ev = n.event === 'fixed' && typeof n.event_id === 'string' ? n.event_id : n.event === 'none' ? null : nextNight;
    try {
      if (n.type === 'email') {
        const r = await testScenarioEmail(id, nid, ev);
        setTestState((s) => ({ ...s, [nid]: r.ok ? 'ok' : r.code === 'demo' ? 'yc.scn.test.err.demo' : 'yc.scn.test.err.failed' }));
      } else {
        await testScenarioSms(id, nid, ev);
        setTestState((s) => ({ ...s, [nid]: 'ok' }));
      }
    } catch (e) {
      setTestState((s) => ({ ...s, [nid]: smsErrorKey(e) }));
    }
  };
  const openTest = async (nid?: string) => {
    await flush();
    setTesting(true);
    if (nid) void sendTest(nid);
  };
  const publish = async () => {
    try {
      const r = await act.publish(id, expected.current);
      if (r.ok) {
        setStatus('active');
        setPublishing(false);
        toast(t('yc.scn.ed.published'));
        void q.refetch();
      }
      return { ok: r.ok, errors: r.errors };
    } catch (e) {
      const c = scnErrorCode(e);
      toast(t(c === 'support_session' ? 'yc.scn.err.support' : c === 'draft_changed' ? 'yc.scn.ed.conflict' : 'yc.scn.err.generic'));
      return { ok: false };
    }
  };
  const setLive = async (next: 'active' | 'paused') => {
    setBusy(true);
    try {
      await act.setStatus(id, next);
      setStatus(next);
      toast(t(next === 'paused' ? 'yc.scn.ed.paused' : 'yc.scn.ed.resumed'));
    } catch (e) {
      const c = scnErrorCode(e);
      toast(t(c === 'support_session' ? 'yc.scn.err.support' : 'yc.scn.err.generic'));
    } finally { setBusy(false); }
  };

  const messages = order.filter((x) => graph.nodes[x]?.type === 'email' || graph.nodes[x]?.type === 'sms').map((x) => {
    const n = graph.nodes[x];
    return {
      id: x, type: n.type, label: nodeLabel(x), line: nodeSummary(T, n, textCtx),
      ready: n.type === 'email' ? typeof n.template_id === 'string' && !!n.template_id : typeof n.body === 'string' && !!n.body.trim(),
    };
  });
  const hasChanges = dirty || (published && JSON.stringify(graph) !== JSON.stringify(d.live?.graph ?? null));

  const inspector = (
    <Inspector
      T={T} graph={graph} setGraph={setGraph} sel={sel} readOnly={readOnly} refs={refs} issues={issues} countEvent={hasEvent ? nextNight : null}
      stats={results && sel.kind === 'node' ? report.data?.nodes?.[sel.id] ?? null : null}
      onDelete={remove} onTest={(nid) => void openTest(nid)} onOpenStudio={(tid) => void openStudio(tid)} onCreateEmail={createEmail}
      onClose={narrow ? () => setSheet(false) : undefined}
    />
  );

  const saveLabel = save === 'saving' ? t('yc.scn.ed.saving') : save === 'error' ? t('yc.scn.ed.saveErr') : save === 'conflict' ? t('yc.scn.ed.conflictShort') : dirty ? t('yc.scn.ed.unsaved') : t('yc.scn.ed.saved');

  return (
    <div style={{ display: 'flex', flexDirection: 'column', minHeight: '100dvh' }}>
      <header style={{ position: 'sticky', top: 0, zIndex: 40, display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: '10px 14px', padding: '12px clamp(12px,2vw,20px)', background: 'rgba(252,250,249,.92)', backdropFilter: 'blur(12px)', WebkitBackdropFilter: 'blur(12px)', borderBottom: '1px solid var(--sand-100)' }}>
        <div style={{ flex: '1 1 260px', minWidth: 0, display: 'flex', alignItems: 'center', gap: 12 }}>
          <Hv as={Link} to={`${CRM_ROUTES.automations}?tab=scenarios`} aria-label={t('yc.scn.ed.back')} title={t('yc.scn.ed.back')}
            style={{ flex: 'none', width: 40, height: 40, borderRadius: 99, border: '1px solid var(--sand-200)', background: '#fff', color: 'var(--ink)', display: 'grid', placeItems: 'center' }} hover={{ background: 'var(--sand-50)', color: 'var(--ink)' }}>
            <Icon name="arrowLeft" size={17} stroke={2.3} />
          </Hv>
          <div style={{ minWidth: 0, flex: 1, display: 'flex', flexDirection: 'column', gap: 2 }}>
            <input value={name} disabled={readOnly} maxLength={80} aria-label={t('yc.scn.ed.name')}
              onChange={(e) => { setName(e.target.value); setDirty(true); }}
              style={{ minWidth: 0, width: '100%', border: 0, background: 'transparent', outline: 'none', padding: 0, fontFamily: 'var(--font-display)', fontWeight: 600, fontSize: 18, letterSpacing: '-.02em', color: 'var(--ink)', textOverflow: 'ellipsis' }} />
            <span style={{ display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: 8, fontSize: 12.5, color: 'var(--sand-500)' }}>
              <StateBadge state={state} label={t(`yc.scn.state.${state}`)} />
              {published && hasChanges && <span style={{ color: 'var(--amber-700)', fontWeight: 600 }}>{t('yc.scn.ed.changes')}</span>}
              {d.ai_author && <span style={{ display: 'inline-flex', alignItems: 'center', gap: 4, fontWeight: 600 }}><Icon name="sparkles" size={12} stroke={2.2} />{t('yc.scn.byAi', { ai: d.ai_author })}</span>}
              {!readOnly && <span>{saveLabel}</span>}
              {readOnly && <span>{t('yc.scn.ed.readOnly')}</span>}
            </span>
          </div>
        </div>
        <div style={{ display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: 8, justifyContent: 'flex-end', marginLeft: 'auto' }}>
          {published && <SmallButton tone={results ? 'dark' : 'light'} icon="chart" onClick={() => setResults((v) => !v)}>{t('yc.scn.ed.results')}</SmallButton>}
          {!narrow && <SmallButton icon="send" onClick={() => void openTest()}>{t('yc.scn.ed.test')}</SmallButton>}
          {d.can_edit && published && status === 'active' && <SmallButton icon="pause" disabled={busy} onClick={() => void setLive('paused')}>{t('yc.scn.ed.pause')}</SmallButton>}
          {d.can_edit && published && status === 'paused' && !hasChanges && <SmallButton icon="play" disabled={busy || !d.can_publish} onClick={() => void setLive('active')}>{t('yc.scn.ed.resume')}</SmallButton>}
          {!readOnly && (!published || hasChanges || status !== 'active') && (status !== 'paused' || hasChanges) && (
            <CtaButton size="sm" icon="check" onClick={async () => { await flush(); setPublishing(true); }}>
              {t(published ? 'yc.scn.ed.publishChanges' : 'yc.scn.ed.publish')}{blocking > 0 ? ` · ${blocking}` : ''}
            </CtaButton>
          )}
        </div>
      </header>

      {save === 'conflict' && (
        <div style={{ display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: 10, padding: '10px 20px', background: 'var(--amber-50)', color: 'var(--amber-700)', fontSize: 14, fontWeight: 500 }}>
          <span style={{ flex: 1, minWidth: 200 }}>{t('yc.scn.ed.conflict')}</span>
          <SmallButton onClick={() => window.location.reload()}>{t('yc.scn.ed.reload')}</SmallButton>
        </div>
      )}
      {(state === 'frozen' || state === 'plan_paused') && (
        <div style={{ padding: '10px 20px', background: 'var(--amber-50)', color: 'var(--amber-700)', fontSize: 14, fontWeight: 500 }}>{t(`yc.scn.ed.${state}`)}</div>
      )}

      <div ref={bodyRef} style={{ height, display: 'flex', minHeight: 0 }}>
        <div style={{ flex: 1, minWidth: 0, overflowY: 'auto', overflowX: 'hidden', padding: 'clamp(16px,3vw,32px) clamp(14px,3vw,32px)' }}>
          {results && report.data && (
            <div style={{ maxWidth: 520, margin: '0 auto 24px' }}>
              <ReportSummary T={T} r={report.data} entered={row?.entered ?? 0} goal={row?.goal ?? 0} />
            </div>
          )}
          <FlowView
            T={T} graph={graph} layout={layout} sel={narrow && !sheet ? null : sel} onSelect={select} readOnly={readOnly} issues={issues}
            report={results ? report.data ?? null : null} nodeLabel={nodeLabel}
            nodeLine={(nid) => nodeSummary(T, graph.nodes[nid], textCtx)} start={start}
            onInsert={(at, allowEnd) => setAdding({ at, allowEnd })}
          />
        </div>
        {!narrow && (
          <aside style={{ flex: 'none', width: 'min(400px, 42vw)', borderLeft: '1px solid var(--sand-100)', background: '#fff', minHeight: 0, display: 'flex', flexDirection: 'column' }}>
            {inspector}
          </aside>
        )}
      </div>

      {narrow && (
        <Sheet open={sheet} onClose={() => setSheet(false)} width={520} label={t('yc.scn.ed.inspector')}>
          {inspector}
        </Sheet>
      )}
      {adding && <AddStepModal T={T} allowEnd={adding.allowEnd} onPick={insert} onClose={() => setAdding(null)} />}
      {publishing && (
        <PublishModal
          T={T} id={id} live={published && status === 'active'} hasChanges={hasChanges || !published || status !== 'active'}
          holdout={graph.entry?.holdout !== false} balance={Number(shell.data?.wallet.balance ?? 0)} nodeLabel={nodeLabel}
          onGoto={(nid) => { setPublishing(false); select(nid ? { kind: 'node', id: nid } : { kind: 'start' }); }}
          onPublish={publish} onClose={() => setPublishing(false)}
        />
      )}
      {testing && <TestModal T={T} messages={messages} state={testState} onSend={(nid) => void sendTest(nid)} onClose={() => setTesting(false)} />}
      {narrow && !readOnly && (
        <div style={{ position: 'fixed', left: 0, right: 0, bottom: 0, zIndex: 30, display: 'flex', justifyContent: 'center', padding: '10px 16px calc(10px + env(safe-area-inset-bottom))', pointerEvents: 'none' }}>
          <span style={{ pointerEvents: 'auto' }}><SmallButton tone="dark" icon="send" onClick={() => void openTest()}>{t('yc.scn.ed.test')}</SmallButton></span>
        </div>
      )}
    </div>
  );
}
