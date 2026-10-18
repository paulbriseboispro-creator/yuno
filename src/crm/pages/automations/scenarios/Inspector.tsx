/**
 * L'inspecteur de l'éditeur de scénario (à droite ; en volet au téléphone) :
 * le départ (déclencheur, qui entre, objectif) ou l'étape choisie. Chaque
 * réglage écrit dans le brouillon ; la validation (miroir du serveur) dit
 * aussitôt ce qui manque, champ par champ.
 */
import { useMemo, useRef, useState, type ReactNode } from 'react';
import { Hv } from '@/crm/ui/Hv';
import { Icon } from '@/crm/ui/Icon';
import { Switch } from '@/crm/ui/kit';
import { countSms, smsFinalText, SAMPLE_LINK } from '@/crm/lib/sms';
import { EVENT_TRIGGERS, SOON_TRIGGERS, TRIGGERS, type ScenarioGraph } from '@/crm/lib/scenarioGraph';
import { isCondGroup, type CondGroup } from '@/crm/lib/scenarioConditions';
import type { ScnIssue, ScnNodeStats } from '@/crm/data/scenarios';
import type { CrmTemplateKind } from '@/crm/lib/emailTemplates';
import { ConditionEditor, type CondRefs } from './ConditionEditor';
import { WARN_CODES, errorText, type T } from './scnText';
import { Chips, Field, NodeGlyph, Note, NumberInput, SelectBox, SmallButton, TextInput } from './scnUi';

type GNode = Record<string, unknown> & { type: string };

export type Selection = { kind: 'start' } | { kind: 'node'; id: string };

export interface InspectorRefs extends CondRefs {
  templates: { id: string; name: string }[];
  pages: { id: string; title: string }[];
  holdoutPct: number;
  rates: { email: number; fr: number; intl: number };
  senderName: string;
  venueName: string;
  nodeLabel: (id: string) => string;
}

/** Sortes d'e-mail qu'une étape peut créer (constructeur des modèles CRM). */
const NEW_EMAIL_KINDS: CrmTemplateKind[] = ['annonce', 'lastcall', 'retour', 'manque', 'merci', 'bienvenue', 'relance', 'vide'];

export function Inspector({
  T, graph, setGraph, sel, readOnly, refs, issues, countEvent, stats, onDelete, onTest, onOpenStudio, onCreateEmail, onClose,
}: {
  T: T; graph: ScenarioGraph; setGraph: (fn: (g: ScenarioGraph) => ScenarioGraph) => void; sel: Selection; readOnly: boolean;
  refs: InspectorRefs; issues: ScnIssue[]; countEvent: string | null; stats: ScnNodeStats | null;
  onDelete: (id: string) => void; onTest: (id: string) => void; onOpenStudio: (templateId: string) => void;
  onCreateEmail: (nodeId: string, kind: CrmTemplateKind) => Promise<void>; onClose?: () => void;
}) {
  const { t } = T;
  if (sel.kind === 'start') {
    return (
      <Shell T={T} title={t('yc.scn.start.title')} glyph={<span style={{ flex: 'none', width: 34, height: 34, borderRadius: 11, background: 'var(--ink)', color: '#fff', display: 'grid', placeItems: 'center' }}><Icon name="zap" size={16} stroke={2.2} /></span>} onClose={onClose}>
        <IssueList T={T} issues={issues.filter((e) => e.node === null && !(e.field ?? '').startsWith('nodes'))} />
        <StartEditor T={T} graph={graph} setGraph={setGraph} readOnly={readOnly} refs={refs} countEvent={countEvent} />
      </Shell>
    );
  }
  const node = graph.nodes[sel.id];
  if (!node) return null;
  const setNode = (patch: Record<string, unknown>) => setGraph((g) => ({ ...g, nodes: { ...g.nodes, [sel.id]: { ...g.nodes[sel.id], ...patch } } }));
  const own = issues.filter((e) => e.node === sel.id);
  return (
    <Shell T={T} title={refs.nodeLabel(sel.id)} glyph={<NodeGlyph type={node.type} />} onClose={onClose}
      actions={!readOnly && node.type !== 'end' ? <SmallButton tone="danger" icon="trash" title={t('yc.scn.node.delete')} onClick={() => onDelete(sel.id)} /> : null}>
      {stats && <NodeStats T={T} type={node.type} s={stats} />}
      <IssueList T={T} issues={own} />
      <NodeEditor T={T} id={sel.id} node={node} setNode={setNode} graph={graph} readOnly={readOnly} refs={refs} countEvent={countEvent}
        onTest={onTest} onOpenStudio={onOpenStudio} onCreateEmail={onCreateEmail} />
    </Shell>
  );
}

