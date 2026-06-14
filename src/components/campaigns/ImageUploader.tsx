import { useRef, useState } from 'react';
import { Upload, X, Loader2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { supabase } from '@/integrations/supabase/client';
import { useLanguage } from '@/contexts/LanguageContext';
import { toast } from 'sonner';

interface Props {
  value?: string | null;
  onChange: (url: string | null) => void;
  bucketFolder: string; // e.g. "venue/abc123" or "org/xyz"
  label?: string;
  helper?: string;
  preview?: 'logo' | 'wide';
  /** Optional background to display behind the logo preview (for transparency check). */
  previewBg?: string;
  /** Logo display shape in the preview thumbnail. */
  previewShape?: 'free' | 'rounded' | 'circle';
}

export default function ImageUploader({
  value, onChange, bucketFolder, label, helper,
  preview = 'wide', previewBg, previewShape = 'free',
}: Props) {
  const { t } = useLanguage();
  const inputRef = useRef<HTMLInputElement>(null);
  const [uploading, setUploading] = useState(false);

  const handleFile = async (file: File) => {
    if (!file) return;
    if (file.size > 5 * 1024 * 1024) {
      toast.error(t('em.iu.tooLarge'));
      return;
    }
    setUploading(true);
    try {
      const ext = (file.name.split('.').pop() || 'png').toLowerCase();
      const path = `${bucketFolder}/${Date.now()}-${Math.random().toString(36).slice(2, 8)}.${ext}`;
      const { error } = await supabase.storage.from('email-assets').upload(path, file, { upsert: false, contentType: file.type });
      if (error) throw error;
      const { data } = supabase.storage.from('email-assets').getPublicUrl(path);
      onChange(data.publicUrl);
      toast.success(t('em.iu.uploaded'));
    } catch (e: any) {
      toast.error(e.message || t('em.iu.uploadFailed'));
    } finally {
      setUploading(false);
    }
  };

  const radius = previewShape === 'circle' ? '9999px' : previewShape === 'rounded' ? '14px' : '8px';

  return (
    <div className="space-y-2">
      {label && <div className="text-sm font-medium">{label}</div>}
      {value ? (
        <div className="flex items-center gap-3">
          <div
            className="relative inline-flex items-center justify-center group p-3"
            style={{
              background: previewBg || 'transparent',
              borderRadius: '12px',
              border: '1px solid hsl(var(--border))',
            }}
          >
            <img
              src={value}
              alt=""
              className={preview === 'logo' ? 'h-20 w-20 object-contain' : 'max-h-40 object-contain'}
              style={{ borderRadius: radius, background: 'transparent' }}
            />
            <button
              type="button"
              onClick={() => onChange(null)}
              className="absolute -top-2 -right-2 bg-destructive text-destructive-foreground rounded-full p-1 shadow-md hover:scale-110 transition-transform"
              aria-label={t('em.iu.remove')}
            >
              <X className="w-3 h-3" />
            </button>
          </div>
          <Button type="button" variant="outline" size="sm" onClick={() => inputRef.current?.click()} disabled={uploading}>
            {uploading ? <Loader2 className="w-3 h-3 mr-1 animate-spin" /> : null}
            {t('em.iu.replace')}
          </Button>
        </div>
      ) : (
        <button
          type="button"
          onClick={() => inputRef.current?.click()}
          disabled={uploading}
          className="flex flex-col items-center justify-center gap-2 w-full h-28 border-2 border-dashed border-border rounded-lg hover:border-primary/60 hover:bg-muted/30 transition-colors text-sm text-muted-foreground"
        >
          {uploading ? <Loader2 className="w-5 h-5 animate-spin" /> : <Upload className="w-5 h-5" />}
          <span>{uploading ? t('em.iu.uploading') : t('em.iu.clickUpload')}</span>
        </button>
      )}
      {helper && <p className="text-xs text-muted-foreground">{helper}</p>}
      <input
        ref={inputRef}
        type="file"
        accept="image/png,image/jpeg,image/webp,image/gif,image/svg+xml"
        className="hidden"
        onChange={(e) => e.target.files?.[0] && handleFile(e.target.files[0])}
      />
    </div>
  );
}
