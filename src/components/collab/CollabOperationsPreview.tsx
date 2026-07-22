import { useEffect, useState } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { useLanguage } from '@/contexts/LanguageContext';
import { translate } from '@/i18n/orgTranslate';
import { Eye, Ticket, Crown } from 'lucide-react';

const T1 = 'rgba(255,255,255,0.96)';
const T2 = 'rgba(255,255,255,0.58)';
const T3 = 'rgba(255,255,255,0.36)';
const BORDER = 'rgba(255,255,255,0.085)';
const INNER_BG = 'rgba(255,255,255,0.032)';
const GREEN = '#34D399';

type Round = {
  id: string; name: string; price: number | null; max_tickets: number | null;
  tickets_sold: number | null; is_active: boolean | null; ticket_type: string | null;
  position: number | null; manually_sold_out: boolean | null;
};
type Pack = {
  id: string; name: string; base_price: number | null; base_capacity: number | null;
  tables_count: number | null; is_active: boolean | null; position: number | null;
};

const euro = (n: number | null | undefined) =>
  n === null || n === undefined ? '—' : `${Number(n).toFixed(Number(n) % 1 === 0 ? 0 : 2)} €`;

/**
 * Aperçu LECTURE SEULE de l'opérationnel, pour la partie qui ne le tient pas.
 *
 * Verrouiller n'est pas aveugler. Quelqu'un qui tient le design a besoin de
 * savoir à quel prix la soirée se vend et combien de tables sont ouvertes — il
 * en parle à son public, il cale sa communication dessus. Lui afficher un
 * cadenas et rien d'autre le forçait à demander au club par message.
 *
 * Aucune écriture possible : le composant ne fait que lire. Les données passent
 * par les policies publiques déjà en place (`ticket_rounds` en SELECT libre,
 * `table_packs` sur is_active), donc il ne contourne aucun garde-fou — il montre
 * exactement ce que le public verra.
 */