function Shell({ T, title, glyph, children, actions, onClose }: { T: T; title: string; glyph: ReactNode; children: ReactNode; actions?: ReactNode; onClose?: () => void }) {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', minHeight: 0, height: '100%' }}>
      <div style={{ flex: 'none', display: 'flex', alignItems: 'center', gap: 12, padding: '16px 18px', borderBottom: '1px solid var(--sand-100)' }}>
        {glyph}
        <span style={{ flex: 1, minWidth: 0, fontFamily: 'var(--font-display)', fontWeight: 600, fontSize: 18, letterSpacing: '-.02em', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{title}</span>
        {actions}
        {onClose && <SmallButton tone="ghost" icon="x" title={T.t('yc.scn.close')} onClick={onClose} />}
      </div>
      <div style={{ flex: 1, minHeight: 0, overflowY: 'auto', padding: 18, display: 'flex', flexDirection: 'column', gap: 18 }}>{children}</div>
    </div>
  );
}

function IssueList({ T, issues }: { T: T; issues: ScnIssue[] }) {
  if (!issues.length) return null;
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
      {issues.map((e) => <Note key={`${e.code}:${e.field}`} tone={WARN_CODES.has(e.code) ? 'warn' : 'error'}>{errorText(T, e)}</Note>)}
    </div>
  );
}

function Section({ title, children, hint }: { title: string; children: ReactNode; hint?: ReactNode }) {
  return (
    <section style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
        <span style={{ fontFamily: 'var(--font-mono)', fontSize: 11.5, letterSpacing: '.08em', textTransform: 'uppercase', color: 'var(--sand-500)' }}>{title}</span>
        {hint && <span style={{ fontSize: 13, lineHeight: 1.45, color: 'var(--sand-600)', textWrap: 'pretty' }}>{hint}</span>}
      </div>
      {children}
    </section>
  );
}

// ── Le départ ──────────────────────────────────────────────────────────────

const TRIGGER_DEFAULTS: Record<string, Record<string, unknown>> = {
  before_event: { days: 7 }, after_event: { hours: 24, who: 'entered' }, absence: { days: 90 }, click_no_buy: { hours: 24 },
  ticket_bought: { first: false }, segment_joined: { segment_id: '' }, manual_segment: { segment_id: '' }, signup_confirmed: { page_id: '' },
  event_published: {}, chance_high: {},
};

