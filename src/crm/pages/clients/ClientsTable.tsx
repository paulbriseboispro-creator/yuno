/**
 * « Vos clients, un par un » : recherche, pastilles de cycle de vie et de
 * segments enregistrés, filtres (soirée, dernière visite, soirées faites,
 * dépense, joignable par, arrivé par), tri, sélection, export, et
 * « Enregistrer en segment ».
 */
import { useEffect, useRef, useState } from 'react';
import type { Dispatch, ReactNode, SetStateAction } from 'react';
import { Hv } from '@/crm/ui/Hv';
import { Icon } from '@/crm/ui/Icon';
import { reveal } from '@/crm/ui/motion';
import { useCrmT } from '@/crm/i18n';
import { useCrmCaps } from '@/crm/scope';
import { hasCriteria } from '@/crm/data/clients';
import type { ClientFilterDef, ClientRow, ClientsList, EventBrief, Lifecycle, SavedSegment } from '@/crm/data/clients';
import { LIFECYCLE_AVATAR, LIFECYCLE_COLOR, fullName, initials, relDays } from '@/crm/lib/lifecycle';

export type FilterKey = 'ev' | 'last' | 'nb' | 'sp' | 'rc' | 'src' | 'gl' | 'glev';
type Opt = { v: string; l: string; s?: string; short?: string; disabled?: boolean };

const COLS = '44px minmax(260px,2.4fr) 150px 84px 132px 96px 140px 24px';

