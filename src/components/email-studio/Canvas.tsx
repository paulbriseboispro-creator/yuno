import { Fragment, useMemo, useState } from 'react';
import { ChevronDown, ChevronUp, Copy, GripVertical, Plus, Trash2 } from 'lucide-react';
import { useLanguage } from '@/contexts/LanguageContext';
import { renderEmailHtml, type BlockType, type LiveData } from '@/lib/email';
import { useStudio } from './store';
import type { StudioScope } from './hooks';
import BlockRenderer from './blocks/BlockRenderer';
import type { CanvasCtx } from './blocks/common';
import { IconBtn, RED, T3, FONT_UI } from './ui';

const DRAG_TYPE_NEW = 'application/x-yn-block-type';
const DRAG_TYPE_MOVE = 'application/x-yn-block-index';

export default function Canvas({ scope, live }: { scope: StudioScope; live: LiveData }) {
  const { t } = useLanguage();
  const campaign = useStudio((s) => s.campaign);
  const selectedId = useStudio((s) => s.selectedId);
  const insertIndex = useStudio((s) => s.insertIndex);
  const device = useStudio((s) => s.device);
  const preview = useStudio((s) => s.preview);
  const select = useStudio((s) => s.select);
  const setInsertIndex = useStudio((s) => s.setInsertIndex);
  const addBlock = useStudio((s) => s.addBlock);
  const moveBlock = useStudio((s) => s.moveBlock);
  const reorderBlock = useStudio((s) => s.reorderBlock);
  const duplicate = useStudio((s) => s.duplicate);
  const removeBlock = useStudio((s) => s.removeBlock);

  const [hoverId, setHoverId] = useState<string | null>(null);
  const [dropIndex, setDropIndex] = useState<number | null>(null);

  const width = device === 'mobile' ? 375 : 600;
  const ctx: CanvasCtx = useMemo(() => ({
    venueName: scope.name,
    socialLinks: campaign.socialLinks,
    live,
    baseUrl: 'https://yunoapp.eu',
  }), [scope.name, campaign.socialLinks, live]);

  // ── Aperçu : le VRAI HTML email, chrome d'édition masquée ─────────────────
  const previewHtml = useMemo(() => {
    if (!preview) return '';
    return renderEmailHtml(campaign.blocks, campaign.theme, {
      venueName: scope.name,
      city: scope.city,
      emailType: campaign.type,
      subject: campaign.subject,
      preheader: campaign.preheader,
      recipient: { email: 'aperçu@exemple.com', firstName: 'Clara' },
      unsubscribeUrl: '#',
      socialLinks: campaign.socialLinks,
      baseUrl: 'https://yunoapp.eu',
      live,
    });
  }, [preview, campaign, scope, live]);

  const handleDropAt = (index: number, e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    const newType = e.dataTransfer.getData(DRAG_TYPE_NEW);
    const moveFrom = e.dataTransfer.getData(DRAG_TYPE_MOVE);
    setDropIndex(null);
    if (newType) {
      addBlock(newType as BlockType, index);
    } else if (moveFrom !== '') {
      const from = Number(moveFrom);
      if (Number.isFinite(from)) reorderBlock(from, from < index ? index - 1 : index);
    }
  };

  const dragOverBlock = (index: number, e: React.DragEvent) => {
    e.preventDefault();
    const rect = (e.currentTarget as HTMLElement).getBoundingClientRect();
    const before = e.clientY < rect.top + rect.height / 2;
    setDropIndex(before ? index : index + 1);
  };

  return (
    <div
      style={{
        flex: 1, minWidth: 0, overflow: 'auto', display: 'flex',
        justifyContent: 'center', alignItems: 'flex-start',
        padding: '28px 24px 64px', background: '#0d0d0f',
      }}
      onClick={() => { select(null); }}
      onDragOver={(e) => { e.preventDefault(); }}
      onDrop={(e) => handleDropAt(dropIndex ?? campaign.blocks.length, e)}
    >
      {preview ? (
        <iframe
          title={t('studio.canvas.previewTitle')}
          srcDoc={previewHtml}
          className="yn-in"
          style={{
            width: width + 48, height: 'calc(100vh - 130px)', border: `1px solid rgba(255,255,255,0.08)`,
            borderRadius: 10, background: campaign.theme.bg,
          }}
        />
      ) : (
        <div
          className="yn-in"
          style={{ width: width + 48, background: campaign.theme.bg, borderRadius: 10, padding: '24px 24px 32px' }}
          onClick={(e) => e.stopPropagation()}
        >
          <div style={{ width, margin: '0 auto', background: campaign.theme.card, borderRadius: 12, overflow: 'visible' }}>
            {campaign.blocks.length === 0 && (
              <div style={{
                padding: '56px 24px', textAlign: 'center', color: T3,
                fontFamily: FONT_UI, fontSize: 12.5, lineHeight: 1.6,
              }}>
                {t('studio.canvas.empty')}
              </div>
            )}
            {campaign.blocks.map((block, i) => {
              const selected = block.id === selectedId;
              const hovered = block.id === hoverId;
              return (
                <Fragment key={block.id}>
                  <InsertZone
                    index={i}
                    active={insertIndex === i}
                    dropActive={dropIndex === i}
                    onClickPlus={() => { setInsertIndex(i); }}
                  />
                  <div
                    onMouseEnter={() => setHoverId(block.id)}
                    onMouseLeave={() => setHoverId((h) => (h === block.id ? null : h))}
                    onClick={(e) => { e.stopPropagation(); select(block.id); }}
                    onDragOver={(e) => dragOverBlock(i, e)}
                    onDrop={(e) => handleDropAt(dropIndex ?? i, e)}
                    style={{
                      position: 'relative', cursor: 'pointer',
                      outline: selected
                        ? `1.5px solid ${RED}`
                        : hovered ? '1px solid rgba(232,25,44,0.45)' : '1px solid transparent',
                      outlineOffset: -1, transition: 'outline-color .1s',
                    }}
                  >
                    <BlockRenderer block={block} theme={campaign.theme} ctx={ctx} mobile={device === 'mobile'} />

                    {(hovered || selected) && (
                      <>
                        {/* Poignée de drag */}
                        <div
                          draggable
                          onDragStart={(e) => {
                            e.dataTransfer.setData(DRAG_TYPE_MOVE, String(i));
                            e.dataTransfer.effectAllowed = 'move';
                          }}
                          onDragEnd={() => setDropIndex(null)}
                          title={t('studio.canvas.dragHandle')}
                          style={{
                            position: 'absolute', left: -26, top: '50%', transform: 'translateY(-50%)',
                            width: 20, height: 28, display: 'flex', alignItems: 'center', justifyContent: 'center',
                            cursor: 'grab', color: 'rgba(255,255,255,0.5)',
                            background: '#141416', border: `1px solid rgba(255,255,255,0.12)`, borderRadius: 6,
                          }}
                        >
                          <GripVertical size={13} strokeWidth={1.75} />
                        </div>

                        {/* Mini-toolbar */}
                        <div style={{
                          position: 'absolute', top: -14, right: 8, display: 'flex', gap: 1,
                          background: '#141416', border: '1px solid rgba(255,255,255,0.12)',
                          borderRadius: 8, padding: 2, zIndex: 5,
                          boxShadow: '0 8px 24px -10px rgba(0,0,0,.9)',
                        }}>
                          <IconBtn size={24} ariaLabel={t('studio.canvas.moveUp')} disabled={i === 0}
                            onClick={(e) => { e.stopPropagation(); moveBlock(block.id, -1); }}>
                            <ChevronUp size={13} strokeWidth={1.75} />
                          </IconBtn>
                          <IconBtn size={24} ariaLabel={t('studio.canvas.moveDown')} disabled={i === campaign.blocks.length - 1}
                            onClick={(e) => { e.stopPropagation(); moveBlock(block.id, 1); }}>
                            <ChevronDown size={13} strokeWidth={1.75} />
                          </IconBtn>
                          <IconBtn size={24} ariaLabel={t('studio.canvas.duplicate')}
                            onClick={(e) => { e.stopPropagation(); duplicate(block.id); }}>
                            <Copy size={13} strokeWidth={1.75} />
                          </IconBtn>
                          <IconBtn size={24} danger ariaLabel={t('studio.canvas.delete')}
                            onClick={(e) => { e.stopPropagation(); removeBlock(block.id); }}>
                            <Trash2 size={13} strokeWidth={1.75} />
                          </IconBtn>
                        </div>
                      </>
                    )}
                  </div>
                </Fragment>
              );
            })}
            <InsertZone
              index={campaign.blocks.length}
              active={insertIndex === campaign.blocks.length}
              dropActive={dropIndex === campaign.blocks.length}
              onClickPlus={() => setInsertIndex(campaign.blocks.length)}
              tall
            />
          </div>
        </div>
      )}
    </div>
  );
}