function StartEditor({ T, graph, setGraph, readOnly, refs, countEvent }: {
  T: T; graph: ScenarioGraph; setGraph: (fn: (g: ScenarioGraph) => ScenarioGraph) => void; readOnly: boolean; refs: InspectorRefs; countEvent: string | null;
}) {
  const { t } = T;
  const tr = graph.trigger ?? { type: '' };
  const hasEvent = (EVENT_TRIGGERS as readonly string[]).includes(tr.type);
  const setTrigger = (patch: Record<string, unknown>) => setGraph((g) => ({ ...g, trigger: { ...g.trigger, ...patch } }));
  const changeType = (type: string) => setGraph((g) => {
    const ev = (EVENT_TRIGGERS as readonly string[]).includes(type);
    const re = g.entry?.reentry ?? { mode: 'once' };
    return {
      ...g,
      trigger: { type, ...(TRIGGER_DEFAULTS[type] ?? {}) },
      // Sans soirée, « une fois par soirée » et « achète CETTE soirée » n'ont plus de sens.
      entry: { ...g.entry, reentry: !ev && re.mode === 'per_event' ? { mode: 'once' } : re },
      goal: !ev && g.goal && g.goal.type !== 'bought_any' ? { type: 'bought_any' } : g.goal,
    };
  });
  const filter = isCondGroup(graph.entry?.filter) ? graph.entry.filter as CondGroup : null;
  const re = graph.entry?.reentry ?? { mode: 'once' };
  const trigOptions = [
    ...TRIGGERS.map((x) => ({ value: x as string, label: t(`yc.scn.trg.${x}`) })),
    ...SOON_TRIGGERS.map((x) => ({ value: x as string, label: `${t(`yc.scn.trg.${x}`)} · ${t('yc.scn.soon')}`, disabled: true })),
  ];
  return (
    <>
      <Section title={t('yc.scn.start.when')}>
        <SelectBox value={tr.type} options={trigOptions} onChange={changeType} disabled={readOnly} ariaLabel={t('yc.scn.start.when')} />
        <span style={{ fontSize: 13, lineHeight: 1.45, color: 'var(--sand-600)', textWrap: 'pretty' }}>{t(tr.type ? `yc.scn.trg.${tr.type}.d` : 'yc.scn.trg.pick')}</span>
        {tr.type === 'before_event' && (
          <>
            <Field label={t('yc.scn.f.days')}><NumberInput value={tr.days as number} onChange={(v) => setTrigger({ days: v })} min={1} max={60} disabled={readOnly} suffix={t('yc.scn.unit.daysBefore')} /></Field>
            <Field label={t('yc.scn.f.series')} hint={t('yc.scn.f.series.h')}>
              <TextInput value={typeof tr.series === 'string' ? tr.series : ''} onChange={(v) => setTrigger({ series: v.trim() ? v : null })} disabled={readOnly} maxLength={300} placeholder={t('yc.scn.ph.optional')} />
            </Field>
          </>
        )}
        {tr.type === 'after_event' && (
          <>
            <Field label={t('yc.scn.f.hours')}><NumberInput value={tr.hours as number} onChange={(v) => setTrigger({ hours: v })} min={1} max={720} disabled={readOnly} suffix={t('yc.scn.unit.hoursAfter')} /></Field>
            <Field label={t('yc.scn.f.who')} hint={tr.who === 'absent_buyers' ? t('yc.scn.f.who.absentHint') : undefined}>
              <Chips value={String(tr.who ?? 'entered')} options={['entered', 'absent_buyers', 'all'].map((x) => ({ value: x, label: t(`yc.scn.v.who.${x}`) }))} onChange={(v) => setTrigger({ who: v })} disabled={readOnly} />
            </Field>
          </>
        )}
        {tr.type === 'absence' && <Field label={t('yc.scn.f.days')}><NumberInput value={tr.days as number} onChange={(v) => setTrigger({ days: v })} min={14} max={730} disabled={readOnly} suffix={t('yc.scn.unit.daysAbsent')} /></Field>}
        {tr.type === 'click_no_buy' && <Field label={t('yc.scn.f.hours')}><NumberInput value={tr.hours as number} onChange={(v) => setTrigger({ hours: v })} min={1} max={72} disabled={readOnly} suffix={t('yc.scn.unit.hoursAfterClick')} /></Field>}
        {tr.type === 'ticket_bought' && (
          <>
            <Field label={t('yc.scn.f.first')}>
              <Chips value={tr.first ? 'y' : 'n'} options={[{ value: 'n', label: t('yc.scn.f.first.any') }, { value: 'y', label: t('yc.scn.f.first.first') }]} onChange={(v) => setTrigger({ first: v === 'y' })} disabled={readOnly} />
            </Field>
            <Field label={t('yc.scn.f.series')} hint={t('yc.scn.f.series.h')}>
              <TextInput value={typeof tr.series === 'string' ? tr.series : ''} onChange={(v) => setTrigger({ series: v.trim() ? v : null })} disabled={readOnly} maxLength={300} placeholder={t('yc.scn.ph.optional')} />
            </Field>
          </>
        )}
        {(tr.type === 'segment_joined' || tr.type === 'manual_segment') && (
          <Field label={t('yc.scn.f.segment_id')}>
            <SelectBox value={typeof tr.segment_id === 'string' ? tr.segment_id : ''} placeholder={t('yc.scn.ph.segment')} options={refs.segments.map((s) => ({ value: s.id, label: s.name }))} onChange={(v) => setTrigger({ segment_id: v })} disabled={readOnly} />
          </Field>
        )}
        {tr.type === 'signup_confirmed' && (
          <Field label={t('yc.scn.f.page_id')} hint={refs.pages.length ? undefined : t('yc.scn.f.page_id.none')}>
            <SelectBox value={typeof tr.page_id === 'string' ? tr.page_id : ''} placeholder={t('yc.scn.ph.page')} options={refs.pages.map((p) => ({ value: p.id, label: p.title }))} onChange={(v) => setTrigger({ page_id: v })} disabled={readOnly} />
          </Field>
        )}
      </Section>

      <Section title={t('yc.scn.start.who')} hint={t('yc.scn.start.whoHint')}>
        <ConditionEditor tree={filter} allowEmpty ctx="entry" refs={{ ...refs, hasEvent }} countEvent={hasEvent ? countEvent : null} readOnly={readOnly}
          onChange={(f) => setGraph((g) => ({ ...g, entry: { ...g.entry, filter: f } }))} />
      </Section>

      <Section title={t('yc.scn.start.again')}>
        <Chips
          value={re.mode}
          options={[
            { value: 'once', label: t('yc.scn.re.once') },
            { value: 'per_event', label: t('yc.scn.re.per_event'), disabled: !hasEvent },
            { value: 'every_days', label: t('yc.scn.re.every_days') },
          ]}
          onChange={(v) => setGraph((g) => ({ ...g, entry: { ...g.entry, reentry: v === 'every_days' ? { mode: 'every_days', days: 60 } : { mode: v as 'once' | 'per_event' } } }))}
          disabled={readOnly}
        />
        {re.mode === 'every_days' && (
          <NumberInput value={re.days ?? 60} onChange={(v) => setGraph((g) => ({ ...g, entry: { ...g.entry, reentry: { mode: 'every_days', days: v } } }))} min={7} max={365} disabled={readOnly} suffix={t('yc.scn.unit.daysMin')} />
        )}
        <span style={{ fontSize: 12.5, lineHeight: 1.45, color: 'var(--sand-500)' }}>{t('yc.scn.re.note')}</span>
      </Section>

      <Section title={t('yc.scn.start.goal')} hint={t('yc.scn.start.goalHint')}>
        <Chips
          value={graph.goal?.type ?? 'none'}
          options={[
            { value: 'bought_event', label: t('yc.scn.goal.bought_event'), disabled: !hasEvent },
            { value: 'bought_any', label: t('yc.scn.goal.bought_any') },
            { value: 'entered', label: t('yc.scn.goal.entered'), disabled: !hasEvent },
            { value: 'none', label: t('yc.scn.goal.none') },
          ]}
          onChange={(v) => setGraph((g) => ({ ...g, goal: v === 'none' ? null : { type: v as 'bought_event' | 'bought_any' | 'entered' } }))}
          disabled={readOnly}
        />
      </Section>

      <Section title={t('yc.scn.start.holdout')}>
        <div style={{ display: 'flex', alignItems: 'flex-start', gap: 12 }}>
          <Switch on={graph.entry?.holdout !== false} onChange={(v) => setGraph((g) => ({ ...g, entry: { ...g.entry, holdout: v } }))} disabled={readOnly} label={t('yc.scn.start.holdout')} />
          <span style={{ fontSize: 13, lineHeight: 1.45, color: 'var(--sand-600)', textWrap: 'pretty' }}>
            {refs.holdoutPct > 0 ? t('yc.scn.holdout.on', { pct: refs.holdoutPct }) : t('yc.scn.holdout.zero')}
          </span>
        </div>
      </Section>
    </>
  );
}

