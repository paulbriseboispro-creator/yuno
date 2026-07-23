import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { supabase } from '@/integrations/supabase/client';
import { useLanguage } from '@/contexts/LanguageContext';
import { translate } from '@/i18n/orgTranslate';
import { Inbox, ChevronRight } from 'lucide-react';
import { RED, T1, T3, BORDER, CARD_BG, CARD_SHADOW } from './ui';

type Row = { id: string; event_id: string };

/**
 * Alerte « des organisateurs attendent une allocation de guest list ».
 *
 * Sans eventId : vue globale (dashboard owner) — toutes les demandes en attente.
 * Avec eventId : scopée à la soirée (page de collab).
 *
 * On ne filtre rien à la main : la policy « Operations holder views allocation
 * requests » ne remonte que les demandes des soirées dont on tient l'opérationnel.
 * Donc si ça s'affiche, c'est qu'on est bien la partie qui doit répondre.
 */
export function GuestListRequestAlert({ eventId, basePath = '/owner/guest-list' }: {
  eventId?: string;
  basePath?: string;
}) {
  const { language } = useLanguage();
  const tt = (fr: string, en: string, es?: string) => translate(language, fr, en, es);
  const [rows, setRows] = useState<Row[]>([]);

  useEffect(() => {
    let active = true;
    (async () => {
      let q = supabase
        .from('guest_list_allocation_requests' as never)
        .select('*')
        .eq('status', 'pending');
      if (eventId) q = q.eq('event_id', eventId);
      const { data } = await q;
      if (!active) return;
      setRows(((data as unknown as Row[] | null) ?? []));
    })();
    return () => { active = false; };
  }, [eventId]);

  if (!rows.length) return null;

  // Une seule soirée concernée → on emmène directement dessus.
  const targetEvent = eventId ?? (new Set(rows.map(r => r.event_id)).size === 1 ? rows[0].event_id : null);
  const to = targetEvent ? `${basePath}?event=${targetEvent}` : basePath;

  return (
    <Link
      to={to}
      className="flex items-center gap-3 no-underline"
      style={{
        padding: '13px 15px', borderRadius: 14, background: CARD_BG,
        border: '1px solid rgba(232,25,44,0.30)', boxShadow: CARD_SHADOW,
      }}
    >
      <span className="flex h-8 w-8 flex-none items-center justify-center rounded-full"
        style={{ background: 'rgba(232,25,44,0.14)' }}>
        <Inbox className="h-4 w-4" style={{ color: RED }} />
      </span>
      <span className="min-w-0 flex-1">
        <span className="block" style={{ color: T1, fontSize: 13.5, fontWeight: 600 }}>
          {rows.length === 1
            ? tt('1 demande de guest list', '1 guest list request', '1 solicitud de guest list')
            : tt(`${rows.length} demandes de guest list`, `${rows.length} guest list requests`, `${rows.length} solicitudes de guest list`)}
        </span>
        <span className="block" style={{ color: T3, fontSize: 12, marginTop: 1 }}>
          {tt(
            'Un organisateur attend ta validation pour ses places.',
            'An organizer is waiting for you to grant their spots.',
            'Un organizador espera tu validación para sus plazas.',
          )}
        </span>
      </span>
      <ChevronRight className="h-4 w-4 flex-none" style={{ color: T3 }} />
    </Link>
  );
}

export default GuestListRequestAlert;
