/**
 * Centre du Studio : l'e-mail tel qu'il partira. Les blocs sont rendus par le
 * miroir React de la Suite (blocks/*View, à l'identique de renderEmailHtml) ;
 * autour, la grammaire du design : contour au survol et à la sélection, barre
 * noire (glisser, monter, descendre, dupliquer, supprimer), « + » entre deux
 * blocs, trait rouge de dépôt, « Ajouter un bloc » en fin, pied de page légal.
 * En aperçu (touche P), c'est le HTML d'envoi lui-même, avec un client fictif.
 */
import { useEffect, useMemo, useState } from 'react';
import type { DragEvent, MouseEvent } from 'react';
import { Hv } from '@/crm/ui/Hv';
import { Icon } from '@/crm/ui/Icon';
import { useCrmToast } from '@/crm/ui/toast';
import { EASE } from '@/crm/ui/motion';
import { YunitFace } from '@/crm/ui/YunitFace';
import { useCrmT } from '@/crm/i18n';
import { useCrmScope } from '@/crm/scope';
import { useEmailSettings } from '@/crm/data/emails';
import { useStudio, useStudioApi } from '@/components/email-studio/store';
import BlockRenderer from '@/components/email-studio/blocks/BlockRenderer';
import { blockBgColor, type CanvasCtx } from '@/components/email-studio/blocks/common';
import { Wordmark } from '@/components/brand/Wordmark';
import {
  bindBlocksToEvent, contrastText, footerSocialEnabled, isHexColor, renderEmailHtml, socialChip, socialLabel,
  type LiveData, type SocialLinks,
} from '@/lib/email';
import { PaletteModal } from './StudioLeft';
import { useInsertBlock } from './insert';
import { useStudioUi } from './studioUi';

const PUBLIC_BASE_URL = (import.meta.env.VITE_APP_BASE_URL as string | undefined) || 'https://yunoapp.eu';
const SAMPLE = { email: 'camille@exemple.fr', firstName: 'Camille', lastName: 'Martin', city: 'Paris', lastEventTitle: null };
const FOOTER_FONT = "Arial,'Helvetica Neue',Helvetica,sans-serif";
const MONO = "'SF Mono',SFMono-Regular,Menlo,Consolas,'Liberation Mono',monospace";