// ── Une étape ──────────────────────────────────────────────────────────────

function NodeEditor({ T, id, node, setNode, graph, readOnly, refs, countEvent, onTest, onOpenStudio, onCreateEmail }: {
  T: T; id: string; node: GNode; setNode: (p: Record<string, unknown>) => void; graph: ScenarioGraph; readOnly: boolean; refs: InspectorRefs;
  countEvent: string | null; onTest: (id: string) => void; onOpenStudio: (tpl: string) => void; onCreateEmail: (nodeId: string, kind: CrmTemplateKind) => Promise<void>;
}) {
  const { t } = T;
  const hasEvent = (EVENT_TRIGGERS as readonly string[]).includes(graph.trigger?.type ?? '');
  const cond = isCondGroup(node.cond) ? node.cond as CondGroup : null;
  switch (node.type) {
    case 'wait': {
      const mode = String(node.mode ?? 'duration');
      const setMode = (m: string) => {
        if (m === 'duration') setNode({ mode: 'duration', hours: 48, anchor: undefined, days: undefined, at: undefined, cond: undefined, max_hours: undefined, timeout: undefined });
        else if (m === 'until_event') setNode({ mode: 'until_event', anchor: 'start', days: -1, at: '18:00', hours: undefined, cond: undefined, max_hours: undefined, timeout: undefined });
        else setNode({ mode: 'until_cond', cond: { op: 'and', items: [] }, max_hours: 72, timeout: node.next, hours: undefined, anchor: undefined, days: undefined, at: undefined });
      };
      return (
        <>
          <Section title={t('yc.scn.wait.mode')}>
            <Chips value={mode} options={[
              { value: 'duration', label: t('yc.scn.wait.m.duration') },
              { value: 'until_event', label: t('yc.scn.wait.m.until_event'), disabled: !hasEvent },
              { value: 'until_cond', label: t('yc.scn.wait.m.until_cond') },
            ]} onChange={(v) => setMode(v as string)} disabled={readOnly} />
          </Section>
          {mode === 'duration' && <DurationField T={T} hours={Number(node.hours ?? 0)} onChange={(h) => setNode({ hours: h })} min={1} max={2160} readOnly={readOnly} label={t('yc.scn.wait.howLong')} />}
          {mode === 'until_event' && (
            <Section title={t('yc.scn.wait.untilWhen')} hint={t('yc.scn.wait.untilHint')}>
              <Field label={t('yc.scn.f.anchor')}>
                <Chips value={String(node.anchor ?? 'start')} options={['start', 'end', 'sale_open'].map((x) => ({ value: x, label: t(`yc.scn.anchor.${x}.l`) }))} onChange={(v) => setNode({ anchor: v })} disabled={readOnly} />
              </Field>
              <Chips value={typeof node.hours === 'number' ? 'h' : 'd'} options={[{ value: 'd', label: t('yc.scn.wait.byDay') }, { value: 'h', label: t('yc.scn.wait.byHours') }]}
                onChange={(v) => setNode(v === 'h' ? { hours: -24, days: undefined, at: undefined } : { hours: undefined, days: -1, at: '18:00' })} disabled={readOnly} />
              {typeof node.hours === 'number' ? (
                <Field label={t('yc.scn.f.hourOffset')} hint={t('yc.scn.f.hourOffset.h')}>
                  <NumberInput value={node.hours} onChange={(v) => setNode({ hours: v })} min={-720} max={720} disabled={readOnly} suffix={t('yc.scn.unit.hourOffset')} width={90} />
                </Field>
              ) : (
              <div style={{ display: 'flex', flexWrap: 'wrap', gap: 12, alignItems: 'flex-end' }}>
                <Field label={t('yc.scn.f.dayOffset')}>
                  <NumberInput value={typeof node.days === 'number' ? node.days : 0} onChange={(v) => setNode({ days: v, hours: undefined })} min={-60} max={60} disabled={readOnly} suffix={t('yc.scn.unit.dayOffset')} width={90} />
                </Field>
                <Field label={t('yc.scn.f.at')}>
                  <input className="yc-field" type="time" value={typeof node.at === 'string' ? node.at : '18:00'} disabled={readOnly} onChange={(e) => setNode({ at: e.target.value.slice(0, 5), hours: undefined })}
                    style={{ height: 42, boxSizing: 'border-box', padding: '0 12px', borderRadius: 12, border: '1px solid var(--sand-200)', fontSize: 14.5, outline: 'none' }} />
                </Field>
              </div>
              )}
            </Section>
          )}
          {mode === 'until_cond' && (
            <>
              <Section title={t('yc.scn.wait.untilCondT')} hint={t('yc.scn.wait.untilCondH')}>
                <ConditionEditor tree={cond} ctx="step" refs={{ ...refs, hasEvent }} countEvent={hasEvent ? countEvent : null} readOnly={readOnly} onChange={(c) => setNode({ cond: c ?? { op: 'and', items: [] } })} />
              </Section>
              <DurationField T={T} hours={Number(node.max_hours ?? 0)} onChange={(h) => setNode({ max_hours: h })} min={1} max={744} readOnly={readOnly} label={t('yc.scn.wait.maxWait')} />
            </>
          )}
        </>
      );
    }
    case 'branch':
      return (
        <Section title={t('yc.scn.branch.t')} hint={t('yc.scn.branch.h')}>
          <ConditionEditor tree={cond} ctx="step" refs={{ ...refs, hasEvent }} countEvent={hasEvent ? countEvent : null} readOnly={readOnly} onChange={(c) => setNode({ cond: c ?? { op: 'and', items: [] } })} />
        </Section>
      );
    case 'split': {
      const paths = (Array.isArray(node.paths) ? node.paths : []) as { pct?: number; next?: string }[];
      const sum = paths.reduce((a, p) => a + (typeof p.pct === 'number' ? p.pct : 0), 0);
      const end = Object.keys(graph.nodes).find((k) => graph.nodes[k].type === 'end') ?? '';
      return (
        <Section title={t('yc.scn.split.t')} hint={t('yc.scn.split.h')}>
          {paths.map((p, i) => (
            <div key={i} style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
              <span style={{ width: 28, height: 28, borderRadius: 99, background: 'var(--sand-100)', display: 'grid', placeItems: 'center', fontSize: 13, fontWeight: 700 }}>{String.fromCharCode(65 + i)}</span>
              <NumberInput value={p.pct ?? 0} onChange={(v) => setNode({ paths: paths.map((x, j) => (j === i ? { ...x, pct: v } : x)) })} min={1} max={99} disabled={readOnly} suffix="%" width={80} />
              {!readOnly && paths.length > 2 && <SmallButton tone="ghost" icon="x" title={t('yc.scn.split.rm')} onClick={() => setNode({ paths: paths.filter((_, j) => j !== i) })} />}
            </div>
          ))}
          <span style={{ fontSize: 13, fontWeight: 600, color: sum === 100 ? 'var(--green-700)' : 'var(--red-700)' }}>{t('yc.scn.split.sum', { n: sum })}</span>
          {!readOnly && paths.length < 4 && <SmallButton icon="plus" onClick={() => setNode({ paths: [...paths, { pct: 0, next: paths[paths.length - 1]?.next ?? end }] })}>{t('yc.scn.split.add')}</SmallButton>}
        </Section>
      );
    }
    case 'email':
      return <EmailEditor T={T} id={id} node={node} setNode={setNode} readOnly={readOnly} refs={refs} hasEvent={hasEvent} onTest={onTest} onOpenStudio={onOpenStudio} onCreateEmail={onCreateEmail} />;
    case 'sms':
      return <SmsEditor T={T} id={id} node={node} setNode={setNode} readOnly={readOnly} refs={refs} hasEvent={hasEvent} onTest={onTest} />;
    case 'tag':
      return (
        <Section title={t('yc.scn.tag.t')} hint={t('yc.scn.tag.h')}>
          <Chips value={String(node.op ?? 'add')} options={[{ value: 'add', label: t('yc.scn.tag.add') }, { value: 'remove', label: t('yc.scn.tag.remove') }]} onChange={(v) => setNode({ op: v })} disabled={readOnly} />
          <TextInput value={String(node.tag ?? '')} onChange={(v) => setNode({ tag: v })} disabled={readOnly} maxLength={40} placeholder={t('yc.scn.ph.tag')} ariaLabel={t('yc.scn.tag.t')} />
        </Section>
      );
    case 'notify':
      return (
        <Section title={t('yc.scn.notify.t')} hint={t('yc.scn.notify.h')}>
          <TextInput value={String(node.label ?? '')} onChange={(v) => setNode({ label: v })} disabled={readOnly} maxLength={80} placeholder={t('yc.scn.ph.notify')} ariaLabel={t('yc.scn.notify.t')} />
        </Section>
      );
    case 'instagram_dm':
      return <Note tone="info">{t('yc.scn.ig.soon')}</Note>;
    case 'end':
      return <Note tone="info">{t('yc.scn.end.h')}</Note>;
    default:
      return null;
  }
}

