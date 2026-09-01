import { Fragment, useMemo, useState } from 'react';
import {
  AlertTriangle, Braces, Check, ChevronDown, Copy, Eye, GripVertical, Inbox,
  Layers, ShieldCheck, Trash2, Users, X, ArrowUp, ArrowDown,
} from 'lucide-react';
import { useLanguage } from '@/contexts/LanguageContext';
import {
  contrastText, isHexColor, renderEmailHtml, runChecklist, checklistBlocksSend,
  BLOCK_COND_LABELS, footerSocialEnabled, socialChip, socialLabel,
  type BlockType, type ChecklistItem, type LiveData, type RenderRecipient,
  type SocialLinks,
} from '@/lib/email';
import { useStudio } from './store';
import type { StudioScope } from './hooks';
import BlockRenderer from './blocks/BlockRenderer';
import { blockBgColor, type CanvasCtx } from './blocks/common';
import { blockMeta } from './meta';
import {
  BORDER, BORDER_FAINT, CANVAS_BG, FONT_UI, MONO, PANEL_BG, POS, RED, SUBTLE,
  T1, T2, T3, WARN,
} from './ui';

const DRAG_TYPE_NEW = 'application/x-yn-block-type';
const DRAG_TYPE_MOVE = 'application/x-yn-block-index';

interface Persona {
  id: string;
  name: string;
  initials: string;
  recipient: RenderRecipient;
}

const PERSONAS: Persona[] = [
  {
    id: 'sample', name: 'Camille M.', initials: 'CM',
    recipient: {
      email: 'camille.m@example.com', firstName: 'Camille', lastName: 'Moreau',
      lastEventTitle: 'la dernière soirée', loyaltyPoints: 240,
      conds: ['vip_table', 'buyers'],
    },
  },
  {
    id: 'empty', name: 'Sans profil', initials: '·',
    recipient: { email: 'contact@example.com', conds: [] },
  },
];

