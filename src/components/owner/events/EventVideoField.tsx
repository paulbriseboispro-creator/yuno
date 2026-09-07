import { useEffect, useMemo, useRef, useState } from 'react';
import { Clapperboard, RefreshCw, Trash2, Loader2 } from 'lucide-react';
import { toast } from 'sonner';
import { useLanguage } from '@/contexts/LanguageContext';
import { FieldLabel, T1, T2, T3, INNER_BG, BORDER } from '@/components/owner/events/events-ui';
import { EVENT_VIDEO_ACCEPT, inspectEventVideo, type EventVideoRejection } from '@/lib/eventVideo';

/**
 * Champ « Vidéo de la soirée » des formulaires club et organisateur.
 *
 * Le champ ne connaît que trois états : une vidéo déjà en ligne (`existingUrl`),
 * un fichier choisi mais pas encore envoyé (`file`), ou rien. L'upload lui-même
 * se fait à l'enregistrement du formulaire (voir `uploadEventVideo`), jamais au
 * choix du fichier : un pro qui ferme le panneau sans enregistrer ne doit pas
 * laisser 30 Mo orphelins dans le bucket.
 */
export function EventVideoField({
  existingUrl,
  file,
  onFileChange,
  onRemoveExisting,
}: {
  existingUrl: string;
  file: File | null;
  onFileChange: (file: File | null) => void;
  onRemoveExisting: () => void;
}) {
  const { t } = useLanguage();
  const inputRef = useRef<HTMLInputElement>(null);
  const [checking, setChecking] = useState(false);

  // Aperçu local du fichier choisi — révoqué dès qu'il change.
  const previewUrl = useMemo(() => (file ? URL.createObjectURL(file) : ''), [file]);
  useEffect(() => () => { if (previewUrl) URL.revokeObjectURL(previewUrl); }, [previewUrl]);

  const shownUrl = previewUrl || existingUrl;

  const rejectionMessage = (reason: EventVideoRejection) => t(`owner.eventVideo.err.${reason}`);

  const handlePick = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const picked = e.target.files?.[0];
    e.target.value = '';
    if (!picked) return;
    setChecking(true);
    try {
      const res = await inspectEventVideo(picked);
      if (res.ok === false) { toast.error(rejectionMessage(res.reason)); return; }
      onFileChange(picked);
    } finally {
      setChecking(false);
    }
  };

  const clear = () => {
    if (file) onFileChange(null);
    else onRemoveExisting();
  };

  const sizeLabel = file ? `${(file.size / (1024 * 1024)).toFixed(1)} Mo` : '';

  return (
    <div>
      <FieldLabel>{t('owner.eventVideo.label')}</FieldLabel>
      <p style={{ color: T3, fontSize: 11.5, marginBottom: 8 }}>{t('owner.eventVideo.desc')}</p>
      <input ref={inputRef} type="file" accept={EVENT_VIDEO_ACCEPT} onChange={handlePick} className="hidden" />

      {shownUrl ? (
        <div className="flex items-stretch gap-3 p-3 rounded-xl" style={{ background: INNER_BG, border: `1px solid ${BORDER}` }}>
          {/* Vignette 9:16 — lue muette, comme sur la page publique */}
          <div className="shrink-0 overflow-hidden rounded-lg" style={{ width: 90, aspectRatio: '9 / 16', background: '#000' }}>
            <video
              key={shownUrl}
              src={shownUrl}
              muted
              loop
              autoPlay
              playsInline
              preload="metadata"
              aria-hidden="true"
              className="w-full h-full object-cover"
            />
          </div>
          <div className="flex-1 min-w-0 flex flex-col justify-between py-0.5">
            <div>
              <p className="truncate" style={{ color: T1, fontSize: 12.5, fontWeight: 560 }}>
                {file ? file.name : t('owner.eventVideo.online')}
              </p>
              <p style={{ color: T3, fontSize: 11.5, marginTop: 2 }}>
                {file ? `${sizeLabel} · ${t('owner.eventVideo.pendingSave')}` : t('owner.eventVideo.playsOnPage')}
              </p>
            </div>
            <div className="flex items-center gap-2">
              <button
                type="button"
                onClick={() => inputRef.current?.click()}
                disabled={checking}
                className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-[12px] font-medium transition-all duration-150"
                style={{ background: 'rgba(255,255,255,0.06)', border: `1px solid ${BORDER}`, color: T2 }}
              >
                {checking ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <RefreshCw className="w-3.5 h-3.5" />}
                {t('owner.eventVideo.replace')}
              </button>
              <button
                type="button"
                onClick={clear}
                className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-[12px] font-medium transition-all duration-150"
                style={{ background: 'transparent', border: `1px solid ${BORDER}`, color: T3 }}
              >
                <Trash2 className="w-3.5 h-3.5" />
                {t('owner.eventVideo.remove')}
              </button>
            </div>
          </div>
        </div>
      ) : (
        <div className="space-y-2">
          <div className="flex items-start gap-2 p-3 rounded-xl" style={{ background: INNER_BG, border: `1px solid ${BORDER}` }}>
            <Clapperboard className="w-4 h-4 mt-0.5 flex-shrink-0" style={{ color: T3 }} />
            <div>
              <p style={{ color: T1, fontSize: 12, fontWeight: 560, marginBottom: 2 }}>{t('owner.eventVideo.formatTitle')}</p>
              <p style={{ color: T3, fontSize: 11.5 }}>{t('owner.eventVideo.specs')}</p>
            </div>
          </div>
          <button
            type="button"
            onClick={() => inputRef.current?.click()}
            disabled={checking}
            className="w-full flex items-center justify-center gap-2 py-2.5 rounded-xl text-[13px] font-medium cursor-pointer transition-all duration-150"
            style={{ background: INNER_BG, border: `1px solid ${BORDER}`, color: T2 }}
          >
            {checking ? <Loader2 className="w-4 h-4 animate-spin" /> : <Clapperboard className="w-4 h-4" />}
            {checking ? t('owner.eventVideo.checking') : t('owner.eventVideo.add')}
          </button>
        </div>
      )}
    </div>
  );
}
