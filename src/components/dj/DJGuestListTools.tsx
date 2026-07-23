import { useEffect, useState } from 'react';
import { UserPlus } from 'lucide-react';
import { supabase } from '@/integrations/supabase/client';
import { useLanguage } from '@/contexts/LanguageContext';
import { PublicTypesEditor } from '@/components/guest-list/PublicTypesEditor';
import { PublicLinksPanel } from '@/components/guest-list/PublicLinksPanel';
import { InviteLinksPanel } from '@/components/guest-list/InviteLinksPanel';
import { DirectAddGuestDialog } from '@/components/guest-list/DirectAddGuestDialog';
import type { GLTypeSource } from '@/lib/guestListTypes';

type PartRow = GLTypeSource & {
  id: string;
  quota_female: number | null;
  quota_male: number | null;
  public_entry_types: string[] | null;
  share_token: string;
  dj_id: string | null;
};

interface DJGuestListToolsProps {
  guestListId: string;
  slug: string;
  eventId: string;
}

/**
 * Outils de distribution du DJ sur SA part de guest list (accordée par le
 * club) : types offerts sur son lien public, ajout direct d'un invité
 * (email + QR), liens uniques personnels. La part est rechargée ici car
 * get_dj_audience() ne remonte que l'agrégat.
 */
export function DJGuestListTools({ guestListId, slug, eventId }: DJGuestListToolsProps) {
  const { t } = useLanguage();
  const [part, setPart] = useState<PartRow | null>(null);
  const [addOpen, setAddOpen] = useState(false);

  useEffect(() => {
    let active = true;
    (async () => {
      const { data } = await supabase
        .from('guest_lists')
        .select('id, holder_type, quota_normal, quota_drink, quota_table, quota_female, quota_male, entry_kind, public_entry_types, share_token, dj_id')
        .eq('id', guestListId)
        .maybeSingle();
      if (active) setPart((data as PartRow) || null);
    })();
    return () => { active = false; };
  }, [guestListId]);

  if (!part) return null;

  return (
    <div>
      <PublicTypesEditor guestList={part} />
      {/* showMainLink=false : la carte du DJ affiche déjà son lien guest list. */}
      <PublicLinksPanel
        guestListId={part.id}
        shareToken={part.share_token}
        slug={slug}
        eventId={eventId}
        showMainLink={false}
        ownerKind="dj"
        djId={part.dj_id}
      />
      <div className="mt-3">
        <button
          type="button"
          onClick={() => setAddOpen(true)}
          className="flex w-full items-center justify-center gap-1.5 rounded-lg py-2 text-xs font-semibold cursor-pointer transition-all duration-150 hover:bg-white/[0.06]"
          style={{ background: 'rgba(255,255,255,0.05)', border: '1px solid rgba(255,255,255,0.085)', color: 'rgba(255,255,255,0.96)' }}
        >
          <UserPlus className="h-3.5 w-3.5" style={{ color: '#E8192C' }} />
          {t('glTools.addGuest')}
        </button>
      </div>
      <InviteLinksPanel guestList={part} slug={slug} eventId={eventId} />
      <DirectAddGuestDialog open={addOpen} onOpenChange={setAddOpen} guestList={part} />
    </div>
  );
}

export default DJGuestListTools;
