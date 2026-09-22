// Étape 4 — les créations. Une liste à gauche (ajouter, dupliquer, retirer),
// l'éditeur de la création ouverte, et l'aperçu feed collé à droite.

import { useState, type MutableRefObject } from 'react';
import { Plus, Copy, Trash2, Check, AlertCircle, Image as ImageIcon, Images, Clapperboard, AtSign as Instagram } from 'lucide-react';
import type { DeferredUpload } from '@/lib/deferredUpload';
import { MAX_CREATIVES, creativeIssues, newCreative, type AdCreative, type AdsEvent, type PreviewSlot } from '@/lib/metaAds';
import type { DraftCreative, WizardCall } from './types';
import { CreativeEditor } from './CreativeEditor';
import { AdPreview, type PreviewTab } from './AdPreview';
import { StepHeader, Tip, GhostButton, T1, T2, T3, BORDER, INNER_BG, RED, POS, WARN } from './ui';

const FormatIcon = ({ f }: { f: DraftCreative['format'] }) => f === 'video' ? <Clapperboard className="w-4 h-4" /> : f === 'carousel' ? <Images className="w-4 h-4" /> : f === 'instagram_post' ? <Instagram className="w-4 h-4" /> : <ImageIcon className="w-4 h-4" />;

export function StepCreatives({ creatives, selected, onSelect, onChange, posterUrl, event, uploadsRef, pageId, pageName, igUsername, instagramOn, facebookOn, placementsLabel, verticalOn, call, previewPayload, onEditPlacements, t }: {
  creatives: DraftCreative[];
  selected: string;
  onSelect: (id: string) => void;
  onChange: (next: DraftCreative[]) => void;
  posterUrl: string | null;
  event: AdsEvent | null;
  uploadsRef: MutableRefObject<Map<string, DeferredUpload>>;
  pageId?: string | null; pageName?: string | null; igUsername?: string | null; instagramOn: boolean; facebookOn: boolean;
  /** Où l'ensemble diffuse (texte lisible) et si stories / reels en font partie. */
  placementsLabel: string;
  verticalOn: boolean;
  call: WizardCall;
  /** Placements + lien envoyés à `ads_preview`. */
  previewPayload: { placements: Record<string, unknown>; eventId: string };
  onEditPlacements: () => void;
  t: (k: string) => string;
}) {
  const current = creatives.find((c) => c.id === selected) ?? creatives[0];
  const [tab, setTab] = useState<PreviewTab>('feed');
  const [meta, setMeta] = useState<{ busy: boolean; html: Partial<Record<PreviewSlot, string | null>>; error: string | null; forId: string | null }>({ busy: false, html: {}, error: null, forId: null });
  const requestMeta = async (slot: PreviewSlot) => {
    if (!current) return;
    setMeta((m) => ({ ...m, busy: true, error: null }));
    try {
      const r = await call('ads_preview', {
        creative: { format: current.format, media: current.media.filter((m) => m.url || m.kind === 'ig_post').map((m) => ({ url: m.url, kind: m.kind, ig_media_id: m.ig_media_id ?? null, thumbnail_url: m.thumbnail_url ?? null, headline: m.headline ?? null, description: m.description ?? null })),
          vertical_media: current.vertical_media?.url ? { url: current.vertical_media.url, kind: current.vertical_media.kind } : null,
          enhancements: current.enhancements === true, headline: current.headline, body: current.body, description: current.description, cta: current.cta },
        slots: [slot], placements: previewPayload.placements, eventId: previewPayload.eventId,
      });
      const p = ((r.previews as Array<{ slot: PreviewSlot; html: string | null; error: string | null }> | undefined) ?? [])[0];
      setMeta((m) => ({ busy: false, html: { ...(m.forId === current.id ? m.html : {}), [slot]: p?.html ?? null }, error: p?.error ?? (p?.html ? null : t('ads.w.preview.metaUnavailable')), forId: current.id }));
    } catch (e) {
      setMeta((m) => ({ ...m, busy: false, error: e instanceof Error ? e.message : 'error' }));
    }
  };
  const metaForCurrent = meta.forId === current?.id ? meta.html : {};
  const canMetaPreview = !!current && current.format !== 'video' && current.media.some((m) => m.url || m.kind === 'ig_post');
  const cover = (c: DraftCreative) => { const m = c.media.find((x) => x.kind === 'image' || x.kind === 'ig_post'); return m?.preview || m?.url || c.media.find((x) => x.kind === 'video')?.thumbnail_url || null; };
  void facebookOn;
  const add = () => { if (creatives.length >= MAX_CREATIVES) return; const c = newCreative({ cta: current?.cta ?? 'BUY_TICKETS', headline: current?.headline ?? '', body: current?.body ?? '' }) as DraftCreative; onChange([...creatives, { ...c, media: [] }]); onSelect(c.id); };
  const duplicate = (c: DraftCreative) => { if (creatives.length >= MAX_CREATIVES) return; const d = newCreative({}) as DraftCreative; const copy: DraftCreative = { ...c, id: d.id, media: c.media.filter((m) => m.url).map((m) => ({ ...m, localId: `${m.localId}_${d.id}` })) }; onChange([...creatives, copy]); onSelect(copy.id); };
  const remove = (id: string) => { if (creatives.length <= 1) return; const next = creatives.filter((c) => c.id !== id); onChange(next); if (selected === id) onSelect(next[0].id); };

  return (
    <div className="space-y-5">
      <StepHeader title={t('ads.w.creative.title')} intro={t('ads.w.creative.intro')} />
      <div className="flex items-center justify-between gap-3 flex-wrap rounded-xl px-4 py-3" style={{ background: INNER_BG, border: `1px solid ${BORDER}` }}>
        <p style={{ color: T2, fontSize: 13 }}><span style={{ color: T1, fontWeight: 600 }}>{t('ads.w.where.title')}</span> {placementsLabel}</p>
        <GhostButton small onClick={onEditPlacements}>{t('ads.w.where.change')}</GhostButton>
      </div>
      <div className="grid gap-5 lg:grid-cols-[1fr_320px]">
        <div className="space-y-4 min-w-0">
          <div className="flex gap-2 flex-wrap items-center">
            {creatives.map((c, i) => {
              const issues = creativeIssues(c as unknown as AdCreative);
              const uploading = c.media.some((m) => m.uploading) || !!c.vertical_media?.uploading;
              const active = c.id === current?.id;
              const img = cover(c);
              return (
                <button key={c.id} type="button" onClick={() => onSelect(c.id)}
                  className="flex items-center gap-2.5 rounded-xl pl-1.5 pr-3 py-1.5 cursor-pointer transition-colors duration-150"
                  style={{ background: active ? 'rgba(232,25,44,0.10)' : INNER_BG, border: `1px solid ${active ? 'rgba(232,25,44,0.5)' : BORDER}`, minHeight: 48 }}>
                  <span className="h-9 w-9 rounded-lg overflow-hidden flex items-center justify-center flex-shrink-0" style={{ background: 'rgba(255,255,255,0.06)', color: T3 }}>
                    {img ? <img src={img} alt="" className="h-full w-full object-cover" /> : <FormatIcon f={c.format} />}
                  </span>
                  <span className="text-left">
                    <span className="block" style={{ color: T1, fontSize: 13, fontWeight: 650 }}>{t('ads.w.creative.n').replace('{n}', String(i + 1))}</span>
                    <span className="inline-flex items-center gap-1" style={{ color: issues.length === 0 && !uploading ? POS : WARN, fontSize: 11.5 }}>
                      {issues.length === 0 && !uploading ? <Check className="w-3 h-3" /> : <AlertCircle className="w-3 h-3" />}
                      {uploading ? t('ads.w.media.uploading') : issues.length === 0 ? t('ads.w.creative.ready') : t('ads.w.creative.incomplete')}
                    </span>
                  </span>
                </button>
              );
            })}
            {creatives.length < MAX_CREATIVES && (
              <GhostButton onClick={add}><Plus className="w-4 h-4" /> {t('ads.w.creative.add')}</GhostButton>
            )}
          </div>

          {current && (
            <div className="rounded-2xl p-4 sm:p-5 space-y-5" style={{ background: INNER_BG, border: `1px solid ${BORDER}` }}>
              <div className="flex items-center justify-between gap-3 flex-wrap">
                <h3 style={{ color: T1, fontSize: 15.5, fontWeight: 650 }}>{t('ads.w.creative.n').replace('{n}', String(creatives.findIndex((c) => c.id === current.id) + 1))}</h3>
                <div className="flex gap-2">
                  <GhostButton small onClick={() => duplicate(current)} disabled={creatives.length >= MAX_CREATIVES}><Copy className="w-3.5 h-3.5" /> {t('ads.w.creative.duplicate')}</GhostButton>
                  <GhostButton small onClick={() => remove(current.id)} disabled={creatives.length <= 1}><Trash2 className="w-3.5 h-3.5" style={{ color: RED }} /> {t('ads.wizard.remove')}</GhostButton>
                </div>
              </div>
              <CreativeEditor creative={current} posterUrl={posterUrl} event={event} uploadsRef={uploadsRef} call={call} igAvailable={instagramOn && !!igUsername} verticalOn={verticalOn} t={t}
                onChange={(next) => onChange(creatives.map((c) => (c.id === next.id ? next : c)))} />
            </div>
          )}
          <Tip tone="tip">{t('ads.w.creative.tip')}</Tip>
        </div>
        <div className="lg:sticky lg:top-4 self-start space-y-2">
          <p style={{ color: T3, fontSize: 11, fontWeight: 600, letterSpacing: '0.07em', textTransform: 'uppercase' }}>{t('ads.w.preview.title')}</p>
          {current && <AdPreview creative={current} pageId={pageId} pageName={pageName} igUsername={igUsername} instagramOn={instagramOn} tab={tab} onTab={setTab}
            metaPreview={{ request: requestMeta, busy: meta.busy, html: metaForCurrent, error: meta.forId === current.id ? meta.error : null, enabled: canMetaPreview }} t={t} />}
          <p style={{ color: T3, fontSize: 12, lineHeight: 1.45 }}>{t('ads.w.preview.note')}</p>
          <span className="hidden" style={{ color: T2 }} />
        </div>
      </div>
    </div>
  );
}
