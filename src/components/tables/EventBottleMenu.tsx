import { useEffect, useState } from 'react';
import { Lock, Wine } from 'lucide-react';
import { supabase } from '@/integrations/supabase/client';
import { useLanguage } from '@/contexts/LanguageContext';
import { VipMenuManager } from '@/components/owner/VipMenuManager';
import { parseTableMenu, type TableMenuItem } from '@/lib/tableBottles';
import { formatMoneyAuto } from '@/lib/money';
import { INNER_BG, BORDER, T1, T3 } from '@/components/org-ui';

/**
 * « Carte bouteilles » d'une soirée dans l'atelier Tables de l'organisateur (D8).
 * - Soirée SANS club : l'organisateur écrit la carte de la soirée (vip_menu_items.event_id).
 * - Soirée AVEC club (hôte ou partenaire) : la carte est celle du club, en lecture seule (get_table_menu).
 */
export function EventBottleMenu({ eventId, hasClub, canEdit }: { eventId: string; hasClub: boolean; canEdit: boolean }) {
  if (!hasClub && canEdit) return <VipMenuManager eventId={eventId} />;
  return <ReadOnlyMenu eventId={eventId} hasClub={hasClub} />;
}

function ReadOnlyMenu({ eventId, hasClub }: { eventId: string; hasClub: boolean }) {
  const { t } = useLanguage();
  const [items, setItems] = useState<TableMenuItem[] | null>(null);
  useEffect(() => {
    let cancelled = false;
    (async () => {
      const { data, error } = await supabase.rpc('get_table_menu', { p_event_id: eventId });
      if (!cancelled) setItems(error ? [] : parseTableMenu(data));
    })();
    return () => { cancelled = true; };
  }, [eventId]);
  return (
    <div className="space-y-3 pt-4">
      <p className="flex items-start gap-1.5" style={{ color: T3, fontSize: 11.5 }}>
        <Lock className="mt-0.5 h-3.5 w-3.5 shrink-0" />
        {t(hasClub ? 'tblb.menu.clubReadOnly' : 'tblb.menu.noRight')}
      </p>
      {items === null ? (
        <p style={{ color: T3, fontSize: 13 }}>…</p>
      ) : items.length === 0 ? (
        <p className="py-4 text-center" style={{ color: T3, fontSize: 13 }}>{t('tblb.menu.empty')}</p>
      ) : (
        items.map(it => (
          <div key={it.id} className="flex items-center justify-between gap-3 rounded-xl p-3" style={{ border: `1px solid ${BORDER}`, background: INNER_BG }}>
            <div className="flex min-w-0 items-center gap-2.5">
              <Wine className="h-4 w-4 shrink-0" style={{ color: T3 }} />
              <div className="min-w-0">
                <div className="truncate" style={{ color: T1, fontSize: 13, fontWeight: 560 }}>{it.name}</div>
                {it.brand && <div className="truncate" style={{ color: T3, fontSize: 11.5 }}>{it.brand}</div>}
              </div>
            </div>
            <span className="shrink-0 tabular-nums" style={{ color: T1, fontSize: 13 }}>{formatMoneyAuto(it.price)}</span>
          </div>
        ))
      )}
    </div>
  );
}