function DurationField({ T, hours, onChange, min, max, readOnly, label }: { T: T; hours: number; onChange: (h: number) => void; min: number; max: number; readOnly: boolean; label: string }) {
  const { t } = T;
  const [unit, setUnit] = useState<'h' | 'd'>(hours > 0 && hours % 24 === 0 ? 'd' : 'h');
  const shown = unit === 'd' ? Math.round(hours / 24) : hours;
  return (
    <Field label={label}>
      <div style={{ display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: 10 }}>
        <NumberInput value={shown} onChange={(v) => onChange(Math.min(max, Math.max(min, unit === 'd' ? v * 24 : v)))} min={1} max={unit === 'd' ? Math.floor(max / 24) : max} disabled={readOnly} width={90} />
        <Chips value={unit} options={[{ value: 'h', label: t('yc.scn.unit.h') }, { value: 'd', label: t('yc.scn.unit.d') }]} onChange={(v) => {
          const u = v as 'h' | 'd';
          setUnit(u);
          if (u === 'd') onChange(Math.min(max, Math.max(24, Math.round(hours / 24) * 24)));
        }} disabled={readOnly} />
      </div>
    </Field>
  );
}

function EventModeField({ T, node, setNode, readOnly, refs, hasEvent, allowNone }: {
  T: T; node: GNode; setNode: (p: Record<string, unknown>) => void; readOnly: boolean; refs: InspectorRefs; hasEvent: boolean; allowNone: boolean;
}) {
  const { t, dShort } = T;
  const mode = String(node.event ?? 'scenario');
  const upcoming = refs.nights.filter((e) => e.upcoming);
  return (
    <Field label={t('yc.scn.evmode.t')} hint={t(`yc.scn.evmode.${mode}.h`)}>
      <Chips
        value={mode}
        options={[
          { value: 'scenario', label: t('yc.scn.evmode.scenario'), disabled: !hasEvent },
          { value: 'for_person', label: t('yc.scn.evmode.for_person') },
          { value: 'fixed', label: t('yc.scn.evmode.fixed') },
          ...(allowNone ? [{ value: 'none', label: t('yc.scn.evmode.none') }] : []),
        ]}
        onChange={(v) => setNode({ event: v, event_id: v === 'fixed' ? (upcoming[0]?.id ?? '') : undefined })}
        disabled={readOnly}
      />
      {mode === 'fixed' && (
        <SelectBox value={typeof node.event_id === 'string' ? node.event_id : ''} placeholder={t('yc.scn.ph.night')} options={upcoming.map((e) => ({ value: e.id, label: `${e.title} · ${dShort(e.start_at)}` }))} onChange={(v) => setNode({ event_id: v })} disabled={readOnly} />
      )}
    </Field>
  );
}