export function CollabOperationsPreview({
  eventId,
  kind,
  showChrome = true,
  heading,
}: {
  eventId: string;
  kind: 'ticketing' | 'tables';
  /** Bandeau « Aperçu — lecture seule » + note « propose un avenant ». Coupé
   *  quand plusieurs sections sont empilées dans un dialogue (chrome montré une
   *  seule fois autour). Par défaut vrai → usage inline inchangé. */
  showChrome?: boolean;
  /** Petit intitulé de section, utile quand on empile plusieurs aperçus. */
  heading?: string;
}) {
  const { language } = useLanguage();
  const tt = (fr: string, en: string, es?: string) => translate(language, fr, en, es);
  const [rounds, setRounds] = useState<Round[]>([]);
  const [packs, setPacks] = useState<Pack[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let active = true;
    (async () => {
      setLoading(true);
      if (kind === 'ticketing') {
        const { data } = await supabase
          .from('ticket_rounds')
          .select('id, name, price, max_tickets, tickets_sold, is_active, ticket_type, position, manually_sold_out')
          .eq('event_id', eventId)
          .order('position', { ascending: true });
        if (active) setRounds((data as Round[] | null) || []);
      } else {
        const { data } = await supabase
          .from('table_packs')
          .select('id, name, base_price, base_capacity, tables_count, is_active, position')
          .eq('event_id', eventId)
          .order('position', { ascending: true });
        if (active) setPacks((data as Pack[] | null) || []);
      }
      if (active) setLoading(false);
    })();
    return () => { active = false; };
  }, [eventId, kind]);

  if (loading) return null;

  const sectionHeading = heading ? (
    <p style={{ color: T3, fontSize: 11, fontWeight: 600, letterSpacing: '0.06em', textTransform: 'uppercase' }}>{heading}</p>
  ) : null;

  const items = kind === 'ticketing' ? rounds : packs;
  if (!items.length) {
    return (
      <div className="space-y-1.5">
        {sectionHeading}
        <p style={{ color: T3, fontSize: 12 }}>
          {kind === 'ticketing'
            ? tt('Aucun palier de billets pour le moment.', 'No ticket tiers yet.', 'Aún no hay tramos de entradas.')
            : tt('Aucune table en ligne pour le moment.', 'No tables online yet.', 'Aún no hay mesas en línea.')}
        </p>
      </div>
    );
  }

  return (
    <div className="space-y-2">
      {sectionHeading}
      {showChrome && (
        <div className="flex items-center gap-1.5" style={{ color: T3, fontSize: 11 }}>
          <Eye className="h-3.5 w-3.5" />
          {tt('Aperçu — lecture seule', 'Preview — read only', 'Vista previa — solo lectura')}
        </div>
      )}

      {kind === 'ticketing' && rounds.map(r => {
        const soldOut = r.manually_sold_out
          || (r.max_tickets !== null && (r.tickets_sold ?? 0) >= r.max_tickets);
        return (
          <div key={r.id} className="flex items-center gap-3 rounded-xl px-3 py-2.5"
            style={{ background: INNER_BG, border: `1px solid ${BORDER}` }}>
            <Ticket className="h-4 w-4 flex-none" style={{ color: T3 }} />
            <div className="min-w-0 flex-1">
              <p className="truncate" style={{ color: T1, fontSize: 13, fontWeight: 560 }}>{r.name}</p>
              <p style={{ color: T3, fontSize: 11 }}>
                {r.max_tickets !== null
                  ? tt(
                    `${r.tickets_sold ?? 0} / ${r.max_tickets} vendus`,
                    `${r.tickets_sold ?? 0} / ${r.max_tickets} sold`,
                    `${r.tickets_sold ?? 0} / ${r.max_tickets} vendidas`,
                  )
                  : tt(`${r.tickets_sold ?? 0} vendus`, `${r.tickets_sold ?? 0} sold`, `${r.tickets_sold ?? 0} vendidas`)}
                {r.ticket_type === 'vip' && ' · VIP'}
              </p>
            </div>
            <div className="flex flex-none items-center gap-2">
              <span style={{ color: T1, fontSize: 13, fontWeight: 600 }}>{euro(r.price)}</span>
              <span className="rounded-full px-2 py-0.5 text-[10px] font-semibold"
                style={soldOut
                  ? { background: 'rgba(255,255,255,0.06)', color: T3 }
                  : r.is_active
                    ? { background: 'rgba(52,211,153,0.12)', color: GREEN }
                    : { background: 'rgba(255,255,255,0.06)', color: T3 }}>
                {soldOut
                  ? tt('Complet', 'Sold out', 'Agotado')
                  : r.is_active
                    ? tt('En vente', 'On sale', 'A la venta')
                    : tt('Fermé', 'Closed', 'Cerrado')}
              </span>
            </div>
          </div>
        );
      })}

      {kind === 'tables' && packs.map(p => (
        <div key={p.id} className="flex items-center gap-3 rounded-xl px-3 py-2.5"
          style={{ background: INNER_BG, border: `1px solid ${BORDER}` }}>
          <Crown className="h-4 w-4 flex-none" style={{ color: T3 }} />
          <div className="min-w-0 flex-1">
            <p className="truncate" style={{ color: T1, fontSize: 13, fontWeight: 560 }}>{p.name}</p>
            <p style={{ color: T3, fontSize: 11 }}>
              {p.base_capacity ? tt(`${p.base_capacity} pers.`, `${p.base_capacity} guests`, `${p.base_capacity} pers.`) : '—'}
              {p.tables_count ? ` · ${tt(`${p.tables_count} tables`, `${p.tables_count} tables`, `${p.tables_count} mesas`)}` : ''}
            </p>
          </div>
          <div className="flex flex-none items-center gap-2">
            <span style={{ color: T1, fontSize: 13, fontWeight: 600 }}>{euro(p.base_price)}</span>
            <span className="rounded-full px-2 py-0.5 text-[10px] font-semibold"
              style={p.is_active
                ? { background: 'rgba(52,211,153,0.12)', color: GREEN }
                : { background: 'rgba(255,255,255,0.06)', color: T3 }}>
              {p.is_active ? tt('En ligne', 'Online', 'En línea') : tt('Hors ligne', 'Offline', 'Fuera de línea')}
            </span>
          </div>
        </div>
      ))}

      {showChrome && (
        <p style={{ color: T2, fontSize: 11, lineHeight: 1.45 }}>
          {tt(
            "C'est ce que voit le public. Pour modifier, il faut tenir l'opérationnel — proposez un avenant.",
            'This is what the public sees. To change it you must hold operations — propose an amendment.',
            'Esto es lo que ve el público. Para cambiarlo hay que llevar lo operativo: propón una adenda.',
          )}
        </p>
      )}
    </div>
  );
}

export default CollabOperationsPreview;
