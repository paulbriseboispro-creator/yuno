import { useEffect, useState } from 'react';
import { translate } from '@/i18n/orgTranslate';
import { Crown, Wine, Star, CalendarClock, StickyNote } from 'lucide-react';
import { supabase } from '@/integrations/supabase/client';
import { useLanguage } from '@/contexts/LanguageContext';

// ─── Design tokens (Yuno pro DA) ──────────────────────────────────────────────
const RED = '#E8192C';
const GOLD = '#E7C15A';
const T1 = 'rgba(255,255,255,0.96)';
const T2 = 'rgba(255,255,255,0.58)';
const T3 = 'rgba(255,255,255,0.36)';
const BORDER = 'rgba(255,255,255,0.085)';
const FAINT = 'rgba(255,255,255,0.06)';

const fmtPrice = (n: number): string => {
  const v = Math.round((n || 0) * 100) / 100;
  return v % 1 === 0 ? `${v.toLocaleString()}€` : `${v.toFixed(2)}€`;
};

interface GuestProfile {
  ok: boolean;
  guest: { full_name: string | null; user_id: string | null; email: string | null };
  nights: number;
  reservations: number;
  first_seen: string | null;
  last_seen: string | null;
  days_since_last: number | null;
  table_revenue: number;
  consumption_revenue: number;
  lifetime_value: number;
  avg_per_night: number;
  nights_min_met: number;
  favorite_category: string | null;
  top_bottles: { name: string | null; category: string | null; brand: string | null; qty: number; revenue: number }[];
  notes: { note: string; note_type: string | null; created_at: string | null }[];
}

interface Props {
  venueId: string;
  userId?: string | null;
  email?: string | null;
}

const CAT_LABEL: Record<string, [string, string, string]> = {
  champagne: ['Champagne', 'Champagne', 'Champán'], vodka: ['Vodka', 'Vodka', 'Vodka'],
  whisky: ['Whisky', 'Whisky', 'Whisky'], gin: ['Gin', 'Gin', 'Ginebra'], rum: ['Rhum', 'Rum', 'Ron'],
  tequila: ['Tequila', 'Tequila', 'Tequila'], cognac: ['Cognac', 'Cognac', 'Coñac'], wine: ['Vin', 'Wine', 'Vino'],
  soft: ['Soft', 'Soft', 'Refresco'], mixer: ['Diluant', 'Mixer', 'Refresco'], other: ['Autre', 'Other', 'Otro'],
};