function EmailEditor({ T, id, node, setNode, readOnly, refs, hasEvent, onTest, onOpenStudio, onCreateEmail }: {
  T: T; id: string; node: GNode; setNode: (p: Record<string, unknown>) => void; readOnly: boolean; refs: InspectorRefs; hasEvent: boolean;
  onTest: (id: string) => void; onOpenStudio: (tpl: string) => void; onCreateEmail: (nodeId: string, kind: CrmTemplateKind) => Promise<void>;
}) {
  const { t } = T;
  const [kind, setKind] = useState<CrmTemplateKind>('annonce');
  const [busy, setBusy] = useState(false);
  const tpl = typeof node.template_id === 'string' ? node.template_id : '';
  return (
    <>
      <Section title={t('yc.scn.email.t')} hint={t('yc.scn.email.h')}>
        <Field label={t('yc.scn.email.tpl')}>
          <SelectBox value={tpl} placeholder={t('yc.scn.ph.template')} options={refs.templates.map((x) => ({ value: x.id, label: x.name }))} onChange={(v) => setNode({ template_id: v })} disabled={readOnly} />
        </Field>
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8 }}>
          {tpl && <SmallButton icon="edit" onClick={() => onOpenStudio(tpl)}>{t(readOnly ? 'yc.scn.email.read' : 'yc.scn.email.edit')}</SmallButton>}
          {tpl && <SmallButton icon="send" onClick={() => onTest(id)}>{t('yc.scn.test.one')}</SmallButton>}
        </div>
        {!readOnly && (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 8, padding: 12, borderRadius: 14, background: 'var(--sand-50)' }}>
            <span style={{ fontSize: 13, fontWeight: 600 }}>{t('yc.scn.email.new')}</span>
            <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
              <div style={{ flex: '1 1 160px', minWidth: 0 }}>
                <SelectBox value={kind} options={NEW_EMAIL_KINDS.map((k) => ({ value: k, label: t(`yc.scn.email.kind.${k}`) }))} onChange={(v) => setKind(v as CrmTemplateKind)} ariaLabel={t('yc.scn.email.new')} />
              </div>
              <SmallButton tone="dark" icon="plus" disabled={busy} onClick={async () => { setBusy(true); try { await onCreateEmail(id, kind); } finally { setBusy(false); } }}>{t('yc.scn.email.create')}</SmallButton>
            </div>
          </div>
        )}
      </Section>
      <Field label={t('yc.scn.email.subject')} hint={t('yc.scn.email.subjectH')}>
        <TextInput value={typeof node.subject === 'string' ? node.subject : ''} onChange={(v) => setNode({ subject: v.trim() ? v : undefined })} disabled={readOnly} maxLength={140} placeholder={t('yc.scn.ph.subject')} />
      </Field>
      <EventModeField T={T} node={node} setNode={setNode} readOnly={readOnly} refs={refs} hasEvent={hasEvent} allowNone={false} />
      <Note tone="info">{t('yc.scn.rhythm', { e: refs.rates.email })}</Note>
    </>
  );
}

