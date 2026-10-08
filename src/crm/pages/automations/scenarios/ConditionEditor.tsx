/**
 * L'éditeur de conditions d'un scénario : des groupes « toutes » / « au moins
 * une », imbriqués (3 niveaux, 20 conditions), des conditions rangées par
 * famille (Profil, Soirées, Ce qui fait venir, Chances de venir, Messages,
 * Guest list, Canal). Chaque groupe montre son effectif EN DIRECT, lu par la
 * même compilation que l'envoi (`crm_scenario_counts`) : le chiffre affiché =
 * le filtre = l'envoi. Une condition propre à une inscription (achat depuis
 * l'entrée, message reçu) n'a pas d'effectif avant le lancement.
 */
import { useEffect, useMemo, useState } from 'react';
import { Hv } from '@/crm/ui/Hv';
import { Icon } from '@/crm/ui/Icon';
import { Modal } from '@/crm/ui/kit';
import { useCrmT } from '@/crm/i18n';
import { useScenarioCounts } from '@/crm/data/scenarios';
import {
  COND_LEAVES, COND_MAX_DEPTH, COND_MAX_LEAVES, condErrors, countLeaves, isCondGroup,
  type CondContext, type CondError, type CondGroup, type CondLeaf, type CondNode,
} from '@/crm/lib/scenarioConditions';
import { AUDIENCES, LEAF_FAMILIES, defaultLeaf, leafAllowed, leafValues, valueLabel, type T } from './scnText';
import { Chips, NumberInput, SelectBox, TextInput } from './scnUi';

export interface CondRefs {
  nights: { id: string; title: string; start_at: string; upcoming: boolean }[];
  segments: { id: string; name: string }[];
  emailNodes: { id: string; name: string }[];
  smsNodes: { id: string; name: string }[];
  hasEvent: boolean;
}

function useDebounced<V>(v: V, ms: number): V {
  const [d, setD] = useState(v);
  useEffect(() => {
    const h = window.setTimeout(() => setD(v), ms);
    return () => window.clearTimeout(h);
  }, [v, ms]);
  return d;
}

export function ConditionEditor({
  tree, onChange, ctx, refs, countEvent, readOnly, allowEmpty,
}: {
  tree: CondGroup | null; onChange: (t: CondGroup | null) => void; ctx: CondContext; refs: CondRefs;
  /** La soirée dont « la soirée du scénario » prend la place pour compter (la prochaine). */
  countEvent: string | null; readOnly?: boolean; allowEmpty?: boolean;
}) {
  const T = useCrmT();
  const { t } = T;
  const errs = useMemo(() => condErrors(tree, ctx), [tree, ctx]);
  const debounced = useDebounced(tree, 600);
  const counts = useScenarioCounts(debounced, countEvent, ctx, !!debounced);
  const [picker, setPicker] = useState<string | null>(null);
  const leaves = countLeaves(tree);

  if (!tree) {
    return (
      <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
        <span style={{ fontSize: 13.5, color: 'var(--sand-600)', lineHeight: 1.45 }}>{t(allowEmpty ? 'yc.scn.cond.everyone' : 'yc.scn.cond.empty')}</span>
        {!readOnly && (
          <AddButton label={t('yc.scn.cond.add')} onClick={() => setPicker('')} />
        )}
        {picker !== null && (
          <LeafPicker T={T} ctx={ctx} onClose={() => setPicker(null)}
            onPick={(k) => { onChange({ op: 'and', items: [defaultLeaf(k, firstNodes(refs))] }); setPicker(null); }} />
        )}
      </div>
    );
  }

  const update = (path: string, fn: (g: CondGroup) => CondGroup | null) => onChange(mapGroup(tree, path, fn, allowEmpty));
  const total = counts.data?.total ?? null;

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
      <Group
        T={T} g={tree} path="" depth={1} ctx={ctx} refs={refs} readOnly={!!readOnly} errs={errs}
        counts={counts.data?.groups ?? null} total={total} loading={counts.isFetching}
        onGroup={update} onAddLeaf={(p) => setPicker(p)}
        full={leaves >= COND_MAX_LEAVES}
      />
      <span style={{ fontSize: 12, color: 'var(--sand-500)', fontVariantNumeric: 'tabular-nums' }}>{t('yc.scn.cond.leaves', { n: leaves, max: COND_MAX_LEAVES })}</span>
      {picker !== null && (
        <LeafPicker T={T} ctx={ctx} onClose={() => setPicker(null)}
          onPick={(k) => { update(picker, (g) => ({ ...g, items: [...g.items, defaultLeaf(k, firstNodes(refs))] })); setPicker(null); }} />
      )}
    </div>
  );
}

