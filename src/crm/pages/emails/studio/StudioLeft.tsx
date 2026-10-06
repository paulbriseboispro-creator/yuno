/**
 * Panneau gauche du Studio : « Blocs » (bibliothèque cherchable, Contenu puis
 * Blocs Yuno, à cliquer ou glisser) et « Structure » (l'ordre des blocs, à
 * glisser ou monter / descendre ; le pied de page y figure, verrouillé). En
 * bas, l'aide et les raccourcis.
 */
import { useState } from 'react';
import type { DragEvent } from 'react';
import { Hv } from '@/crm/ui/Hv';
import { Icon } from '@/crm/ui/Icon';
import { Modal } from '@/crm/ui/kit';
import { EASE } from '@/crm/ui/motion';
import { useCrmT } from '@/crm/i18n';
import { useNights } from '@/crm/data/nights';
import { useStudio, useStudioApi } from '@/components/email-studio/store';
import { BLOCK_ICONS, PALETTE, blockSummary } from './catalog';
import { useInsertBlock, useInsertTarget } from './insert';
import { useStudioUi } from './studioUi';

const norm = (s: string) => s.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '');

export function PaletteGrid({ q, onPicked }: { q: string; onPicked?: () => void }) {
  const { t } = useCrmT();
  const ui = useStudioUi();
  const insert = useInsertBlock();
  const target = useInsertTarget();
  const query = norm(q.trim());
  const groups = (['content', 'yuno'] as const).map((g) => ({
    g,
    tiles: PALETTE.filter((p) => p.group === g && (!query || norm(`${t(`yc.em.st.b.${p.k}`)} ${t(`yc.em.st.b.${p.k}.d`)}`).includes(query))),
  })).filter((x) => x.tiles.length);

  if (!groups.length) return <div style={{ padding: '24px 8px', textAlign: 'center', fontSize: 14, color: 'var(--sand-500)' }}>{t('yc.em.st.l.none', { q })}</div>;

  return (
    <>
      {groups.map(({ g, tiles }) => {
        const yuno = g === 'yuno';
        return (
          <div key={g} style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
              <span style={{ fontFamily: 'var(--font-mono)', fontSize: 11, letterSpacing: '.08em', textTransform: 'uppercase', color: yuno ? 'var(--red-600)' : 'var(--sand-400)' }}>{t(yuno ? 'yc.em.st.l.yuno' : 'yc.em.st.l.content')}</span>
              {yuno && <><span style={{ width: 6, height: 6, borderRadius: 99, background: 'var(--red-500)' }} /><span style={{ fontSize: 12, color: 'var(--sand-500)' }}>{t('yc.em.st.l.yunoSub')}</span></>}
            </div>
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8 }}>
              {tiles.map((p) => (
                <Hv
                  key={p.k}
                  as="button"
                  type="button"
                  draggable
                  onClick={() => { insert(p.k, target()); onPicked?.(); }}
                  onDragStart={(e: DragEvent<HTMLButtonElement>) => { try { e.dataTransfer.setData('text/plain', `new:${p.k}`); e.dataTransfer.effectAllowed = 'copy'; } catch { /* navigateur sans dataTransfer : le glisser reste interne */ } ui.setDrag({ kind: 'new', k: p.k }); }}
                  onDragEnd={() => { ui.setDrag(null); ui.setDropAt(null); }}
                  title={t(`yc.em.st.b.${p.k}.d`)}
                  style={{ display: 'flex', flexDirection: 'column', alignItems: 'flex-start', gap: 10, padding: 12, borderRadius: 16, borderWidth: 1, borderStyle: 'solid', borderColor: yuno ? 'var(--red-200)' : 'var(--sand-200)', background: yuno ? 'var(--red-50)' : '#fff', cursor: 'grab', textAlign: 'left', color: 'var(--ink)', transition: `translate 200ms ${EASE},box-shadow 200ms,border-color 160ms` }}
                  hover={{ translate: '0 -2px', boxShadow: 'var(--shadow-sm)', borderColor: 'var(--sand-300)' }}
                  active={{ cursor: 'grabbing', translate: '0 0' }}
                >
                  <span style={{ width: 34, height: 34, borderRadius: 11, background: yuno ? '#fff' : 'var(--sand-100)', color: yuno ? 'var(--red-600)' : 'var(--sand-700)', display: 'grid', placeItems: 'center' }}><Icon d={p.d} size={18} stroke={2} /></span>
                  <span style={{ display: 'flex', flexDirection: 'column', gap: 1 }}>
                    <b style={{ fontSize: 14, lineHeight: '17px' }}>{t(`yc.em.st.b.${p.k}`)}</b>
                    <span style={{ fontSize: 12, lineHeight: '15px', color: 'var(--sand-500)' }}>{t(`yc.em.st.b.${p.k}.d`)}</span>
                  </span>
                </Hv>
              ))}
            </div>
          </div>
        );
      })}
    </>
  );
}

