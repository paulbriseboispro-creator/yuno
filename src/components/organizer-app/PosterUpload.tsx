import { useRef, useState } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { ImagePlus, Loader2, X } from 'lucide-react';
import { toast } from 'sonner';
import { T1, T2, T3, BORDER } from '@/components/org-ui';
import { useLanguage } from '@/contexts/LanguageContext';
import { translate } from '@/i18n/orgTranslate';

interface PosterUploadProps {
  userId: string;
  value: string | null;
  onChange: (url: string | null) => void;
  label?: string;
}

export function PosterUpload({ userId, value, onChange, label }: PosterUploadProps) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [uploading, setUploading] = useState(false);
  const { language } = useLanguage();
  const t = (fr: string, en: string, es?: string) => translate(language, fr, en, es);

  const handleFile = async (file: File) => {
    if (!file.type.startsWith('image/')) {
      toast.error(t('Format non supporté', 'Unsupported format', 'Formato no compatible'));
      return;
    }
    if (file.size > 8 * 1024 * 1024) {
      toast.error(t('Image trop lourde (max 8 Mo)', 'Image too heavy (max 8 MB)', 'Imagen demasiado pesada (máx. 8 MB)'));
      return;
    }
    setUploading(true);
    try {
      const ext = file.name.split('.').pop()?.toLowerCase() || 'jpg';
      const path = `${userId}/${crypto.randomUUID()}.${ext}`;
      const { error: upErr } = await supabase.storage
        .from('event-posters')
        .upload(path, file, { upsert: false, contentType: file.type });
      if (upErr) throw upErr;
      const { data: pub } = supabase.storage.from('event-posters').getPublicUrl(path);
      onChange(pub.publicUrl);
      toast.success(t('Affiche enregistrée', 'Poster saved', 'Cartel guardado'));
    } catch (e: any) {
      toast.error(e.message || t('Erreur', 'Error', 'Error'));
    } finally {
      setUploading(false);
    }
  };

  return (
    <div>
      {label && <div className="mb-2" style={{ color: T1, fontSize: 13, fontWeight: 560 }}>{label}</div>}
      {value ? (
        <div className="relative aspect-[4/5] w-full max-w-xs overflow-hidden rounded-xl" style={{ border: `1px solid ${BORDER}` }}>
          <img src={value} alt="Poster" className="h-full w-full object-cover" />
          <button
            type="button"
            onClick={() => onChange(null)}
            className="absolute right-2 top-2 flex h-8 w-8 items-center justify-center rounded-full backdrop-blur transition-colors"
            style={{ background: 'rgba(10,10,12,0.8)', color: T1 }}
            aria-label={t('Retirer', 'Remove', 'Quitar')}
          >
            <X className="h-4 w-4" />
          </button>
        </div>
      ) : (
        <button
          type="button"
          onClick={() => inputRef.current?.click()}
          disabled={uploading}
          className="flex aspect-[4/5] w-full max-w-xs flex-col items-center justify-center rounded-xl transition-colors"
          style={{ border: `2px dashed ${BORDER}`, color: T3 }}
        >
          {uploading ? (
            <Loader2 className="h-6 w-6 animate-spin" />
          ) : (
            <>
              <ImagePlus className="mb-2 h-8 w-8" />
              <span style={{ color: T2, fontSize: 13 }}>{t('Ajouter une affiche', 'Add poster', 'Añadir cartel')}</span>
              <span className="mt-1" style={{ fontSize: 11.5 }}>{t('JPG / PNG · 4:5 recommandé', 'JPG / PNG · 4:5 recommended', 'JPG / PNG · 4:5 recomendado')}</span>
            </>
          )}
        </button>
      )}
      <input
        ref={inputRef}
        type="file"
        accept="image/*"
        className="hidden"
        onChange={(e) => {
          const f = e.target.files?.[0];
          if (f) handleFile(f);
          e.target.value = '';
        }}
      />
    </div>
  );
}