const firstNodes = (refs: CondRefs) => ({ firstEmail: refs.emailNodes[0]?.id ?? null, firstSms: refs.smsNodes[0]?.id ?? null, hasEvent: refs.hasEvent });

/** Remplace le groupe au chemin `path` (null = le retirer). La racine vide disparaît si permis. */
function mapGroup(root: CondGroup, path: string, fn: (g: CondGroup) => CondGroup | null, allowEmpty?: boolean): CondGroup | null {
  if (path === '') {
    const r = fn(root);
    if (!r) return allowEmpty ? null : { op: 'and', items: [] };
    return r;
  }
  const [head, ...rest] = path.split('.').map(Number);
  const items = root.items.map((it, i) => {
    if (i !== head || !isCondGroup(it)) return it;
    return rest.length ? mapGroup(it, rest.join('.'), fn) : fn(it);
  }).filter((x): x is CondNode => x !== null);
  return { ...root, items };
}

const childPath = (p: string, i: number) => (p === '' ? String(i) : `${p}.${i}`);

function Group({
  T, g, path, depth, ctx, refs, readOnly, errs, counts, total, loading, onGroup, onAddLeaf, full,
}: {
  T: T; g: CondGroup; path: string; depth: number; ctx: CondContext; refs: CondRefs; readOnly: boolean; errs: CondError[];
  counts: Record<string, number | null> | null; total: number | null; loading: boolean;
  onGroup: (path: string, fn: (g: CondGroup) => CondGroup | null) => void; onAddLeaf: (path: string) => void; full: boolean;
}) {
  const { t, n } = T;
  const has = counts ? Object.prototype.hasOwnProperty.call(counts, path) : false;
  const c = has ? counts?.[path] : undefined;
  const items = Array.isArray(g.items) ? g.items : [];
  const groupErr = errs.find((e) => e.path === path);
  // Une condition incomplète dans ce groupe : le compte serait faux (personne), on attend.
  const incomplete = errs.some((e) => path === '' || e.path === path || e.path.startsWith(`${path}.`));
  return (
    <div style={{
      display: 'flex', flexDirection: 'column', gap: 8, padding: depth === 1 ? 0 : '10px 10px 10px 12px', borderRadius: 14,
      background: depth === 1 ? 'transparent' : depth === 2 ? 'var(--sand-50)' : '#fff',
      border: depth === 1 ? 0 : '1px solid var(--sand-200)', minWidth: 0,
    }}>
      <div style={{ display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: 8 }}>
        <OpToggle T={T} g={g} readOnly={readOnly} onChange={(next) => onGroup(path, () => next)} />
        <span style={{ marginLeft: 'auto', fontSize: 12.5, fontWeight: 600, color: c === null ? 'var(--sand-500)' : 'var(--ink)', fontVariantNumeric: 'tabular-nums', opacity: loading ? 0.55 : 1, transition: 'opacity 160ms' }}>
          {incomplete ? t('yc.scn.cond.incomplete') : c === null ? t('yc.scn.cond.atLaunch') : typeof c === 'number' ? (total ? t('yc.scn.cond.countOf', { n: n(c), total: n(total) }) : t('yc.scn.cond.count', { n: n(c) })) : '…'}
        </span>
        {depth > 1 && !readOnly && (
          <Hv as="button" type="button" onClick={() => onGroup(path, () => null)} aria-label={t('yc.scn.cond.rmGroup')} title={t('yc.scn.cond.rmGroup')}
            style={{ width: 28, height: 28, border: 0, borderRadius: 99, background: 'none', color: 'var(--sand-500)', cursor: 'pointer', display: 'grid', placeItems: 'center' }} hover={{ background: 'var(--sand-100)', color: 'var(--ink)' }}>
            <Icon name="x" size={13} stroke={2.4} />
          </Hv>
        )}
      </div>
      {groupErr?.code === 'empty_group' && <span style={{ fontSize: 12.5, color: 'var(--amber-700)', fontWeight: 500 }}>{t('yc.scn.cond.emptyHint')}</span>}
      {items.map((it, i) => {
        const p = childPath(path, i);
        if (isCondGroup(it)) {
          return (
            <Group key={p} T={T} g={it} path={p} depth={depth + 1} ctx={ctx} refs={refs} readOnly={readOnly} errs={errs}
              counts={counts} total={total} loading={loading} onGroup={onGroup} onAddLeaf={onAddLeaf} full={full} />
          );
        }
        return (
          <LeafRow key={p} T={T} leaf={it as CondLeaf} ctx={ctx} refs={refs} readOnly={readOnly} err={errs.find((e) => e.path === p) ?? null}
            onChange={(next) => onGroup(path, (gg) => ({ ...gg, items: gg.items.map((x, j) => (j === i ? next : x)) }))}
            onRemove={() => onGroup(path, (gg) => ({ ...gg, items: gg.items.filter((_, j) => j !== i) }))}
          />
        );
      })}
      {!readOnly && (
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
          <AddButton label={t('yc.scn.cond.add')} onClick={() => onAddLeaf(path)} disabled={full} />
          {depth < COND_MAX_DEPTH && (
            <AddButton label={t('yc.scn.cond.addGroup')} onClick={() => onGroup(path, (gg) => ({ ...gg, items: [...gg.items, { op: gg.op === 'and' ? 'or' : 'and', items: [] }] }))} disabled={full} />
          )}
        </div>
      )}
    </div>
  );
}