export default function CanvasColumn({ scope, live }: { scope: StudioScope; live: LiveData }) {
  const { t } = useLanguage();
  const campaign = useStudio((s) => s.campaign);
  const selectedId = useStudio((s) => s.selectedId);
  const insertIndex = useStudio((s) => s.insertIndex);
  const device = useStudio((s) => s.device);
  const preview = useStudio((s) => s.preview);
  const drawer = useStudio((s) => s.drawer);
  const setDrawer = useStudio((s) => s.setDrawer);
  const select = useStudio((s) => s.select);
  const setInsertIndex = useStudio((s) => s.setInsertIndex);
  const addBlock = useStudio((s) => s.addBlock);
  const moveBlock = useStudio((s) => s.moveBlock);
  const reorderBlock = useStudio((s) => s.reorderBlock);
  const duplicate = useStudio((s) => s.duplicate);
  const removeBlock = useStudio((s) => s.removeBlock);
  const patchContent = useStudio((s) => s.patchContent);

  const [hoverId, setHoverId] = useState<string | null>(null);
  const [dragging, setDragging] = useState<{ kind: 'new' | 'move'; index?: number } | null>(null);
  const [dropIndex, setDropIndex] = useState<number | null>(null);
  const [persona, setPersona] = useState<Persona>(PERSONAS[0]);
  const [personaOpen, setPersonaOpen] = useState(false);

  const width = device === 'mobile' ? 390 : 600;
  const theme = campaign.theme;

  const ctx: CanvasCtx = useMemo(() => ({
    venueName: scope.name,
    logoUrl: scope.logoUrl,
    socialLinks: campaign.socialLinks,
    live,
    baseUrl: 'https://yunoapp.eu',
    // Les blocs Yuno sans événement propre héritent de celui de la campagne
    // (même repli que l'envoi côté edge).
    fallbackEventId: campaign.eventId,
  }), [scope.name, scope.logoUrl, campaign.socialLinks, live, campaign.eventId]);

  // Le VRAI HTML email — sert à l'aperçu iframe, au poids et à la checklist.
  const renderedHtml = useMemo(() => renderEmailHtml(campaign.blocks, theme, {
    venueName: scope.name,
    city: scope.city,
    logoUrl: scope.logoUrl,
    emailType: campaign.type,
    subject: campaign.subject,
    preheader: campaign.preheader,
    recipient: persona.recipient,
    unsubscribeUrl: '#',
    socialLinks: campaign.socialLinks,
    baseUrl: 'https://yunoapp.eu',
    live,
    ignoreConds: persona.id === 'sample',
  }), [campaign, theme, scope, live, persona]);
  const renderedBytes = renderedHtml.length;

  // Réseaux du pied de page : mêmes règles que le rendu email (thème + liens).
  const footerSocialLinks = useMemo(
    () => (footerSocialEnabled(theme)
      ? (Object.entries(campaign.socialLinks) as [keyof SocialLinks, string | undefined][])
        .filter((entry): entry is [keyof SocialLinks, string] => !!entry[1] && entry[1].trim().length > 0)
      : []),
    [theme, campaign.socialLinks],
  );
  const footerChip = socialChip(undefined, theme);
  const footerBorderCss = isHexColor(theme.footerBg) && contrastText(theme.footerBg) === '#ffffff'
    ? 'none' : `1px solid ${theme.divider}`;

  const checks = useMemo(() => runChecklist({
    subject: campaign.subject, preheader: campaign.preheader,
    type: campaign.type, blocks: campaign.blocks, renderedBytes,
    footerSocial: footerSocialEnabled(theme), hasSocialLinks: footerSocialLinks.length > 0,
  }), [
    campaign.subject, campaign.preheader, campaign.type, campaign.blocks, renderedBytes,
    theme, footerSocialLinks.length,
  ]);
  const warnCount = checks.filter((c) => c.status === 'warn').length;
  const blocked = checklistBlocksSend(checks);

  const modelJson = useMemo(() => JSON.stringify({
    subject: campaign.subject,
    preheader: campaign.preheader,
    theme: theme.name,
    ab: campaign.abOn ? { b: campaign.subjectB, split: 50, winnerAfterH: 4 } : null,
    blocks: campaign.blocks,
  }, null, 2), [campaign, theme.name]);

  const handleDropAt = (index: number, e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    const newType = e.dataTransfer.getData(DRAG_TYPE_NEW);
    const moveFrom = e.dataTransfer.getData(DRAG_TYPE_MOVE);
    setDropIndex(null);
    setDragging(null);
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
    <div style={{ flex: 1, minWidth: 0, display: 'flex', flexDirection: 'column', background: CANVAS_BG, minHeight: 0 }}>
      {/* ── Bandeau Objet / Preheader / Aperçu pour ── */}
      <div style={{
        flex: 'none', padding: '11px 22px', borderBottom: `1px solid ${BORDER_FAINT}`,
        display: 'flex', alignItems: 'center', gap: 14,
      }}>
        <div style={{ flex: 1.4, minWidth: 0 }}>
          <div style={{ color: T3, fontSize: 10, fontWeight: 600, letterSpacing: '0.08em', textTransform: 'uppercase', fontFamily: FONT_UI }}>
            {t('studio.data.subject')}
          </div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <input
              value={campaign.subject}
              onChange={(e) => patchContent({ subject: e.target.value })}
              placeholder={t('studio.data.subjectPh')}
              aria-label={t('studio.data.subject')}
              style={{
                flex: 1, minWidth: 0, background: 'transparent', border: '1px solid transparent',
                borderRadius: 7, padding: '3px 6px', marginLeft: -6,
                color: T1, fontSize: 13.5, fontWeight: 500, fontFamily: FONT_UI, outline: 'none',
              }}
              onFocus={(e) => { e.currentTarget.style.background = 'rgba(255,255,255,0.05)'; }}
              onBlur={(e) => { e.currentTarget.style.background = 'transparent'; }}
            />
            {campaign.abOn && (
              <span style={{
                display: 'inline-flex', alignItems: 'center', gap: 4, padding: '2px 7px', borderRadius: 6,
                background: 'rgba(232,25,44,0.1)', border: '1px solid rgba(232,25,44,0.2)',
                color: RED, fontSize: 10, fontWeight: 600, flex: 'none', fontFamily: FONT_UI,
              }}>A/B</span>
            )}
          </div>
        </div>
        <div style={{ width: 1, height: 30, background: BORDER, flex: 'none' }} />
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ color: T3, fontSize: 10, fontWeight: 600, letterSpacing: '0.08em', textTransform: 'uppercase', fontFamily: FONT_UI }}>
            {t('studio.data.preheader')}
          </div>
          <input
            value={campaign.preheader}
            onChange={(e) => patchContent({ preheader: e.target.value })}
            placeholder={t('studio.data.preheaderPh')}
            aria-label={t('studio.data.preheader')}
            style={{
              width: '100%', background: 'transparent', border: '1px solid transparent',
              borderRadius: 7, padding: '3px 6px', marginLeft: -6,
              color: T2, fontSize: 13, fontFamily: FONT_UI, outline: 'none',
            }}
            onFocus={(e) => { e.currentTarget.style.background = 'rgba(255,255,255,0.05)'; }}
            onBlur={(e) => { e.currentTarget.style.background = 'transparent'; }}
          />
        </div>
        <div style={{ width: 1, height: 30, background: BORDER, flex: 'none' }} />
        <div style={{ display: 'flex', alignItems: 'center', gap: 9, flex: 'none', position: 'relative' }}>
          <span style={{ color: T3, fontSize: 11, fontFamily: FONT_UI }}>{t('studio.canvas.previewFor')}</span>
          <button
            type="button"
            onClick={() => setPersonaOpen((v) => !v)}
            aria-label={t('studio.canvas.previewFor')}
            style={{
              display: 'flex', alignItems: 'center', gap: 7, padding: '5px 10px', borderRadius: 9,
              background: SUBTLE, border: `1px solid ${BORDER}`, cursor: 'pointer',
            }}
          >
            <span style={{
              width: 18, height: 18, borderRadius: '50%', background: 'rgba(232,25,44,0.18)',
              color: RED, fontSize: 9, fontWeight: 700, display: 'flex', alignItems: 'center',
              justifyContent: 'center', fontFamily: FONT_UI,
            }}>{persona.initials}</span>
            <span style={{ color: T1, fontSize: 12, fontFamily: FONT_UI }}>{persona.name}</span>
            <ChevronDown size={13} strokeWidth={1.75} style={{ color: T3 }} />
          </button>
          {personaOpen && (
            <div className="yn-in" style={{
              position: 'absolute', top: '110%', right: 0, zIndex: 20, minWidth: 180,
              background: PANEL_BG, border: `1px solid ${BORDER}`, borderRadius: 11, padding: 4,
              boxShadow: '0 20px 40px -20px #000',
            }}>
              {PERSONAS.map((p) => (
                <button
                  key={p.id} type="button"
                  onClick={() => { setPersona(p); setPersonaOpen(false); }}
                  style={{
                    display: 'flex', alignItems: 'center', gap: 8, width: '100%', textAlign: 'left',
                    background: p.id === persona.id ? 'rgba(255,255,255,0.05)' : 'transparent',
                    border: 'none', borderRadius: 8, padding: '7px 9px', cursor: 'pointer',
                    color: T1, fontSize: 12, fontFamily: FONT_UI,
                  }}
                >
                  {p.id === persona.id && <Check size={12} strokeWidth={2} style={{ color: RED }} />}
                  {p.name}
                </button>
              ))}
            </div>
          )}
        </div>
      </div>

      {/* ── Scène ── */}
      <div
        style={{
          flex: 1, overflowY: 'auto', padding: '26px 0 70px',
          display: 'flex', justifyContent: 'center', alignItems: 'flex-start',
          background: 'radial-gradient(90% 50% at 50% 0%,rgba(255,255,255,.03),transparent 60%)',
          minHeight: 0,
        }}
        onClick={() => { select(null); setPersonaOpen(false); }}
      >
        <div style={{ width, maxWidth: '100%', transition: 'width .2s' }}>
          {preview ? (
            <iframe
              title={t('studio.canvas.previewTitle')}
              srcDoc={renderedHtml}
              className="yn-in"
              style={{
                width: '100%', height: 'calc(100vh - 250px)', border: 'none',
                borderRadius: 12, background: theme.bg,
                boxShadow: '0 30px 60px -30px rgba(0,0,0,.9)',
              }}
            />
          ) : (
            <div
              onClick={(e) => e.stopPropagation()}
              onDragOver={(e) => { if (dragging) e.preventDefault(); }}
              onDrop={(e) => handleDropAt(dropIndex ?? campaign.blocks.length, e)}
              style={{
                background: theme.card, borderRadius: 12, overflow: 'hidden',
                boxShadow: '0 30px 60px -30px rgba(0,0,0,.9)',
                border: theme.dark ? '1px solid rgba(255,255,255,0.06)' : 'none',
              }}
            >
              {/* Slot de drop tout en haut — hauteur nulle hors drag : l'éditeur
                  ne doit fabriquer AUCUN espace qui n'existe pas dans l'email. */}
              <div
                onDragOver={(e) => { if (dragging) { e.preventDefault(); setDropIndex(0); } }}
                onDrop={(e) => handleDropAt(0, e)}
                style={{
                  position: 'relative', height: dragging && dropIndex === 0 ? 20 : 0,
                  display: 'flex', alignItems: 'center', justifyContent: 'center',
                  opacity: dragging && dropIndex === 0 ? 1 : 0, transition: 'all .12s',
                }}
              >
                <span style={{ position: 'absolute', left: 24, right: 24, height: 2, background: RED, borderRadius: 2 }} />
              </div>

              {campaign.blocks.map((block, i) => {
                const selected = block.id === selectedId;
                const hovered = block.id === hoverId;
                const meta = blockMeta(block.type);
                const isDraggingThis = dragging?.kind === 'move' && dragging.index === i;
                return (
                  <Fragment key={block.id}>
                    <div
                      onMouseEnter={() => setHoverId(block.id)}
                      onMouseLeave={() => setHoverId((h) => (h === block.id ? null : h))}
                      onClick={(e) => { e.stopPropagation(); select(block.id); }}
                      draggable
                      onDragStart={(e) => {
                        e.dataTransfer.setData(DRAG_TYPE_MOVE, String(i));
                        e.dataTransfer.effectAllowed = 'move';
                        setDragging({ kind: 'move', index: i });
                      }}
                      onDragEnd={() => { setDragging(null); setDropIndex(null); }}
                      onDragOver={(e) => dragOverBlock(i, e)}
                      onDrop={(e) => handleDropAt(dropIndex ?? i, e)}
                      style={{
                        position: 'relative', cursor: 'pointer',
                        background: blockBgColor(block, theme),
                        outline: selected ? `2px solid ${RED}` : '2px dashed transparent',
                        outlineOffset: -2,
                        transition: 'outline-color .15s, opacity .15s',
                        opacity: isDraggingThis ? 0.4 : 1,
                        ...(hovered && !selected ? { outline: '2px dashed rgba(232,25,44,.45)', outlineOffset: -2 } : {}),
                      }}
                    >
                      {/* Toolbar du bloc sélectionné */}
                      {selected && (
                        <div style={{
                          position: 'absolute', top: -13, right: 10, zIndex: 5,
                          display: 'flex', alignItems: 'center', gap: 1, padding: 3,
                          borderRadius: 9, background: '#141416', border: '1px solid rgba(255,255,255,0.13)',
                          boxShadow: '0 10px 24px -14px #000',
                        }}>
                          <span style={{
                            padding: '0 8px', height: 22, display: 'inline-flex', alignItems: 'center',
                            color: RED, fontSize: 10.5, fontWeight: 700, letterSpacing: '0.05em',
                            textTransform: 'uppercase', fontFamily: FONT_UI,
                          }}>{t(meta.labelKey)}</span>
                          <span style={{ width: 1, height: 14, background: 'rgba(255,255,255,0.12)', margin: '0 3px' }} />
                          <ToolBtn label={t('studio.canvas.moveUp')} disabled={i === 0} onClick={() => moveBlock(block.id, -1)}>
                            <ArrowUp size={12} strokeWidth={1.75} />
                          </ToolBtn>
                          <ToolBtn label={t('studio.canvas.moveDown')} disabled={i === campaign.blocks.length - 1} onClick={() => moveBlock(block.id, 1)}>
                            <ArrowDown size={12} strokeWidth={1.75} />
                          </ToolBtn>
                          <ToolBtn label={t('studio.canvas.duplicate')} onClick={() => duplicate(block.id)}>
                            <Copy size={12} strokeWidth={1.75} />
                          </ToolBtn>
                          <ToolBtn label={t('studio.canvas.delete')} danger onClick={() => removeBlock(block.id)}>
                            <Trash2 size={12} strokeWidth={1.75} />
                          </ToolBtn>
                        </div>
                      )}

                      {/* Chip règle de visibilité */}
                      {block.cond && (
                        <div style={{
                          position: 'absolute', top: 6, left: 14, zIndex: 4,
                          display: 'inline-flex', alignItems: 'center', gap: 5, padding: '2px 8px',
                          borderRadius: 999, background: 'rgba(232,25,44,0.14)',
                          border: '1px solid rgba(232,25,44,0.3)', color: RED,
                          fontSize: 9.5, fontWeight: 600, fontFamily: FONT_UI,
                        }}>
                          <Eye size={10} strokeWidth={1.75} />
                          {t('studio.canvas.visibleFor')} {BLOCK_COND_LABELS[block.cond]}
                        </div>
                      )}

                      <BlockRenderer block={block} theme={theme} ctx={ctx} mobile={device === 'mobile'} />

                      {/* Poignée de drag (survol) */}
                      {(hovered || selected) && (
                        <div style={{
                          position: 'absolute', left: -26, top: '50%', transform: 'translateY(-50%)',
                          width: 20, height: 28, display: 'flex', alignItems: 'center', justifyContent: 'center',
                          cursor: 'grab', color: 'rgba(255,255,255,0.5)',
                          background: '#141416', border: '1px solid rgba(255,255,255,0.12)', borderRadius: 6,
                        }} title={t('studio.canvas.dragHandle')}>
                          <GripVertical size={13} strokeWidth={1.75} />
                        </div>
                      )}
                    </div>

                    {/* Zone + après le bloc */}
                    <InsertZone
                      active={insertIndex === i + 1}
                      dropActive={!!dragging && dropIndex === i + 1}
                      onClickPlus={() => setInsertIndex(i + 1)}
                      onDragOver={(e) => { if (dragging) { e.preventDefault(); setDropIndex(i + 1); } }}
                      onDrop={(e) => handleDropAt(i + 1, e)}
                      label={t('studio.canvas.insertHere')}
                    />
                  </Fragment>
                );
              })}

              {campaign.blocks.length === 0 && (
                <div style={{ padding: '70px 30px', textAlign: 'center' }}>
                  <div style={{
                    width: 44, height: 44, margin: '0 auto 14px', borderRadius: 14,
                    background: 'rgba(0,0,0,0.06)', display: 'flex', alignItems: 'center',
                    justifyContent: 'center', color: '#9a9a9a',
                  }}><Inbox size={16} strokeWidth={1.75} /></div>
                  <div style={{ color: '#4a4a4a', fontSize: 15, fontWeight: 600, marginBottom: 5, fontFamily: FONT_UI }}>
                    {t('studio.canvas.emptyTitle')}
                  </div>
                  <div style={{ color: '#8a8a8a', fontSize: 13, fontFamily: FONT_UI }}>{t('studio.canvas.empty')}</div>
                </div>
              )}

              {/* Réseaux du pied de page (aperçu) — miroir de renderSocial(standalone=false).
                  Rendus ICI et pas seulement dans l'email : invisibles au canvas, ils
                  doublaient en silence le bloc « Réseaux » posé dans le corps. */}
              {footerSocialLinks.length > 0 && (
                <div style={{
                  padding: '18px 24px 4px', background: theme.footerBg, textAlign: 'center',
                  borderTop: footerBorderCss,
                }}>
                  {footerSocialLinks.map(([key, url]) => (
                    <span
                      key={key}
                      title={socialLabel(key, url)}
                      style={{
                        width: 34, height: 34, borderRadius: '50%', margin: '0 5px',
                        background: footerChip.chip, display: 'inline-flex',
                        alignItems: 'center', justifyContent: 'center', verticalAlign: 'middle',
                      }}
                    >
                      <img
                        src={`/email-social/${key}-${footerChip.glyph}.png`}
                        alt={socialLabel(key, url)}
                        width={16} height={16}
                        style={{ display: 'block' }}
                      />
                    </span>
                  ))}
                </div>
              )}

              {/* Footer légal (aperçu) — trait seulement sur footer clair (miroir render.ts) */}
              <div style={{
                padding: '22px 24px', background: theme.footerBg, textAlign: 'center',
                borderTop: footerSocialLinks.length > 0 ? 'none' : footerBorderCss,
              }}>
                <div style={{ fontSize: 12, fontWeight: 600, color: theme.footerText, marginBottom: 6, fontFamily: FONT_UI }}>
                  {scope.name}{scope.city ? ` — ${scope.city}` : ''}
                </div>
                <div style={{ fontSize: 11.5, color: theme.footerText, opacity: 0.8, lineHeight: 1.6, fontFamily: FONT_UI }}>
                  {t('studio.canvas.footerSentTo').replace('{email}', persona.recipient.email)}
                </div>
                <div style={{ fontSize: 11.5, color: theme.accent, marginTop: 4, textDecoration: 'underline', fontFamily: FONT_UI }}>
                  {t('studio.canvas.footerUnsub')}
                </div>
              </div>
            </div>
          )}

          {/* Largeur · poids */}
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginTop: 12, padding: '0 2px' }}>
            <span style={{ color: 'rgba(255,255,255,0.28)', fontSize: 10.5, fontFamily: MONO }}>
              {device === 'mobile' ? '390 px · mobile' : '600 px · desktop'}
            </span>
            <span style={{ color: 'rgba(255,255,255,0.28)', fontSize: 10.5, fontFamily: MONO }}>
              {(renderedBytes / 1024).toFixed(1).replace('.', ',')} Ko
              {renderedBytes <= 102_400 ? ` · ${t('studio.canvas.underGmail')}` : ` · ${t('studio.canvas.overGmail')}`}
            </span>
          </div>
        </div>
      </div>

      {/* ── Tiroir contrôles / JSON ── */}
      {drawer && (
        <div className="yn-in" style={{
          flex: 'none', height: 250, borderTop: `1px solid ${BORDER}`, background: PANEL_BG,
          display: 'flex', flexDirection: 'column',
        }}>
          <div style={{
            flex: 'none', height: 38, display: 'flex', alignItems: 'center', gap: 2,
            padding: '0 12px', borderBottom: `1px solid ${BORDER_FAINT}`,
          }}>
            <DrawerTab active={drawer === 'checks'} onClick={() => setDrawer('checks')}>{t('studio.drawer.checks')}</DrawerTab>
            <DrawerTab active={drawer === 'json'} onClick={() => setDrawer('json')}>{t('studio.drawer.json')}</DrawerTab>
            <span style={{ flex: 1 }} />
            <button
              type="button" onClick={() => setDrawer(null)} aria-label={t('studio.test.close')}
              style={{
                width: 24, height: 24, display: 'flex', alignItems: 'center', justifyContent: 'center',
                borderRadius: 7, color: T3, cursor: 'pointer', background: 'transparent', border: 'none',
              }}
            ><X size={13} strokeWidth={1.75} /></button>
          </div>
          {drawer === 'checks' ? (
            <div style={{
              flex: 1, overflowY: 'auto', padding: '12px 16px',
              display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8, alignContent: 'start',
            }}>
              {checks.map((c) => <CheckTile key={c.id} item={c} />)}
            </div>
          ) : (
            <div style={{ flex: 1, overflow: 'auto', padding: '12px 16px' }}>
              <div style={{ color: T3, fontSize: 11, marginBottom: 8, fontFamily: FONT_UI }}>
                {t('studio.drawer.jsonHelp')}{' '}
                <span style={{ color: 'rgba(255,255,255,0.7)', fontFamily: MONO }}>EmailBlock</span> /{' '}
                <span style={{ color: 'rgba(255,255,255,0.7)', fontFamily: MONO }}>EmailTheme</span>.
              </div>
              <pre style={{
                margin: 0, padding: 12, borderRadius: 11, background: SUBTLE,
                border: `1px solid ${BORDER}`, color: 'rgba(255,255,255,0.72)',
                fontFamily: MONO, fontSize: 11, lineHeight: 1.55, whiteSpace: 'pre-wrap',
              }}>{modelJson}</pre>
            </div>
          )}
        </div>
      )}

      {/* ── Barre de statut ── */}
      <div style={{
        flex: 'none', height: 34, display: 'flex', alignItems: 'center', gap: 14,
        padding: '0 18px', borderTop: `1px solid ${BORDER_FAINT}`, background: PANEL_BG,
      }}>
        <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6, color: T3, fontSize: 11, fontFamily: FONT_UI }}>
          <Layers size={12} strokeWidth={1.75} />{campaign.blocks.length} {t('studio.status.blocks')}
        </span>
        <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6, color: T3, fontSize: 11, fontFamily: FONT_UI }}>
          <Users size={12} strokeWidth={1.75} />{campaign.audiences.length > 0 ? t('studio.status.audienceSet') : t('studio.status.audienceUnset')}
        </span>
        <button
          type="button"
          onClick={() => setDrawer(drawer === 'json' ? null : 'json')}
          style={{
            display: 'inline-flex', alignItems: 'center', gap: 6, color: T3, fontSize: 11,
            fontFamily: FONT_UI, background: 'transparent', border: 'none', cursor: 'pointer', padding: 0,
          }}
        >
          <Braces size={12} strokeWidth={1.75} />{t('studio.drawer.json')}
        </button>
        <span style={{ flex: 1 }} />
        <button
          type="button"
          onClick={() => setDrawer(drawer === 'checks' ? null : 'checks')}
          style={{
            display: 'inline-flex', alignItems: 'center', gap: 6, fontSize: 11, fontWeight: 500,
            fontFamily: FONT_UI, background: 'transparent', border: 'none', cursor: 'pointer', padding: 0,
            color: warnCount ? WARN : POS,
          }}
        >
          {warnCount ? <AlertTriangle size={12} strokeWidth={1.75} /> : <ShieldCheck size={12} strokeWidth={1.75} />}
          {warnCount
            ? t('studio.status.checksWarn').replace('{n}', String(warnCount))
            : t('studio.status.checksOk')}
          {blocked ? ' !' : ''}
        </button>
      </div>
    </div>
  );
}

