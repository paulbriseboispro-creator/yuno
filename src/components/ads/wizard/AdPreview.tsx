// Aperçu « façon feed » d'une création : la Page en en-tête, le média
// (image, carrousel qui défile, vidéo lisible), le texte, la carte de lien
// avec le bouton. C'est l'écran que Meta montrera, aux couleurs près.

import { useEffect, useState } from 'react';
import { ChevronLeft, ChevronRight, Play, ImageIcon } from 'lucide-react';
import type { DraftCreative, DraftMedia } from './types';
import { T1, T3, BORDER } from './ui';

export function AdPreview({ creative, pageId, pageName, igUsername, instagramOn, t }: {
  creative: DraftCreative;
  pageId?: string | null;
  pageName?: string | null;
  igUsername?: string | null;
  instagramOn: boolean;
  t: (k: string) => string;
}) {
  const [card, setCard] = useState(0);
  const media = creative.format === 'video' ? creative.media.filter((m) => m.kind === 'video') : creative.format === 'instagram_post' ? creative.media.filter((m) => m.kind === 'ig_post') : creative.media.filter((m) => m.kind === 'image');
  useEffect(() => { if (card >= media.length) setCard(0); }, [media.length, card]);
  const shown: DraftMedia | undefined = media[Math.min(card, Math.max(0, media.length - 1))];
  const src = (m?: DraftMedia) => m?.preview || m?.url || '';
  const cardHeadline = creative.format === 'carousel' ? (shown?.headline || creative.headline) : creative.headline;
  const cardDesc = creative.format === 'carousel' ? (shown?.description || creative.description) : creative.description;

  return (
    <div className="rounded-2xl overflow-hidden" style={{ background: '#111113', border: `1px solid ${BORDER}` }}>
      <div className="px-3.5 py-2.5 flex items-center gap-2.5">
        <div className="h-8 w-8 rounded-full overflow-hidden flex-shrink-0" style={{ background: 'rgba(255,255,255,0.12)' }}>
          {pageId && <img src={`https://graph.facebook.com/${pageId}/picture?type=square`} alt="" className="h-full w-full object-cover" />}
        </div>
        <div className="min-w-0">
          <p className="truncate" style={{ color: T1, fontSize: 13, fontWeight: 650 }}>{pageName || t('ads.wizard.previewPage')}</p>
          <p className="truncate" style={{ color: T3, fontSize: 11 }}>{t('ads.wizard.previewSponsored')}{instagramOn && igUsername ? ` · @${igUsername}` : ''}</p>
        </div>
      </div>
      {creative.format === 'instagram_post' && shown?.description ? <p className="px-3.5 pb-2.5 whitespace-pre-line" style={{ color: T1, fontSize: 13, lineHeight: 1.45 }}>{shown.description}</p>
        : creative.body && <p className="px-3.5 pb-2.5 whitespace-pre-line" style={{ color: T1, fontSize: 13, lineHeight: 1.45 }}>{creative.body}</p>}
      <div className="relative" style={{ background: 'rgba(255,255,255,0.05)' }}>
        <div className={creative.format === 'video' && shown ? '' : 'aspect-square'}>
          {!shown ? (
            <div className="h-full w-full flex flex-col items-center justify-center gap-2 aspect-square" style={{ color: T3 }}>
              <ImageIcon className="w-7 h-7" />
              <p style={{ fontSize: 12 }}>{t('ads.w.preview.noMedia')}</p>
            </div>
          ) : creative.format === 'video' ? (
            <video key={src(shown)} src={src(shown)} poster={shown.thumbnail_url ?? undefined} controls muted playsInline className="w-full max-h-[420px] object-contain bg-black" />
          ) : (
            <img src={src(shown)} alt="" className="h-full w-full object-cover" />
          )}
        </div>
        {creative.format === 'carousel' && media.length > 1 && (
          <>
            <button type="button" aria-label="previous" onClick={() => setCard((c) => (c - 1 + media.length) % media.length)} className="absolute left-2 top-1/2 -translate-y-1/2 h-9 w-9 rounded-full flex items-center justify-center cursor-pointer" style={{ background: 'rgba(0,0,0,0.55)', color: '#fff' }}><ChevronLeft className="w-5 h-5" /></button>
            <button type="button" aria-label="next" onClick={() => setCard((c) => (c + 1) % media.length)} className="absolute right-2 top-1/2 -translate-y-1/2 h-9 w-9 rounded-full flex items-center justify-center cursor-pointer" style={{ background: 'rgba(0,0,0,0.55)', color: '#fff' }}><ChevronRight className="w-5 h-5" /></button>
            <div className="absolute bottom-2 left-0 right-0 flex justify-center gap-1.5">
              {media.map((m, i) => <span key={m.localId} className="h-1.5 w-1.5 rounded-full" style={{ background: i === card ? '#fff' : 'rgba(255,255,255,0.4)' }} />)}
            </div>
          </>
        )}
        {creative.format === 'video' && shown && !shown.url && (
          <span className="absolute top-2 left-2 px-2 py-1 rounded-md text-[11px] font-semibold" style={{ background: 'rgba(0,0,0,0.6)', color: '#fff' }}><Play className="w-3 h-3 inline mr-1" />{t('ads.w.media.uploading')}</span>
        )}
      </div>
      <div className="px-3.5 py-3">
        {creative.format === 'instagram_post' ? (
          <div className="flex items-center justify-end"><span className="px-3 py-1.5 rounded-lg" style={{ background: 'rgba(255,255,255,0.14)', color: T1, fontSize: 12, fontWeight: 700 }}>{t(`ads.cta.${creative.cta}`)}</span></div>
        ) : (
        <div className="flex items-center justify-between gap-3 rounded-xl px-3 py-2.5" style={{ background: 'rgba(255,255,255,0.06)' }}>
          <div className="min-w-0">
            <p style={{ color: T3, fontSize: 10.5, letterSpacing: '0.04em' }}>YUNOAPP.EU</p>
            <p className="truncate" style={{ color: T1, fontSize: 13, fontWeight: 700 }}>{cardHeadline || t('ads.wizard.previewHeadline')}</p>
            {cardDesc && <p className="truncate" style={{ color: T3, fontSize: 12 }}>{cardDesc}</p>}
          </div>
          <span className="px-3 py-1.5 rounded-lg flex-shrink-0" style={{ background: 'rgba(255,255,255,0.14)', color: T1, fontSize: 12, fontWeight: 700 }}>{t(`ads.cta.${creative.cta}`)}</span>
        </div>
        )}
      </div>
    </div>
  );
}