function OpToggle({ T, g, readOnly, onChange }: { T: T; g: CondGroup; readOnly: boolean; onChange: (g: CondGroup) => void }) {
  const { t } = T;
  const opt = (on: boolean, label: string, click: () => void) => (
    <Hv as="button" type="button" disabled={readOnly} aria-pressed={on} onClick={click}
      style={{ height: 28, padding: '0 11px', borderRadius: 99, border: 0, background: on ? '#fff' : 'transparent', boxShadow: on ? 'var(--shadow-xs)' : 'none', fontSize: 12.5, fontWeight: 600, color: on ? 'var(--ink)' : 'var(--sand-600)', cursor: readOnly ? 'default' : 'pointer', whiteSpace: 'nowrap' }}>
      {label}
    </Hv>
  );
  return (
    <div style={{ display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: 6 }}>
      <div role="group" aria-label={t('yc.scn.cond.opAria')} style={{ display: 'inline-flex', padding: 2, gap: 2, background: 'var(--sand-100)', borderRadius: 99 }}>
        {opt(g.op === 'and', t('yc.scn.cond.all'), () => onChange({ ...g, op: 'and' }))}
        {opt(g.op === 'or', t('yc.scn.cond.any'), () => onChange({ ...g, op: 'or' }))}
      </div>
      <Hv as="button" type="button" disabled={readOnly} aria-pressed={!!g.not} onClick={() => onChange({ ...g, not: !g.not })}
        style={{ height: 28, padding: '0 11px', borderRadius: 99, border: `1px solid ${g.not ? 'var(--red-300)' : 'var(--sand-200)'}`, background: g.not ? 'var(--red-50)' : '#fff', color: g.not ? 'var(--red-700)' : 'var(--sand-600)', fontSize: 12.5, fontWeight: 600, cursor: readOnly ? 'default' : 'pointer', whiteSpace: 'nowrap' }}>
        {t('yc.scn.cond.not')}
      </Hv>
    </div>
  );
}

function AddButton({ label, onClick, disabled }: { label: string; onClick: () => void; disabled?: boolean }) {
  return (
    <Hv as="button" type="button" onClick={onClick} disabled={disabled}
      style={{ height: 32, padding: '0 12px 0 9px', borderRadius: 99, borderWidth: 1, borderStyle: 'dashed', borderColor: 'var(--sand-300)', background: '#fff', color: 'var(--sand-700)', fontSize: 13, fontWeight: 600, cursor: disabled ? 'default' : 'pointer', display: 'inline-flex', alignItems: 'center', gap: 6, opacity: disabled ? 0.45 : 1 }}
      hover={disabled ? undefined : { borderColor: 'var(--sand-400)', color: 'var(--ink)' }}>
      <Icon name="plus" size={14} stroke={2.4} />{label}
    </Hv>
  );
}

