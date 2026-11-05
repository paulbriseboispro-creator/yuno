import { useRef, useState } from 'react';
import { toast } from 'sonner';
import { ChevronLeft, ChevronRight, Loader2, Pencil, Plus, Trash2 } from 'lucide-react';
import { supabase } from '@/integrations/supabase/client';
import { useLanguage } from '@/contexts/LanguageContext';
import { compressImage } from '@/lib/compressImage';
import { pruneGalleryCrops, type CropState, type GalleryCrops } from '@/lib/galleryCrop';
import { BORDER, INNER_BG, T3 } from '@/components/org-ui';
import { GalleryCropDialog } from './GalleryCropDialog';

interface Props {
  images: string[];
  crops: GalleryCrops;
  max?: number;
  /** Où ranger les fichiers : bucket public + dossier autorisé par ses policies. */
  storage: { bucket: string; folder: string };
  /** Écrit la galerie en base et met à jour l'écran ; rend false si rien n'a été écrit. */
  persist: (images: string[], crops: GalleryCrops) => Promise<boolean>;
  disabled?: boolean;
  /** Grille compacte (4 colonnes, vignettes carrées) pour l'onboarding. */
  compact?: boolean;
}

const ORIGINAL_MAX_BYTES = 20 * 1024 * 1024;
const btn = 'flex h-7 w-7 items-center justify-center rounded-full disabled:opacity-0';
const chip = { background: 'rgba(0,0,0,0.62)', color: '#fff' } as const;

/**
 * Galerie photo d'une page publique (club, organisateur). Chaque photo ajoutée
 * passe par le cadrage, une par une ; le crayon rouvre l'image d'origine avec
 * son cadre. Tout s'enregistre à chaque geste (comme avant), sans bouton.
 */