export function StudioLeft({ collapsed }: { collapsed: boolean }) {
  const { t } = useCrmT();
  const api = useStudioApi();
  const tab = useStudio((s) => s.paletteTab);
  const insertIndex = useStudio((s) => s.insertIndex);
  const [q, setQ] = useState('');
  const keys: { k: string; l: string }[] = [
    { k: '⌘Z', l: t('yc.em.st.k.undo') }, { k: '⌘D', l: t('yc.em.st.k.dup') }, { k: '⌫', l: t('yc.em.st.k.del') },
    { k: '↑↓', l: t('yc.em.st.k.move') }, { k: 'P', l: t('yc.em.st.k.prev') }, { k: 'Esc', l: t('yc.em.st.k.esc') },
  ];
  return (
    <aside style={{ flex: 'none', boxSizing: 'border-box', width: collapsed ? 0 : 300, opacity: collapsed ? 0 : 1, overflow: 'hidden', background: '#fff', borderRight: '1px solid var(--sand-100)', display: 'flex', flexDirection: 'column', transition: `width 320ms ${EASE},opacity 220ms`, animation: `yc-slide-l 700ms ${EASE} 150ms both` }}>
      <div style={{ width: 300, flex: 1, minHeight: 0, display: 'flex', flexDirection: 'column' }}>
        <div style={{ padding: '16px 16px 12px' }}>
          <div role="tablist" style={{ display: 'flex', padding: 3, gap: 2, background: 'var(--sand-100)', borderRadius: 99 }}>
            {(['blocks', 'structure'] as const).map((k) => {
              const on = tab === k;
              return (
                <button key={k} type="button" role="tab" aria-selected={on} onClick={() => api.getState().setPaletteTab(k)} style={{ flex: 1, height: 36, border: 0, borderRadius: 99, background: on ? '#fff' : 'transparent', boxShadow: on ? 'var(--shadow-xs)' : 'none', fontSize: 14, fontWeight: 600, color: on ? 'var(--ink)' : 'var(--sand-600)', cursor: 'pointer', transition: 'background 160ms' }}>
                  {t(k === 'blocks' ? 'yc.em.st.l.blocks' : 'yc.em.st.l.struct')}
                </button>
              );
            })}
          </div>
        </div>

        {tab === 'blocks' ? (
          <>
            <div style={{ padding: '0 16px 10px' }}>
              <label className="yc-field" style={{ height: 40, boxSizing: 'border-box', display: 'flex', alignItems: 'center', gap: 10, padding: '0 14px', borderRadius: 99, background: 'var(--paper)', border: '1px solid var(--sand-200)', cursor: 'text' }}>
                <Icon name="search" size={15} stroke={2.2} color="var(--sand-400)" />
                <input value={q} onChange={(e) => setQ(e.target.value)} placeholder={t('yc.em.st.l.search')} aria-label={t('yc.em.st.l.search')} style={{ flex: 1, minWidth: 0, border: 0, outline: 0, background: 'transparent', fontSize: 14, color: 'var(--ink)' }} />
              </label>
            </div>
            {insertIndex !== null && (
              <div style={{ margin: '0 16px 10px', padding: '12px 14px', borderRadius: 14, background: 'var(--red-50)', boxShadow: 'inset 0 0 0 1px var(--red-200)', display: 'flex', alignItems: 'center', gap: 10, animation: `yc-pop 200ms ${EASE}` }}>
                <span style={{ flex: 1, fontSize: 13.5, lineHeight: 1.35, fontWeight: 600, color: 'var(--red-800)' }}>{t('yc.em.st.l.ins', { n: insertIndex + 1 })}</span>
                <button type="button" onClick={() => api.getState().setInsertIndex(null)} style={{ height: 30, padding: '0 12px', border: 0, borderRadius: 99, background: '#fff', fontSize: 13, fontWeight: 600, color: 'var(--red-700)', cursor: 'pointer' }}>{t('yc.em.st.l.insCancel')}</button>
              </div>
            )}
            <div className="yc-thin-scroll" style={{ flex: 1, minHeight: 0, overflowY: 'auto', padding: '0 16px 12px', display: 'flex', flexDirection: 'column', gap: 16 }}>
              <PaletteGrid q={q} />
            </div>
          </>
        ) : (
          <StructureList />
        )}

        <div style={{ flex: 'none', padding: '14px 16px 16px', borderTop: '1px solid var(--sand-100)', display: 'flex', flexDirection: 'column', gap: 10, background: 'var(--paper)' }}>
          <span style={{ fontSize: 13, lineHeight: 1.45, color: 'var(--sand-600)', textWrap: 'pretty' }}>
            {t('yc.em.st.l.help.a')}
            <b style={{ display: 'inline-grid', placeItems: 'center', width: 18, height: 18, borderRadius: 99, background: 'var(--red-500)', color: '#fff', fontSize: 13, lineHeight: 1, verticalAlign: -3 }}>+</b>
            {t('yc.em.st.l.help.b')}
          </span>
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: '6px 12px', fontSize: 12, color: 'var(--sand-500)' }}>
            {keys.map((k) => (
              <span key={k.k} style={{ display: 'inline-flex', alignItems: 'center', gap: 5 }}>
                <kbd style={{ height: 20, padding: '0 6px', borderRadius: 6, background: '#fff', boxShadow: 'inset 0 0 0 1px var(--sand-200)', font: "500 11.5px/20px 'Geist Mono',monospace", color: 'var(--sand-700)' }}>{k.k}</kbd>{k.l}
              </span>
            ))}
          </div>
        </div>
      </div>
    </aside>
  );
}