function ToolBtn({ children, onClick, disabled, danger, label }: {
  children: React.ReactNode; onClick: () => void; disabled?: boolean; danger?: boolean; label: string;
}) {
  return (
    <button
      type="button" disabled={disabled} aria-label={label} title={label}
      onClick={(e) => { e.stopPropagation(); onClick(); }}
      onMouseEnter={(e) => { if (!disabled) e.currentTarget.style.background = danger ? 'rgba(255,92,99,0.14)' : 'rgba(255,255,255,0.09)'; }}
      onMouseLeave={(e) => { e.currentTarget.style.background = 'transparent'; }}
      style={{
        width: 22, height: 22, display: 'flex', alignItems: 'center', justifyContent: 'center',
        borderRadius: 6, color: danger ? 'rgba(255,255,255,0.6)' : 'rgba(255,255,255,0.6)',
        cursor: disabled ? 'default' : 'pointer', background: 'transparent', border: 'none',
        opacity: disabled ? 0.3 : 1,
      }}
    >{children}</button>
  );
}

function DrawerTab({ active, onClick, children }: { active: boolean; onClick: () => void; children: React.ReactNode }) {
  return (
    <button
      type="button" onClick={onClick}
      style={{
        padding: '8px 11px', fontSize: 12, fontWeight: 560, cursor: 'pointer',
        color: active ? T1 : T3, background: 'transparent', border: 'none', fontFamily: FONT_UI,
      }}
    >{children}</button>
  );
}

