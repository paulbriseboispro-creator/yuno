import { useCallback, useState } from 'react';
import { useDropzone } from 'react-dropzone';
import {
  DndContext,
  closestCenter,
  PointerSensor,
  useSensor,
  useSensors,
  DragEndEvent,
} from '@dnd-kit/core';
import {
  SortableContext,
  horizontalListSortingStrategy,
  useSortable,
  arrayMove,
} from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';
import { GripVertical, Loader2, Upload, X } from 'lucide-react';
import { supabase } from '@/integrations/supabase/client';
import { compressImage } from '@/lib/compressImage';
import { cn } from '@/lib/utils';
import { useToast } from '@/hooks/use-toast';
import { RED, T2, T3, BORDER, INNER_BG } from '@/components/affiliate/affiliate-ui';

interface SortableItemProps {
  url: string;
  index: number;
  onRemove: (url: string) => void;
}

function SortableItem({ url, index, onRemove }: SortableItemProps) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({ id: url });

  return (
    <div
      ref={setNodeRef}
      style={{ transform: CSS.Transform.toString(transform), transition }}
      className={cn('relative group select-none', isDragging ? 'opacity-40 z-50' : '')}
    >
      <img src={url} alt={`Gallery ${index + 1}`} className="w-20 h-20 rounded-lg object-cover" style={{ border: `1px solid ${BORDER}` }} />
      {/* Drag handle */}
      <div
        {...attributes}
        {...listeners}
        className="absolute inset-0 flex items-center justify-center opacity-0 group-hover:opacity-100 transition-opacity rounded-lg cursor-grab active:cursor-grabbing"
        style={{ background: 'rgba(0,0,0,0.5)' }}
      >
        <GripVertical className="w-5 h-5 text-white" />
      </div>
      {/* Position */}
      <span className="absolute bottom-1 left-1 text-[9px] font-mono pointer-events-none" style={{ color: 'rgba(255,255,255,0.6)' }}>
        {index + 1}
      </span>
      {/* Remove */}
      <button
        type="button"
        onClick={() => onRemove(url)}
        className="absolute -top-1.5 -right-1.5 w-5 h-5 rounded-full flex items-center justify-center opacity-0 group-hover:opacity-100 transition-opacity z-10"
        style={{ background: RED }}
      >
        <X className="w-3 h-3 text-white" />
      </button>
    </div>
  );
}

interface AffiliateDraggableGalleryProps {
  affiliateId: string;
  folder: string; // ex: "venues/gallery" ou "events/gallery"
  urls: string[];
  onChange: (urls: string[]) => void;
  maxFiles?: number;
  label?: string;
}

export function AffiliateDraggableGallery({
  affiliateId,
  folder,
  urls,
  onChange,
  maxFiles = 15,
  label,
}: AffiliateDraggableGalleryProps) {
  const [uploading, setUploading] = useState(false);
  const { toast } = useToast();

  const sensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 5 } }));

  const onDrop = useCallback(
    async (accepted: File[]) => {
      if (urls.length >= maxFiles) return;
      const remaining = maxFiles - urls.length;
      const files = accepted.slice(0, remaining);
      setUploading(true);
      try {
        const uploaded: string[] = [];
        let failCount = 0;
        for (const file of files) {
          const compressed = await compressImage(file);
          const ext = compressed.name.split('.').pop() ?? 'jpg';
          const path = `${affiliateId}/${folder}/${Date.now()}-${Math.random().toString(36).slice(2, 7)}.${ext}`;

          const { error } = await supabase.storage
            .from('affiliate-media')
            .upload(path, compressed, { upsert: false, contentType: compressed.type });

          if (error) {
            failCount++;
            console.error('Gallery upload error', error);
          } else {
            const { data } = supabase.storage.from('affiliate-media').getPublicUrl(path);
            uploaded.push(data.publicUrl);
          }
        }
        if (uploaded.length > 0) onChange([...urls, ...uploaded]);
        if (failCount > 0) {
          toast({
            title: 'Erreur d\'upload',
            description: `${failCount} photo(s) n'ont pas pu être uploadées.`,
            variant: 'destructive',
          });
        }
      } catch (err) {
        console.error('Gallery upload failed', err);
        const msg = (err as any)?.message ?? (err instanceof Error ? err.message : 'Erreur upload');
        toast({ title: 'Erreur d\'upload galerie', description: msg, variant: 'destructive' });
      } finally {
        setUploading(false);
      }
    },
    [affiliateId, folder, urls, onChange, maxFiles, toast]
  );

  const { getRootProps, getInputProps, isDragActive } = useDropzone({
    onDrop,
    accept: { 'image/*': [] },
    multiple: true,
    maxFiles,
    disabled: uploading || urls.length >= maxFiles,
  });

  function handleDragEnd(event: DragEndEvent) {
    const { active, over } = event;
    if (over && active.id !== over.id) {
      const oldIndex = urls.indexOf(active.id as string);
      const newIndex = urls.indexOf(over.id as string);
      onChange(arrayMove(urls, oldIndex, newIndex));
    }
  }

  function handleRemove(url: string) {
    onChange(urls.filter((u) => u !== url));
  }

  return (
    <div className="space-y-3">
      {label && <p style={{ color: T2, fontSize: 12.5, fontWeight: 600 }}>{label}</p>}

      {/* Drop zone */}
      {urls.length < maxFiles && (
        <div
          {...getRootProps()}
          className={cn(
            'rounded-xl p-5 text-center cursor-pointer transition-colors',
            (uploading || urls.length >= maxFiles) && 'opacity-50 cursor-not-allowed'
          )}
          style={{ border: `2px dashed ${isDragActive ? 'rgba(232,25,44,0.55)' : BORDER}`, background: isDragActive ? 'rgba(232,25,44,0.05)' : 'transparent' }}
        >
          <input {...getInputProps()} />
          {uploading ? (
            <div className="flex items-center justify-center gap-2 py-1" style={{ color: T2 }}>
              <Loader2 className="w-5 h-5 animate-spin" />
              <span style={{ fontSize: 13 }}>Upload en cours…</span>
            </div>
          ) : (
            <div className="py-1">
              <div className="w-9 h-9 rounded-xl mx-auto mb-1.5 flex items-center justify-center" style={{ background: INNER_BG, border: `1px solid ${BORDER}` }}>
                <Upload className="w-4 h-4" style={{ color: T2 }} />
              </div>
              <p style={{ color: T2, fontSize: 13 }}>
                {isDragActive ? 'Dépose les images ici' : `Dépose plusieurs photos (max ${maxFiles})`}
              </p>
              <p style={{ color: T3, fontSize: 11, marginTop: 2 }}>{urls.length}/{maxFiles} photos</p>
            </div>
          )}
        </div>
      )}

      {/* Sortable gallery */}
      {urls.length > 0 && (
        <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={handleDragEnd}>
          <SortableContext items={urls} strategy={horizontalListSortingStrategy}>
            <div className="flex flex-wrap gap-2 mt-2">
              {urls.map((url, i) => (
                <SortableItem key={url} url={url} index={i} onRemove={handleRemove} />
              ))}
            </div>
          </SortableContext>
        </DndContext>
      )}
    </div>
  );
}
