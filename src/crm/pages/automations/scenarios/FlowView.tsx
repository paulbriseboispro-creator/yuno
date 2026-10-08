/**
 * Le scénario en FLUX VERTICAL (jamais un canevas libre) : le départ, puis
 * les étapes de haut en bas ; une condition, un test A/B ou une attente
 * « jusqu'à » ouvrent des colonnes côte à côte (empilées quand la place
 * manque, au téléphone) qui se rejoignent à l'étape commune. Chaque lien porte
 * un « + » pour poser une étape ; un lien vide se montre « à choisir ».
 */
import { useEffect, useRef, useState, type ReactNode } from 'react';
import { Hv } from '@/crm/ui/Hv';
import { Icon } from '@/crm/ui/Icon';
import type { ScnIssue, ScnReport } from '@/crm/data/scenarios';
import type { Edge, FlowItem, FlowLayout, FlowLane, Inlet } from '@/crm/lib/scenarioEdit';
import type { ScenarioGraph } from '@/crm/lib/scenarioGraph';
import type { T } from './scnText';
import { NodeGlyph } from './scnUi';
import type { Selection } from './Inspector';

const LANE_MIN = 250;

export interface FlowProps {
  T: T;
  graph: ScenarioGraph;
  layout: FlowLayout;
  sel: Selection | null;
  onSelect: (s: Selection) => void;
  readOnly: boolean;
  issues: ScnIssue[];
  report: ScnReport | null;
  nodeLabel: (id: string) => string;
  nodeLine: (id: string) => string;
  start: { trigger: string; who: string; goal: string };
  onInsert: (at: Inlet, allowEnd: boolean) => void;
}

export function FlowView(p: FlowProps) {
  const ref = useRef<HTMLDivElement>(null);
  const [w, setW] = useState(720);
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const ro = new ResizeObserver(() => setW(el.clientWidth));
    ro.observe(el);
    setW(el.clientWidth);
    return () => ro.disconnect();
  }, []);
  const startIssues = p.issues.filter((e) => e.node === null).length;
  return (
    <div ref={ref} style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', minWidth: 0, width: '100%', paddingBottom: 40 }}>
      <StartCard {...p} n={startIssues} />
      <Seq p={p} items={p.layout.items} avail={w} />
      {p.layout.orphans.length > 0 && (
        <div style={{ marginTop: 32, width: '100%', maxWidth: 420, display: 'flex', flexDirection: 'column', gap: 10 }}>
          <span style={{ fontFamily: 'var(--font-mono)', fontSize: 11.5, letterSpacing: '.08em', textTransform: 'uppercase', color: 'var(--sand-500)' }}>{p.T.t('yc.scn.flow.orphans')}</span>
          {p.layout.orphans.map((id) => <NodeCard key={id} p={p} id={id} />)}
        </div>
      )}
    </div>
  );
}

function StartCard(p: FlowProps & { n: number }) {
  const { t } = p.T;
  const on = p.sel?.kind === 'start';
  return (
    <Hv
      as="button" type="button" onClick={() => p.onSelect({ kind: 'start' })} aria-pressed={on}
      style={{
        width: '100%', maxWidth: 420, textAlign: 'left', border: 0, borderRadius: 20, padding: '16px 18px', cursor: 'pointer',
        background: 'var(--ink)', color: '#fff', display: 'flex', flexDirection: 'column', gap: 8,
        boxShadow: on ? '0 0 0 3px var(--red-400), var(--shadow-md)' : 'var(--shadow-sm)', transition: 'box-shadow 160ms',
      }}
      hover={{ boxShadow: on ? '0 0 0 3px var(--red-400), var(--shadow-md)' : 'var(--shadow-md)' }}
    >
      <span style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
        <span style={{ fontFamily: 'var(--font-mono)', fontSize: 11.5, letterSpacing: '.08em', textTransform: 'uppercase', color: 'rgba(255,255,255,.6)' }}>{t('yc.scn.flow.start')}</span>
        {p.n > 0 && <IssueDot n={p.n} />}
      </span>
      <span style={{ fontFamily: 'var(--font-display)', fontSize: 18, fontWeight: 600, letterSpacing: '-.02em', lineHeight: 1.25 }}>{p.start.trigger}</span>
      <span style={{ fontSize: 13.5, lineHeight: 1.45, color: 'rgba(255,255,255,.75)', overflowWrap: 'anywhere' }}><b style={{ color: '#fff' }}>{t('yc.scn.flow.who')}</b> {p.start.who}</span>
      <span style={{ fontSize: 13.5, lineHeight: 1.45, color: 'rgba(255,255,255,.75)' }}><b style={{ color: '#fff' }}>{t('yc.scn.flow.goal')}</b> {p.start.goal}</span>
    </Hv>
  );
}

function IssueDot({ n }: { n: number }) {
  return <span style={{ minWidth: 20, height: 20, padding: '0 6px', boxSizing: 'border-box', borderRadius: 99, background: 'var(--red-500)', color: '#fff', fontSize: 11.5, fontWeight: 700, display: 'grid', placeItems: 'center' }}>{n}</span>;
}