function LeafRow({ T, leaf, ctx, refs, readOnly, err, onChange, onRemove }: {
  T: T; leaf: CondLeaf; ctx: CondContext; refs: CondRefs; readOnly: boolean; err: CondError | null;
  onChange: (l: CondLeaf) => void; onRemove: () => void;
}) {
  const { t } = T;
  const def = COND_LEAVES[leaf.k];
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 8, padding: '10px 12px', borderRadius: 12, background: '#fff', border: `1px solid ${err ? 'var(--red-200)' : 'var(--sand-200)'}`, minWidth: 0 }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
        <span style={{ flex: 1, minWidth: 0, fontSize: 13.5, fontWeight: 600, lineHeight: 1.3 }}>{t(def ? `yc.scn.leaf.${leaf.k}` : 'yc.scn.leaf.unknown')}</span>
        {!readOnly && (
          <Hv as="button" type="button" onClick={onRemove} aria-label={t('yc.scn.cond.rm')} title={t('yc.scn.cond.rm')}
            style={{ flex: 'none', width: 28, height: 28, border: 0, borderRadius: 99, background: 'none', color: 'var(--sand-500)', cursor: 'pointer', display: 'grid', placeItems: 'center' }} hover={{ background: 'var(--sand-100)', color: 'var(--ink)' }}>
            <Icon name="trash" size={13} stroke={2.2} />
          </Hv>
        )}
      </div>
      {def && <LeafValue T={T} leaf={leaf} refs={refs} readOnly={readOnly} onChange={onChange} />}
      {err && <span style={{ fontSize: 12.5, color: 'var(--red-700)', fontWeight: 500 }}>{t(`yc.scn.err.cond_${err.code}`)}</span>}
      {ctx === 'step' && def?.scenario && !err && <span style={{ fontSize: 12, color: 'var(--sand-500)' }}>{t('yc.scn.cond.runLeaf')}</span>}
    </div>
  );
}