export function VipGuestBlackBook({ venueId, userId, email }: Props) {
  const { language } = useLanguage();
  const tt = (fr: string, en: string, es?: string) => translate(language, fr, en, es);
  const [data, setData] = useState<GuestProfile | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!venueId || (!userId && !email)) { setLoading(false); return; }
    let cancelled = false;
    (async () => {
      setLoading(true);
      const { data: res } = await supabase.rpc('get_vip_guest_profile', {
        p_venue_id: venueId,
        p_user_id: userId ?? undefined,
        p_email: email ?? undefined,
      });
      if (cancelled) return;
      const parsed = res as unknown as GuestProfile | null;
      setData(parsed && parsed.ok ? parsed : null);
      setLoading(false);
    })();
    return () => { cancelled = true; };
  }, [venueId, userId, email]);

  if (loading || !data) return null;

  // A first-timer's profile still counts the current paid night (nights === 1).
  const isReturning = data.nights > 1;
  const catLabel = (c: string | null) => { if (!c) return null; const l = CAT_LABEL[c]; return l ? tt(l[0], l[1], l[2]) : c; };

  const lastSeenLabel = data.days_since_last == null ? null
    : data.days_since_last <= 0 ? tt('aujourd\'hui', 'today', 'hoy')
    : data.days_since_last === 1 ? tt('hier', 'yesterday', 'ayer')
    : data.days_since_last < 30 ? tt(`il y a ${data.days_since_last} j`, `${data.days_since_last}d ago`, `hace ${data.days_since_last} d`)
    : tt(`il y a ${Math.round(data.days_since_last / 30)} mois`, `${Math.round(data.days_since_last / 30)}mo ago`, `hace ${Math.round(data.days_since_last / 30)} meses`);

  return (
    <div style={{
      background: isReturning
        ? `linear-gradient(180deg, ${GOLD}14 0%, rgba(255,255,255,.006) 60%), #0a0a0c`
        : 'linear-gradient(180deg,rgba(255,255,255,.04) 0%,rgba(255,255,255,.008) 100%),#0a0a0c',
      border: `1px solid ${isReturning ? GOLD + '3a' : BORDER}`,
      borderRadius: 16,
      padding: '16px 18px',
    }}>
      {/* Header */}
      <div className="flex items-center justify-between mb-3">
        <div className="flex items-center gap-2">
          <Crown className="h-4 w-4 flex-none" style={{ color: isReturning ? GOLD : T3 }} />
          <span className="text-[13px] font-semibold" style={{ color: T1 }}>
            {isReturning
              ? tt(`Habitué · ${data.nights}e visite`, `Regular · visit #${data.nights}`, `Habitual · visita #${data.nights}`)
              : tt('Première visite', 'First visit', 'Primera visita')}
          </span>
        </div>
        {lastSeenLabel && isReturning && (
          <span className="text-[11px] flex items-center gap-1" style={{ color: T3 }}>
            <CalendarClock className="h-3 w-3" /> {tt('vu', 'seen', 'visto')} {lastSeenLabel}
          </span>
        )}
      </div>

      {/* Value stats */}
      <div className="grid grid-cols-3 gap-2 mb-3">
        <div>
          <div className="text-[10px] uppercase tracking-wide" style={{ color: T3 }}>{tt('Valeur vie', 'Lifetime', 'Valor vida')}</div>
          <div className="text-[17px] font-[680] tabular-nums leading-tight" style={{ color: isReturning ? GOLD : T1 }}>{fmtPrice(data.lifetime_value)}</div>
        </div>
        <div>
          <div className="text-[10px] uppercase tracking-wide" style={{ color: T3 }}>{tt('Moy./soir', 'Avg/night', 'Prom./noche')}</div>
          <div className="text-[17px] font-[680] tabular-nums leading-tight" style={{ color: T1 }}>{fmtPrice(data.avg_per_night)}</div>
        </div>
        <div>
          <div className="text-[10px] uppercase tracking-wide" style={{ color: T3 }}>{tt('Soirées', 'Nights', 'Noches')}</div>
          <div className="text-[17px] font-[680] tabular-nums leading-tight" style={{ color: T1 }}>{data.nights}</div>
        </div>
      </div>

      {/* Favorite + top bottles */}
      {(data.favorite_category || data.top_bottles.length > 0) && (
        <div className="flex flex-wrap items-center gap-1.5 mb-1" style={{ paddingTop: 10, borderTop: `1px solid ${FAINT}` }}>
          {data.favorite_category && (
            <span className="inline-flex items-center gap-1 text-[11px] px-2 py-1 rounded-full"
              style={{ background: RED + '1a', color: '#ff6b78', border: `1px solid ${RED}33` }}>
              <Star className="h-3 w-3" /> {catLabel(data.favorite_category)}
            </span>
          )}
          {data.top_bottles.slice(0, 3).map((b, i) => (
            <span key={(b.name ?? '') + i} className="inline-flex items-center gap-1 text-[11px] px-2 py-1 rounded-full"
              style={{ background: FAINT, color: T2, border: `1px solid ${BORDER}` }}>
              <Wine className="h-3 w-3" /> {b.name} <span style={{ color: T3 }}>×{b.qty}</span>
            </span>
          ))}
        </div>
      )}

      {/* Notes */}
      {data.notes.length > 0 && (
        <div className="mt-2 space-y-1" style={{ paddingTop: 10, borderTop: `1px solid ${FAINT}` }}>
          {data.notes.slice(0, 2).map((n, i) => (
            <div key={i} className="flex items-start gap-1.5 text-[12px]" style={{ color: T2 }}>
              <StickyNote className="h-3 w-3 flex-none mt-0.5" style={{ color: T3 }} />
              <span>{n.note}</span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