/** Le trait entre deux étapes, avec son « + ». */
function Connector({ p, at, allowEnd = false, plus = true }: { p: FlowProps; at: Inlet | null; allowEnd?: boolean; plus?: boolean }) {
  const show = plus && !p.readOnly && at;
  return (
    <div style={{ position: 'relative', width: 2, height: show ? 40 : 22, background: 'var(--sand-200)', flex: 'none' }}>
      {show && (
        <Hv
          as="button" type="button" onClick={() => p.onInsert(at, allowEnd)} aria-label={p.T.t('yc.scn.flow.add')} title={p.T.t('yc.scn.flow.add')}
          style={{ position: 'absolute', left: '50%', top: '50%', transform: 'translate(-50%,-50%)', width: 24, height: 24, borderRadius: 99, borderWidth: 1, borderStyle: 'solid', borderColor: 'var(--sand-300)', background: '#fff', color: 'var(--sand-600)', display: 'grid', placeItems: 'center', cursor: 'pointer', padding: 0 }}
          hover={{ background: 'var(--ink)', color: '#fff', borderColor: 'var(--ink)' }}
        >
          <Icon name="plus" size={13} stroke={2.6} />
        </Hv>
      )}
    </div>
  );
}

function Seq({ p, items, avail }: { p: FlowProps; items: FlowItem[]; avail: number }) {
  return (
    <>
      {items.map((it, i) => {
        if (it.kind === 'open') {
          return (
            <Wrap key={`open:${i}`}>
              <Connector p={p} at={null} plus={false} />
              <OpenSlot p={p} edge={it.edge} />
            </Wrap>
          );
        }
        if (it.kind === 'goto') {
          return (
            <Wrap key={`goto:${it.target}:${i}`}>
              <Connector p={p} at={it.inlet} />
              <Hv as="button" type="button" onClick={() => p.onSelect({ kind: 'node', id: it.target })}
                style={{ height: 34, padding: '0 14px', borderRadius: 99, borderWidth: 1, borderStyle: 'dashed', borderColor: 'var(--sand-300)', background: '#fff', color: 'var(--sand-700)', fontSize: 13, fontWeight: 600, cursor: 'pointer', display: 'inline-flex', alignItems: 'center', gap: 6 }}
                hover={{ borderColor: 'var(--sand-400)' }}>
                <Icon name="arrowDown" size={13} stroke={2.4} />{p.T.t('yc.scn.flow.goto', { name: p.nodeLabel(it.target) })}
              </Hv>
            </Wrap>
          );
        }
        return (
          <Wrap key={it.id}>
            <Connector p={p} at={it.inlet} />
            <NodeCard p={p} id={it.id} />
            {it.kind === 'fork' && <Lanes p={p} id={it.id} lanes={it.lanes} avail={avail} />}
          </Wrap>
        );
      })}
    </>
  );
}

function Wrap({ children }: { children: ReactNode }) {
  return <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', width: '100%', minWidth: 0 }}>{children}</div>;
}

function laneLabel(p: FlowProps, id: string, lane: FlowLane, i: number): string {
  const { t } = p.T;
  const n = p.graph.nodes[id];
  if (n?.type === 'branch') return t(lane.field === 'yes' ? 'yc.scn.lane.yes' : 'yc.scn.lane.no');
  if (n?.type === 'wait') return t(lane.field === 'timeout' ? 'yc.scn.lane.timeout' : 'yc.scn.lane.met');
  if (n?.type === 'split') {
    const pct = (Array.isArray(n.paths) ? n.paths[i] as { pct?: number } : undefined)?.pct ?? 0;
    return t('yc.scn.lane.path', { l: String.fromCharCode(65 + i), pct });
  }
  return '';
}

function Lanes({ p, id, lanes, avail }: { p: FlowProps; id: string; lanes: FlowLane[]; avail: number }) {
  const row = avail >= lanes.length * LANE_MIN;
  const child = row ? Math.floor((avail - 16 * (lanes.length - 1)) / lanes.length) : avail - 14;
  return (
    <>
      <div style={{ width: 2, height: 16, background: 'var(--sand-200)' }} />
      <div style={{ display: 'flex', flexDirection: row ? 'row' : 'column', alignItems: row ? 'flex-start' : 'stretch', gap: row ? 16 : 14, width: '100%', minWidth: 0, borderTop: row ? '2px solid var(--sand-200)' : 0, paddingTop: row ? 0 : 0 }}>
        {lanes.map((lane, i) => (
          <div key={lane.field} style={{
            flex: row ? '1 1 0' : 'none', minWidth: 0, display: 'flex', flexDirection: 'column', alignItems: 'center',
            ...(row ? {} : { borderLeft: '2px solid var(--sand-200)', paddingLeft: 12, alignItems: 'stretch' }),
          }}>
            <span style={{ alignSelf: row ? 'center' : 'flex-start', marginTop: row ? 10 : 0, height: 24, padding: '0 10px', borderRadius: 99, background: lane.field === 'no' || lane.field === 'timeout' ? 'var(--sand-100)' : 'var(--amber-50)', color: lane.field === 'no' || lane.field === 'timeout' ? 'var(--sand-700)' : 'var(--amber-700)', fontSize: 12, fontWeight: 700, display: 'inline-flex', alignItems: 'center', whiteSpace: 'nowrap' }}>
              {laneLabel(p, id, lane, i)}
            </span>
            <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', width: '100%', minWidth: 0 }}>
              <Seq p={p} items={lane.items} avail={child} />
              {lane.tail && <Connector p={p} at={{ type: 'edge', edge: lane.tail }} />}
            </div>
          </div>
        ))}
      </div>
      {row && <div style={{ width: '100%', height: 2, background: 'var(--sand-200)' }} />}
    </>
  );
}

