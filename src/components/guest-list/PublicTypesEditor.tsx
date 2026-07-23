import { useEffect, useState } from 'react';
import { Ticket, Wine, Crown, Link2 } from 'lucide-react';
import { toast } from 'sonner';
import { supabase } from '@/integrations/supabase/client';
import { useLanguage } from '@/contexts/LanguageContext';
import {
  GL_ENTRY_TYPES, allowedEntryTypes, effectivePublicTypes, entryTypeLabelKey,
  type GLEntryType, type GLTypeSource,
} from '@/lib/guestListTypes';

const TYPE_ICON: Record<GLEntryType, typeof Ticket> = { normal: Ticket, drink: Wine, table: Crown };

interface PublicTypesEditorProps {
  guestList: GLTypeSource & { id: string; public_entry_types?: string[] | null };
  onChanged?: (types: GLEntryType[]) => void;
}

/**
 * Choix des types d'entrée proposés sur le LIEN PUBLIC de la part (canal 1).
 * Chaque bascule persiste immédiatement via la RPC set_guest_list_public_types
 * (les DJ/promoteurs n'ont pas d'UPDATE RLS sur guest_lists — la RPC vérifie
 * can_manage_guest_list_part et la règle des types autorisés côté serveur).
 */
export function PublicTypesEditor({ guestList, onChanged }: PublicTypesEditorProps) {
  const { t } = useLanguage();
  const allowed = allowedEntryTypes(guestList);
  const [selected, setSelected] = useState<GLEntryType[]>(() => effectivePublicTypes(guestList));
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    setSelected(effectivePublicTypes(guestList));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [guestList.id, (guestList.public_entry_types || []).join(',')]);

  // Un seul type possible → rien à choisir, on n'affiche pas l'éditeur.
  if (allowed.length <= 1) return null;

  const toggle = async (type: GLEntryType) => {
    const next = selected.includes(type)
      ? selected.filter(v => v !== type)
      : GL_ENTRY_TYPES.filter(v => selected.includes(v) || v === type);
    if (next.length === 0) {
      toast.error(t('glTools.atLeastOneType'));
      return;
    }
    const previous = selected;
    setSelected(next);
    setSaving(true);
    const { error } = await supabase.rpc('set_guest_list_public_types', {
      p_guest_list_id: guestList.id,
      p_types: next,
    });
    setSaving(false);
    if (error) {
      setSelected(previous);
      toast.error(t('glTools.saveTypesError'));
      return;
    }
    onChanged?.(next);
  };

  return (
    <div className="mt-3">
      <p className="mb-1.5 flex items-center gap-1.5 text-xs font-semibold text-muted-foreground">
        <Link2 className="h-3.5 w-3.5 text-primary" />
        {t('glTools.publicTypesTitle')}
      </p>
      <div className="flex flex-wrap gap-1.5">
        {GL_ENTRY_TYPES.filter(type => allowed.includes(type)).map(type => {
          const Icon = TYPE_ICON[type];
          const active = selected.includes(type);
          return (
            <button
              key={type}
              type="button"
              disabled={saving}
              onClick={() => toggle(type)}
              className={`flex items-center gap-1.5 rounded-lg border px-2.5 py-1.5 text-xs font-semibold transition-colors ${
                active
                  ? 'border-primary/50 bg-primary/15 text-primary'
                  : 'border-border/60 bg-muted/30 text-muted-foreground hover:text-foreground'
              } ${saving ? 'opacity-60' : 'cursor-pointer'}`}
            >
              <Icon className="h-3.5 w-3.5" />
              {t(entryTypeLabelKey(type))}
            </button>
          );
        })}
      </div>
      <p className="mt-1 text-[11px] text-muted-foreground/70">{t('glTools.publicTypesHint')}</p>
    </div>
  );
}
