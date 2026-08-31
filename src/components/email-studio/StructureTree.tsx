import { useState } from 'react';
import { GripVertical } from 'lucide-react';
import { useLanguage } from '@/contexts/LanguageContext';
import type { EmailBlock } from '@/lib/email';
import { useStudio } from './store';
import { blockMeta } from './meta';
import { BORDER, FONT_UI, RED, SUBTLE, T1, T3 } from './ui';

function blockSnippet(b: EmailBlock): string {
  switch (b.type) {
    case 'header': return b.venueName;
    case 'text': return b.body.replace(/<[^>]+>/g, ' ').trim().slice(0, 42);
    case 'image': return b.label || '';
    case 'cta': return b.label;
    case 'event': return b.title;
    case 'tickets': return `${b.rows.length}`;
    case 'table': return b.title;
    case 'countdown': return b.label;
    case 'html': return b.code.slice(0, 42);
    default: return '';
  }
}

/** Arborescence des blocs — sélection synchronisée avec le canvas, réordonnable. */
export default function StructureTree() {
  const { t } = useLanguage();
  const blocks = useStudio((s) => s.campaign.blocks);
  const selectedId = useStudio((s) => s.selectedId);
  const select = useStudio((s) => s.select);
  const reorderBlock = useStudio((s) => s.reorderBlock);
  const [dragFrom, setDragFrom] = useState<number | null>(null);
  const [dropAt, setDropAt] = useState<number | null>(null);

  if (blocks.length === 0) {
    return <p style={{ fontSize: 11.5, color: T3, fontFamily: FONT_UI, padding: '4px 2px' }}>{t('studio.structure.empty')}</p>;
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
            <button
              type="button"
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
              style={{
                display: 'flex', alignItems: 'center', gap: 8, width: '100%',
                background: selected ? 'rgba(232,25,44,0.10)' : SUBTLE,
                border: `1px solid ${selected ? 'rgba(232,25,44,0.4)' : BORDER}`,
                borderRadius: 8, padding: '7px 8px', cursor: 'pointer', textAlign: 'left',
              }}
            >
              <GripVertical size={12} strokeWidth={1.75} style={{ color: T3, flex: 'none', cursor: 'grab' }} />
              <Icon size={14} strokeWidth={1.75} style={{ color: meta.group === 'yuno' ? RED : T3, flex: 'none' }} />
              <span style={{ fontSize: 11.5, fontWeight: 600, color: T1, fontFamily: FONT_UI, flex: 'none' }}>
                {t(meta.labelKey)}
              </span>
              {snippet && (
                <span style={{
                  fontSize: 11, color: T3, fontFamily: FONT_UI, overflow: 'hidden',
                  textOverflow: 'ellipsis', whiteSpace: 'nowrap', minWidth: 0,
                }}>{snippet}</span>
              )}
            </button>
          </div>
        );
      })}
      {dropAt === blocks.length && dragFrom != null && (
        <div style={{ height: 2, background: RED, borderRadius: 2, margin: '2px 4px' }} />
      )}
    </div>
  );
}