function StructureList() {
  const { t } = useCrmT();
  const api = useStudioApi();
  const ui = useStudioUi();
  const insert = useInsertBlock();
  const nights = useNights();
  const blocks = useStudio((s) => s.campaign.blocks);
  const selectedId = useStudio((s) => s.selectedId);
  const nightTitle = (id?: string) => (id ? nights.data?.nights.find((x) => x.id === id)?.title ?? null : null);

  const drop = (e: DragEvent) => {
    e.preventDefault();
    const at = ui.dropAt;
    const d = ui.drag;
    ui.setDrag(null); ui.setDropAt(null);
    if (!d || at === null) return;
    if (d.kind === 'new') { insert(d.k, at); return; }
    const from = api.getState().campaign.blocks.findIndex((b) => b.id === d.id);
    if (from < 0) return;
    const to = at > from ? at - 1 : at;
    if (to !== from) api.getState().reorderBlock(from, to);
  };
  const overRow = (i: number) => (e: DragEvent<HTMLDivElement>) => {
    if (!ui.drag) return;
    e.preventDefault();
    const r = e.currentTarget.getBoundingClientRect();
    const at = e.clientY < r.top + r.height / 2 ? i : i + 1;
    if (ui.dropAt !== at) ui.setDropAt(at);
  };

  return (
    <div className="yc-thin-scroll" style={{ flex: 1, minHeight: 0, overflowY: 'auto', padding: '0 12px 12px', display: 'flex', flexDirection: 'column', gap: 2 }}>
      {blocks.map((b, i) => {
        const on = selectedId === b.id;
        return (
          <div key={b.id} style={{ position: 'relative' }} onDragOver={overRow(i)} onDrop={drop}>
            {ui.drag && ui.dropAt === i && <div style={{ position: 'absolute', left: 8, right: 8, top: -2, height: 3, borderRadius: 2, background: 'var(--red-500)', zIndex: 2 }} />}
            <Hv
              onClick={() => api.getState().select(b.id)}
              style={{ display: 'flex', alignItems: 'center', gap: 10, height: 46, padding: '0 6px 0 4px', borderRadius: 14, background: on ? 'var(--red-50)' : 'transparent', boxShadow: `inset 0 0 0 ${on ? 1.5 : 0}px var(--red-300)`, cursor: 'pointer', transition: 'background 140ms' }}
              hover={{ background: on ? 'var(--red-50)' : 'var(--sand-50)' }}
            >
              <span
                draggable
                onDragStart={(e) => { try { e.dataTransfer.setData('text/plain', b.id); } catch { /* glisser interne */ } ui.setDrag({ kind: 'move', id: b.id }); api.getState().select(b.id); }}
                onDragEnd={() => { ui.setDrag(null); ui.setDropAt(null); }}
                title={t('yc.em.st.drag')}
                style={{ flex: 'none', width: 22, height: 34, color: 'var(--sand-300)', display: 'grid', placeItems: 'center', cursor: 'grab' }}
              >
                <Icon d="M9 5h.01M9 12h.01M9 19h.01M15 5h.01M15 12h.01M15 19h.01" size={14} stroke={3} />
              </span>
              <span style={{ flex: 'none', width: 30, height: 30, borderRadius: 10, background: on ? '#fff' : 'var(--sand-100)', color: on ? 'var(--red-600)' : 'var(--sand-600)', display: 'grid', placeItems: 'center' }}><Icon d={BLOCK_ICONS[b.type] ?? BLOCK_ICONS.text} size={16} stroke={2} /></span>
              <span style={{ flex: 1, minWidth: 0, display: 'flex', flexDirection: 'column' }}>
                <b style={{ fontSize: 13.5, lineHeight: '16px' }}>{t(`yc.em.st.b.${b.type}`)}</b>
                <span style={{ fontSize: 12, lineHeight: '15px', color: 'var(--sand-500)', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{blockSummary(b, t, nightTitle)}</span>
              </span>
              <span style={{ flex: 'none', display: 'flex', opacity: on ? 1 : 0.5 }}>
                <MiniBtn label={t('yc.em.st.up')} d="m18 15-6-6-6 6" onClick={() => api.getState().moveBlock(b.id, -1)} />
                <MiniBtn label={t('yc.em.st.down')} d="m6 9 6 6 6-6" onClick={() => api.getState().moveBlock(b.id, 1)} />
              </span>
            </Hv>
          </div>
        );
      })}
      {ui.drag && ui.dropAt === blocks.length && <div style={{ height: 3, margin: '2px 8px', borderRadius: 2, background: 'var(--red-500)' }} />}
      <div
        onDragOver={(e) => { if (!ui.drag) return; e.preventDefault(); if (ui.dropAt !== blocks.length) ui.setDropAt(blocks.length); }}
        onDrop={drop}
        style={{ marginTop: 4, display: 'flex', alignItems: 'center', gap: 10, height: 46, padding: '0 10px', borderRadius: 14, background: 'var(--paper)', boxShadow: 'inset 0 0 0 1px var(--sand-100)' }}
      >
        <span style={{ width: 30, height: 30, borderRadius: 10, background: 'var(--sand-100)', color: 'var(--sand-500)', display: 'grid', placeItems: 'center' }}><Icon d={BLOCK_ICONS.footer} size={15} stroke={2.2} /></span>
        <span style={{ display: 'flex', flexDirection: 'column' }}>
          <b style={{ fontSize: 13.5, lineHeight: '16px', color: 'var(--sand-600)' }}>{t('yc.em.st.footer')}</b>
          <span style={{ fontSize: 12, lineHeight: '15px', color: 'var(--sand-500)' }}>{t('yc.em.st.footerSub')}</span>
        </span>
      </div>
    </div>
  );
}

function MiniBtn({ label, d, onClick }: { label: string; d: string; onClick: () => void }) {
  return (
    <Hv as="button" type="button" onClick={(e: React.MouseEvent) => { e.stopPropagation(); onClick(); }} aria-label={label} title={label} style={{ width: 24, height: 28, border: 0, borderRadius: 8, background: 'none', color: 'var(--sand-500)', cursor: 'pointer', display: 'grid', placeItems: 'center' }} hover={{ background: 'var(--sand-200)', color: 'var(--ink)' }}>
      <Icon d={d} size={14} stroke={2.4} />
    </Hv>
  );
}

/** Petit écran : la bibliothèque s'ouvre en fenêtre depuis un « + ». */
export function PaletteModal() {
  const { t } = useCrmT();
  const ui = useStudioUi();
  const api = useStudioApi();
  const [q, setQ] = useState('');
  const close = () => { ui.setPaletteOpen(false); api.getState().setInsertIndex(null); };
  return (
    <Modal open={ui.paletteOpen} onClose={close} width={560} label={t('yc.em.st.l.blocks')}>
      <div style={{ padding: 22, display: 'flex', flexDirection: 'column', gap: 14 }}>
        <label className="yc-field" style={{ height: 42, boxSizing: 'border-box', display: 'flex', alignItems: 'center', gap: 10, padding: '0 14px', borderRadius: 99, background: 'var(--paper)', border: '1px solid var(--sand-200)' }}>
          <Icon name="search" size={15} stroke={2.2} color="var(--sand-400)" />
          <input value={q} onChange={(e) => setQ(e.target.value)} placeholder={t('yc.em.st.l.search')} aria-label={t('yc.em.st.l.search')} style={{ flex: 1, minWidth: 0, border: 0, outline: 0, background: 'transparent', fontSize: 15 }} />
        </label>
        <PaletteGrid q={q} onPicked={() => ui.setPaletteOpen(false)} />
      </div>
    </Modal>
  );
}
