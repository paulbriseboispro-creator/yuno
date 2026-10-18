import { useEffect, useMemo, useRef, useState } from 'react';
import { RectangleHorizontal, RefreshCw, Trash2, Loader2 } from 'lucide-react';
import { toast } from 'sonner';
import { useLanguage } from '@/contexts/LanguageContext';
import { FieldLabel, T1, T2, T3, INNER_BG, BORDER } from '@/components/owner/events/events-ui';

/**
 * Champ « Flyer 16:9 » des formulaires de soirée (club, organisateur, séries).
 *
 * Le flyer large ne sert QU'AU haut de la page soirée (events.flyer_wide_url) :
 * cartes, Explore, emails, Wallet et partages gardent l'affiche 1:1. Facultatif :
 * sans lui, l'affiche carrée se montre entière dans le cadre 16:9.
 *
 * Même modèle que `EventVideoField` : trois états (en ligne, fichier choisi,
 * rien), envoi parti dès le choix (voir `deferredUpload.ts`).
 *
 * Seule vérification : le format. Le cadre de la page est en 16:9 et l'image y
 * est posée en plein : une image presque carrée y perdrait la moitié de sa
 * hauteur. On accepte de 1,5:1 à 2,4:1 (le 16:9 vaut 1,78).
 */
const MIN_RATIO = 1.5;
const MAX_RATIO = 2.4;

function readRatio(file: File): Promise<number | null> {
  return new Promise((resolve) => {
    const url = URL.createObjectURL(file);
    const img = new globalThis.Image();
    img.onload = () => { URL.revokeObjectURL(url); resolve(img.naturalHeight ? img.naturalWidth / img.naturalHeight : null); };
    img.onerror = () => { URL.revokeObjectURL(url); resolve(null); };
    img.src = url;
  });
}

export function EventWideFlyerField({
  existingUrl,
  file,
  uploading = false,
  onFileChange,
  onRemoveExisting,
}: {
  existingUrl: string;
  file: File | null;
  /** L'envoi du fichier choisi est-il encore en vol ? */
  uploading?: boolean;
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

  const handlePick = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const picked = e.target.files?.[0];
    e.target.value = '';
    if (!picked) return;
    if (!picked.type.startsWith('image/')) { toast.error(t('owner.eventWide.err.type')); return; }
    setChecking(true);
    try {
      const ratio = await readRatio(picked);
      if (ratio === null) { toast.error(t('owner.eventWide.err.type')); return; }
      if (ratio < MIN_RATIO || ratio > MAX_RATIO) { toast.error(t('owner.eventWide.err.ratio')); return; }
      onFileChange(picked);
    } finally {
      setChecking(false);
    }
  };

  const clear = () => {
    if (file) onFileChange(null);
    else onRemoveExisting();
  };

  return (
    <div>
      <FieldLabel>{t('owner.eventWide.label')}</FieldLabel>
      <p style={{ color: T3, fontSize: 11.5, marginBottom: 8 }}>{t('owner.eventWide.desc')}</p>
      <input ref={inputRef} type="file" accept="image/jpeg,image/png,image/webp" onChange={handlePick} className="hidden" />

      {shownUrl ? (
        <div className="flex items-stretch gap-3 p-3 rounded-xl" style={{ background: INNER_BG, border: `1px solid ${BORDER}` }}>
          {/* Vignette 16:9 — le cadrage exact du haut de la page publique */}
          <div className="shrink-0 self-start overflow-hidden rounded-lg" style={{ width: 132, aspectRatio: '16 / 9', background: 'var(--sf-000000)' }}>
            <img src={shownUrl} alt="" className="w-full h-full object-cover" />
          </div>
          <div className="flex-1 min-w-0 flex flex-col justify-between py-0.5">
            <div>
              <p className="truncate" style={{ color: T1, fontSize: 12.5, fontWeight: 560 }}>
                {file ? file.name : t('owner.eventWide.online')}
              </p>
              <p style={{ color: T3, fontSize: 11.5, marginTop: 2 }}>
                {file
                  ? t(uploading ? 'owner.eventVideo.uploading' : 'owner.eventVideo.ready')
                  : t('owner.eventWide.onPage')}
              </p>
            </div>
            <div className="flex items-center gap-2 mt-2">
              <button
                type="button"
                onClick={() => inputRef.current?.click()}
                disabled={checking}
                className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-[12px] font-medium transition-all duration-150"
                style={{ background: 'rgb(var(--ink)/0.06)', border: `1px solid ${BORDER}`, color: T2 }}
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
            <RectangleHorizontal className="w-4 h-4 mt-0.5 flex-shrink-0" style={{ color: T3 }} />
            <div>
              <p style={{ color: T1, fontSize: 12, fontWeight: 560, marginBottom: 2 }}>{t('owner.eventWide.formatTitle')}</p>
              <p style={{ color: T3, fontSize: 11.5 }}>{t('owner.ev.recommendedLabel')} <span style={{ color: T2 }}>1920 × 1080 px</span></p>
            </div>
          </div>
          <button
            type="button"
            onClick={() => inputRef.current?.click()}
            disabled={checking}
            className="w-full flex items-center justify-center gap-2 py-2.5 rounded-xl text-[13px] font-medium cursor-pointer transition-all duration-150"
            style={{ background: INNER_BG, border: `1px solid ${BORDER}`, color: T2 }}
          >
            {checking ? <Loader2 className="w-4 h-4 animate-spin" /> : <RectangleHorizontal className="w-4 h-4" />}
            {t('owner.eventWide.add')}
          </button>
        </div>
      )}
    </div>
  );
}
