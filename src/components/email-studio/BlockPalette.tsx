import { useMemo, useState } from 'react';
import { ChevronRight, CornerDownRight, LayoutTemplate, Lightbulb, Search } from 'lucide-react';
import { useLanguage } from '@/contexts/LanguageContext';
import { migrateV1Blocks, type BlockType } from '@/lib/email';
import { getTemplatePresets, type TemplatePreset } from '@/components/email-editor/templates';
import { useStudio } from './store';
import type { StudioScope } from './hooks';
import { BLOCK_META, type BlockGroup } from './meta';
import StructureTree from './StructureTree';
import {
  BORDER, BORDER_FAINT, FONT_UI, MicroLabel, PANEL_BG, RED, SUBTLE, ShortcutRow,
  ACTIVE_GRAD, T1, T2, T3,
} from './ui';

const DRAG_TYPE_NEW = 'application/x-yn-block-type';

const GROUP_ORDER: { group: BlockGroup; labelKey: string; accent?: boolean }[] = [
  { group: 'content', labelKey: 'studio.palette.groupContent' },
  { group: 'yuno', labelKey: 'studio.palette.groupYuno', accent: true },
  { group: 'advanced', labelKey: 'studio.palette.groupAdvanced' },
];

export default function BlockPalette({ scope }: { scope: StudioScope }) {
  const { t } = useLanguage();
  const tab = useStudio((s) => s.paletteTab);
  const setTab = useStudio((s) => s.setPaletteTab);
  const insertIndex = useStudio((s) => s.insertIndex);
  const setInsertIndex = useStudio((s) => s.setInsertIndex);
  const addBlock = useStudio((s) => s.addBlock);
  const setBlocks = useStudio((s) => s.setBlocks);
  const patchContent = useStudio((s) => s.patchContent);
  const subject = useStudio((s) => s.campaign.subject);
  const [query, setQuery] = useState('');
  const [templatesOpen, setTemplatesOpen] = useState(false);

  const templates = useMemo(() => getTemplatePresets(t), [t]);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return BLOCK_META;
    return BLOCK_META.filter((m) => t(m.labelKey).toLowerCase().includes(q));
  }, [query, t]);

  const applyTemplate = (tpl: TemplatePreset) => {
    const v1 = tpl.blocks({ name: scope.name, logoUrl: scope.logoUrl });
    setBlocks(migrateV1Blocks(v1, scope.name));
    if (!subject.trim() || subject === '—') patchContent({ subject: tpl.subject });
    setTemplatesOpen(false);
  };

  return (
    <aside style={{
      width: 274, flex: 'none', display: 'flex', flexDirection: 'column',
      background: PANEL_BG, borderRight: `1px solid ${BORDER}`, minHeight: 0,
    }}>
      {/* Onglets Blocs / Structure */}
      <div style={{ flex: 'none', padding: '12px 14px 10px' }}>
        <div style={{
          display: 'flex', width: '100%', gap: 2, padding: 3, borderRadius: 11,
          background: SUBTLE, border: `1px solid ${BORDER}`,
        }}>
          {(['blocks', 'structure'] as const).map((k) => (
            <button
              key={k} type="button" onClick={() => setTab(k)}
              style={{
                flex: 1, textAlign: 'center', padding: 6, borderRadius: 8,
                fontSize: 12, fontWeight: 560, cursor: 'pointer', border: 'none', fontFamily: FONT_UI,
                background: tab === k ? ACTIVE_GRAD : 'transparent',
                color: tab === k ? T1 : T3,
              }}
            >{t(k === 'blocks' ? 'studio.palette.tabBlocks' : 'studio.palette.tabStructure')}</button>
          ))}
        </div>
        {tab === 'blocks' && (
          <div style={{
            display: 'flex', alignItems: 'center', gap: 8, marginTop: 8, padding: '0 10px',
            borderRadius: 10, background: SUBTLE, border: `1px solid ${BORDER}`,
          }}>
            <Search size={14} strokeWidth={1.75} style={{ color: T3, flex: 'none' }} />
            <input
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder={t('studio.palette.search')}
              aria-label={t('studio.palette.search')}
              style={{
                flex: 1, minWidth: 0, background: 'transparent', border: 'none',
                padding: '9px 0', color: T1, fontSize: 12.5, fontFamily: FONT_UI, outline: 'none',
              }}
            />
          </div>
        )}
      </div>

      {/* Bandeau mode insertion */}
      {insertIndex != null && (
        <div className="yn-in" style={{
          margin: '0 14px 10px', padding: '9px 11px', borderRadius: 11,
          background: 'rgba(232,25,44,0.09)', border: '1px solid rgba(232,25,44,0.25)',
          display: 'flex', alignItems: 'center', gap: 8,
        }}>
          <CornerDownRight size={14} strokeWidth={1.75} style={{ color: RED, flex: 'none' }} />
          <span style={{ flex: 1, color: T1, fontSize: 11.5, fontWeight: 500, fontFamily: FONT_UI }}>
            {t('studio.palette.insertMode')}
          </span>
          <button
            type="button" onClick={() => setInsertIndex(null)}
            style={{ color: T3, fontSize: 11, cursor: 'pointer', background: 'transparent', border: 'none', fontFamily: FONT_UI }}
          >{t('em.common.cancel')}</button>
        </div>
      )}

      {tab === 'blocks' ? (
        <div style={{ flex: 1, overflowY: 'auto', padding: '0 14px 14px', display: 'flex', flexDirection: 'column', gap: 16, minHeight: 0 }}>
          {GROUP_ORDER.map(({ group, labelKey, accent }) => {
            const items = filtered.filter((m) => m.group === group);
            if (items.length === 0) return null;
            return (
              <div key={group}>
                {accent ? (
                  <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 8 }}>
                    <span style={{ color: RED, fontSize: 10.5, fontWeight: 600, letterSpacing: '0.08em', textTransform: 'uppercase', fontFamily: FONT_UI }}>
                      {t(labelKey)}
                    </span>
                    <span style={{ flex: 1, height: 1, background: 'rgba(232,25,44,0.18)' }} />
                    <span style={{ color: T3, fontSize: 10, fontFamily: FONT_UI }}>{t('studio.palette.liveTag')}</span>
                  </div>
                ) : (
                  <MicroLabel style={{ marginBottom: 8 }}>{t(labelKey)}</MicroLabel>
                )}
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
                        onClick={() => addBlock(m.type as BlockType, insertIndex)}
                        onMouseEnter={(e) => {
                          if (accent) e.currentTarget.style.borderColor = 'rgba(232,25,44,0.5)';
                          else { e.currentTarget.style.background = 'rgba(255,255,255,0.07)'; e.currentTarget.style.color = T1; }
                        }}
                        onMouseLeave={(e) => {
                          if (accent) e.currentTarget.style.borderColor = 'rgba(232,25,44,0.22)';
                          else { e.currentTarget.style.background = SUBTLE; e.currentTarget.style.color = T2; }
                        }}
                        style={{
                          display: 'flex', flexDirection: 'column', alignItems: 'flex-start', gap: 7,
                          padding: '11px 10px', borderRadius: 12, cursor: 'grab',
                          transition: 'all .15s', textAlign: 'left', fontFamily: FONT_UI,
                          ...(accent
                            ? { background: 'linear-gradient(135deg,rgba(232,25,44,0.14),rgba(232,25,44,0.04))', border: '1px solid rgba(232,25,44,0.22)', color: T1 }
                            : { background: SUBTLE, border: `1px solid ${BORDER}`, color: T2 }),
                        }}
                      >
                        <Icon size={16} strokeWidth={1.75} style={accent ? { color: RED } : undefined} />
                        <span style={{ fontSize: 11.5, fontWeight: 500 }}>{t(m.labelKey)}</span>
                      </button>
                    );
                  })}
                </div>
              </div>
            );
          })}

          {query.trim().length > 0 && filtered.length === 0 && (
            <div style={{ textAlign: 'center', padding: '18px 10px', color: T3, fontSize: 11.5, fontFamily: FONT_UI }}>
              {t('studio.palette.noResults')}
            </div>
          )}

          {/* Aide */}
          <div style={{ padding: 12, borderRadius: 12, border: '1px dashed rgba(255,255,255,0.14)', display: 'flex', gap: 9, alignItems: 'flex-start' }}>
            <Lightbulb size={14} strokeWidth={1.75} style={{ color: T3, marginTop: 1, flex: 'none' }} />
            <span style={{ color: T3, fontSize: 11, lineHeight: 1.55, fontFamily: FONT_UI }}>
              {t('studio.palette.helpPre')} <span style={{ color: RED }}>+</span> {t('studio.palette.helpPost')}
            </span>
          </div>

          {/* Raccourcis */}
          <div style={{
            padding: 12, borderRadius: 12, background: SUBTLE, border: `1px solid ${BORDER}`,
            display: 'flex', flexDirection: 'column', gap: 7,
          }}>
            <MicroLabel style={{ fontSize: 10 }}>{t('studio.palette.shortcuts')}</MicroLabel>
            <ShortcutRow keys="⌘Z" label={t('studio.shortcut.undo')} />
            <ShortcutRow keys="⌘⇧Z" label={t('studio.shortcut.redo')} />
            <ShortcutRow keys="⌘D" label={t('studio.shortcut.duplicate')} />
            <ShortcutRow keys="⌫" label={t('studio.shortcut.delete')} />
            <ShortcutRow keys="⌥↑ ⌥↓" label={t('studio.shortcut.move')} />
            <ShortcutRow keys="P" label={t('studio.shortcut.preview')} />
            <ShortcutRow keys="Esc" label={t('studio.shortcut.deselect')} />
          </div>
        </div>
      ) : (
        <div style={{ flex: 1, overflowY: 'auto', padding: '0 12px 14px', minHeight: 0 }}>
          <StructureTree />
        </div>
      )}

      {/* Partir d'un template */}
      <div style={{ flex: 'none', borderTop: `1px solid ${BORDER_FAINT}`, position: 'relative' }}>
        {templatesOpen && (
          <div className="yn-in" style={{
            position: 'absolute', bottom: '100%', left: 10, right: 10, marginBottom: 8, zIndex: 30,
            background: PANEL_BG, border: `1px solid ${BORDER}`, borderRadius: 12, padding: 6,
            boxShadow: '0 24px 48px -24px #000', maxHeight: 260, overflowY: 'auto',
          }}>
            {templates.map((tpl) => (
              <button
                key={tpl.id} type="button" onClick={() => applyTemplate(tpl)}
                onMouseEnter={(e) => { e.currentTarget.style.background = 'rgba(255,255,255,0.05)'; }}
                onMouseLeave={(e) => { e.currentTarget.style.background = 'transparent'; }}
                style={{
                  display: 'block', width: '100%', textAlign: 'left', padding: '8px 10px',
                  borderRadius: 9, border: 'none', background: 'transparent', cursor: 'pointer',
                }}
              >
                <div style={{ color: T1, fontSize: 12, fontWeight: 600, fontFamily: FONT_UI }}>{tpl.name}</div>
                <div style={{
                  color: T3, fontSize: 11, fontFamily: FONT_UI, whiteSpace: 'nowrap',
                  overflow: 'hidden', textOverflow: 'ellipsis',
                }}>{tpl.subject}</div>
              </button>
            ))}
          </div>
        )}
        <button
          type="button"
          onClick={() => setTemplatesOpen((v) => !v)}
          style={{
            display: 'flex', alignItems: 'center', gap: 8, width: '100%', padding: '11px 14px',
            background: 'transparent', border: 'none', cursor: 'pointer',
          }}
        >
          <LayoutTemplate size={14} strokeWidth={1.75} style={{ color: T3 }} />
          <span style={{ flex: 1, color: T2, fontSize: 12, textAlign: 'left', fontFamily: FONT_UI }}>
            {t('studio.palette.templates')}
          </span>
          <ChevronRight size={14} strokeWidth={1.75} style={{ color: T3, transform: templatesOpen ? 'rotate(90deg)' : 'none', transition: 'transform .15s' }} />
        </button>
      </div>
    </aside>
  );
}
