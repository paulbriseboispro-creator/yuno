// Éditeur d'UNE création : format (image, carrousel, vidéo), médias, textes,
// bouton. Les fichiers partent vers le Storage dès qu'ils sont choisis
// (`deferredUpload`) ; une vidéo reçoit sa couverture capturée à 1 s, que le
// pro peut remplacer par une image à lui.

import { useRef, type MutableRefObject, type ChangeEvent } from 'react';
import { toast } from 'sonner';
import { Image as ImageIcon, Images, Clapperboard, Plus, X, ArrowLeft, ArrowRight, Loader2, AlertTriangle, RefreshCw, Sparkles } from 'lucide-react';
import type { DeferredUpload } from '@/lib/deferredUpload';
import {
  AD_IMAGE_ACCEPT, AD_VIDEO_ACCEPT, AD_VIDEO_MAX_BYTES, AD_VIDEO_MAX_SECONDS,
  inspectAdVideo, captureVideoFrame, startAdImageUpload, startAdVideoUpload, startAdThumbnailUpload,
} from '@/lib/adCreativeMedia';
import { CTA_OPTIONS, CAROUSEL_MAX, CAROUSEL_MIN, HEADLINE_MAX, BODY_MAX, DESCRIPTION_MAX, type CreativeFormat, type CtaType } from '@/lib/metaAds';
import type { DraftCreative, DraftMedia } from './types';
import { Field, Chip, ChoiceCards, GhostButton, Tip, inputStyle, focusRing, T1, T2, T3, BORDER, RED, POS, INNER_BG } from './ui';

const localId = () => `m_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 7)}`;