function CheckTile({ item }: { item: ChecklistItem }) {
  const { t } = useLanguage();
  const color = item.status === 'ok' ? POS : item.status === 'warn' ? (item.critical ? RED : WARN) : T3;
  const Icon = item.status === 'ok' ? Check : AlertTriangle;
  let label = t(item.labelKey);
  if (item.detail) label += ` (${item.detail})`;
  return (
    <div style={{
      display: 'flex', gap: 9, alignItems: 'flex-start', padding: '10px 12px',
      borderRadius: 11, background: SUBTLE, border: `1px solid ${BORDER}`,
    }}>
      <Icon size={14} strokeWidth={1.75} style={{ color, flex: 'none', marginTop: 1 }} />
      <div style={{ minWidth: 0 }}>
        <div style={{ color: T1, fontSize: 12, fontWeight: 560, fontFamily: FONT_UI }}>{label}</div>
        <div style={{ color: T3, fontSize: 11, marginTop: 2, lineHeight: 1.45, fontFamily: FONT_UI }}>
          {t(`studio.check.${item.id}.detail`)}
        </div>
      </div>
    </div>
  );
}

/**
 * Zone « + » inter-blocs + ligne d'insertion pendant un drag.
 * Hauteur NULLE hors drag : la zone est un overlay absolu à cheval sur la
 * frontière — l'éditeur n'ajoute aucun espace entre les blocs, le canvas
 * montre exactement les marges de l'email (py 0 = blocs collés).
 */
