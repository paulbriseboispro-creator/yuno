import { useState } from 'react';
import { ChevronDown, ChevronUp, GripVertical, Lock, PanelBottom, Trash2 } from 'lucide-react';
import { useLanguage } from '@/contexts/LanguageContext';
import type { EmailBlock } from '@/lib/email';
import { useStudio } from './store';
import { blockMeta, FOOTER_SELECTION_ID } from './meta';
import { FONT_UI, RED, T1, T3 } from './ui';

function blockSnippet(b: EmailBlock): string {
  switch (b.type) {
    case 'header': return b.venueName;
    case 'text': return b.body.replace(/<[^>]+>/g, ' ').trim().slice(0, 34);
    case 'image': return b.label || '';
    case 'cta': return b.label;
    case 'event': return b.title;
    case 'table': return b.title;
    case 'countdown': return b.label;
    case 'html': return b.code.slice(0, 34);
    default: return '';
  }
}

/** Arborescence des blocs — sélection synchronisée, réordonnable (prototype). */
export default function StructureTree() {
  const { t } = useLanguage();
  const blocks = useStudio((s) => s.campaign.blocks);
  const selectedId = useStudio((s) => s.selectedId);
  const select = useStudio((s) => s.select);
  const moveBlock = useStudio((s) => s.moveBlock);
  const removeBlock = useStudio((s) => s.removeBlock);
  const reorderBlock = useStudio((s) => s.reorderBlock);
  const [dragFrom, setDragFrom] = useState<number | null>(null);
  const [dropAt, setDropAt] = useState<number | null>(null);

  const footerSelected = selectedId === FOOTER_SELECTION_ID;

  /** Le pied de page ferme toujours la liste : ni déplaçable, ni supprimable. */
  const footerRow = (
    <div
      role="button"
      tabIndex={0}
      onClick={() => select(FOOTER_SELECTION_ID)}
      onKeyDown={(e) => { if (e.key === 'Enter') select(FOOTER_SELECTION_ID); }}
      style={{
        display: 'flex', alignItems: 'center', gap: 9, padding: '8px 9px', borderRadius: 11,
        cursor: 'pointer', marginTop: blocks.length > 0 ? 4 : 0,
        background: footerSelected ? 'rgba(232,25,44,0.09)' : 'transparent',
        border: `1px solid ${footerSelected ? 'rgba(232,25,44,0.22)' : 'transparent'}`,
      }}
    >
      <span style={{ width: 13, flex: 'none' }} />
      <PanelBottom size={14} strokeWidth={1.75} style={{ color: footerSelected ? RED : 'rgba(255,255,255,0.35)', flex: 'none' }} />
      <span style={{
        flex: 1, fontSize: 12.5, fontWeight: 500, fontFamily: FONT_UI,
        color: footerSelected ? T1 : 'rgba(255,255,255,0.55)',
        whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis',
      }}>
        {t('studio.footer.label')}
      </span>
      <Lock size={12} strokeWidth={1.75} style={{ color: 'rgba(255,255,255,0.22)', flex: 'none' }} />
    </div>
  );

  if (blocks.length === 0) {
    return (
      <div style={{ display: 'flex', flexDirection: 'column', gap: 3 }}>
        <p style={{ fontSize: 11.5, color: T3, fontFamily: FONT_UI, padding: '4px 2px' }}>{t('studio.structure.empty')}</p>
        {footerRow}
      </div>
    );
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 3 }}>
      {blocks.map((b, i) => {
        const meta = blockMeta(b.type);
        const Icon = meta.icon;
        const selected = b.id === selectedId;
        const snippet = blockSnippet(b);
        return (
          <div key={b.id}>
            {dropAt === i && dragFrom != null && (
              <div style={{ height: 2, background: RED, borderRadius: 2, margin: '2px 4px' }} />
            )}
            <div
              role="button"
              tabIndex={0}
              draggable
              onDragStart={(e) => { setDragFrom(i); e.dataTransfer.effectAllowed = 'move'; }}
              onDragOver={(e) => {
                e.preventDefault();
                const rect = e.currentTarget.getBoundingClientRect();
                setDropAt(e.clientY < rect.top + rect.height / 2 ? i : i + 1);
              }}
              onDrop={(e) => {
                e.preventDefault();
                if (dragFrom != null && dropAt != null) {
                  reorderBlock(dragFrom, dragFrom < dropAt ? dropAt - 1 : dropAt);
                }
                setDragFrom(null); setDropAt(null);
              }}
              onDragEnd={() => { setDragFrom(null); setDropAt(null); }}
              onClick={() => select(b.id)}
              onKeyDown={(e) => { if (e.key === 'Enter') select(b.id); }}
              style={{
                display: 'flex', alignItems: 'center', gap: 9, padding: '8px 9px', borderRadius: 11,
                cursor: 'pointer',
                background: selected ? 'rgba(232,25,44,0.09)' : 'transparent',
                border: `1px solid ${selected ? 'rgba(232,25,44,0.22)' : 'transparent'}`,
              }}
            >
              <GripVertical size={13} strokeWidth={1.75} style={{ color: 'rgba(255,255,255,0.18)', flex: 'none', cursor: 'grab' }} />
              <Icon size={14} strokeWidth={1.75} style={{ color: selected ? RED : 'rgba(255,255,255,0.35)', flex: 'none' }} />
              <span style={{
                flex: 1, fontSize: 12.5, fontWeight: 500, fontFamily: FONT_UI,
                color: selected ? T1 : 'rgba(255,255,255,0.55)',
                whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis',
              }}>
                {t(meta.labelKey)}{snippet ? ` · ${snippet}` : ''}
              </span>
              {b.cond && (
                <span style={{
                  fontSize: 9.5, padding: '1px 6px', borderRadius: 5,
                  background: 'rgba(232,25,44,0.14)', color: RED, fontWeight: 600,
                  flex: 'none', fontFamily: FONT_UI,
                }}>{t('studio.structure.rule')}</span>
              )}
              <RowBtn label={t('studio.canvas.moveUp')} onClick={() => moveBlock(b.id, -1)}>
                <ChevronUp size={12} strokeWidth={1.75} />
              </RowBtn>
              <RowBtn label={t('studio.canvas.moveDown')} onClick={() => moveBlock(b.id, 1)}>
                <ChevronDown size={12} strokeWidth={1.75} />
              </RowBtn>
              <RowBtn label={t('studio.canvas.delete')} danger onClick={() => removeBlock(b.id)}>
                <Trash2 size={12} strokeWidth={1.75} />
              </RowBtn>
            </div>
          </div>
        );
      })}
      {dropAt === blocks.length && dragFrom != null && (
        <div style={{ height: 2, background: RED, borderRadius: 2, margin: '2px 4px' }} />
      )}
      {footerRow}
    </div>
  );
}

function RowBtn({ children, onClick, label, danger }: {
  children: React.ReactNode; onClick: () => void; label: string; danger?: boolean;
}) {
  return (
    <button
      type="button" aria-label={label} title={label}
      onClick={(e) => { e.stopPropagation(); onClick(); }}
      onMouseEnter={(e) => { e.currentTarget.style.color = danger ? '#FF5C63' : T1; }}
      onMouseLeave={(e) => { e.currentTarget.style.color = 'rgba(255,255,255,0.28)'; }}
      style={{
        width: 20, height: 20, display: 'flex', alignItems: 'center', justifyContent: 'center',
        borderRadius: 6, color: 'rgba(255,255,255,0.28)', cursor: 'pointer', flex: 'none',
        background: 'transparent', border: 'none',
      }}
    >{children}</button>
  );
}