export function CreativeEditor({ creative, onChange, posterUrl, uploadsRef, t }: {
  creative: DraftCreative;
  onChange: (next: DraftCreative) => void;
  posterUrl: string | null;
  uploadsRef: MutableRefObject<Map<string, DeferredUpload>>;
  t: (k: string) => string;
}) {
  const imageInput = useRef<HTMLInputElement>(null);
  const videoInput = useRef<HTMLInputElement>(null);
  const coverInput = useRef<HTMLInputElement>(null);
  // Le brouillon est mis à jour par des fonctions (pas par la valeur captée) :
  // plusieurs envois se terminent dans n'importe quel ordre.
  const latest = useRef(creative);
  latest.current = creative;
  const patch = (fn: (c: DraftCreative) => DraftCreative) => { const next = fn(latest.current); latest.current = next; onChange(next); };
  const patchMedia = (id: string, fn: (m: DraftMedia) => DraftMedia) => patch((c) => ({ ...c, media: c.media.map((m) => (m.localId === id ? fn(m) : m)) }));

  const images = creative.media.filter((m) => m.kind === 'image');
  const video = creative.media.find((m) => m.kind === 'video') ?? null;

  const setFormat = (format: CreativeFormat) => patch((c) => {
    // On garde ce qui reste valable : une image pour « image », toutes pour
    // « carrousel », la vidéo pour « vidéo ».
    const imgs = c.media.filter((m) => m.kind === 'image');
    const vid = c.media.filter((m) => m.kind === 'video');
    const media = format === 'image' ? imgs.slice(0, 1) : format === 'carousel' ? imgs : vid;
    return { ...c, format, media };
  });

  const addImages = async (files: File[]) => {
    const room = creative.format === 'carousel' ? CAROUSEL_MAX - images.length : 1;
    const picked = files.filter((f) => f.type.startsWith('image/')).slice(0, Math.max(0, room));
    if (picked.length === 0) return;
    const entries: DraftMedia[] = picked.map((f) => ({ localId: localId(), kind: 'image', url: '', preview: URL.createObjectURL(f), uploading: true }));
    patch((c) => ({ ...c, media: creative.format === 'image' ? entries.slice(0, 1) : [...c.media, ...entries] }));
    await Promise.all(entries.map(async (m, i) => {
      const up = startAdImageUpload(picked[i]);
      uploadsRef.current.set(m.localId, up);
      const r = await up.result;
      if ('url' in r) patchMedia(m.localId, (x) => ({ ...x, url: r.url, uploading: false }));
      else { patchMedia(m.localId, (x) => ({ ...x, uploading: false, error: r.error })); toast.error(t('ads.w.media.uploadFailed')); }
    }));
  };

  const addVideo = async (file: File) => {
    const check = await inspectAdVideo(file);
    if (check.ok === false) { toast.error(t(`ads.w.media.video.${check.reason}`)); return; }
    const id = localId();
    const entry: DraftMedia = { localId: id, kind: 'video', url: '', preview: URL.createObjectURL(file), uploading: true, duration: check.duration };
    patch((c) => ({ ...c, media: [entry] }));
    const up = startAdVideoUpload(file);
    uploadsRef.current.set(id, up);
    // La couverture part en parallèle : c'est elle que Meta montre avant la
    // lecture, et sans elle la pub vidéo est refusée.
    const frame = captureVideoFrame(file).then(async (blob) => {
      if (!blob) return null;
      const cu = startAdThumbnailUpload(blob);
      uploadsRef.current.set(`${id}:cover`, cu);
      const r = await cu.result;
      return 'url' in r ? r.url : null;
    });
    const [r, thumb] = await Promise.all([up.result, frame]);
    if ('url' in r) patchMedia(id, (x) => ({ ...x, url: r.url, uploading: false, thumbnail_url: x.thumbnail_url ?? thumb }));
    else { patchMedia(id, (x) => ({ ...x, uploading: false, error: r.error })); toast.error(t('ads.w.media.uploadFailed')); }
  };

  const replaceCover = async (file: File) => {
    if (!video) return;
    const up = startAdThumbnailUpload(await (async () => file)());
    uploadsRef.current.set(`${video.localId}:cover:${Date.now()}`, up);
    const r = await up.result;
    if ('url' in r) patchMedia(video.localId, (x) => ({ ...x, thumbnail_url: r.url }));
    else toast.error(t('ads.w.media.uploadFailed'));
  };

  const remove = (id: string) => {
    uploadsRef.current.get(id)?.discard();
    uploadsRef.current.delete(id);
    patch((c) => ({ ...c, media: c.media.filter((m) => m.localId !== id) }));
  };
  const move = (id: string, dir: -1 | 1) => patch((c) => {
    const i = c.media.findIndex((m) => m.localId === id);
    const j = i + dir;
    if (i < 0 || j < 0 || j >= c.media.length) return c;
    const media = [...c.media]; [media[i], media[j]] = [media[j], media[i]];
    return { ...c, media };
  });
  const usePoster = () => {
    if (!posterUrl) return;
    const entry: DraftMedia = { localId: localId(), kind: 'image', url: posterUrl };
    patch((c) => ({ ...c, media: c.format === 'image' ? [entry] : [...c.media, entry] }));
  };
  const onPick = (e: ChangeEvent<HTMLInputElement>, fn: (files: File[]) => void) => { const files = Array.from(e.target.files ?? []); e.target.value = ''; if (files.length) fn(files); };

  const Thumb = ({ m, index }: { m: DraftMedia; index: number }) => (
    <div className="relative rounded-xl overflow-hidden group" style={{ background: 'rgba(255,255,255,0.06)', border: `1px solid ${m.error ? RED : BORDER}` }}>
      <div className="aspect-square">
        {(m.preview || m.url) && <img src={m.preview || m.url} alt="" className="h-full w-full object-cover" />}
      </div>
      {m.uploading && <div className="absolute inset-0 flex items-center justify-center" style={{ background: 'rgba(0,0,0,0.45)' }}><Loader2 className="w-5 h-5 animate-spin text-white" /></div>}
      {m.error && <div className="absolute inset-0 flex items-center justify-center" style={{ background: 'rgba(0,0,0,0.55)' }}><AlertTriangle className="w-5 h-5" style={{ color: RED }} /></div>}
      <div className="absolute top-1.5 right-1.5 flex gap-1">
        <button type="button" aria-label={t('ads.wizard.remove')} onClick={() => remove(m.localId)} className="h-7 w-7 rounded-full flex items-center justify-center cursor-pointer" style={{ background: 'rgba(0,0,0,0.6)', color: '#fff' }}><X className="w-3.5 h-3.5" /></button>
      </div>
      {creative.format === 'carousel' && (
        <div className="absolute bottom-1.5 left-1.5 right-1.5 flex items-center justify-between">
          <span className="px-1.5 py-0.5 rounded text-[10.5px] font-bold" style={{ background: 'rgba(0,0,0,0.6)', color: '#fff' }}>{index + 1}</span>
          <span className="flex gap-1">
            <button type="button" aria-label="left" onClick={() => move(m.localId, -1)} className="h-6 w-6 rounded-full flex items-center justify-center cursor-pointer" style={{ background: 'rgba(0,0,0,0.6)', color: '#fff' }}><ArrowLeft className="w-3 h-3" /></button>
            <button type="button" aria-label="right" onClick={() => move(m.localId, 1)} className="h-6 w-6 rounded-full flex items-center justify-center cursor-pointer" style={{ background: 'rgba(0,0,0,0.6)', color: '#fff' }}><ArrowRight className="w-3 h-3" /></button>
          </span>
        </div>
      )}
    </div>
  );

  const AddTile = ({ onClick, label }: { onClick: () => void; label: string }) => (
    <button type="button" onClick={onClick} className="rounded-xl flex flex-col items-center justify-center gap-1.5 cursor-pointer transition-colors duration-150 hover:bg-white/[0.05] aspect-square" style={{ border: `1px dashed ${BORDER}`, color: T2, background: INNER_BG }}>
      <Plus className="w-5 h-5" />
      <span style={{ fontSize: 12, fontWeight: 600 }}>{label}</span>
    </button>
  );

  return (
    <div className="space-y-5">
      <input ref={imageInput} type="file" accept={AD_IMAGE_ACCEPT} multiple={creative.format === 'carousel'} className="hidden" onChange={(e) => onPick(e, addImages)} />
      <input ref={videoInput} type="file" accept={AD_VIDEO_ACCEPT} className="hidden" onChange={(e) => onPick(e, (f) => addVideo(f[0]))} />
      <input ref={coverInput} type="file" accept={AD_IMAGE_ACCEPT} className="hidden" onChange={(e) => onPick(e, (f) => replaceCover(f[0]))} />

      <Field label={t('ads.w.creative.format')} hint={t('ads.w.creative.formatHint')}>
        <ChoiceCards<CreativeFormat> value={creative.format} onChange={setFormat} columns={3} options={[
          { value: 'image', label: t('ads.w.format.image'), desc: t('ads.w.format.imageDesc'), icon: <ImageIcon className="w-5 h-5" /> },
          { value: 'carousel', label: t('ads.w.format.carousel'), desc: t('ads.w.format.carouselDesc'), icon: <Images className="w-5 h-5" /> },
          { value: 'video', label: t('ads.w.format.video'), desc: t('ads.w.format.videoDesc'), icon: <Clapperboard className="w-5 h-5" /> },
        ]} />
      </Field>

      {creative.format !== 'video' ? (
        <Field label={creative.format === 'carousel' ? t('ads.w.media.carouselLabel') : t('ads.w.media.imageLabel')}
          hint={creative.format === 'carousel' ? t('ads.w.media.carouselHint').replace('{min}', String(CAROUSEL_MIN)).replace('{max}', String(CAROUSEL_MAX)) : t('ads.w.media.imageHint')}
          counter={creative.format === 'carousel' ? `${images.length}/${CAROUSEL_MAX}` : undefined}>
          <div className={`grid gap-2.5 ${creative.format === 'carousel' ? 'grid-cols-3 sm:grid-cols-5' : 'grid-cols-3 sm:grid-cols-4'}`}>
            {images.map((m, i) => <Thumb key={m.localId} m={m} index={i} />)}
            {(creative.format === 'carousel' ? images.length < CAROUSEL_MAX : images.length === 0) && <AddTile onClick={() => imageInput.current?.click()} label={t('ads.w.media.addImage')} />}
          </div>
          <div className="mt-2.5 flex gap-2 flex-wrap">
            {posterUrl && !creative.media.some((m) => m.url === posterUrl) && (creative.format === 'carousel' || images.length === 0) && (
              <GhostButton small onClick={usePoster}><Sparkles className="w-3.5 h-3.5" /> {t('ads.wizard.usePoster')}</GhostButton>
            )}
            {creative.format === 'image' && images.length === 1 && (
              <GhostButton small onClick={() => imageInput.current?.click()}><RefreshCw className="w-3.5 h-3.5" /> {t('ads.w.media.replace')}</GhostButton>
            )}
          </div>
        </Field>
      ) : (
        <Field label={t('ads.w.media.videoLabel')} hint={t('ads.w.media.videoHint').replace('{mb}', String(AD_VIDEO_MAX_BYTES / 1024 / 1024)).replace('{min}', String(AD_VIDEO_MAX_SECONDS / 60))}>
          {!video ? (
            <button type="button" onClick={() => videoInput.current?.click()} className="w-full rounded-2xl flex flex-col items-center justify-center gap-2 cursor-pointer transition-colors duration-150 hover:bg-white/[0.05]" style={{ border: `1px dashed ${BORDER}`, background: INNER_BG, minHeight: 150, color: T2 }}>
              <Clapperboard className="w-6 h-6" />
              <span style={{ fontSize: 13.5, fontWeight: 600 }}>{t('ads.w.media.addVideo')}</span>
              <span style={{ fontSize: 12, color: T3 }}>{t('ads.w.media.videoFormats')}</span>
            </button>
          ) : (
            <div className="grid gap-3 sm:grid-cols-[1fr_140px]">
              <div className="rounded-xl overflow-hidden relative" style={{ background: '#000', border: `1px solid ${video.error ? RED : BORDER}` }}>
                <video src={video.preview || video.url} poster={video.thumbnail_url ?? undefined} controls muted playsInline className="w-full max-h-[280px] object-contain" />
                {video.uploading && <span className="absolute top-2 left-2 px-2 py-1 rounded-md text-[11px] font-semibold inline-flex items-center gap-1" style={{ background: 'rgba(0,0,0,0.65)', color: '#fff' }}><Loader2 className="w-3 h-3 animate-spin" />{t('ads.w.media.uploading')}</span>}
                {!video.uploading && video.url && <span className="absolute top-2 left-2 px-2 py-1 rounded-md text-[11px] font-semibold" style={{ background: 'rgba(52,211,153,0.2)', color: POS }}>{t('ads.w.media.ready')}{video.duration ? ` · ${Math.round(video.duration)} s` : ''}</span>}
                {video.error && <span className="absolute top-2 left-2 px-2 py-1 rounded-md text-[11px] font-semibold" style={{ background: 'rgba(232,25,44,0.25)', color: '#FF8A91' }}>{t('ads.w.media.uploadFailed')}</span>}
              </div>
              <div className="space-y-2">
                <p style={{ color: T2, fontSize: 12.5, fontWeight: 600 }}>{t('ads.w.media.cover')}</p>
                <div className="rounded-xl overflow-hidden aspect-[4/5]" style={{ background: 'rgba(255,255,255,0.06)', border: `1px solid ${BORDER}` }}>
                  {video.thumbnail_url ? <img src={video.thumbnail_url} alt="" className="h-full w-full object-cover" /> : <div className="h-full w-full flex items-center justify-center"><Loader2 className="w-4 h-4 animate-spin" style={{ color: T3 }} /></div>}
                </div>
                <GhostButton small onClick={() => coverInput.current?.click()}><RefreshCw className="w-3.5 h-3.5" /> {t('ads.w.media.changeCover')}</GhostButton>
                <GhostButton small onClick={() => remove(video.localId)}><X className="w-3.5 h-3.5" /> {t('ads.wizard.remove')}</GhostButton>
              </div>
            </div>
          )}
        </Field>
      )}

      {creative.format === 'carousel' && images.length > 0 && (
        <Tip>{t('ads.w.media.carouselTexts')}</Tip>
      )}

      <div className="grid gap-4 sm:grid-cols-2">
        <Field label={t('ads.wizard.headline')} hint={t('ads.wizard.headlineHint')} counter={`${creative.headline.length}/${HEADLINE_MAX}`}>
          <input value={creative.headline} onChange={(e) => patch((c) => ({ ...c, headline: e.target.value.slice(0, HEADLINE_MAX) }))} style={inputStyle} className={focusRing} placeholder={t('ads.w.creative.headlinePh')} />
        </Field>
        <Field label={t('ads.w.creative.description')} optional={t('ads.w.optional')} hint={t('ads.w.creative.descriptionHint')} counter={`${creative.description.length}/${DESCRIPTION_MAX}`}>
          <input value={creative.description} onChange={(e) => patch((c) => ({ ...c, description: e.target.value.slice(0, DESCRIPTION_MAX) }))} style={inputStyle} className={focusRing} placeholder={t('ads.w.creative.descriptionPh')} />
        </Field>
      </div>
      <Field label={t('ads.wizard.body')} hint={t('ads.wizard.bodyHint')} counter={`${creative.body.length}/${BODY_MAX}`}>
        <textarea value={creative.body} onChange={(e) => patch((c) => ({ ...c, body: e.target.value.slice(0, BODY_MAX) }))} rows={4} style={{ ...inputStyle, resize: 'vertical' }} className={focusRing} placeholder={t('ads.w.creative.bodyPh')} />
      </Field>
      <Field label={t('ads.wizard.cta')} hint={t('ads.w.creative.ctaHint')}>
        <div className="flex gap-2 flex-wrap">
          {CTA_OPTIONS.map((c) => <Chip key={c} active={creative.cta === c} onClick={() => patch((x) => ({ ...x, cta: c as CtaType }))}>{t(`ads.cta.${c}`)}</Chip>)}
        </div>
      </Field>
      {creative.format === 'carousel' && images.length >= CAROUSEL_MIN && (
        <details className="rounded-2xl" style={{ border: `1px solid ${BORDER}`, background: INNER_BG }}>
          <summary className="cursor-pointer px-4 py-3 select-none" style={{ color: T1, fontSize: 13.5, fontWeight: 600 }}>{t('ads.w.media.perCard')}</summary>
          <div className="px-4 pb-4 space-y-3">
            {images.map((m, i) => (
              <div key={m.localId} className="grid gap-2 sm:grid-cols-[56px_1fr_1fr] items-center">
                <div className="h-14 w-14 rounded-lg overflow-hidden" style={{ background: 'rgba(255,255,255,0.06)' }}>{(m.preview || m.url) && <img src={m.preview || m.url} alt="" className="h-full w-full object-cover" />}</div>
                <input value={m.headline ?? ''} onChange={(e) => patchMedia(m.localId, (x) => ({ ...x, headline: e.target.value.slice(0, HEADLINE_MAX) }))} style={{ ...inputStyle, minHeight: 42, fontSize: 14 }} className={focusRing} placeholder={`${t('ads.wizard.headline')} ${i + 1}`} />
                <input value={m.description ?? ''} onChange={(e) => patchMedia(m.localId, (x) => ({ ...x, description: e.target.value.slice(0, DESCRIPTION_MAX) }))} style={{ ...inputStyle, minHeight: 42, fontSize: 14 }} className={focusRing} placeholder={t('ads.w.creative.description')} />
              </div>
            ))}
          </div>
        </details>
      )}
    </div>
  );
}