function LeafValue({ T, leaf, refs, readOnly, onChange }: { T: T; leaf: CondLeaf; refs: CondRefs; readOnly: boolean; onChange: (l: CondLeaf) => void }) {
  const { t, dShort } = T;
  const spec = COND_LEAVES[leaf.k].spec;
  const set = (v: unknown) => onChange({ ...leaf, v });
  const v = leaf.v;
  const evOpts = [
    ...(refs.hasEvent ? [{ value: '$event', label: t('yc.scn.ev.scenario') }] : []),
    { value: 'T', label: t('yc.scn.ev.tonight') },
    ...refs.nights.map((e) => ({ value: e.id, label: `${e.title} · ${dShort(e.start_at)}` })),
  ];
  switch (spec.t) {
    case 'enum': {
      const vals = leafValues(leaf.k);
      const opts = vals.map((x) => ({ value: x, label: valueLabel(T, leaf.k, x) }));
      return vals.length > 5
        ? <SelectBox value={typeof v === 'string' ? v : ''} options={opts} onChange={set} disabled={readOnly} ariaLabel={t(`yc.scn.leaf.${leaf.k}`)} />
        : <Chips value={typeof v === 'string' ? v : ''} options={opts} onChange={set} disabled={readOnly} />;
    }
    case 'set': {
      const vals = leafValues(leaf.k);
      return <Chips multi value={Array.isArray(v) ? v as string[] : []} options={vals.map((x) => ({ value: x, label: valueLabel(T, leaf.k, x) }))} onChange={set} disabled={readOnly} />;
    }
    case 'int': return <NumberInput value={typeof v === 'number' ? v : null} onChange={set} min={0} max={spec.max} disabled={readOnly} suffix={t(`yc.scn.unit.${leaf.k}`)} ariaLabel={t(`yc.scn.leaf.${leaf.k}`)} />;
    case 'money': return <NumberInput value={typeof v === 'number' ? v : null} onChange={set} min={0} max={9_999_999} disabled={readOnly} suffix="€" ariaLabel={t(`yc.scn.leaf.${leaf.k}`)} />;
    case 'bool': return <Chips value={v === true ? 'y' : v === false ? 'n' : ''} options={[{ value: 'y', label: t('yc.scn.yes') }, { value: 'n', label: t('yc.scn.no') }]} onChange={(x) => set(x === 'y')} disabled={readOnly} />;
    case 'strings':
    case 'patterns':
      return <ListInput T={T} value={Array.isArray(v) ? (v as string[]) : []} onChange={set} disabled={readOnly}
        prefix={leaf.k === 'artist' ? 'name:' : ''} upper={leaf.k === 'country'} placeholder={t(`yc.scn.ph.${leaf.k}`)} />;
    case 'pattern': return <TextInput value={typeof v === 'string' ? v : ''} onChange={(x) => set(x.toUpperCase().slice(0, 2))} disabled={readOnly} placeholder="FR" maxLength={2} ariaLabel={t(`yc.scn.leaf.${leaf.k}`)} />;
    case 'uuid':
      return <SelectBox value={typeof v === 'string' ? v : ''} placeholder={t('yc.scn.ph.segment')} options={refs.segments.map((s) => ({ value: s.id, label: s.name }))} onChange={set} disabled={readOnly} ariaLabel={t('yc.scn.leaf.segment')} />;
    case 'events': {
      const cur = Array.isArray(v) ? v as string[] : [];
      return (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
          {cur.map((x, i) => (
            <div key={`${x}:${i}`} style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
              <div style={{ flex: 1, minWidth: 0 }}>
                <SelectBox value={x} options={evOpts} onChange={(nv) => set(cur.map((y, j) => (j === i ? nv : y)))} disabled={readOnly} ariaLabel={t('yc.scn.leaf.ev')} />
              </div>
              {!readOnly && cur.length > 1 && (
                <Hv as="button" type="button" onClick={() => set(cur.filter((_, j) => j !== i))} aria-label={t('yc.scn.cond.rm')} style={{ flex: 'none', width: 30, height: 30, border: 0, borderRadius: 99, background: 'none', color: 'var(--sand-500)', cursor: 'pointer', display: 'grid', placeItems: 'center' }} hover={{ background: 'var(--sand-100)' }}>
                  <Icon name="x" size={12} stroke={2.4} />
                </Hv>
              )}
            </div>
          ))}
          {!readOnly && <AddButton label={t('yc.scn.cond.addNight')} onClick={() => set([...cur, refs.nights[0]?.id ?? 'T'])} />}
        </div>
      );
    }
    case 'ntgt': {
      const o = (v && typeof v === 'object' ? v : {}) as { e?: string; a?: string };
      return (
        <div style={{ display: 'grid', gridTemplateColumns: 'minmax(0,1fr)', gap: 6 }}>
          <SelectBox value={o.a ?? ''} options={AUDIENCES.map((a) => ({ value: a, label: t(`yc.scn.v.ntgt.${a}`) }))} onChange={(a) => set({ e: o.e ?? '', a })} disabled={readOnly} ariaLabel={t('yc.scn.leaf.ntgt')} />
          <SelectBox value={o.e ?? ''} placeholder={t('yc.scn.ph.night')} options={evOpts.filter((x) => x.value !== 'T')} onChange={(e) => set({ e, a: o.a ?? AUDIENCES[0] })} disabled={readOnly} ariaLabel={t('yc.scn.ph.night')} />
        </div>
      );
    }
    case 'node': {
      const list = leaf.k === 'sc_sms_delivered' ? refs.smsNodes : refs.emailNodes;
      return <SelectBox value={typeof v === 'string' ? v : ''} placeholder={t(leaf.k === 'sc_sms_delivered' ? 'yc.scn.ph.smsNode' : 'yc.scn.ph.emailNode')} options={list.map((x) => ({ value: x.id, label: x.name }))} onChange={set} disabled={readOnly} ariaLabel={t(`yc.scn.leaf.${leaf.k}`)} />;
    }
    default: return <span style={{ fontSize: 13, color: 'var(--sand-500)' }}>{t('yc.scn.soon')}</span>;
  }
}

/** Une liste de mots séparés par des virgules (genres, villes, étiquettes, artistes). */
function ListInput({ T, value, onChange, disabled, prefix, upper, placeholder }: {
  T: T; value: string[]; onChange: (v: string[]) => void; disabled: boolean; prefix: string; upper?: boolean; placeholder: string;
}) {
  const shown = value.map((x) => (prefix && x.startsWith(prefix) ? x.slice(prefix.length) : x.replace(/^(id|slug|name):/, ''))).join(', ');
  const [txt, setTxt] = useState<string | null>(null);
  const commit = (s: string) => {
    const parts = s.split(',').map((x) => x.trim()).filter(Boolean).map((x) => (upper ? x.toUpperCase() : x)).map((x) => `${prefix}${x}`);
    onChange(parts);
    setTxt(null);
  };
  return (
    <input className="yc-field" value={txt ?? shown} disabled={disabled} placeholder={placeholder} aria-label={placeholder}
      onChange={(e) => setTxt(e.target.value)} onBlur={(e) => commit(e.target.value)} onKeyDown={(e) => { if (e.key === 'Enter') commit((e.target as HTMLInputElement).value); }}
      title={T.t('yc.scn.ph.commas')}
      style={{ height: 42, boxSizing: 'border-box', padding: '0 14px', borderRadius: 12, border: '1px solid var(--sand-200)', fontSize: 14.5, outline: 'none', width: '100%', minWidth: 0, opacity: disabled ? 0.6 : 1 }} />
  );
}