export function ClientsTable({
  intro, def, setDef, q, setQ, sort, dir, onSort, list, loading, limit, onMore,
  events, saved, activeSaved, onPickSaved, onDeleteSaved, onSaveSegment,
  sel, setSel, selAll, setSelAll, onOpen, onExport, dense, saveSignal,
}: {
  intro: boolean;
  def: ClientFilterDef;
  setDef: (d: ClientFilterDef) => void;
  q: string;
  setQ: (v: string) => void;
  sort: string;
  dir: number;
  onSort: (k: string) => void;
  list: ClientsList | undefined;
  loading: boolean;
  limit: number;
  onMore: () => void;
  events: EventBrief[];
  saved: SavedSegment[];
  activeSaved: string | null;
  onPickSaved: (s: SavedSegment) => void;
  onDeleteSaved: (s: SavedSegment) => void;
  onSaveSegment: (name: string) => Promise<boolean>;
  sel: string[];
  setSel: Dispatch<SetStateAction<string[]>>;
  selAll: boolean;
  setSelAll: (v: boolean) => void;
  onOpen: (email: string) => void;
  onExport: () => void;
  dense?: boolean;
  /** Change à chaque « En segment » de la barre de sélection : ouvre le champ de nom. */
  saveSignal?: number;
}) {
  const caps = useCrmCaps();
  const T = useCrmT();
  const { t, tp, n, eur, pct, locale } = T;
  const [pop, setPop] = useState<FilterKey | null>(null);
  // Un menu ouvert près du bord droit s'aligne à droite de son bouton (téléphone).
  const [popRight, setPopRight] = useState(false);
  const [sf, setSf] = useState(false);
  const [saving, setSaving] = useState(false);
  const [svName, setSvName] = useState('');
  const svRef = useRef<HTMLInputElement>(null);
  const searchRef = useRef<HTMLInputElement>(null);
  const rowH = dense ? 56 : 68;
  const f = def.f ?? {};
  const seg = def.seg ?? 'all';
  const counts = list?.counts;
  const total = list?.total ?? 0;
  const rows = list?.rows ?? [];
  const all = counts?.all ?? 0;

  useEffect(() => {
    const kd = (e: KeyboardEvent) => {
      const tg = (e.target as HTMLElement | null)?.tagName ?? '';
      if (e.key === '/' && tg !== 'INPUT' && tg !== 'TEXTAREA') { e.preventDefault(); searchRef.current?.focus(); }
      if (e.key === 'Escape') setPop(null);
    };
    document.addEventListener('keydown', kd);
    return () => document.removeEventListener('keydown', kd);
  }, []);

  useEffect(() => { if (saving) setTimeout(() => svRef.current?.focus(), 30); }, [saving]);
  useEffect(() => { if (saveSignal) { setSaving(true); setSvName(''); } }, [saveSignal]);

  const FIL: { k: FilterKey; l: string; title: string; multi?: boolean; opts: Opt[] }[] = [
    {
      k: 'ev', l: t('yc.cli.f.ev'), title: t('yc.cli.f.ev.title'), multi: true,
      opts: [
        { v: 'T', l: t('yc.cli.f.ev.tonight'), short: t('yc.cli.f.ev.tonightShort') },
        ...events.map((e) => ({ v: e.id, l: e.title ?? '—', s: e.upcoming ? `${t('yc.cli.f.ev.upcoming')} · ${T.dShort(e.start_at)}` : T.dShort(e.start_at) })),
      ],
    },
    { k: 'last', l: t('yc.cli.f.last'), title: t('yc.cli.f.last'), opts: ['0-30', '30-90', '90-180', '180+'].map((v) => ({ v, l: t(`yc.cli.f.last.${v}`), short: t(`yc.cli.f.last.${v}.s`) })) },
    { k: 'nb', l: t('yc.cli.f.nb'), title: t('yc.cli.f.nb.title'), opts: ['1', '2', '3-5', '6+'].map((v) => ({ v, l: t(`yc.cli.f.nb.${v}`), short: t(`yc.cli.f.nb.${v}.s`) })) },
    { k: 'sp', l: t('yc.cli.f.sp'), title: t('yc.cli.f.sp.title'), opts: ['<50', '50-200', '200+'].map((v) => ({ v, l: t(`yc.cli.f.sp.${v}`), short: t(`yc.cli.f.sp.${v}.s`) })) },
    { k: 'rc', l: t('yc.cli.f.rc'), title: t('yc.cli.f.rc'), multi: true, opts: [{ v: 'mail', l: t('yc.cli.f.rc.mail') }, { v: 'sms', l: t('yc.cli.f.rc.sms') }, { v: 'none', l: t('yc.cli.f.rc.none'), s: t('yc.cli.f.rc.none.s') }] },
    {
      k: 'src', l: t('yc.cli.f.src'), title: t('yc.cli.f.src'), multi: true,
      opts: [
        { v: 'shotgun', l: t('yc.cli.f.src.shotgun'), s: t('yc.cli.f.src.shotgun.s') },
        { v: 'utm', l: t('yc.cli.f.src.utm'), s: t('yc.cli.f.src.utm.s') },
        { v: 'import', l: t('yc.cli.f.src.import') },
        { v: 'page', l: t('yc.cli.f.src.page'), s: t('yc.cli.f.src.page.s') },
      ],
    },
    // Guest list Shotgun (invitations + billets à 0 €), migration 20261008100000.
    { k: 'gl', l: t('yc.gl.f'), title: t('yc.gl.f.title'), opts: (['any', 'only', 'loyal', 'conv', 'noshow'] as const).map((v) => ({ v, l: t(`yc.gl.f.${v}`), s: t(`yc.gl.f.${v}.s`), short: t(`yc.gl.f.${v}.short`) })) },
    // Invités d'une soirée : seulement quand on arrive d'une soirée (?glev=).
    ...(f.glev?.length ? [{
      k: 'glev' as const, l: t('yc.gl.f.glev'), title: t('yc.gl.f.glev.title'), multi: true,
      opts: [
        ...f.glev.filter((id) => !events.some((e) => e.id === id)).map((id) => ({ v: id, l: t('yc.gl.f.glev.this'), short: t('yc.gl.f.glev.this') })),
        ...events.map((e) => ({ v: e.id, l: e.title ?? '—', s: T.dShort(e.start_at) })),
      ],
    }] : []),
  ];

  const valOf = (k: FilterKey): string | string[] => (f as Record<string, string | string[] | undefined>)[k] ?? (FIL.find((x) => x.k === k)?.multi ? [] : '');
  const setF = (k: FilterKey, v: string | string[]) => setDef({ ...def, f: { ...f, [k]: v } });
  const nF = FIL.filter((fl) => { const v = valOf(fl.k); return Array.isArray(v) ? v.length > 0 : !!v; }).length;
  const hasFilt = nF > 0 || hasCriteria({ ...def, q });

  const chips: { k: 'all' | Lifecycle; l: string; n: number }[] = [
    { k: 'all', l: t('yc.cli.list.all'), n: all },
    ...(['hab', 'occ', 'nou', 'end', 'none'] as Lifecycle[])
      .filter((k) => k !== 'none' || (counts?.none ?? 0) > 0)
      .map((k) => ({ k, l: t(`yc.cli.seg.${k}`), n: counts?.[k] ?? 0 })),
  ];

  const pcBase = all ? (total / all) * 100 : 0;
  const pcTxt = total === all ? t('yc.cli.list.wholeBase') : total === 0 ? '' : t('yc.cli.list.pctBase', { pct: pcBase < 0.1 ? '< 0,1 %' : pct(pcBase, 1) });
  const shown = Math.min(limit, total);
  const vis = rows.slice(0, shown);
  const selSet = new Set(sel);
  const visSel = vis.filter((c) => selAll || selSet.has(c.email)).length;
  const allSelVis = shown > 0 && visSel === shown;
  const hd = (k: string, label: string) => {
    const on = sort === k;
    const ar = on ? (dir === 1 ? (k === 'name' ? '↑' : '↓') : (k === 'name' ? '↓' : '↑')) : '';
    return (
      <Hv as="button" type="button" onClick={() => onSort(k)} style={{ textAlign: 'left', border: 0, background: 'none', padding: 0, font: 'inherit', letterSpacing: 'inherit', textTransform: 'inherit', color: on ? 'var(--ink)' : 'var(--sand-500)', cursor: 'pointer', display: 'inline-flex', alignItems: 'center', gap: 6 }} hover={{ color: 'var(--ink)' }}>
        {label}<span>{ar}</span>
      </Hv>
    );
  };
  const now = Date.now();

  const commitSave = async () => {
    const ok = await onSaveSegment(svName.trim());
    if (ok) { setSaving(false); setSvName(''); }
  };

  return (
    <section id="liste" style={{ position: 'relative', display: 'flex', flexDirection: 'column', borderRadius: 28, background: '#fff', boxShadow: 'inset 0 0 0 1px var(--sand-200),var(--shadow-sm)', ...reveal(intro, 760) }}>
      {pop && <div onClick={() => setPop(null)} style={{ position: 'fixed', inset: 0, zIndex: 19 }} />}
      <div style={{ display: 'flex', flexDirection: 'column', gap: 16, padding: 'clamp(18px,2.2vw,28px) clamp(18px,2.2vw,28px) 16px' }}>
        <div style={{ display: 'flex', flexWrap: 'wrap', alignItems: 'center', justifyContent: 'space-between', gap: '14px 20px' }}>
          <div>
            <h2 style={{ margin: 0, fontFamily: 'var(--font-display)', fontWeight: 600, fontSize: 22, letterSpacing: '-.02em' }}>{t('yc.cli.list.title')}</h2>
            <div style={{ fontSize: 13.5, color: 'var(--sand-500)', marginTop: 2 }}>{t('yc.cli.list.sub')}</div>
          </div>
          <label style={{ flex: '0 1 360px', minWidth: 220, height: 42, display: 'flex', alignItems: 'center', gap: 10, padding: '0 8px 0 14px', borderRadius: 99, background: '#fff', border: `1px solid ${sf ? 'var(--sand-400)' : 'var(--sand-200)'}`, boxShadow: sf ? '0 0 0 4px rgba(26,20,18,.06)' : 'none', cursor: 'text', transition: 'border-color 140ms,box-shadow 140ms' }}>
            <Icon name="search" size={16} stroke={2.2} color="var(--sand-400)" />
            <input
              ref={searchRef}
              value={q}
              onChange={(e) => setQ(e.target.value)}
              onFocus={() => setSf(true)}
              onBlur={() => setSf(false)}
              autoComplete="off"
              aria-label={t('yc.cli.list.searchAria')}
              placeholder={t('yc.cli.list.searchPh')}
              style={{ flex: 1, minWidth: 0, border: 0, outline: 0, background: 'transparent', font: '400 14.5px/1 var(--font-body)', color: 'var(--ink)', boxShadow: 'none' }}
            />
            {q && (
              <Hv as="button" type="button" onClick={() => { setQ(''); searchRef.current?.focus(); }} aria-label={t('yc.top.clearSearch')} style={{ flex: 'none', width: 26, height: 26, border: 0, borderRadius: 99, background: 'var(--sand-100)', color: 'var(--sand-600)', cursor: 'pointer', display: 'grid', placeItems: 'center' }} hover={{ background: 'var(--sand-200)' }}>
                <Icon name="x" size={12} stroke={2.6} />
              </Hv>
            )}
          </label>
        </div>

        <div style={{ display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: 8 }}>
          {chips.map((c) => {
            const on = seg === c.k && !activeSaved;
            return (
              <Hv
                key={c.k}
                as="button"
                type="button"
                onClick={() => setDef({ ...def, seg: c.k })}
                aria-pressed={on}
                style={{ height: 38, padding: '0 14px', borderRadius: 99, border: `1px solid ${on ? 'var(--ink)' : 'var(--sand-200)'}`, background: on ? 'var(--ink)' : '#fff', color: on ? '#fff' : 'var(--ink)', fontSize: 14, fontWeight: 600, display: 'inline-flex', alignItems: 'center', gap: 8, cursor: 'pointer', transition: 'background 160ms,color 160ms,border-color 160ms' }}
                hover={{ borderColor: 'var(--sand-400)' }}
              >
                {c.l}<span style={{ fontSize: 13, fontWeight: 500, color: on ? 'rgba(255,255,255,.7)' : 'var(--sand-500)', fontVariantNumeric: 'tabular-nums' }}>{n(c.n)}</span>
              </Hv>
            );
          })}
          {saved.length > 0 && <span style={{ width: 1, height: 22, background: 'var(--sand-200)', margin: '0 4px' }} />}
          {saved.map((v) => {
            const on = activeSaved === v.id;
            return (
              <span key={v.id} style={{ height: 38, padding: '0 6px 0 14px', borderRadius: 99, border: `1px dashed ${on ? 'var(--ink)' : 'var(--sand-300)'}`, background: on ? 'var(--ink)' : '#fff', color: on ? '#fff' : 'var(--ink)', fontSize: 14, fontWeight: 600, display: 'inline-flex', alignItems: 'center', gap: 8 }}>
                <button type="button" onClick={() => onPickSaved(v)} style={{ border: 0, background: 'none', padding: 0, color: 'inherit', fontWeight: 600, cursor: 'pointer', display: 'inline-flex', alignItems: 'center', gap: 8, font: 'inherit' }}>
                  {v.name}<span style={{ fontSize: 13, fontWeight: 500, color: on ? 'rgba(255,255,255,.7)' : 'var(--sand-500)', fontVariantNumeric: 'tabular-nums' }}>{n(v.n)}</span>
                </button>
                {caps.write && (<Hv as="button" type="button" onClick={() => onDeleteSaved(v)} aria-label={t('yc.cli.list.segDelete')} title={t('yc.cli.list.segDelete')} style={{ width: 26, height: 26, border: 0, borderRadius: 99, background: 'none', color: on ? 'rgba(255,255,255,.7)' : 'var(--sand-500)', cursor: 'pointer', display: 'grid', placeItems: 'center' }} hover={{ background: 'rgba(0,0,0,.08)' }}>
                  <Icon name="x" size={12} stroke={2.6} />
                </Hv>)}
              </span>
            );
          })}
        </div>

        <div style={{ display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: 8 }}>
          <span style={{ fontFamily: 'var(--font-mono)', fontSize: 11, letterSpacing: '.08em', textTransform: 'uppercase', color: 'var(--sand-400)', marginRight: 4 }}>{t('yc.cli.list.filterBy')}</span>
          {FIL.map((fl) => {
            const val = valOf(fl.k);
            const act = Array.isArray(val) ? val.length > 0 : !!val;
            const open = pop === fl.k;
            let label = fl.l;
            if (act) {
              if (Array.isArray(val)) { const o = fl.opts.find((x) => x.v === val[0]); label = `${fl.l} : ${o?.short ?? o?.l ?? ''}${val.length > 1 ? ` +${val.length - 1}` : ''}`; }
              else { const o = fl.opts.find((x) => x.v === val); label = `${fl.l} : ${o?.short ?? o?.l ?? ''}`; }
            }
            return (
              <div key={fl.k} style={{ position: 'relative', zIndex: open ? 25 : undefined }}>
                <Hv
                  as="button"
                  type="button"
                  onClick={(e: React.MouseEvent<HTMLElement>) => { setPopRight(e.currentTarget.getBoundingClientRect().left + 296 > window.innerWidth); setPop(open ? null : fl.k); }}
                  aria-haspopup="listbox"
                  aria-expanded={open}
                  style={{ height: 38, padding: '0 12px 0 14px', borderRadius: 99, border: `1px solid ${act ? 'var(--ink)' : open ? 'var(--sand-400)' : 'var(--sand-200)'}`, background: act ? 'var(--ink)' : '#fff', color: act ? '#fff' : 'var(--ink)', fontSize: 14, fontWeight: act ? 600 : 500, display: 'inline-flex', alignItems: 'center', gap: 8, cursor: 'pointer', whiteSpace: 'nowrap', transition: 'background 160ms,border-color 160ms' }}
                  hover={{ borderColor: 'var(--sand-400)' }}
                >
                  {label}
                  <Icon name="chevronDown" size={14} stroke={2.4} style={{ opacity: 0.6, transform: `rotate(${open ? 180 : 0}deg)`, transition: 'transform 200ms' }} />
                </Hv>
                {open && (
                  <div role="listbox" style={{ position: 'absolute', zIndex: 25, top: 46, ...(popRight ? { right: 0 } : { left: 0 }), width: 'min(280px, calc(100vw - 32px))', padding: 8, borderRadius: 20, background: '#fff', boxShadow: 'var(--shadow-md),0 0 0 1px var(--sand-200)', animation: 'yc-pop 200ms cubic-bezier(.22,1,.36,1)', transformOrigin: popRight ? 'top right' : 'top left' }}>
                    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '8px 10px 6px' }}>
                      <span style={{ fontFamily: 'var(--font-mono)', fontSize: 11, letterSpacing: '.08em', textTransform: 'uppercase', color: 'var(--sand-400)' }}>{fl.title}</span>
                      {act && <button type="button" onClick={() => setF(fl.k, fl.multi ? [] : '')} style={{ border: 0, background: 'none', padding: 0, fontSize: 13, fontWeight: 600, color: 'var(--red-600)', cursor: 'pointer' }}>{t('yc.cli.list.clear')}</button>}
                    </div>
                    <div style={{ display: 'flex', flexDirection: 'column', gap: 2, maxHeight: 320, overflowY: 'auto' }}>
                      {fl.opts.map((o) => {
                        const on = Array.isArray(val) ? val.includes(o.v) : val === o.v;
                        return (
                          <Hv
                            key={o.v}
                            as="button"
                            type="button"
                            role="option"
                            aria-selected={on}
                            disabled={o.disabled}
                            onClick={() => {
                              if (o.disabled) return;
                              if (Array.isArray(val)) setF(fl.k, on ? val.filter((x) => x !== o.v) : [...val, o.v]);
                              else { setF(fl.k, on ? '' : o.v); setPop(null); }
                            }}
                            style={{ display: 'flex', alignItems: 'center', gap: 12, padding: '9px 10px', border: 0, borderRadius: 12, background: on ? 'var(--sand-50)' : 'transparent', textAlign: 'left', cursor: o.disabled ? 'default' : 'pointer', color: 'var(--ink)', opacity: o.disabled ? 0.5 : 1 }}
                            hover={{ background: 'var(--sand-50)' }}
                          >
                            <span style={{ flex: 'none', width: 18, height: 18, borderRadius: fl.multi ? 6 : 99, border: `1.5px solid ${on ? 'var(--ink)' : 'var(--sand-300)'}`, background: on ? 'var(--ink)' : '#fff', display: 'grid', placeItems: 'center', color: '#fff' }}>
                              {on && <Icon name="check" size={11} stroke={3.4} />}
                            </span>
                            <span style={{ flex: 1, minWidth: 0, display: 'flex', flexDirection: 'column' }}>
                              <span style={{ fontSize: 14.5, fontWeight: on ? 600 : 500 }}>{o.l}</span>
                              {o.s && <span style={{ fontSize: 12.5, color: 'var(--sand-500)' }}>{o.s}</span>}
                            </span>
                          </Hv>
                        );
                      })}
                    </div>
                  </div>
                )}
              </div>
            );
          })}
        </div>
      </div>

      <div style={{ display: 'flex', flexWrap: 'wrap', alignItems: 'center', justifyContent: 'space-between', gap: '10px 16px', padding: '12px clamp(18px,2.2vw,28px)', borderTop: '1px solid var(--sand-100)', background: 'var(--sand-50)' }}>
        <div style={{ display: 'flex', flexWrap: 'wrap', alignItems: 'baseline', gap: '4px 12px', fontSize: 14.5, color: 'var(--sand-600)' }}>
          <b style={{ fontSize: 16, fontWeight: 600, color: 'var(--ink)', fontVariantNumeric: 'tabular-nums' }}>{list ? tp('yc.cli.list.n', total, { n: n(total) }) : '…'}</b>
          <span>{pcTxt}</span>
        </div>
        <div style={{ display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: '8px 16px' }}>
          {caps.write && (saving || (hasFilt && !activeSaved && total > 0)) && (saving ? (
            <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6, animation: 'yc-pop 200ms cubic-bezier(.22,1,.36,1)' }}>
              <input
                ref={svRef}
                value={svName}
                onChange={(e) => setSvName(e.target.value)}
                onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); void commitSave(); } else if (e.key === 'Escape') setSaving(false); }}
                placeholder={t('yc.cli.list.segName')}
                aria-label={t('yc.cli.list.segName')}
                maxLength={80}
                style={{ height: 34, width: 190, padding: '0 14px', borderRadius: 99, border: '1px solid var(--sand-300)', outline: 0, background: '#fff', font: '400 14px/1 var(--font-body)', color: 'var(--ink)' }}
              />
              <Hv as="button" type="button" onClick={() => void commitSave()} style={{ height: 34, padding: '0 14px', borderRadius: 99, border: 0, background: 'var(--ink)', color: '#fff', fontSize: 13.5, fontWeight: 600, cursor: 'pointer' }} hover={{ background: 'var(--sand-700)' }}>{t('yc.cli.list.save')}</Hv>
              <Hv as="button" type="button" onClick={() => setSaving(false)} aria-label={t('yc.common.cancel')} style={{ width: 30, height: 30, border: 0, borderRadius: 99, background: 'none', color: 'var(--sand-500)', cursor: 'pointer', display: 'grid', placeItems: 'center' }} hover={{ background: 'var(--sand-100)' }}>
                <Icon name="x" size={13} stroke={2.6} />
              </Hv>
            </span>
          ) : (
            <TextBtn onClick={() => { setSaving(true); setSvName(''); }} icon={<Icon d="M19 21l-7-5-7 5V5a2 2 0 0 1 2-2h10a2 2 0 0 1 2 2z" size={15} stroke={2.2} />}>{t('yc.cli.list.saveSeg')}</TextBtn>
          ))}
          {hasFilt && <TextBtn color="var(--red-600)" hover="var(--red-700)" onClick={() => { setQ(''); setDef({ seg: 'all', f: {} }); }}>{t('yc.cli.list.clearFilters')}</TextBtn>}
          {caps.write && <TextBtn onClick={onExport} icon={<Icon name="download" size={15} stroke={2.2} />}>{t('yc.cli.list.export')}</TextBtn>}
        </div>
      </div>

      {((allSelVis && !selAll && total > shown) || selAll) && (
        <div style={{ display: 'flex', flexWrap: 'wrap', alignItems: 'center', justifyContent: 'center', gap: '6px 10px', padding: '10px 16px', background: 'var(--red-50)', fontSize: 14, color: 'var(--red-800)', borderTop: '1px solid var(--red-100)' }}>
          <span>{selAll ? t('yc.cli.list.selAllDone', { n: n(total) }) : t('yc.cli.list.selPage', { n: n(shown) })}</span>
          <button type="button" onClick={() => { setSelAll(!selAll); setSel([]); }} style={{ border: 0, background: 'none', padding: 0, fontSize: 14, fontWeight: 600, color: 'var(--red-700)', cursor: 'pointer', textDecoration: 'underline' }}>
            {selAll ? t('yc.common.cancel') : t('yc.cli.list.selAllGo', { n: n(total) })}
          </button>
        </div>
      )}

      <div style={{ overflowX: 'auto' }}>
        <div style={{ minWidth: 990 }}>
          <div style={{ display: 'grid', gridTemplateColumns: COLS, alignItems: 'center', gap: 12, padding: '0 clamp(18px,2.2vw,28px)', height: 44, borderTop: '1px solid var(--sand-100)', borderBottom: '1px solid var(--sand-100)', fontFamily: 'var(--font-mono)', fontSize: 11, letterSpacing: '.08em', textTransform: 'uppercase', color: 'var(--sand-500)' }}>
            {caps.write ? <CheckBox
              state={allSelVis ? 'on' : visSel > 0 ? 'part' : 'off'}
              label={t('yc.cli.list.selectAll')}
              onClick={() => { if (allSelVis) { setSel([]); setSelAll(false); } else { setSel(vis.map((c) => c.email)); setSelAll(false); } }}
            /> : <span />}
            {hd('name', t('yc.cli.list.col.client'))}
            <span>{t('yc.cli.list.col.status')}</span>
            {hd('n', t('yc.cli.list.col.nights'))}
            {hd('last', t('yc.cli.list.col.last'))}
            {hd('sp', t('yc.cli.list.col.spent'))}
            <span>{t('yc.cli.list.col.reach')}</span>
            <span />
          </div>

          {loading && !list ? (
            <div aria-busy="true">
              {Array.from({ length: 8 }, (_, i) => (
                <div key={i} style={{ display: 'grid', gridTemplateColumns: COLS, alignItems: 'center', gap: 12, padding: '0 clamp(18px,2.2vw,28px)', height: rowH, borderBottom: '1px solid var(--sand-100)' }}>
                  <i style={{ width: 20, height: 20, borderRadius: 6, background: 'var(--sand-100)' }} />
                  <span style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
                    <i style={{ width: 40, height: 40, borderRadius: 99, background: 'var(--sand-100)' }} />
                    <span style={{ display: 'flex', flexDirection: 'column', gap: 7 }}>
                      <i className="yc-skel" style={{ display: 'block', width: 110 + ((i * 37) % 70), height: 12, borderRadius: 6 }} />
                      <i style={{ display: 'block', width: 150 + ((i * 53) % 60), height: 10, borderRadius: 6, background: 'var(--sand-100)' }} />
                    </span>
                  </span>
                  <i style={{ display: 'block', width: 90, height: 24, borderRadius: 99, background: 'var(--sand-100)' }} />
                  <i style={{ display: 'block', width: 24, height: 12, borderRadius: 6, background: 'var(--sand-100)' }} />
                  <i style={{ display: 'block', width: 80, height: 12, borderRadius: 6, background: 'var(--sand-100)' }} />
                  <i style={{ display: 'block', width: 52, height: 12, borderRadius: 6, background: 'var(--sand-100)' }} />
                  <i style={{ display: 'block', width: 84, height: 12, borderRadius: 6, background: 'var(--sand-100)' }} />
                  <span />
                </div>
              ))}
            </div>
          ) : total > 0 ? (
            <div style={{ opacity: loading ? 0.55 : 1, transition: 'opacity 160ms' }}>
              {vis.map((c, i) => (
                <Row
                  key={c.email}
                  c={c}
                  i={i}
                  rowH={rowH}
                  selected={selAll || selSet.has(c.email)}
                  onOpen={() => onOpen(c.email)}
                  onToggle={!caps.write ? undefined : () => {
                    if (selAll) { setSelAll(false); setSel(vis.filter((x) => x.email !== c.email).map((x) => x.email)); return; }
                    setSel((cur) => (cur.includes(c.email) ? cur.filter((x) => x !== c.email) : [...cur, c.email]));
                  }}
                  now={now}
                  locale={locale}
                  fmt={{ n, eur, t, tp }}
                />
              ))}
            </div>
          ) : (
            <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 8, padding: '56px 24px', textAlign: 'center' }}>
              <span style={{ fontFamily: 'var(--font-display)', fontWeight: 600, fontSize: 22, letterSpacing: '-.02em' }}>{q.trim() ? t('yc.cli.list.noMatchQ', { q: q.trim() }) : t('yc.cli.list.noMatch')}</span>
              <span style={{ fontSize: 14.5, lineHeight: 1.5, color: 'var(--sand-500)', maxWidth: 420 }}>{q.trim() ? t('yc.cli.list.noMatchQHint') : t('yc.cli.list.noMatchHint')}</span>
              <Hv as="button" type="button" onClick={() => { setQ(''); setDef({ seg: 'all', f: {} }); }} style={{ marginTop: 8, height: 42, padding: '0 20px', borderRadius: 99, border: '1px solid var(--sand-200)', background: '#fff', fontSize: 14.5, fontWeight: 600, cursor: 'pointer', color: 'var(--ink)' }} hover={{ background: 'var(--paper)' }}>
                {t('yc.cli.list.clearFilters')}
              </Hv>
            </div>
          )}
        </div>
      </div>

      {total > 0 && (
        <div style={{ display: 'flex', flexWrap: 'wrap', alignItems: 'center', justifyContent: 'space-between', gap: '12px 16px', padding: '16px clamp(18px,2.2vw,28px)' }}>
          <span style={{ fontSize: 14, color: 'var(--sand-500)', fontVariantNumeric: 'tabular-nums' }}>{t('yc.cli.list.shown', { a: n(shown), b: n(total) })}</span>
          {shown < total && (
            <Hv as="button" type="button" onClick={onMore} style={{ height: 42, padding: '0 20px', borderRadius: 99, border: '1px solid var(--sand-200)', background: '#fff', fontSize: 14.5, fontWeight: 600, cursor: 'pointer', color: 'var(--ink)', transition: 'translate 200ms cubic-bezier(.22,1,.36,1),box-shadow 200ms' }} hover={{ translate: '0 -2px', boxShadow: 'var(--shadow-md)' }}>
              {t('yc.cli.list.more', { n: n(Math.min(12, total - shown)) })}
            </Hv>
          )}
        </div>
      )}

    </section>
  );
}