const SMS_TOKENS = ['{{prénom}}', '{{nom_club}}', '{{soirée}}', '{{lien}}'];

function SmsEditor({ T, id, node, setNode, readOnly, refs, hasEvent, onTest }: {
  T: T; id: string; node: GNode; setNode: (p: Record<string, unknown>) => void; readOnly: boolean; refs: InspectorRefs; hasEvent: boolean; onTest: (id: string) => void;
}) {
  const { t, lang } = T;
  const area = useRef<HTMLTextAreaElement | null>(null);
  const body = typeof node.body === 'string' ? node.body : '';
  const count = useMemo(() => countSms(smsFinalText(body, {
    sender: refs.senderName, lang, vals: { 'prénom': t('yc.scn.sms.sampleName'), nom_club: refs.venueName, 'soirée': t('yc.scn.sms.sampleNight'), lien: SAMPLE_LINK },
  })), [body, refs.senderName, refs.venueName, lang, t]);
  const insert = (token: string) => {
    if (readOnly) return;
    const el = area.current;
    const s = el?.selectionStart ?? body.length;
    const e = el?.selectionEnd ?? body.length;
    const before = body.slice(0, s);
    const pad = before && !/\s$/.test(before) ? ' ' : '';
    setNode({ body: `${before}${pad}${token}${body.slice(e)}` });
  };
  return (
    <>
      <Section title={t('yc.scn.sms.t')} hint={t('yc.scn.sms.h')}>
        <textarea ref={area} className="yc-field" value={body} disabled={readOnly} maxLength={480} rows={5} onChange={(e) => setNode({ body: e.target.value })} aria-label={t('yc.scn.sms.t')}
          style={{ width: '100%', boxSizing: 'border-box', padding: '12px 14px', borderRadius: 14, border: '1px solid var(--sand-200)', fontSize: 14.5, lineHeight: 1.5, resize: 'vertical', outline: 'none', font: 'inherit' }} />
        {!readOnly && (
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
            {SMS_TOKENS.map((tk) => (
              <Hv key={tk} as="button" type="button" onClick={() => insert(tk)} style={{ height: 30, padding: '0 11px', borderRadius: 99, border: '1px solid var(--sand-200)', background: '#fff', fontSize: 12.5, fontWeight: 600, cursor: 'pointer', fontFamily: 'var(--font-mono)' }} hover={{ background: 'var(--sand-50)' }}>{tk}</Hv>
            ))}
          </div>
        )}
        <span style={{ fontSize: 12.5, color: 'var(--sand-600)', fontVariantNumeric: 'tabular-nums' }}>
          {T.tp('yc.scn.sms.parts', count.parts, { len: count.length, fr: count.parts * refs.rates.fr, intl: count.parts * refs.rates.intl })}
        </span>
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8 }}>
          {body.trim() && <SmallButton icon="send" onClick={() => onTest(id)}>{t('yc.scn.test.one')}</SmallButton>}
        </div>
      </Section>
      <EventModeField T={T} node={node} setNode={setNode} readOnly={readOnly} refs={refs} hasEvent={hasEvent} allowNone />
      <Note tone="info">{t('yc.scn.sms.rules')}</Note>
    </>
  );
}

