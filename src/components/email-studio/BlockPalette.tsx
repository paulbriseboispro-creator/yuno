import { useMemo, useState } from 'react';
import { Search, X } from 'lucide-react';
import { useLanguage } from '@/contexts/LanguageContext';
import type { BlockType } from '@/lib/email';
import { useStudio } from './store';
import { BLOCK_META, type BlockGroup } from './meta';
import StructureTree from './StructureTree';
import {
  BORDER, FONT_UI, Help, MicroLabel, PANEL_BG, RED, SUBTLE, ShortcutRow, T1, T2, T3,
} from './ui';

const DRAG_TYPE_NEW = 'application/x-yn-block-type';

const GROUP_ORDER: { group: BlockGroup; labelKey: string; accent?: boolean }[] = [
  { group: 'content', labelKey: 'studio.palette.groupContent' },
  { group: 'yuno', labelKey: 'studio.palette.groupYuno', accent: true },
  { group: 'advanced', labelKey: 'studio.palette.groupAdvanced' },
];

export default function BlockPalette() {
  const { t } = useLanguage();
  const tab = useStudio((s) => s.paletteTab);
  const setTab = useStudio((s) => s.setPaletteTab);
  const insertIndex = useStudio((s) => s.insertIndex);
  const setInsertIndex = useStudio((s) => s.setInsertIndex);
  const addBlock = useStudio((s) => s.addBlock);
  const [query, setQuery] = useState('');

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return BLOCK_META;
    return BLOCK_META.filter((m) => t(m.labelKey).toLowerCase().includes(q));
  }, [query, t]);

  const insert = (type: BlockType) => {
    addBlock(type, insertIndex);
  };

  return (
    <aside style={{
      width: 274, flex: 'none', display: 'flex', flexDirection: 'column',
      background: PANEL_BG, borderRight: `1px solid ${BORDER}`, minHeight: 0,
    }}>
      {/* Onglets Blocs / Structure */}
      <div style={{ display: 'flex', gap: 2, padding: '10px 12px 0' }}>
        {(['blocks', 'structure'] as const).map((k) => (
          <button
            key={k} type="button" onClick={() => setTab(k)}
            style={{
              flex: 1, border: 'none', cursor: 'pointer', borderRadius: 8,
              padding: '6px 0', fontSize: 12, fontWeight: 600, fontFamily: FONT_UI,
              background: tab === k ? SUBTLE : 'transparent',
              color: tab === k ? T1 : T3, transition: 'all .12s',
            }}
          >{t(k === 'blocks' ? 'studio.palette.tabBlocks' : 'studio.palette.tabStructure')}</button>
        ))}
      </div>

      {/* Bandeau mode insertion */}
      {insertIndex != null && (
        <div className="yn-in" style={{
          margin: '10px 12px 0', padding: '8px 10px', borderRadius: 8,
          background: 'rgba(232,25,44,0.10)', border: `1px solid rgba(232,25,44,0.35)`,
          display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8,
        }}>
          <span style={{ fontSize: 11.5, fontWeight: 600, color: RED, fontFamily: FONT_UI }}>
            {t('studio.palette.insertMode')}
          </span>
          <button
            type="button" onClick={() => setInsertIndex(null)}
            aria-label={t('studio.palette.insertCancel')}
            style={{ background: 'transparent', border: 'none', color: RED, cursor: 'pointer', display: 'flex' }}
          ><X size={13} strokeWidth={2} /></button>
        </div>
      )}

      {tab === 'blocks' ? (
        <>
          {/* Recherche */}
          <div style={{ padding: '10px 12px 4px', position: 'relative' }}>
            <Search size={13} strokeWidth={1.75} style={{ position: 'absolute', left: 22, top: 18, color: T3 }} />
            <input
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder={t('studio.palette.search')}
              aria-label={t('studio.palette.search')}
              style={{
                width: '100%', background: SUBTLE, border: `1px solid ${BORDER}`, borderRadius: 7,
                color: T1, fontSize: 12, fontFamily: FONT_UI, padding: '7px 10px 7px 28px', outline: 'none',
              }}
            />
          </div>

          {/* Grille 2 colonnes par groupe */}
          <div style={{ flex: 1, overflowY: 'auto', padding: '8px 12px 12px', minHeight: 0 }}>
            {GROUP_ORDER.map(({ group, labelKey, accent }) => {
              const items = filtered.filter((m) => m.group === group);
              if (items.length === 0) return null;
              return (
                <div key={group} style={{ marginBottom: 14 }}>
                  <MicroLabel style={{ color: accent ? RED : T3, margin: '6px 2px 8px' }}>
                    {t(labelKey)}
                  </MicroLabel>
                  <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 6 }}>
                    {items.map((m) => {
                      const Icon = m.icon;
                      return (
                        <button
                          key={m.type} type="button"
                          draggable
                          onDragStart={(e) => {
                            e.dataTransfer.setData(DRAG_TYPE_NEW, m.type);
                            e.dataTransfer.effectAllowed = 'copy';
                          }}
                          onClick={() => insert(m.type)}
                          onMouseEnter={(e) => { e.currentTarget.style.background = 'rgba(255,255,255,0.06)'; }}
                          onMouseLeave={(e) => { e.currentTarget.style.background = SUBTLE; }}
                          style={{
                            display: 'flex', flexDirection: 'column', alignItems: 'flex-start', gap: 7,
                            background: SUBTLE, border: `1px solid ${accent ? 'rgba(232,25,44,0.22)' : BORDER}`,
                            borderRadius: 9, padding: '10px 10px 9px', cursor: 'grab',
                            transition: 'background .12s', textAlign: 'left',
                          }}
                        >
                          <Icon size={16} strokeWidth={1.75} style={{ color: accent ? RED : T2 }} />
                          <span style={{ fontSize: 11.5, fontWeight: 600, color: T1, fontFamily: FONT_UI }}>
                            {t(m.labelKey)}
                          </span>
                        </button>
                      );
                    })}
                  </div>
                </div>
              );
            })}
          </div>
        </>
      ) : (
        <div style={{ flex: 1, overflowY: 'auto', padding: '10px 12px', minHeight: 0 }}>
          <StructureTree />
        </div>
      )}

      {/* Aide + raccourcis */}
      <div style={{ borderTop: `1px solid ${BORDER}`, padding: '10px 14px 12px', display: 'flex', flexDirection: 'column', gap: 7 }}>
        <Help>{t('studio.palette.help')}</Help>
        <ShortcutRow keys="⌘Z / ⇧⌘Z" label={t('studio.shortcut.undo')} />
        <ShortcutRow keys="⌘D" label={t('studio.shortcut.duplicate')} />
        <ShortcutRow keys="⌫" label={t('studio.shortcut.delete')} />
        <ShortcutRow keys="↑ / ↓" label={t('studio.shortcut.move')} />
        <ShortcutRow keys="P" label={t('studio.shortcut.preview')} />
        <ShortcutRow keys="Esc" label={t('studio.shortcut.deselect')} />
      </div>
    </aside>
  );
}