export function GalleryPhotosEditor({ images, crops, max = 8, storage, persist, disabled, compact }: Props) {
  const { t } = useLanguage();
  const inputRef = useRef<HTMLInputElement>(null);
  const latest = useRef({ images, crops });
  latest.current = { images, crops };

  const [queue, setQueue] = useState<File[]>([]);
  const [queueIndex, setQueueIndex] = useState(0);
  const [editing, setEditing] = useState<{ index: number; url: string; src: string; initial: CropState | null } | null>(null);
  const [busy, setBusy] = useState(false);

  const full = images.length >= max;

  const put = async (file: File, name: string): Promise<string> => {
    const path = `${storage.folder}/${name}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}.jpg`;
    const { error } = await supabase.storage.from(storage.bucket).upload(path, file, { contentType: file.type || 'image/jpeg' });
    if (error) throw error;
    return supabase.storage.from(storage.bucket).getPublicUrl(path).data.publicUrl;
  };

  const save = async (next: string[], nextCrops: GalleryCrops) => {
    const ok = await persist(next, pruneGalleryCrops(next, nextCrops));
    if (!ok) toast.error(t('gallery.saveError'));
    return ok;
  };

  const onPick = (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = Array.from(e.target.files ?? []);
    e.target.value = '';
    if (files.length === 0) return;
    const room = max - latest.current.images.length;
    const picked = files.filter((f) => f.type.startsWith('image/')).slice(0, Math.max(0, room));
    if (picked.length < files.length) {
      toast.message(t('gallery.someIgnored').replace('{n}', String(files.length - picked.length)).replace('{max}', String(max)));
    }
    if (picked.length === 0) return;
    setQueue(picked);
    setQueueIndex(0);
  };

  const nextInQueue = () => {
    if (queueIndex + 1 < queue.length) setQueueIndex(queueIndex + 1);
    else { setQueue([]); setQueueIndex(0); }
  };

  const confirmNew = async (cropped: File, crop: CropState) => {
    const original = queue[queueIndex];
    if (!original) return;
    setBusy(true);
    try {
      const source = await compressImage(original, 2400, 0.86);
      if (source.size > ORIGINAL_MAX_BYTES) { toast.error(t('gallery.tooHeavy')); nextInQueue(); return; }
      const [src, url] = await Promise.all([put(source, 'gallery-src'), put(cropped, 'gallery')]);
      const cur = latest.current;
      if (cur.images.length >= max) { toast.error(t('gallery.max').replace('{max}', String(max))); setQueue([]); return; }
      if (await save([...cur.images, url], { ...cur.crops, [url]: { src, ...crop } })) {
        toast.success(t('gallery.added'));
      }
      nextInQueue();
    } catch (err) {
      toast.error((err as Error).message || t('gallery.saveError'));
    } finally {
      setBusy(false);
    }
  };

  const confirmEdit = async (cropped: File, crop: CropState) => {
    if (!editing) return;
    setBusy(true);
    try {
      const url = await put(cropped, 'gallery');
      const cur = latest.current;
      const index = cur.images.indexOf(editing.url) >= 0 ? cur.images.indexOf(editing.url) : editing.index;
      const next = cur.images.map((u, i) => (i === index ? url : u));
      const nextCrops = { ...cur.crops, [url]: { src: editing.src, ...crop } };
      if (await save(next, nextCrops)) toast.success(t('gallery.updated'));
      setEditing(null);
    } catch (err) {
      toast.error((err as Error).message || t('gallery.saveError'));
    } finally {
      setBusy(false);
    }
  };

  const openEdit = (index: number) => {
    const url = images[index];
    const entry = crops[url];
    // Photo ajoutée avant le cadrage : on repart d'elle-même, sans cadre gardé.
    setEditing({ index, url, src: entry?.src ?? url, initial: entry ? { x: entry.x, y: entry.y, zoom: entry.zoom } : null });
  };

  const remove = async (index: number) => {
    setBusy(true);
    try {
      if (await save(images.filter((_, i) => i !== index), crops)) toast.success(t('gallery.removed'));
    } finally { setBusy(false); }
  };

  const move = async (index: number, delta: -1 | 1) => {
    const target = index + delta;
    if (target < 0 || target >= images.length) return;
    const next = [...images];
    [next[index], next[target]] = [next[target], next[index]];
    setBusy(true);
    try { await save(next, crops); } finally { setBusy(false); }
  };

  const locked = disabled || busy;

  return (
    <div className="space-y-3">
      {images.length > 0 ? (
        <div className={compact ? 'grid grid-cols-3 gap-2 sm:grid-cols-4' : 'grid grid-cols-2 gap-3 sm:grid-cols-4'}>
          {images.map((url, i) => (
            <div key={`${i}-${url}`} className="relative aspect-[4/3] overflow-hidden rounded-xl" style={{ background: INNER_BG, border: `1px solid ${BORDER}` }}>
              <img src={url} alt={`${t('gallery.photo')} ${i + 1}`} className="h-full w-full object-cover" loading="lazy" />
              <div className="absolute inset-x-1.5 top-1.5 flex items-start justify-between">
                <span className="rounded-md px-1.5 py-0.5 font-mono text-[10px]" style={chip}>{i + 1}</span>
                <div className="flex gap-1">
                  <button type="button" disabled={locked} onClick={() => openEdit(i)} className={btn} style={chip}
                    aria-label={t('gallery.edit')} title={t('gallery.edit')}>
                    <Pencil className="h-3.5 w-3.5" />
                  </button>
                  <button type="button" disabled={locked} onClick={() => remove(i)} className={btn}
                    style={{ background: 'rgba(232,25,44,0.9)', color: '#fff' }}
                    aria-label={t('gallery.remove')} title={t('gallery.remove')}>
                    <Trash2 className="h-3.5 w-3.5" />
                  </button>
                </div>
              </div>
              {images.length > 1 && (
                <div className="absolute inset-x-1.5 bottom-1.5 flex justify-between">
                  <button type="button" disabled={locked || i === 0} onClick={() => move(i, -1)} className={btn} style={chip}
                    aria-label={t('gallery.moveEarlier')}>
                    <ChevronLeft className="h-4 w-4" />
                  </button>
                  <button type="button" disabled={locked || i === images.length - 1} onClick={() => move(i, 1)} className={btn} style={chip}
                    aria-label={t('gallery.moveLater')}>
                    <ChevronRight className="h-4 w-4" />
                  </button>
                </div>
              )}
            </div>
          ))}
        </div>
      ) : (
        <div className="rounded-xl py-8 text-center" style={{ background: INNER_BG, border: `1px dashed ${BORDER}`, color: T3, fontSize: 13 }}>
          {t('gallery.empty')}
        </div>
      )}

      <input ref={inputRef} type="file" accept="image/*" multiple className="hidden" disabled={locked || full} onChange={onPick} />
      <div className="flex flex-wrap items-center justify-between gap-2">
        <button
          type="button"
          onClick={() => inputRef.current?.click()}
          disabled={locked || full}
          className="flex items-center gap-2 rounded-xl px-3.5 py-2 text-[13px] font-medium transition-opacity disabled:opacity-40"
          style={{ background: INNER_BG, border: `1px solid ${BORDER}`, color: 'rgb(var(--ink)/0.8)' }}
        >
          {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <Plus className="h-4 w-4" />}
          {t('gallery.add')}
        </button>
        <span className="font-mono" style={{ color: T3, fontSize: 11.5 }}>{images.length}/{max}</span>
      </div>

      <GalleryCropDialog
        open={queue.length > 0}
        source={queue[queueIndex] ?? null}
        step={{ index: queueIndex, total: queue.length }}
        busy={busy}
        onConfirm={confirmNew}
        onSkip={nextInQueue}
        onCancel={() => { setQueue([]); setQueueIndex(0); }}
      />
      <GalleryCropDialog
        open={!!editing}
        source={editing?.src ?? null}
        initial={editing?.initial}
        busy={busy}
        onConfirm={confirmEdit}
        onCancel={() => setEditing(null)}
      />
    </div>
  );
}