export function StudioCanvas({ live, readOnly, narrow }: { live: LiveData; readOnly: boolean; narrow: boolean }) {
  const { t } = useCrmT();
  const toast = useCrmToast();
  const { space } = useCrmScope();
  const api = useStudioApi();
  const ui = useStudioUi();
  const insert = useInsertBlock();
  const campaign = useStudio((s) => s.campaign);
  const selectedId = useStudio((s) => s.selectedId);
  const insertIndex = useStudio((s) => s.insertIndex);
  const device = useStudio((s) => s.device);
  const preview = useStudio((s) => s.preview) || readOnly;
  const [first] = useState(() => Date.now());
  const fresh = Date.now() - first < 2200;
  const mob = device === 'mobile';
  const theme = campaign.theme;
  const N = campaign.blocks.length;
  // Le pied de page montre l'adresse réglée dans Réglages d'envoi, comme l'envoi.
  const settings = useEmailSettings();
  const postalAddress = settings.data?.postal_address ?? null;
  const place = (postalAddress ?? '').trim() || (space.city ?? '').trim();

  const ctx: CanvasCtx = useMemo(() => ({
    venueName: space.name, logoUrl: space.logoUrl, socialLinks: campaign.socialLinks, live, baseUrl: PUBLIC_BASE_URL, fallbackEventId: campaign.eventId,
    language: campaign.language ?? null,
  }), [space.name, space.logoUrl, campaign.socialLinks, live, campaign.eventId, campaign.language]);

  const html = useMemo(() => (preview ? renderEmailHtml(bindBlocksToEvent(campaign.blocks, campaign.eventId), theme, {
    venueName: space.name, city: space.city, postalAddress, logoUrl: space.logoUrl, emailType: campaign.type, language: campaign.language ?? null,
    subject: campaign.subject, preheader: campaign.preheader, recipient: SAMPLE, unsubscribeUrl: '#',
    socialLinks: campaign.socialLinks, baseUrl: PUBLIC_BASE_URL, live, ignoreConds: true,
  }) : ''), [preview, campaign, theme, space, live, postalAddress]);

  const openInsert = (i: number) => {
    api.getState().setInsertIndex(i);
    if (narrow) ui.setPaletteOpen(true); else api.getState().setPaletteTab('blocks');
  };

  const drop = (e: DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
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
  const overBlock = (i: number) => (e: DragEvent<HTMLDivElement>) => {
    if (!ui.drag) return;
    e.preventDefault();
    e.stopPropagation();
    const r = e.currentTarget.getBoundingClientRect();
    const at = e.clientY < r.top + r.height / 2 ? i : i + 1;
    if (ui.dropAt !== at) ui.setDropAt(at);
  };
  const stop = (fn: () => void) => (e: MouseEvent) => { e.stopPropagation(); fn(); };

  const socialLinks = (footerSocialEnabled(theme)
    ? (Object.entries(campaign.socialLinks) as [keyof SocialLinks, string | undefined][]).filter((x): x is [keyof SocialLinks, string] => !!x[1] && x[1].trim().length > 0)
    : []);
  const chip = socialChip(undefined, theme);
  const footerDark = isHexColor(theme.footerBg) && contrastText(theme.footerBg) === '#ffffff';
  const footerBorder = footerDark ? 'none' : `1px solid ${theme.divider}`;
  const width = (mob ? 375 : 600) + 48;
  // La barre d'un bloc se pose à droite de l'e-mail quand la place existe,
  // sinon dans le bloc (petit écran, panneaux ouverts sur un écran moyen).
  const [box, setBox] = useState<HTMLElement | null>(null);
  const [room, setRoom] = useState(0);
  useEffect(() => {
    if (!box) return undefined;
    const ro = new ResizeObserver(([e]) => setRoom(e.contentRect.width));
    ro.observe(box);
    return () => ro.disconnect();
  }, [box]);
  // Il faut ~50 px à droite de l'e-mail : la marge du centre plus son rembourrage (24 px).
  const outside = !narrow && (room - width) / 2 + 24 >= 52;

  return (
    <section
      ref={setBox}
      onClick={() => { if (!preview) api.getState().select(null); }}
      onDragOver={(e) => { if (ui.drag) e.preventDefault(); }}
      className="yc-thin-scroll"
      style={{ flex: 1, minWidth: 0, position: 'relative', overflow: 'auto', display: 'flex', flexDirection: 'column', alignItems: 'center', padding: preview ? '28px 20px 20px' : narrow ? '24px 12px 20px' : '36px 24px 20px', boxSizing: 'border-box' }}
    >
      {preview && !readOnly && (
        <div style={{ position: 'sticky', top: 0, zIndex: 30, marginBottom: 16, display: 'flex', alignItems: 'center', gap: 12, height: 44, padding: '0 8px 0 18px', borderRadius: 99, background: 'var(--ink)', color: '#fff', boxShadow: 'var(--shadow-md)', animation: `yc-pop 240ms ${EASE} both`, flex: 'none' }}>
          <span style={{ fontSize: 14, fontWeight: 500 }}>{t('yc.em.st.c.prev')}<b style={{ fontWeight: 600 }}>Camille</b></span>
          <Hv as="button" type="button" onClick={() => api.getState().setPreview(false)} style={{ height: 32, padding: '0 14px', border: 0, borderRadius: 99, background: 'rgba(255,255,255,.14)', color: '#fff', fontSize: 13.5, fontWeight: 600, cursor: 'pointer' }} hover={{ background: 'rgba(255,255,255,.24)' }}>
            {t('yc.em.st.c.back')}
          </Hv>
        </div>
      )}

      {preview ? (
        <div style={{ flex: 'none', width, maxWidth: '100%', borderRadius: 20, overflow: 'hidden', boxShadow: 'var(--shadow-md),0 0 0 1px var(--sand-200)', background: theme.bg, transition: `width 360ms ${EASE}`, animation: `yc-rise 500ms ${EASE} both` }}>
          <iframe title={t('yc.em.st.preview')} srcDoc={html} sandbox="" style={{ display: 'block', width: '100%', height: 'calc(100vh - 190px)', minHeight: 480, border: 0, background: theme.bg }} />
        </div>
      ) : (
        <div style={{ flex: 'none', width, maxWidth: '100%', boxSizing: 'border-box', background: theme.bg, padding: mob || narrow ? 12 : 24, borderRadius: 20, boxShadow: 'var(--shadow-md),0 0 0 1px var(--sand-200)', transition: `width 360ms ${EASE}`, animation: `yc-rise 800ms ${EASE} 250ms both` }}>
          <div onClick={(e) => e.stopPropagation()} style={{ width: '100%', background: theme.card }}>
            {campaign.blocks.map((b, i) => {
              const sel = selectedId === b.id;
              const hov = ui.hoverId === b.id && !ui.drag;
              const lineTop = (!!ui.drag && ui.dropAt === i) || insertIndex === i;
              return (
                <div
                  key={b.id}
                  id={`blk-${b.id}`}
                  onClick={(e) => { e.stopPropagation(); api.getState().select(b.id); }}
                  onMouseEnter={() => ui.setHoverId(b.id)}
                  onMouseLeave={() => { if (ui.hoverId === b.id) ui.setHoverId(null); }}
                  onDragOver={overBlock(i)}
                  onDrop={drop}
                  style={{ position: 'relative', outline: sel ? '2px solid var(--red-500)' : hov ? '2px solid rgba(227,20,27,.4)' : 'none', outlineOffset: -2, cursor: 'pointer', background: blockBgColor(b, theme), opacity: ui.drag?.kind === 'move' && ui.drag.id === b.id ? 0.45 : 1, animation: fresh ? `yc-row 520ms ${EASE} ${300 + i * 90}ms both` : undefined }}
                >
                  {lineTop && <div style={{ position: 'absolute', left: 0, right: 0, top: -2, height: 4, background: 'var(--red-500)', zIndex: 7, borderRadius: 2, pointerEvents: 'none', animation: `yc-drop 160ms ${EASE}` }} />}
                  <BlockRenderer block={b} theme={theme} ctx={ctx} mobile={mob} />
                  {(sel || hov) && (
                    // Hors de l'e-mail, à droite : sur un titre d'une ligne, la barre posée
                    // dedans masquait le texte qu'on venait de sélectionner.
                    <div style={!outside
                      ? { position: 'absolute', top: 8, right: 8, zIndex: 8, display: 'flex', alignItems: 'center', gap: 2, padding: 4, borderRadius: 99, background: 'var(--ink)', boxShadow: 'var(--shadow-md)', animation: `yc-pop 140ms ${EASE}` }
                      : { position: 'absolute', top: 0, left: `calc(100% + ${mob ? 22 : 34}px)`, zIndex: 8, display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 2, padding: 4, borderRadius: 99, background: 'var(--ink)', boxShadow: 'var(--shadow-md)', animation: `yc-pop 140ms ${EASE}` }}>
                      <span
                        draggable
                        onDragStart={(e) => {
                          e.stopPropagation();
                          try {
                            e.dataTransfer.setData('text/plain', b.id);
                            e.dataTransfer.effectAllowed = 'move';
                            const el = document.getElementById(`blk-${b.id}`);
                            if (el) e.dataTransfer.setDragImage(el, 24, 24);
                          } catch { /* glisser interne */ }
                          ui.setDrag({ kind: 'move', id: b.id });
                          api.getState().select(b.id);
                        }}
                        onDragEnd={() => { ui.setDrag(null); ui.setDropAt(null); }}
                        title={t('yc.em.st.drag')}
                        style={{ width: 30, height: 30, borderRadius: 99, color: 'rgba(255,255,255,.7)', display: 'grid', placeItems: 'center', cursor: 'grab' }}
                      >
                        <Icon d="M9 5h.01M9 12h.01M9 19h.01M15 5h.01M15 12h.01M15 19h.01" size={15} stroke={3} />
                      </span>
                      <ToolBtn label={t('yc.em.st.up')} d="m18 15-6-6-6 6" onClick={stop(() => api.getState().moveBlock(b.id, -1))} />
                      <ToolBtn label={t('yc.em.st.down')} d="m6 9 6 6 6-6" onClick={stop(() => api.getState().moveBlock(b.id, 1))} />
                      <ToolBtn label={t('yc.em.st.dup')} d="M8 8h12v12H8zM4 16V4h12" onClick={stop(() => api.getState().duplicate(b.id))} />
                      <ToolBtn label={t('yc.em.st.del')} d="M3 6h18M8 6V4h8v2M19 6l-1 14H6L5 6" danger onClick={stop(() => { api.getState().removeBlock(b.id); ui.setHoverId(null); toast(t('yc.em.st.deleted')); })} />
                    </div>
                  )}
                  {(sel || hov) && !ui.drag && (
                    <>
                      <PlusDot top label={t('yc.em.st.insHere')} onClick={stop(() => openInsert(i))} />
                      <PlusDot top={false} label={t('yc.em.st.insHere')} onClick={stop(() => openInsert(i + 1))} />
                    </>
                  )}
                </div>
              );
            })}

            {N === 0 && (
              <div
                onDragOver={(e) => { if (!ui.drag) return; e.preventDefault(); if (ui.dropAt !== 0) ui.setDropAt(0); }}
                onDrop={drop}
                style={{ margin: 24, padding: '48px 20px', borderRadius: 20, border: '2px dashed var(--sand-300)', display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 10, textAlign: 'center', fontFamily: 'var(--font-body)', color: 'var(--ink)' }}
              >
                <YunitFace mood="content" size={48} />
                <b style={{ fontSize: 16 }}>{t('yc.em.st.c.empty')}</b>
                <span style={{ fontSize: 14, color: 'var(--sand-500)' }}>{t('yc.em.st.c.emptySub')}</span>
                <EndButton label={t('yc.em.st.c.add')} onClick={() => openInsert(0)} />
              </div>
            )}

            {N > 0 && (
              <div
                onDragOver={(e) => { if (!ui.drag) return; e.preventDefault(); if (ui.dropAt !== N) ui.setDropAt(N); }}
                onDrop={drop}
                style={{ position: 'relative', height: ui.drag ? 56 : 52, display: 'flex', alignItems: 'center', justifyContent: 'center' }}
              >
                {((!!ui.drag && ui.dropAt === N) || insertIndex === N) && <div style={{ position: 'absolute', left: 0, right: 0, top: -2, height: 4, background: 'var(--red-500)', borderRadius: 2, pointerEvents: 'none' }} />}
                <EndButton label={t('yc.em.st.c.add')} onClick={() => openInsert(N)} />
              </div>
            )}

            {/* Pied de page : ajouté à l'envoi, jamais modifiable (miroir de renderFooter). */}
            {socialLinks.length > 0 && (
              <div style={{ padding: '18px 24px 4px', background: theme.footerBg, textAlign: 'center', borderTop: footerBorder }}>
                {socialLinks.map(([key, url]) => (
                  <span key={key} title={socialLabel(key, url)} style={{ width: 34, height: 34, borderRadius: '50%', margin: '0 5px', background: chip.chip, display: 'inline-flex', alignItems: 'center', justifyContent: 'center', verticalAlign: 'middle' }}>
                    <img src={`/email-social/${key}-${chip.glyph}.png`} alt={socialLabel(key, url)} width={16} height={16} style={{ display: 'block' }} />
                  </span>
                ))}
              </div>
            )}
            <div style={{ padding: '22px 24px', background: theme.footerBg, textAlign: 'center', borderTop: socialLinks.length ? 'none' : footerBorder, fontFamily: FOOTER_FONT }}>
              <div style={{ fontSize: 12, fontWeight: 600, color: theme.footerText, marginBottom: 6 }}>{space.name}{place ? ` — ${place}` : ''}</div>
              <div style={{ fontSize: 11.5, lineHeight: 1.6, color: theme.footerText }}>Cet email a été envoyé à {SAMPLE.email} car vous êtes abonné à sa newsletter.</div>
              <div style={{ fontSize: 11.5, lineHeight: 1.6, color: theme.footerText, marginTop: 4 }}>© {new Date().getFullYear()} {space.name}. Tous droits réservés.</div>
              <div style={{ fontSize: 11.5, marginTop: 8, color: theme.accent, textDecoration: 'underline' }}>Se désabonner</div>
              <div style={{ marginTop: 18 }}>
                <div style={{ fontFamily: MONO, fontSize: 9.5, lineHeight: '13px', fontWeight: 700, letterSpacing: '0.16em', color: theme.footerText }}>POWERED BY</div>
                <Wordmark height={14} tone={footerDark ? 'white' : 'dark'} style={{ margin: '5px auto 0' }} />
              </div>
            </div>
          </div>
        </div>
      )}
      <div style={{ flex: 'none', height: 40 }} />
      {narrow && <PaletteModal />}
    </section>
  );
}

function ToolBtn({ label, d, onClick, danger }: { label: string; d: string; onClick: (e: MouseEvent) => void; danger?: boolean }) {
  return (
    <Hv as="button" type="button" onClick={onClick} aria-label={label} title={label} style={{ width: 30, height: 30, border: 0, borderRadius: 99, background: 'none', color: danger ? '#FF948D' : '#fff', cursor: 'pointer', display: 'grid', placeItems: 'center' }} hover={{ background: 'rgba(255,255,255,.16)' }}>
      <Icon d={d} size={15} stroke={2.3} />
    </Hv>
  );
}

function PlusDot({ top, label, onClick }: { top: boolean; label: string; onClick: (e: MouseEvent) => void }) {
  return (
    <Hv
      as="button"
      type="button"
      onClick={onClick}
      aria-label={label}
      title={label}
      style={{ position: 'absolute', left: '50%', [top ? 'top' : 'bottom']: -13, width: 26, height: 26, marginLeft: -13, border: '2px solid #fff', borderRadius: 99, background: 'var(--red-500)', color: '#fff', cursor: 'pointer', display: 'grid', placeItems: 'center', padding: 0, zIndex: 9, boxShadow: 'var(--shadow-sm)', animation: `yc-pop 140ms ${EASE}` }}
      hover={{ background: 'var(--red-600)' }}
    >
      <Icon name="plus" size={13} stroke={3} />
    </Hv>
  );
}

function EndButton({ label, onClick }: { label: string; onClick: () => void }) {
  return (
    <Hv
      as="button"
      type="button"
      onClick={(e: MouseEvent) => { e.stopPropagation(); onClick(); }}
      style={{ height: 34, padding: '0 14px', border: '1.5px dashed var(--sand-300)', borderRadius: 99, background: 'transparent', color: 'var(--sand-500)', fontSize: 13, fontWeight: 600, cursor: 'pointer', display: 'flex', alignItems: 'center', gap: 6, fontFamily: 'var(--font-body)' }}
      hover={{ borderColor: 'var(--red-400)', color: 'var(--red-600)', background: 'var(--red-50)' }}
    >
      <Icon name="plus" size={13} stroke={3} />{label}
    </Hv>
  );
}