function NodeStats({ T, type, s }: { T: T; type: string; s: ScnNodeStats }) {
  const { t, n } = T;
  const cell = (label: string, v: number) => (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 2, minWidth: 0 }}>
      <span style={{ fontSize: 20, fontWeight: 600, fontFamily: 'var(--font-display)', fontVariantNumeric: 'tabular-nums' }}>{n(v)}</span>
      <span style={{ fontSize: 12, color: 'var(--sand-500)' }}>{label}</span>
    </div>
  );
  const msg = type === 'email' || type === 'sms';
  const reasons = Object.entries(s.reasons ?? {}).filter(([, v]) => v > 0).sort((a, b) => b[1] - a[1]);
  return (
    <section style={{ display: 'flex', flexDirection: 'column', gap: 10, padding: 14, borderRadius: 16, background: 'var(--sand-50)' }}>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit,minmax(84px,1fr))', gap: 10 }}>
        {cell(t('yc.scn.rep.entered'), s.entered)}
        {msg ? cell(t('yc.scn.rep.sent'), s.sent + s.would_send) : cell(t('yc.scn.rep.passed'), s.passed)}
        {type === 'email' && cell(t('yc.scn.rep.opened'), s.opened)}
        {type === 'email' && cell(t('yc.scn.rep.clicked'), s.clicked)}
        {msg && s.holdout > 0 && cell(t('yc.scn.rep.holdout'), s.holdout)}
      </div>
      {s.would_send > 0 && <span style={{ fontSize: 12.5, color: 'var(--sand-600)' }}>{t('yc.scn.rep.wouldSend', { n: n(s.would_send) })}</span>}
      {reasons.length > 0 && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
          {reasons.map(([k, v]) => {
            const [st, why] = k.split(':');
            return <span key={k} style={{ fontSize: 12.5, color: st === 'held' ? 'var(--amber-700)' : 'var(--sand-600)' }}>{t(`yc.scn.rep.${st}`, { n: n(v), why: t(`yc.scn.why.${why || 'other'}`) })}</span>;
          })}
        </div>
      )}
    </section>
  );
}