function InsertZone({ active, dropActive, onClickPlus, onDragOver, onDrop, label }: {
  active: boolean; dropActive: boolean; onClickPlus: () => void;
  onDragOver: (e: React.DragEvent) => void; onDrop: (e: React.DragEvent) => void; label: string;
}) {
  const [hover, setHover] = useState(false);
  const visible = hover || active || dropActive;
  return (
    <div style={{ position: 'relative', height: dropActive ? 20 : 0, transition: 'height .12s', zIndex: 3 }}>
      <div
        onMouseEnter={() => setHover(true)}
        onMouseLeave={() => setHover(false)}
        onClick={(e) => e.stopPropagation()}
        onDragOver={onDragOver}
        onDrop={onDrop}
        style={{
          position: 'absolute', left: 0, right: 0, top: dropActive ? 0 : -9,
          height: dropActive ? 20 : 18,
          display: 'flex', alignItems: 'center', justifyContent: 'center',
          opacity: visible ? 1 : 0, transition: 'opacity .12s', cursor: 'pointer',
        }}
      >
        <span style={{
          position: 'absolute', left: 24, right: 24, height: 2, background: RED,
          borderRadius: 2, opacity: dropActive || active ? 1 : 0.55,
        }} />
        <button
          type="button" aria-label={label} onClick={onClickPlus}
          style={{
            position: 'relative', zIndex: 1, width: 20, height: 20, borderRadius: 999,
            background: RED, color: '#fff', border: 'none', cursor: 'pointer',
            display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
            fontSize: 14, fontWeight: 700, lineHeight: 1,
          }}
        >+</button>
      </div>
    </div>
  );
}
