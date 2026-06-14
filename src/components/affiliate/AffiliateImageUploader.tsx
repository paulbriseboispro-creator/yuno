import { useCallback, useState } from 'react';
import { useDropzone } from 'react-dropzone';
import { Loader2, Upload, X } from 'lucide-react';
import { supabase } from '@/integrations/supabase/client';
import { compressImage } from '@/lib/compressImage';
import { useToast } from '@/hooks/use-toast';
import { RED, T1, T2, T3, BORDER, INNER_BG } from '@/components/affiliate/affiliate-ui';

interface AffiliateImageUploaderProps {
  affiliateId: string;
  value: string | null;
  onChange: (url: string | null) => void;
  folder: string; // ex: "venues/logos" ou "events/flyers"
  label?: string;
  hint?: string;
  /** circular = logo rond */
  shape?: 'circle' | 'rect';
  compress?: boolean;
}

export function AffiliateImageUploader({
  affiliateId,
  value,
  onChange,
  folder,
  label,
  hint,
  shape = 'rect',
  compress = true,
}: AffiliateImageUploaderProps) {
  const [uploading, setUploading] = useState(false);
  const { toast } = useToast();

  const onDrop = useCallback(
    async (accepted: File[]) => {
      const file = accepted[0];
      if (!file) return;
      setUploading(true);
      try {
        const toUpload = compress ? await compressImage(file) : file;
        const ext = toUpload.name.split('.').pop() ?? 'jpg';
        const path = `${affiliateId}/${folder}/${Date.now()}.${ext}`;

        const { error } = await supabase.storage
          .from('affiliate-media')
          .upload(path, toUpload, { upsert: true, contentType: toUpload.type });

        if (error) throw error;

        const { data } = supabase.storage.from('affiliate-media').getPublicUrl(path);
        onChange(data.publicUrl);
      } catch (err) {
        console.error('Upload failed', err);
        const msg = (err as any)?.message ?? (err instanceof Error ? err.message : 'Erreur upload');
        toast({ title: "Erreur d'upload", description: msg, variant: 'destructive' });
      } finally {
        setUploading(false);
      }
    },
    [affiliateId, folder, compress, onChange, toast]
  );

  const { getRootProps, getInputProps, isDragActive } = useDropzone({
    onDrop,
    accept: { 'image/*': [] },
    maxFiles: 1,
    disabled: uploading,
  });

  const dashBorder = (active: boolean) => `2px dashed ${active ? 'rgba(232,25,44,0.55)' : BORDER}`;
  const labelEl = label && <p style={{ color: T2, fontSize: 12.5, fontWeight: 600 }}>{label}</p>;

  if (shape === 'circle') {
    return (
      <div className="space-y-1.5">
        {labelEl}
        <div {...getRootProps()}
          className="relative rounded-full w-24 h-24 flex items-center justify-center cursor-pointer transition-colors overflow-hidden mx-auto"
          style={{ border: dashBorder(isDragActive), background: isDragActive ? 'rgba(232,25,44,0.05)' : 'transparent' }}>
          <input {...getInputProps()} />
          {value ? (
            <>
              <img src={value} alt="Logo" className="object-cover w-full h-full" />
              <button type="button" onClick={(e) => { e.stopPropagation(); onChange(null); }}
                className="absolute top-0.5 right-0.5 w-5 h-5 rounded-full flex items-center justify-center z-10" style={{ background: RED }}>
                <X className="w-3 h-3 text-white" />
              </button>
            </>
          ) : uploading ? (
            <Loader2 className="w-6 h-6 animate-spin" style={{ color: T3 }} />
          ) : (
            <Upload className="w-6 h-6" style={{ color: T3 }} />
          )}
        </div>
        {hint && <p className="text-center" style={{ color: T3, fontSize: 11 }}>{hint}</p>}
      </div>
    );
  }

  return (
    <div className="space-y-1.5">
      {labelEl}
      <div {...getRootProps()}
        className="rounded-xl p-5 text-center cursor-pointer transition-colors"
        style={{ border: dashBorder(isDragActive), background: isDragActive ? 'rgba(232,25,44,0.05)' : 'transparent' }}>
        <input {...getInputProps()} />
        {value ? (
          <div className="flex items-center gap-4">
            <img src={value} alt="" className="w-20 h-20 rounded-lg object-cover flex-none" style={{ border: `1px solid ${BORDER}` }} />
            <div className="text-left flex-1 min-w-0">
              <p style={{ color: T1, fontSize: 13.5, fontWeight: 500 }}>Photo uploadée</p>
              <p style={{ color: T3, fontSize: 11.5, marginTop: 2 }}>Dépose une nouvelle image pour remplacer</p>
            </div>
            <button type="button" onClick={(e) => { e.stopPropagation(); onChange(null); }}
              className="flex-none transition-colors" style={{ color: T3 }}
              onMouseEnter={(e) => (e.currentTarget.style.color = RED)} onMouseLeave={(e) => (e.currentTarget.style.color = T3)}>
              <X className="w-4 h-4" />
            </button>
          </div>
        ) : uploading ? (
          <div className="flex items-center justify-center gap-2 py-2" style={{ color: T2 }}>
            <Loader2 className="w-5 h-5 animate-spin" />
            <span style={{ fontSize: 13 }}>Upload en cours…</span>
          </div>
        ) : (
          <div className="py-2">
            <div className="w-10 h-10 rounded-xl mx-auto mb-2 flex items-center justify-center" style={{ background: INNER_BG, border: `1px solid ${BORDER}` }}>
              <Upload className="w-4 h-4" style={{ color: T2 }} />
            </div>
            <p style={{ color: T2, fontSize: 13 }}>{isDragActive ? "Dépose l'image ici" : 'Dépose une image ou clique pour parcourir'}</p>
            {hint && <p style={{ color: T3, fontSize: 11, marginTop: 4 }}>{hint}</p>}
          </div>
        )}
      </div>
    </div>
  );
}
