import { useEffect, useState } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { useLanguage } from '@/contexts/LanguageContext';
import { translate } from '@/i18n/orgTranslate';
import { Eye, Users, Building2, Music, Megaphone, UserPlus, Clock, Wine, Loader2 } from 'lucide-react';
import type { LucideIcon } from 'lucide-react';

const T1 = 'rgba(255,255,255,0.96)';
const T2 = 'rgba(255,255,255,0.58)';
const T3 = 'rgba(255,255,255,0.36)';
const GREEN = '#34D399';
const BORDER = 'rgba(255,255,255,0.085)';
const INNER_BG = 'rgba(255,255,255,0.032)';

type PartRow = {
  id: string;
  holder_type: 'club' | 'dj' | 'promoter' | 'custom' | string;
  holder_label: string | null;
  quota: number | null;
  free_before_time: string | null;
  includes_drink: boolean | null;
  is_active: boolean | null;
};

const HOLDER_ICON: Record<string, LucideIcon> = {
  club: Building2, dj: Music, promoter: Megaphone, custom: UserPlus,
};

/**
 * Aperçu LECTURE SEULE de la guest list, pour la partie qui ne tient pas
 * l'opérationnel. Modèle hybride : la part « maison » (holder_type='club') et
 * l'allocation totale suivent l'operations — on les MONTRE ici sans pouvoir y
 * toucher. Chaque partie garde par ailleurs ses propres parts déléguées (gérées
 * sur sa page Guest list) : c'est pour ça que l'aperçu liste toutes les parts,
 * mais ne propose aucune édition.
 *
 * Aucune écriture : lit `guest_lists` + un décompte d'entrées. Le partenaire a
 * déjà le droit de lire ces lignes pour sa co-soirée.
 */