/** Zone « + » inter-blocs + ligne d'insertion pendant un drag. */
function InsertZone({ index, active, dropActive, onClickPlus, tall }: {
  index: number; active: boolean; dropActive: boolean; onClickPlus: () => void; tall?: boolean;
}) {
  const { t } = useLanguage();
  const [hover, setHover] = useState(false);
  const visible = hover || active || dropActive;
  return (
    <div
      onMouseEnter={() => setHover(true)}
      onMouseLeave={() => setHover(false)}
      onClick={(e) => e.stopPropagation()}
      style={{
        position: 'relative', height: tall ? 26 : 14, margin: '-1px 0',
        display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 4,
      }}
      data-insert-index={index}
    >
      {(visible) && (
        <>
          <div style={{
            position: 'absolute', left: 20, right: 20, height: 2, borderRadius: 2,
            background: RED, opacity: dropActive || active ? 1 : 0.55,
          }} />
          <button
            type="button"
            aria-label={t('studio.canvas.insertHere')}
            onClick={onClickPlus}
            style={{
              position: 'relative', zIndex: 1, width: 20, height: 20, borderRadius: 9999,
              background: RED, color: '#fff', border: 'none', cursor: 'pointer',
              display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
              boxShadow: `0 0 14px -4px ${RED}`,
            }}
          >
            <Plus size={12} strokeWidth={2.25} />
          </button>
        </>
      )}
    </div>
  );
}