function TextBtn({ children, onClick, icon, color = 'var(--ink)', hover = 'var(--red-600)' }: { children: ReactNode; onClick: () => void; icon?: ReactNode; color?: string; hover?: string }) {
  return (
    <Hv as="button" type="button" onClick={onClick} style={{ border: 0, background: 'none', padding: 0, fontSize: 14, fontWeight: 600, color, cursor: 'pointer', display: 'inline-flex', alignItems: 'center', gap: 6 }} hover={{ color: hover }}>
      {icon}{children}
    </Hv>
  );
}

export function CheckBox({ state, label, onClick }: { state: 'on' | 'off' | 'part'; label: string; onClick: (e: React.MouseEvent) => void }) {
  const on = state !== 'off';
  return (
    <button
      type="button"
      role="checkbox"
      aria-checked={state === 'on' ? true : state === 'part' ? 'mixed' : false}
      aria-label={label}
      onClick={(e) => { e.stopPropagation(); onClick(e); }}
      style={{ width: 20, height: 20, padding: 0, borderRadius: 6, border: `1.5px solid ${on ? 'var(--ink)' : 'var(--sand-300)'}`, background: on ? 'var(--ink)' : '#fff', color: '#fff', cursor: 'pointer', display: 'grid', placeItems: 'center', transition: 'background 140ms,border-color 140ms' }}
    >
      {state === 'on' && <Icon name="check" size={12} stroke={3.4} />}
      {state === 'part' && <i style={{ width: 9, height: 2, borderRadius: 2, background: '#fff' }} />}
    </button>
  );
}