export function CollabGuestListPreview({ eventId, showChrome = true, houseOnly = false }: { eventId: string; showChrome?: boolean; houseOnly?: boolean }) {
  const { language } = useLanguage();
  const tt = (fr: string, en: string, es?: string) => translate(language, fr, en, es);
  const [parts, setParts] = useState<PartRow[]>([]);
  const [countByPart, setCountByPart] = useState<Record<string, number>>({});
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let active = true;
    (async () => {
      setLoading(true);
      const { data: rows } = await supabase
        .from('guest_lists')
        .select('id, holder_type, holder_label, quota, free_before_time, includes_drink, is_active')
        .eq('event_id', eventId);
      const list = (rows as PartRow[] | null) ?? [];
      // Part maison en tête, puis le reste.
      list.sort((a, b) => (a.holder_type === 'club' ? -1 : b.holder_type === 'club' ? 1 : 0));

      const ids = list.map(p => p.id);
      const counts: Record<string, number> = {};
      if (ids.length) {
        const { data: entries } = await supabase
          .from('guest_list_entries')
          .select('guest_list_id, status')
          .in('guest_list_id', ids)
          .neq('status', 'cancelled');
        ((entries ?? []) as { guest_list_id: string; status: string }[]).forEach(e => {
          counts[e.guest_list_id] = (counts[e.guest_list_id] || 0) + 1;
        });
      }
      if (!active) return;
      setParts(list);
      setCountByPart(counts);
      setLoading(false);
    })();
    return () => { active = false; };
  }, [eventId]);

  if (loading) {
    return (
      <div className="flex justify-center py-6">
        <Loader2 className="h-5 w-5 animate-spin" style={{ color: T3 }} />
      </div>
    );
  }

  if (!parts.length) {
    return (
      <div className="space-y-2">
        {showChrome && <ReadOnlyChip tt={tt} />}
        <p style={{ color: T3, fontSize: 12 }}>
          {tt('Aucune guest list pour le moment.', 'No guest list yet.', 'Aún no hay guest list.')}
        </p>
      </div>
    );
  }

  const clubPart = parts.find(p => p.holder_type === 'club') ?? null;
  const totalSignups = Object.values(countByPart).reduce((s, n) => s + n, 0);
  // Allocation totale : NULL sur une part = illimité → on l'indique sans fausser la somme.
  const anyUnlimited = parts.some(p => p.quota == null);
  const totalQuota = parts.reduce((s, p) => s + (p.quota ?? 0), 0);

  const holderLabel = (p: PartRow) =>
    p.holder_type === 'club' ? tt('Club / maison', 'Club / house', 'Club / casa')
    : p.holder_type === 'dj' ? (p.holder_label || tt('DJ', 'DJ', 'DJ'))
    : p.holder_type === 'promoter' ? (p.holder_label || tt('Promoteur', 'Promoter', 'Promotor'))
    : (p.holder_label || tt('Part', 'Part', 'Parte'));

  return (
    <div className="space-y-3">
      {showChrome && <ReadOnlyChip tt={tt} />}

      {/* Totaux — masqués en mode houseOnly (la page les affiche déjà) */}
      {!houseOnly && (
      <div className="grid grid-cols-2 gap-2">
        <div className="rounded-xl px-3 py-2.5" style={{ background: INNER_BG, border: `1px solid ${BORDER}` }}>
          <p style={{ color: T3, fontSize: 10, fontWeight: 600, letterSpacing: '0.06em', textTransform: 'uppercase' }}>{tt('Alloué', 'Allocated', 'Asignado')}</p>
          <p style={{ color: T1, fontSize: 18, fontWeight: 700 }}>{anyUnlimited ? `${totalQuota}+` : totalQuota}</p>
        </div>
        <div className="rounded-xl px-3 py-2.5" style={{ background: INNER_BG, border: `1px solid ${BORDER}` }}>
          <p style={{ color: T3, fontSize: 10, fontWeight: 600, letterSpacing: '0.06em', textTransform: 'uppercase' }}>{tt('Inscrits', 'Signed up', 'Inscritos')}</p>
          <p style={{ color: GREEN, fontSize: 18, fontWeight: 700 }}>{totalSignups}</p>
        </div>
      </div>
      )}

      {/* Part maison (operations) — config lue */}
      {clubPart && (
        <div className="rounded-xl px-3 py-2.5 space-y-1.5" style={{ background: INNER_BG, border: `1px solid ${BORDER}` }}>
          <div className="flex items-center gap-2">
            <Building2 className="h-4 w-4" style={{ color: T3 }} />
            <span style={{ color: T1, fontSize: 13, fontWeight: 600 }}>{tt('Part maison', 'House part', 'Parte casa')}</span>
            <span className="ml-auto rounded-full px-2 py-0.5 text-[10px] font-semibold"
              style={clubPart.is_active ? { background: 'rgba(52,211,153,0.12)', color: GREEN } : { background: 'rgba(255,255,255,0.06)', color: T3 }}>
              {clubPart.is_active ? tt('Active', 'Active', 'Activa') : tt('Inactive', 'Inactive', 'Inactiva')}
            </span>
          </div>
          <div className="flex flex-wrap gap-x-4 gap-y-1" style={{ color: T2, fontSize: 11.5 }}>
            <span>{tt('Quota', 'Quota', 'Cupo')} : <strong style={{ color: T1 }}>{clubPart.quota ?? '∞'}</strong></span>
            {clubPart.free_before_time && (
              <span className="inline-flex items-center gap-1"><Clock className="h-3 w-3" style={{ color: T3 }} /> {tt('Gratuit avant', 'Free before', 'Gratis antes')} {clubPart.free_before_time.substring(0, 5)}</span>
            )}
            {clubPart.includes_drink && (
              <span className="inline-flex items-center gap-1"><Wine className="h-3 w-3" style={{ color: T3 }} /> {tt('Boisson incluse', 'Drink included', 'Bebida incluida')}</span>
            )}
          </div>
        </div>
      )}

      {/* Toutes les parts — masquées en mode houseOnly (la page les liste, éditables) */}
      {!houseOnly && (
      <div className="space-y-1.5">
        <p style={{ color: T3, fontSize: 11, fontWeight: 600, letterSpacing: '0.06em', textTransform: 'uppercase' }}>{tt('Parts', 'Parts', 'Partes')}</p>
        {parts.map(p => {
          const Icon = HOLDER_ICON[p.holder_type] ?? Users;
          const count = countByPart[p.id] ?? 0;
          return (
            <div key={p.id} className="flex items-center gap-2.5 rounded-lg px-2.5 py-2" style={{ background: INNER_BG, border: `1px solid ${BORDER}` }}>
              <Icon className="h-4 w-4 flex-none" style={{ color: T3 }} />
              <span className="min-w-0 flex-1 truncate" style={{ color: T1, fontSize: 12.5 }}>{holderLabel(p)}</span>
              <span style={{ color: T2, fontSize: 12, fontWeight: 600 }}>{count} / {p.quota ?? '∞'}</span>
            </div>
          );
        })}
      </div>
      )}

      <p style={{ color: T2, fontSize: 11, lineHeight: 1.45 }}>
        {tt(
          "La part maison et l'allocation totale sont tenues par qui gère l'opérationnel. Vous gardez vos propres parts sur votre page Guest list ; pour reprendre la main sur la part maison, proposez un avenant.",
          'The house part and total allocation are held by whoever manages operations. You keep your own parts on your Guest list page; to take over the house part, propose an amendment.',
          'La parte casa y el cupo total los lleva quien gestiona lo operativo. Conservas tus propias partes en tu página de Guest list; para asumir la parte casa, propón una adenda.',
        )}
      </p>
    </div>
  );
}

function ReadOnlyChip({ tt }: { tt: (fr: string, en: string, es?: string) => string }) {
  return (
    <div className="flex items-center gap-1.5" style={{ color: T3, fontSize: 11 }}>
      <Eye className="h-3.5 w-3.5" />
      {tt('Aperçu — lecture seule', 'Preview — read only', 'Vista previa — solo lectura')}
    </div>
  );
}

export default CollabGuestListPreview;
