/**
 * Ce que partagent les briques du panneau de droite (fields.tsx) sans être
 * des composants : variables d'e-mail, style des champs, envoi d'une image.
 */
import { useState } from 'react';
import { useCrmToast } from '@/crm/ui/toast';
import { useCrmT } from '@/crm/i18n';
import { useCrmScope } from '@/crm/scope';
import { supabase } from '@/integrations/supabase/client';

export const VARS = ['prénom', 'nom_club', 'soirée', 'ville'] as const;
export const cap = (s: string) => (s ? s[0].toUpperCase() + s.slice(1) : s);

export type Patch = (p: Record<string, unknown>) => void;

export const inputCss = { height: 44, boxSizing: 'border-box', padding: '0 14px', borderRadius: 12, border: '1px solid var(--sand-200)', background: '#fff', fontSize: 14.5, color: 'var(--ink)', outline: 'none', width: '100%' } as const;

/**
 * Envoi d'une image d'e-mail (bucket public `email-assets`, dossier de la
 * portée) : 5 Mo au plus. Rend l'URL publique, ou null après un toast.
 */
export function useEmailImageUpload() {
  const { t } = useCrmT();
  const toast = useCrmToast();
  const { space } = useCrmScope();
  const [busy, setBusy] = useState(false);
  const upload = async (file: File | undefined): Promise<string | null> => {
    if (!file) return null;
    if (file.size > 5 * 1024 * 1024) { toast(t('yc.em.st.f.imgTooBig')); return null; }
    setBusy(true);
    try {
      const ext = (file.name.split('.').pop() || 'jpg').toLowerCase().replace(/[^a-z0-9]/g, '') || 'jpg';
      const folder = space.venueId ? `venue/${space.venueId}` : `org/${space.organizerUserId}`;
      const path = `${folder}/${Date.now()}-${Math.random().toString(36).slice(2, 8)}.${ext}`;
      const { error } = await supabase.storage.from('email-assets').upload(path, file, { upsert: false, contentType: file.type });
      if (error) throw error;
      return supabase.storage.from('email-assets').getPublicUrl(path).data.publicUrl;
    } catch {
      toast(t('yc.em.st.f.imgFail'));
      return null;
    } finally {
      setBusy(false);
    }
  };
  return { busy, upload };
}
