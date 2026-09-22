// Aperçu d'une création dans les trois cadres où elle vivra : le feed
// Instagram (carte avec titre et bouton), la story (plein écran 9:16, barre de
// progression, bouton en bas) et le reel (plein écran, icônes à droite,
// légende en bas). La version verticale est montrée quand elle existe, sinon
// le visuel feed est recadré comme Meta le ferait. « Aperçu Meta » demande à
// Meta son propre rendu (iframe) pour l'onglet ouvert.

import { useEffect, useState } from 'react';
import { ChevronLeft, ChevronRight, ImageIcon, Heart, MessageCircle, Send, Bookmark, MoreHorizontal, Music2, Loader2, Sparkles } from 'lucide-react';
import type { PreviewSlot } from '@/lib/metaAds';
import type { DraftCreative, DraftMedia } from './types';
import { T1, T3, BORDER, RED } from './ui';

export type PreviewTab = 'feed' | 'story' | 'reel';

export function AdPreview({ creative, pageId, pageName, igUsername, instagramOn, tab: tabProp, onTab, metaPreview, t }: {
  creative: DraftCreative;
  pageId?: string | null;
  pageName?: string | null;
  igUsername?: string | null;
  instagramOn: boolean;
  tab?: PreviewTab;
  onTab?: (tab: PreviewTab) => void;
  /** Aperçu réel Meta : `request` lance l'appel, `html` est l'iframe rendu pour l'onglet. */
  metaPreview?: { request: (slot: PreviewSlot) => void; busy: boolean; html: Partial<Record<PreviewSlot, string | null>>; error: string | null; enabled: boolean };
  t: (k: string) => string;
}) {
  const [innerTab, setInnerTab] = useState<PreviewTab>('feed');
  const tab = tabProp ?? innerTab;
  const setTab = (x: PreviewTab) => { setInnerTab(x); onTab?.(x); };
  const [card, setCard] = useState(0);
  const isVideo = creative.format === 'video';
  const media = isVideo ? creative.media.filter((m) => m.kind === 'video') : creative.format === 'instagram_post' ? creative.media.filter((m) => m.kind === 'ig_post') : creative.media.filter((m) => m.kind === 'image');
  useEffect(() => { if (card >= media.length) setCard(0); }, [media.length, card]);
  const shown: DraftMedia | undefined = media[Math.min(card, Math.max(0, media.length - 1))];
  const vertical = creative.vertical_media && (creative.vertical_media.preview || creative.vertical_media.url) ? creative.vertical_media : null;
  const src = (m?: DraftMedia | null) => m?.preview || m?.url || '';
  const name = pageName || t('ads.wizard.previewPage');
  const handle = instagramOn && igUsername ? igUsername : name;
  const cardHeadline = creative.format === 'carousel' ? (shown?.headline || creative.headline) : creative.headline;
  const bodyText = creative.format === 'instagram_post' ? (shown?.description || '') : creative.body;
  const cta = t(`ads.cta.${creative.cta}`);
  const metaHtml = metaPreview?.html[tab === 'feed' ? 'feed' : tab === 'story' ? 'story' : 'reel'];
  const metaSrc = metaHtml ? (metaHtml.match(/src="([^"]+)"/)?.[1] ?? null)?.replace(/&amp;/g, '&') ?? null : null;

  const Avatar = ({ size }: { size: number }) => (
    <div className="rounded-full overflow-hidden flex-shrink-0" style={{ width: size, height: size, background: 'rgba(255,255,255,0.14)', border: '1px solid rgba(255,255,255,0.25)' }}>
      {pageId && <img src={`https://graph.facebook.com/${pageId}/picture?type=square`} alt="" className="h-full w-full object-cover" />}
    </div>
  );
  const Media = ({ m, fill }: { m: DraftMedia | null | undefined; fill?: boolean }) => !m ? (
    <div className="h-full w-full flex flex-col items-center justify-center gap-2" style={{ color: T3 }}><ImageIcon className="w-7 h-7" /><p style={{ fontSize: 12 }}>{t('ads.w.preview.noMedia')}</p></div>
  ) : m.kind === 'video' ? (
    <video key={src(m)} src={src(m)} poster={m.thumbnail_url ?? undefined} muted playsInline autoPlay loop className={`h-full w-full ${fill ? 'object-cover' : 'object-contain'} bg-black`} />
  ) : (
    <img src={src(m)} alt="" className={`h-full w-full ${fill ? 'object-cover' : 'object-cover'}`} />
  );

  const tabs: PreviewTab[] = ['feed', 'story', 'reel'];
  return (
    <div className="space-y-2">
      <div className="flex items-center gap-1 rounded-xl p-1" style={{ background: 'rgba(255,255,255,0.05)', border: `1px solid ${BORDER}` }}>
        {tabs.map((x) => (
          <button key={x} type="button" onClick={() => setTab(x)} className="flex-1 rounded-lg py-1.5 text-[12.5px] font-semibold cursor-pointer transition-colors duration-150"
            style={tab === x ? { background: 'rgba(255,255,255,0.12)', color: T1 } : { color: T3 }}>{t(`ads.w.preview.tab.${x}`)}</button>
        ))}
      </div>

      {metaSrc ? (
        <div className="rounded-2xl overflow-hidden flex justify-center" style={{ background: '#111113', border: `1px solid ${BORDER}` }}>
          <iframe title="meta-preview" src={metaSrc} className="block" style={{ width: tab === 'feed' ? 320 : 300, height: tab === 'feed' ? 560 : 540, border: 0 }} sandbox="allow-scripts allow-same-origin allow-popups" />
        </div>
      ) : tab === 'feed' ? (
        <div className="rounded-2xl overflow-hidden" style={{ background: '#111113', border: `1px solid ${BORDER}` }}>
          <div className="px-3.5 py-2.5 flex items-center gap-2.5">
            <Avatar size={32} />
            <div className="min-w-0 flex-1"><p className="truncate" style={{ color: T1, fontSize: 13, fontWeight: 650 }}>{handle}</p><p style={{ color: T3, fontSize: 11 }}>{t('ads.wizard.previewSponsored')}</p></div>
            <MoreHorizontal className="w-4 h-4" style={{ color: T3 }} />
          </div>
          <div className="relative" style={{ background: 'rgba(255,255,255,0.05)' }}>
            <div className={isVideo && shown ? '' : 'aspect-[4/5]'}><Media m={shown} fill /></div>
            {creative.format === 'carousel' && media.length > 1 && (
              <>
                <button type="button" aria-label="previous" onClick={() => setCard((c) => (c - 1 + media.length) % media.length)} className="absolute left-2 top-1/2 -translate-y-1/2 h-9 w-9 rounded-full flex items-center justify-center cursor-pointer" style={{ background: 'rgba(0,0,0,0.55)', color: '#fff' }}><ChevronLeft className="w-5 h-5" /></button>
                <button type="button" aria-label="next" onClick={() => setCard((c) => (c + 1) % media.length)} className="absolute right-2 top-1/2 -translate-y-1/2 h-9 w-9 rounded-full flex items-center justify-center cursor-pointer" style={{ background: 'rgba(0,0,0,0.55)', color: '#fff' }}><ChevronRight className="w-5 h-5" /></button>
                <div className="absolute bottom-2 left-0 right-0 flex justify-center gap-1.5">{media.map((m, i) => <span key={m.localId} className="h-1.5 w-1.5 rounded-full" style={{ background: i === card ? '#fff' : 'rgba(255,255,255,0.4)' }} />)}</div>
              </>
            )}
          </div>
          {creative.format !== 'instagram_post' && (
            <div className="flex items-center justify-between px-3.5 py-2.5" style={{ background: 'rgba(255,255,255,0.06)' }}>
              <div className="min-w-0"><p className="truncate" style={{ color: T1, fontSize: 13, fontWeight: 700 }}>{cardHeadline || t('ads.wizard.previewHeadline')}</p>{creative.description && <p className="truncate" style={{ color: T3, fontSize: 11.5 }}>{creative.description}</p>}</div>
              <span className="flex-shrink-0 ml-3 px-3 py-1.5 rounded-lg" style={{ background: 'rgba(255,255,255,0.14)', color: T1, fontSize: 12, fontWeight: 700 }}>{cta}</span>
            </div>
          )}
          <div className="px-3.5 py-2 flex items-center gap-4" style={{ color: T1 }}><Heart className="w-5 h-5" /><MessageCircle className="w-5 h-5" /><Send className="w-5 h-5" /><Bookmark className="w-5 h-5 ml-auto" /></div>
          {(bodyText || creative.format === 'instagram_post') && (
            <p className="px-3.5 pb-3 whitespace-pre-line" style={{ color: T1, fontSize: 12.5, lineHeight: 1.45 }}><span style={{ fontWeight: 650 }}>{handle}</span> {bodyText}</p>
          )}
        </div>
      ) : (
        <div className="mx-auto rounded-[28px] overflow-hidden relative" style={{ width: 300, aspectRatio: '9 / 16', background: '#000', border: `1px solid ${BORDER}` }}>
          <div className="absolute inset-0"><Media m={vertical ?? shown} fill /></div>
          <div className="absolute inset-x-0 top-0 h-32" style={{ background: 'linear-gradient(180deg, rgba(0,0,0,0.55), transparent)' }} />
          <div className="absolute inset-x-0 bottom-0 h-48" style={{ background: 'linear-gradient(0deg, rgba(0,0,0,0.7), transparent)' }} />
          {tab === 'story' ? (
            <>
              <div className="absolute top-2 left-2 right-2 h-0.5 rounded-full" style={{ background: 'rgba(255,255,255,0.35)' }}><div className="h-full w-1/3 rounded-full bg-white" /></div>
              <div className="absolute top-4 left-3 right-3 flex items-center gap-2"><Avatar size={28} /><p className="truncate" style={{ color: '#fff', fontSize: 12.5, fontWeight: 650 }}>{handle}</p><span style={{ color: 'rgba(255,255,255,0.7)', fontSize: 11 }}>{t('ads.wizard.previewSponsored')}</span></div>
              <div className="absolute bottom-5 left-4 right-4 flex flex-col items-center gap-2">
                <span style={{ color: '#fff', fontSize: 11 }}>▲</span>
                <span className="w-full text-center py-2.5 rounded-full" style={{ background: '#fff', color: '#0A0A0A', fontSize: 13, fontWeight: 700 }}>{cta}</span>
              </div>
            </>
          ) : (
            <>
              <div className="absolute right-3 bottom-24 flex flex-col items-center gap-4" style={{ color: '#fff' }}><Heart className="w-6 h-6" /><MessageCircle className="w-6 h-6" /><Send className="w-6 h-6" /><MoreHorizontal className="w-6 h-6" /></div>
              <div className="absolute left-3 right-14 bottom-5 space-y-2">
                <div className="flex items-center gap-2"><Avatar size={26} /><p className="truncate" style={{ color: '#fff', fontSize: 12.5, fontWeight: 650 }}>{handle}</p><span style={{ color: 'rgba(255,255,255,0.7)', fontSize: 11 }}>{t('ads.wizard.previewSponsored')}</span></div>
                {bodyText && <p className="line-clamp-2" style={{ color: '#fff', fontSize: 12, lineHeight: 1.35 }}>{bodyText}</p>}
                <span className="inline-block px-3 py-2 rounded-lg" style={{ background: 'rgba(255,255,255,0.92)', color: '#0A0A0A', fontSize: 12, fontWeight: 700 }}>{cta}</span>
                <p className="flex items-center gap-1.5" style={{ color: 'rgba(255,255,255,0.75)', fontSize: 11 }}><Music2 className="w-3 h-3" /> {handle} · {t('ads.w.preview.originalAudio')}</p>
              </div>
            </>
          )}
          {!vertical && shown && <span className="absolute top-12 left-3 px-2 py-1 rounded-md" style={{ background: 'rgba(0,0,0,0.55)', color: '#fff', fontSize: 10.5 }}>{t('ads.w.preview.croppedByMeta')}</span>}
        </div>
      )}

      {metaPreview?.enabled && (
        <div className="flex items-center justify-between gap-2">
          <button type="button" onClick={() => metaPreview.request(tab === 'feed' ? 'feed' : tab === 'story' ? 'story' : 'reel')} disabled={metaPreview.busy}
            className="inline-flex items-center gap-1.5 px-3 rounded-lg text-[12.5px] font-semibold cursor-pointer disabled:opacity-50" style={{ background: 'rgba(8,102,255,0.14)', border: '1px solid rgba(8,102,255,0.4)', color: '#8FB6FF', minHeight: 34 }}>
            {metaPreview.busy ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Sparkles className="w-3.5 h-3.5" />} {metaSrc ? t('ads.w.preview.metaRefresh') : t('ads.w.preview.metaAsk')}
          </button>
          {metaPreview.error && <span style={{ color: '#FF8A91', fontSize: 11.5 }}>{metaPreview.error}</span>}
        </div>
      )}
      <span className="hidden" style={{ color: RED }} />
    </div>
  );
}