function LeafPicker({ T, ctx, onPick, onClose }: { T: T; ctx: CondContext; onPick: (k: string) => void; onClose: () => void }) {
  const { t } = T;
  const [fam, setFam] = useState(LEAF_FAMILIES[0].family);
  const cur = LEAF_FAMILIES.find((f) => f.family === fam) ?? LEAF_FAMILIES[0];
  return (
    <Modal open onClose={onClose} width={560} label={t('yc.scn.cond.pickTitle')}>
      <div style={{ padding: 'clamp(18px,3vw,26px)', display: 'flex', flexDirection: 'column', gap: 14 }}>
        <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: 12 }}>
          <div>
            <h2 style={{ margin: 0, fontFamily: 'var(--font-display)', fontWeight: 600, fontSize: 22, letterSpacing: '-.02em' }}>{t('yc.scn.cond.pickTitle')}</h2>
            <span style={{ fontSize: 13.5, color: 'var(--sand-500)' }}>{t(ctx === 'entry' ? 'yc.scn.cond.pickSubEntry' : 'yc.scn.cond.pickSub')}</span>
          </div>
          <Hv as="button" type="button" onClick={onClose} aria-label={t('yc.scn.close')} style={{ flex: 'none', width: 36, height: 36, border: 0, borderRadius: 99, background: 'var(--sand-100)', color: 'var(--sand-600)', cursor: 'pointer', display: 'grid', placeItems: 'center' }} hover={{ background: 'var(--sand-200)' }}>
            <Icon name="x" size={16} stroke={2.4} />
          </Hv>
        </div>
        <div style={{ display: 'flex', gap: 6, overflowX: 'auto', paddingBottom: 2 }}>
          {LEAF_FAMILIES.map((f) => {
            const on = f.family === fam;
            return (
              <button key={f.family} type="button" onClick={() => setFam(f.family)} aria-pressed={on}
                style={{ flex: 'none', height: 34, padding: '0 13px', borderRadius: 99, border: 0, background: on ? 'var(--ink)' : 'var(--sand-100)', color: on ? '#fff' : 'var(--sand-700)', fontSize: 13.5, fontWeight: 600, cursor: 'pointer', whiteSpace: 'nowrap' }}>
                {t(`yc.scn.fam.${f.family}`)}
              </button>
            );
          })}
        </div>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 6, maxHeight: 'min(420px, 55vh)', overflowY: 'auto' }}>
          {cur.keys.map((k) => {
            const def = COND_LEAVES[k];
            const soon = def?.spec.t === 'soon';
            const allowed = leafAllowed(k, ctx) && !soon;
            return (
              <Hv key={k} as="button" type="button" disabled={!allowed} onClick={() => onPick(k)}
                style={{ display: 'flex', alignItems: 'center', gap: 12, padding: '11px 14px', borderRadius: 14, borderWidth: 1, borderStyle: 'solid', borderColor: 'var(--sand-200)', background: '#fff', textAlign: 'left', cursor: allowed ? 'pointer' : 'default', opacity: allowed ? 1 : 0.5 }}
                hover={allowed ? { borderColor: 'var(--sand-300)', background: 'var(--paper)' } : undefined}>
                <span style={{ flex: 1, minWidth: 0, display: 'flex', flexDirection: 'column', gap: 2 }}>
                  <span style={{ fontSize: 14.5, fontWeight: 600 }}>{t(`yc.scn.leaf.${k}`)}</span>
                  <span style={{ fontSize: 12.5, lineHeight: 1.4, color: 'var(--sand-500)' }}>
                    {soon ? `${t('yc.scn.soon')} · ${t(`yc.scn.leaf.${k}.d`)}` : !allowed ? t('yc.scn.cond.notInEntry') : t(`yc.scn.leaf.${k}.d`)}
                  </span>
                </span>
                {allowed && <Icon name="plus" size={15} stroke={2.4} color="var(--sand-500)" />}
              </Hv>
            );
          })}
        </div>
      </div>
    </Modal>
  );
}
