// Éditeur d'UNE création : format (image, carrousel, vidéo), médias, textes,
// bouton. Les fichiers partent vers le Storage dès qu'ils sont choisis
// (`deferredUpload`) ; une vidéo reçoit sa couverture capturée à 1 s, que le
// pro peut remplacer par une image à lui.

import { useEffect, useRef, useState, type MutableRefObject, type ChangeEvent } from 'react';
import { toast } from 'sonner';
import { Image as ImageIcon, Images, Clapperboard, Plus, X, ArrowLeft, ArrowRight, Loader2, AlertTriangle, RefreshCw, Sparkles, AtSign as Instagram, Check, Wand2, Smartphone, CalendarDays, MapPin, Tag, Music } from 'lucide-react';
import type { DeferredUpload } from '@/lib/deferredUpload';
import {
  AD_IMAGE_ACCEPT, AD_VIDEO_ACCEPT, AD_VIDEO_MAX_BYTES, AD_VIDEO_MAX_SECONDS,
  inspectAdVideo, captureVideoFrame, startAdImageUpload, startAdVideoUpload, startAdThumbnailUpload,
} from '@/lib/adCreativeMedia';
import { CTA_OPTIONS, CAROUSEL_MAX, CAROUSEL_MIN, HEADLINE_MAX, BODY_MAX, DESCRIPTION_MAX, type AdsEvent, type ComposedDesign, type CreativeFormat, type CtaType, type IgMedia } from '@/lib/metaAds';
import { format as fmtDate } from 'date-fns';
import { fr, es, enUS } from 'date-fns/locale';
import { useLanguage } from '@/contexts/LanguageContext';
import { StoryComposer } from './StoryComposer';
import type { DraftCreative, DraftMedia, WizardCall } from './types';
import { Field, Chip, ChoiceCards, GhostButton, Tip, ToggleRow, inputStyle, focusRing, T1, T2, T3, BORDER, RED, POS, INNER_BG } from './ui';

const localId = () => `m_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 7)}`;