function OpenSlot({ p, edge }: { p: FlowProps; edge: Edge }) {
  const { t } = p.T;
  return (
    <Hv
      as="button" type="button" disabled={p.readOnly} onClick={() => p.onInsert({ type: 'edge', edge }, true)}
      style={{ width: '100%', maxWidth: 420, minHeight: 52, borderRadius: 16, borderWidth: 1.5, borderStyle: 'dashed', borderColor: 'var(--red-300)', background: 'var(--red-50)', color: 'var(--red-700)', fontSize: 14, fontWeight: 600, cursor: p.readOnly ? 'default' : 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 8 }}
      hover={p.readOnly ? undefined : { borderColor: 'var(--red-400)' }}
    >
      <Icon name="plus" size={15} stroke={2.4} />{t('yc.scn.flow.open')}
    </Hv>
  );
}

function NodeCard({ p, id }: { p: FlowProps; id: string }) {
  const { t, n: fmt } = p.T;
  const node = p.graph.nodes[id];
  if (!node) return null;
  const on = p.sel?.kind === 'node' && p.sel.id === id;
  const errs = p.issues.filter((e) => e.node === id);
  const hardErrs = errs.filter((e) => e.code !== 'family_not_confirmed' && e.code !== 'chance_unavailable').length;
  const st = p.report?.nodes?.[id] ?? null;
  const msg = node.type === 'email' || node.type === 'sms';
  return (
    <Hv
      as="button" type="button" onClick={() => p.onSelect({ kind: 'node', id })} aria-pressed={on}
      style={{
        width: '100%', maxWidth: 420, textAlign: 'left', borderRadius: 18, padding: '12px 14px', cursor: 'pointer', background: '#fff',
        borderWidth: 1, borderStyle: 'solid', borderColor: on ? 'var(--red-400)' : hardErrs ? 'var(--red-200)' : 'var(--sand-200)',
        boxShadow: on ? '0 0 0 3px rgba(232,25,44,.12), var(--shadow-sm)' : 'var(--shadow-xs)', display: 'flex', flexDirection: 'column', gap: 6,
        transition: 'box-shadow 160ms, border-color 160ms', minWidth: 0, boxSizing: 'border-box',
      }}
      hover={{ borderColor: on ? 'var(--red-400)' : 'var(--sand-300)' }}
    >
      <span style={{ display: 'flex', alignItems: 'center', gap: 10, minWidth: 0 }}>
        <NodeGlyph type={node.type} size={30} />
        <span style={{ flex: 1, minWidth: 0, fontSize: 14.5, fontWeight: 600, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{p.nodeLabel(id)}</span>
        {errs.length > 0 && (hardErrs ? <IssueDot n={hardErrs} /> : <span style={{ color: 'var(--amber-700)', display: 'grid' }}><Icon name="alert" size={15} stroke={2.3} /></span>)}
      </span>
      <span style={{ fontSize: 13, lineHeight: 1.4, color: 'var(--sand-600)', display: '-webkit-box', WebkitLineClamp: 2, WebkitBoxOrient: 'vertical', overflow: 'hidden', overflowWrap: 'anywhere' }}>{p.nodeLine(id)}</span>
      {st && (
        <span style={{ display: 'flex', flexWrap: 'wrap', gap: '2px 10px', fontSize: 12, fontWeight: 600, color: 'var(--sand-700)', fontVariantNumeric: 'tabular-nums' }}>
          <span>{t('yc.scn.flow.st.entered', { n: fmt(st.entered) })}</span>
          {msg && <span>{t('yc.scn.flow.st.sent', { n: fmt(st.sent + st.would_send) })}</span>}
          {node.type === 'email' && st.sent > 0 && <span>{t('yc.scn.flow.st.clicked', { n: fmt(st.clicked) })}</span>}
          {st.held > 0 && <span style={{ color: 'var(--amber-700)' }}>{t('yc.scn.flow.st.held', { n: fmt(st.held) })}</span>}
        </span>
      )}
    </Hv>
  );
}