function Row({
  c, i, rowH, selected, onOpen, onToggle, now, locale, fmt,
}: {
  c: ClientRow; i: number; rowH: number; selected: boolean; onOpen: () => void; onToggle?: () => void; now: number; locale: string;
  fmt: { n: (v: number) => string; eur: (v: number) => string; t: (k: string, v?: Record<string, string | number>) => string; tp: (k: string, n: number) => string };
}) {
  const { n, eur, t, tp } = fmt;
  const av = LIFECYCLE_AVATAR[c.lifecycle];
  const name = fullName(c.first_name, c.last_name, c.email);
  const rc = c.email_ok && c.phone_ok ? ['both', 'var(--ink)'] : c.email_ok ? ['mail', 'var(--ink)'] : c.phone_ok ? ['sms', 'var(--ink)'] : ['none', 'var(--amber-700)'];
  const last = c.last_night ? new Date(c.last_night) : null;
  const days = last ? Math.max(0, Math.floor((now - last.getTime()) / 86_400_000)) : null;
  return (
    <Hv
      role="row"
      tabIndex={0}
      onClick={onOpen}
      onKeyDown={(e: React.KeyboardEvent) => { if (e.key === 'Enter' && e.target === e.currentTarget) { e.preventDefault(); onOpen(); } }}
      style={{
        display: 'grid', gridTemplateColumns: COLS, alignItems: 'center', gap: 12, padding: '0 clamp(18px,2.2vw,28px)', height: rowH,
        borderBottom: '1px solid var(--sand-100)', background: selected ? 'var(--red-50)' : 'transparent', cursor: 'pointer',
        animation: `yc-rise 480ms cubic-bezier(.22,1,.36,1) both`, animationDelay: `${Math.min(i % 12, 11) * 32}ms`, transition: 'background 140ms', outline: 0,
      }}
      hover={{ background: selected ? 'var(--red-50)' : 'var(--paper)' }}
    >
      {onToggle ? <CheckBox state={selected ? 'on' : 'off'} label={t('yc.cli.list.select')} onClick={onToggle} /> : <span />}
      <span style={{ minWidth: 0, display: 'flex', alignItems: 'center', gap: 12 }}>
        <span style={{ flex: 'none', width: 40, height: 40, borderRadius: 99, background: av[0], color: av[1], display: 'grid', placeItems: 'center', fontSize: 13.5, fontWeight: 600 }}>{initials(c.first_name, c.last_name, c.email)}</span>
        <span style={{ minWidth: 0, display: 'flex', flexDirection: 'column', gap: 1 }}>
          <span style={{ display: 'flex', alignItems: 'center', gap: 8, minWidth: 0 }}>
            <span style={{ fontSize: 15, fontWeight: 600, lineHeight: '20px', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{name}</span>
            {c.tonight && (
              <span style={{ flex: 'none', height: 20, padding: '0 8px', borderRadius: 99, background: 'var(--red-50)', color: 'var(--red-700)', fontSize: 11.5, fontWeight: 600, display: 'inline-flex', alignItems: 'center', gap: 5 }}>
                <i style={{ width: 5, height: 5, borderRadius: 99, background: 'var(--red-500)' }} />{t('yc.cli.list.tonight')}
              </span>
            )}
            {!c.tonight && c.tag && <span style={{ flex: 'none', height: 20, padding: '0 8px', borderRadius: 99, background: 'var(--sand-100)', color: 'var(--sand-700)', fontSize: 11.5, fontWeight: 600, display: 'inline-flex', alignItems: 'center' }}>{c.tag}</span>}
            {!!c.gl && (
              <span title={tp(c.gl_only ? 'yc.gl.badge.onlyTip' : 'yc.gl.badge.tip', c.gl)} style={{ flex: 'none', height: 20, padding: '0 8px', borderRadius: 99, background: c.gl_only ? 'var(--amber-50)' : 'var(--sand-100)', color: c.gl_only ? 'var(--amber-700)' : 'var(--sand-700)', fontSize: 11.5, fontWeight: 600, display: 'inline-flex', alignItems: 'center', gap: 4 }}>
                <Icon name="users" size={11} stroke={2.6} />{t('yc.gl.badge', { n: c.gl })}
              </span>
            )}
          </span>
          <span style={{ fontSize: 13, lineHeight: '17px', color: 'var(--sand-500)', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{c.email}</span>
        </span>
      </span>
      <span>
        <span style={{ height: 26, padding: '0 11px', borderRadius: 99, background: 'var(--sand-50)', boxShadow: 'inset 0 0 0 1px var(--sand-200)', display: 'inline-flex', alignItems: 'center', gap: 7, fontSize: 13, fontWeight: 500, color: 'var(--sand-700)' }}>
          <i style={{ width: 8, height: 8, borderRadius: 3, background: c.lifecycle === 'none' ? 'var(--sand-200)' : LIFECYCLE_COLOR[c.lifecycle] }} />{t(`yc.cli.seg.${c.lifecycle}`)}
        </span>
      </span>
      <span style={{ fontSize: 15, fontWeight: 600, fontVariantNumeric: 'tabular-nums' }}>{n(c.nights)}</span>
      <span style={{ display: 'flex', flexDirection: 'column', gap: 1 }}>
        {last ? (
          <>
            <span style={{ fontSize: 14.5, fontWeight: 500 }}>{last.toLocaleDateString(locale, { day: 'numeric', month: 'short', ...(last.getFullYear() !== new Date().getFullYear() ? { year: 'numeric' } : {}) })}</span>
            <span style={{ fontSize: 12.5, color: 'var(--sand-500)' }}>{relDays(days ?? 0, t, tp)}</span>
          </>
        ) : <span style={{ fontSize: 13.5, color: 'var(--sand-400)' }}>{t('yc.cli.list.never')}</span>}
      </span>
      <span style={{ fontSize: 15, fontWeight: 600, fontVariantNumeric: 'tabular-nums' }}>{eur(c.spent)}</span>
      <span style={{ fontSize: 13.5, fontWeight: 500, color: rc[1] }}>{t(`yc.cli.list.reach.${rc[0]}`)}</span>
      <Icon name="chevronRight" size={16} stroke={2.4} color="var(--sand-300)" />
    </Hv>
  );
}