export function CreativeEditor({ creative, onChange, posterUrl, event, uploadsRef, call, igAvailable, verticalOn, t }: {
  creative: DraftCreative;
  onChange: (next: DraftCreative) => void;
  posterUrl: string | null;
  event: AdsEvent | null;
  uploadsRef: MutableRefObject<Map<string, DeferredUpload>>;
  call: WizardCall;
  /** Un compte Instagram est relié : « booster une publication » est possible. */
  igAvailable: boolean;
  /** L'ensemble diffuse en stories / reels : la version verticale a un sens. */
  verticalOn: boolean;
  t: (k: string) => string;
}) {
  const { language } = useLanguage();
  const [igMedia, setIgMedia] = useState<IgMedia[] | null>(null);
  const [igBusy, setIgBusy] = useState(false);
  const [composer, setComposer] = useState<null | '9:16' | '4:5'>(null);
  const verticalInput = useRef<HTMLInputElement>(null);
  const bodyRef = useRef<HTMLTextAreaElement>(null);
  const headlineRef = useRef<HTMLInputElement>(null);
  const lastFocus = useRef<'body' | 'headline' | 'description'>('body');
  useEffect(() => {
    if (creative.format !== 'instagram_post' || igMedia !== null || igBusy) return;
    setIgBusy(true);
    call('ads_ig_media', {}).then((r) => setIgMedia((r.results as IgMedia[] | undefined) ?? [])).catch(() => setIgMedia([])).finally(() => setIgBusy(false));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [creative.format]);
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
    const post = c.media.filter((m) => m.kind === 'ig_post');
    const media = format === 'image' ? imgs.slice(0, 1) : format === 'carousel' ? imgs : format === 'video' ? vid : post;
    return { ...c, format, media };
  });
  const pickPost = (m: IgMedia) => patch((c) => ({
    ...c, media: [{ localId: `ig_${m.id}`, kind: 'ig_post', url: m.image ?? '', ig_media_id: m.id, description: m.caption }],
    headline: c.headline || 'Instagram', body: c.body || m.caption || '—',
  }));

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

  // Version verticale (stories / reels) : envoyée comme une image ou une vidéo.
  const addVertical = async (file: File) => {
    const isVideo = file.type.startsWith('video/');
    if (isVideo !== (creative.format === 'video')) { toast.error(t('ads.w.vertical.sameKind')); return; }
    const id = localId();
    if (isVideo) {
      const check = await inspectAdVideo(file);
      if (check.ok === false) { toast.error(t(`ads.w.media.video.${check.reason}`)); return; }
      patch((c) => ({ ...c, vertical_media: { localId: id, kind: 'video', url: '', preview: URL.createObjectURL(file), uploading: true, duration: check.duration } }));
      const up = startAdVideoUpload(file); uploadsRef.current.set(id, up);
      const frame = captureVideoFrame(file).then(async (blob) => { if (!blob) return null; const cu = startAdThumbnailUpload(blob); uploadsRef.current.set(`${id}:cover`, cu); const r = await cu.result; return 'url' in r ? r.url : null; });
      const [r, thumb] = await Promise.all([up.result, frame]);
      patch((c) => ({ ...c, vertical_media: c.vertical_media ? ('url' in r ? { ...c.vertical_media, url: r.url, uploading: false, thumbnail_url: thumb } : { ...c.vertical_media, uploading: false, error: r.error }) : null }));
      if (!('url' in r)) toast.error(t('ads.w.media.uploadFailed'));
      return;
    }
    patch((c) => ({ ...c, vertical_media: { localId: id, kind: 'image', url: '', preview: URL.createObjectURL(file), uploading: true } }));
    const up = startAdImageUpload(file); uploadsRef.current.set(id, up);
    const r = await up.result;
    patch((c) => ({ ...c, vertical_media: c.vertical_media ? ('url' in r ? { ...c.vertical_media, url: r.url, uploading: false } : { ...c.vertical_media, uploading: false, error: r.error }) : null }));
    if (!('url' in r)) toast.error(t('ads.w.media.uploadFailed'));
  };
  const removeVertical = () => { const id = creative.vertical_media?.localId; if (id) { uploadsRef.current.get(id)?.discard(); uploadsRef.current.delete(id); } patch((c) => ({ ...c, vertical_media: null, design: c.design?.ratio === '9:16' ? null : c.design })); };
  // Visuel composé dans Yuno (story 9:16 ou post 4:5) → Storage → média.
  const useComposed = async (blob: Blob, design: ComposedDesign) => {
    const id = localId();
    const preview = URL.createObjectURL(blob);
    if (design.ratio === '9:16') patch((c) => ({ ...c, vertical_media: { localId: id, kind: 'image', url: '', preview, uploading: true }, design }));
    else patch((c) => ({ ...c, format: 'image', media: [{ localId: id, kind: 'image', url: '', preview, uploading: true }], design }));
    const up = startAdThumbnailUpload(blob); uploadsRef.current.set(id, up);
    const r = await up.result;
    if (design.ratio === '9:16') patch((c) => ({ ...c, vertical_media: c.vertical_media?.localId === id ? ('url' in r ? { ...c.vertical_media, url: r.url, uploading: false } : { ...c.vertical_media, uploading: false, error: r.error }) : c.vertical_media }));
    else patchMedia(id, (x) => ('url' in r ? { ...x, url: r.url, uploading: false } : { ...x, uploading: false, error: r.error }));
    if (!('url' in r)) toast.error(t('ads.w.media.uploadFailed'));
  };
  // Faits de la soirée, insérés au curseur du dernier champ touché.
  const locale = language === 'fr' ? fr : language === 'es' ? es : enUS;
  const facts: Array<{ key: string; icon: React.ReactNode; text: string }> = event ? [
    { key: 'date', icon: <CalendarDays className="w-3.5 h-3.5" />, text: fmtDate(new Date(event.start_at), 'EEEE d MMMM · HH:mm', { locale }) },
    ...(event.venue_name ? [{ key: 'venue', icon: <MapPin className="w-3.5 h-3.5" />, text: event.venue_name + (event.city ? `, ${event.city}` : '') }] : event.city ? [{ key: 'city', icon: <MapPin className="w-3.5 h-3.5" />, text: event.city }] : []),
    ...(event.price_from != null ? [{ key: 'price', icon: <Tag className="w-3.5 h-3.5" />, text: t('ads.w.fact.priceFrom').replace('{price}', String(Math.round(event.price_from))) }] : []),
    ...(event.lineup && event.lineup.length ? [{ key: 'lineup', icon: <Music className="w-3.5 h-3.5" />, text: event.lineup.slice(0, 6).join(' · ') }] : []),
  ] : [];
  const insertFact = (text: string) => {
    const field = lastFocus.current;
    const el = field === 'body' ? bodyRef.current : field === 'headline' ? headlineRef.current : null;
    const max = field === 'body' ? BODY_MAX : field === 'headline' ? HEADLINE_MAX : DESCRIPTION_MAX;
    patch((c) => {
      const cur = field === 'body' ? c.body : field === 'headline' ? c.headline : c.description;
      const pos = el && typeof el.selectionStart === 'number' ? el.selectionStart : cur.length;
      const sep = pos > 0 && !/\s$/.test(cur.slice(0, pos)) ? ' ' : '';
      const next = (cur.slice(0, pos) + sep + text + cur.slice(pos)).slice(0, max);
      return field === 'body' ? { ...c, body: next } : field === 'headline' ? { ...c, headline: next } : { ...c, description: next };
    });
    el?.focus();
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
      <input ref={verticalInput} type="file" accept={creative.format === 'video' ? AD_VIDEO_ACCEPT : AD_IMAGE_ACCEPT} className="hidden" onChange={(e) => onPick(e, (f) => addVertical(f[0]))} />
      {composer && <StoryComposer event={event} posterUrl={posterUrl} ratio={composer} initial={creative.design?.ratio === composer ? creative.design : null} onUse={useComposed} onClose={() => setComposer(null)} t={t} />}

      <Field label={t('ads.w.creative.format')} hint={t('ads.w.creative.formatHint')}>
        <ChoiceCards<CreativeFormat> value={creative.format} onChange={setFormat} columns={igAvailable ? 2 : 3} options={[
          { value: 'image', label: t('ads.w.format.image'), desc: t('ads.w.format.imageDesc'), icon: <ImageIcon className="w-5 h-5" /> },
          { value: 'carousel', label: t('ads.w.format.carousel'), desc: t('ads.w.format.carouselDesc'), icon: <Images className="w-5 h-5" /> },
          { value: 'video', label: t('ads.w.format.video'), desc: t('ads.w.format.videoDesc'), icon: <Clapperboard className="w-5 h-5" /> },
          ...(igAvailable ? [{ value: 'instagram_post' as CreativeFormat, label: t('ads.w.format.instagram_post'), desc: t('ads.w.format.instagram_postDesc'), icon: <Instagram className="w-5 h-5" /> }] : []),
        ]} />
      </Field>

      {creative.format === 'instagram_post' ? (
        <Field label={t('ads.x.post.pick')} hint={t('ads.x.post.pickHint')}>
          {igBusy || igMedia === null ? <p className="inline-flex items-center gap-2" style={{ color: T2, fontSize: 13.5 }}><Loader2 className="w-4 h-4 animate-spin" />{t('ads.x.post.loading')}</p>
            : igMedia.length === 0 ? <p style={{ color: T3, fontSize: 13.5 }}>{t('ads.x.post.none')}</p> : (
            <div className="grid gap-2.5 grid-cols-3 sm:grid-cols-4 lg:grid-cols-6">
              {igMedia.map((m) => {
                const active = creative.media.some((x) => x.ig_media_id === m.id);
                return (
                  <button key={m.id} type="button" onClick={() => pickPost(m)} className="relative rounded-xl overflow-hidden aspect-square cursor-pointer transition-colors duration-150" style={{ background: 'rgba(255,255,255,0.06)', border: `2px solid ${active ? RED : 'transparent'}` }} title={m.caption}>
                    {m.image && <img src={m.image} alt="" className="h-full w-full object-cover" />}
                    {m.type === 'VIDEO' && <span className="absolute top-1.5 left-1.5 px-1.5 py-0.5 rounded text-[10px] font-bold" style={{ background: 'rgba(0,0,0,0.6)', color: '#fff' }}>REEL</span>}
                    {m.type === 'CAROUSEL_ALBUM' && <Images className="absolute top-1.5 right-1.5 w-4 h-4 text-white drop-shadow" />}
                    {active && <span className="absolute inset-0 flex items-center justify-center" style={{ background: 'rgba(232,25,44,0.35)' }}><Check className="w-6 h-6 text-white" /></span>}
                  </button>
                );
              })}
            </div>
          )}
          <Tip>{t('ads.x.post.note')}</Tip>
        </Field>
      ) : creative.format !== 'video' ? (
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
            {creative.format === 'image' && posterUrl && (
              <GhostButton small onClick={() => setComposer('4:5')}><Wand2 className="w-3.5 h-3.5" /> {t('ads.w.compose.feed')}</GhostButton>
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

      {(creative.format === 'image' || creative.format === 'video') && (
        <Field label={<span className="inline-flex items-center gap-2"><Smartphone className="w-4 h-4" style={{ color: T3 }} />{t('ads.w.vertical.title')}</span>} optional={t('ads.w.optional')}
          hint={verticalOn ? t('ads.w.vertical.hint') : t('ads.w.vertical.hintOff')}>
          {creative.vertical_media ? (
            <div className="flex items-start gap-3">
              <div className="rounded-xl overflow-hidden relative flex-shrink-0" style={{ width: 96, aspectRatio: '9 / 16', background: 'rgba(255,255,255,0.06)', border: `1px solid ${creative.vertical_media.error ? RED : BORDER}` }}>
                {creative.vertical_media.kind === 'video'
                  ? <video src={creative.vertical_media.preview || creative.vertical_media.url} poster={creative.vertical_media.thumbnail_url ?? undefined} muted playsInline className="h-full w-full object-cover" />
                  : (creative.vertical_media.preview || creative.vertical_media.url) && <img src={creative.vertical_media.preview || creative.vertical_media.url} alt="" className="h-full w-full object-cover" />}
                {creative.vertical_media.uploading && <div className="absolute inset-0 flex items-center justify-center" style={{ background: 'rgba(0,0,0,0.45)' }}><Loader2 className="w-5 h-5 animate-spin text-white" /></div>}
                {creative.vertical_media.error && <div className="absolute inset-0 flex items-center justify-center" style={{ background: 'rgba(0,0,0,0.55)' }}><AlertTriangle className="w-5 h-5" style={{ color: RED }} /></div>}
              </div>
              <div className="space-y-2 pt-1">
                <p style={{ color: POS, fontSize: 12.5, fontWeight: 600 }}>{creative.vertical_media.uploading ? t('ads.w.media.uploading') : t('ads.w.vertical.ready')}</p>
                {creative.format === 'image' && posterUrl && <GhostButton small onClick={() => setComposer('9:16')}><Wand2 className="w-3.5 h-3.5" /> {creative.design?.ratio === '9:16' ? t('ads.w.compose.edit') : t('ads.w.compose.story')}</GhostButton>}
                <GhostButton small onClick={() => verticalInput.current?.click()}><RefreshCw className="w-3.5 h-3.5" /> {t('ads.w.media.replace')}</GhostButton>
                <GhostButton small onClick={removeVertical}><X className="w-3.5 h-3.5" /> {t('ads.wizard.remove')}</GhostButton>
              </div>
            </div>
          ) : (
            <div className="flex gap-2 flex-wrap">
              {creative.format === 'image' && posterUrl && (
                <button type="button" onClick={() => setComposer('9:16')} className="inline-flex items-center gap-2 px-4 rounded-xl text-[13.5px] font-semibold cursor-pointer transition-colors duration-150" style={{ background: 'rgba(232,25,44,0.12)', border: '1px solid rgba(232,25,44,0.4)', color: '#FF8A91', minHeight: 44 }}>
                  <Wand2 className="w-4 h-4" /> {t('ads.w.compose.story')}
                </button>
              )}
              <GhostButton onClick={() => verticalInput.current?.click()}><Plus className="w-4 h-4" /> {creative.format === 'video' ? t('ads.w.vertical.addVideo') : t('ads.w.vertical.addImage')}</GhostButton>
            </div>
          )}
        </Field>
      )}

      {creative.format !== 'instagram_post' && facts.length > 0 && (
        <Field label={t('ads.w.fact.title')} hint={t('ads.w.fact.hint')}>
          <div className="flex gap-2 flex-wrap">
            {facts.map((f) => <Chip key={f.key} active={false} onClick={() => insertFact(f.text)}>{f.icon}{f.text}</Chip>)}
          </div>
        </Field>
      )}

      {creative.format !== 'instagram_post' && (
      <div className="grid gap-4 sm:grid-cols-2">
        <Field label={t('ads.wizard.headline')} hint={t('ads.wizard.headlineHint')} counter={`${creative.headline.length}/${HEADLINE_MAX}`}>
          <input ref={headlineRef} onFocus={() => { lastFocus.current = 'headline'; }} value={creative.headline} onChange={(e) => patch((c) => ({ ...c, headline: e.target.value.slice(0, HEADLINE_MAX) }))} style={inputStyle} className={focusRing} placeholder={t('ads.w.creative.headlinePh')} />
        </Field>
        <Field label={t('ads.w.creative.description')} optional={t('ads.w.optional')} hint={t('ads.w.creative.descriptionHint')} counter={`${creative.description.length}/${DESCRIPTION_MAX}`}>
          <input onFocus={() => { lastFocus.current = 'description'; }} value={creative.description} onChange={(e) => patch((c) => ({ ...c, description: e.target.value.slice(0, DESCRIPTION_MAX) }))} style={inputStyle} className={focusRing} placeholder={t('ads.w.creative.descriptionPh')} />
        </Field>
      </div>
      )}
      {creative.format !== 'instagram_post' && (
      <Field label={t('ads.wizard.body')} hint={t('ads.wizard.bodyHint')} counter={`${creative.body.length}/${BODY_MAX}`}>
        <textarea ref={bodyRef} onFocus={() => { lastFocus.current = 'body'; }} value={creative.body} onChange={(e) => patch((c) => ({ ...c, body: e.target.value.slice(0, BODY_MAX) }))} rows={4} style={{ ...inputStyle, resize: 'vertical' }} className={focusRing} placeholder={t('ads.w.creative.bodyPh')} />
      </Field>
      )}
      <Field label={t('ads.wizard.cta')} hint={t('ads.w.creative.ctaHint')}>
        <div className="flex gap-2 flex-wrap">
          {CTA_OPTIONS.map((c) => <Chip key={c} active={creative.cta === c} onClick={() => patch((x) => ({ ...x, cta: c as CtaType }))}>{t(`ads.cta.${c}`)}</Chip>)}
        </div>
      </Field>
      {creative.format !== 'instagram_post' && (
        <ToggleRow icon={<Sparkles className="w-4 h-4" />} label={t('ads.w.enh.title')} desc={t('ads.w.enh.desc')} checked={creative.enhancements === true} onChange={(v) => patch((c) => ({ ...c, enhancements: v }))} />
      )}
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
