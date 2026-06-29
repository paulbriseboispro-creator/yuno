import { useEffect, useState } from 'react';
import { translate } from '@/i18n/orgTranslate';
import { Cake, Users, MapPin, Info, UsersRound } from 'lucide-react';
import { supabase } from '@/integrations/supabase/client';
import { useLanguage } from '@/contexts/LanguageContext';

// ─── Design tokens (Yuno pro DA — single red accent, mono ramp) ────────────────
const RED = '#E8192C';
const T1 = 'rgba(255,255,255,0.96)';
const T2 = 'rgba(255,255,255,0.58)';
const T3 = 'rgba(255,255,255,0.36)';
const BORDER = 'rgba(255,255,255,0.085)';
const FAINT = 'rgba(255,255,255,0.06)';
const CARD_BG = 'linear-gradient(180deg,rgba(255,255,255,.045) 0%,rgba(255,255,255,.008) 100%),#0a0a0c';
const CARD_SHADOW = '0 1px 0 rgba(255,255,255,.05) inset,0 18px 40px -28px rgba(0,0,0,.9)';

// Ordinal ramp — the leading segment is RED, the rest fade through white opacity.
const RAMP = [
  RED,
  'rgba(255,255,255,0.66)', 'rgba(255,255,255,0.44)', 'rgba(255,255,255,0.30)',
  'rgba(255,255,255,0.22)', 'rgba(255,255,255,0.15)',
];
const ramp = (i: number) => RAMP[Math.min(i, RAMP.length - 1)];

const crd: React.CSSProperties = {
  background: CARD_BG,
  border: `1px solid ${BORDER}`,
  borderRadius: 18,
  boxShadow: CARD_SHADOW,
  overflow: 'hidden',
};

// ─── Types (RPC event_audience_demographics → jsonb) ──────────────────────────
interface DemographicsData {
  ok: boolean;
  total: number;
  /** Combined event capacity (tickets + VIP tables + guest list). Single-event view only; null otherwise. */
  capacity: number | null;
  age_known: number;
  gender_known: number;
  age_buckets: { bucket: string; count: number }[];
  gender: { label: string; count: number }[];
  cities: { city: string; count: number }[];
}

interface Props {
  scope: { kind: 'venue'; id: string } | { kind: 'organizer'; id: string };
  /** When set, demographics are scoped to a single event (per-night view). */
  eventId?: string | null;
  from?: string;
  to?: string;
}

// ─── Distribution bar row ──────────────────────────────────────────────────────
function BarRow({ label, pct, count, color }: { label: string; pct: number; count: number; color: string }) {
  return (
    <div className="space-y-1.5">
      <div className="flex items-baseline justify-between gap-3">
        <span className="text-[13px] font-[560] truncate capitalize" style={{ color: T1 }}>{label}</span>
        <span className="text-[13px] font-[640] tabular-nums flex-none" style={{ color: T2 }}>
          {pct}% <span style={{ color: T3 }}>({count})</span>
        </span>
      </div>
      <div className="h-1.5 rounded-full overflow-hidden" style={{ background: FAINT }}>
        <div className="h-full rounded-full transition-all" style={{ width: `${Math.max(pct === 0 ? 0 : 4, pct)}%`, background: color }} />
      </div>
    </div>
  );
}

function Coverage({ known, total, label }: { known: number; total: number; label: string }) {
  if (total === 0) return null;
  const pct = Math.round((known / total) * 100);
  return (
    <div className="flex items-center gap-1.5 mt-3.5 text-[11px]" style={{ color: T3 }}>
      <Info className="w-3 h-3 flex-none" />
      <span>{label} — {known}/{total} ({pct}%)</span>
    </div>
  );
}

export function EventAudienceDemographics({ scope, eventId, from, to }: Props) {
  const { language } = useLanguage();
  const tt = (fr: string, en: string, es?: string) => translate(language, fr, en, es);
  const [data, setData] = useState<DemographicsData | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      setLoading(true);
      const { data: res } = await supabase.rpc('event_audience_demographics', {
        p_scope: scope.kind,
        p_scope_id: scope.id,
        p_event_id: eventId ?? null,
        p_from: from ?? null,
        p_to: to ?? null,
      });
      if (cancelled) return;
      const parsed = res as unknown as DemographicsData | null;
      setData(parsed && parsed.ok ? parsed : null);
      setLoading(false);
    })();
    return () => { cancelled = true; };
  }, [scope.kind, scope.id, eventId, from, to]);

  const capacity = data && data.capacity && data.capacity > 0 ? data.capacity : null;
  const fillPct = capacity ? Math.round(Math.min(1, (data?.total ?? 0) / capacity) * 100) : null;

  if (loading) {
    return (
      <div className="h-40 flex items-center justify-center text-sm" style={{ color: T3 }}>
        {tt('Chargement…', 'Loading…', 'Cargando…')}
      </div>
    );
  }

  if (!data || data.total === 0) {
    return (
      <div style={{ ...crd, padding: '22px 24px' }}>
        <div className="flex items-center gap-2.5 mb-1.5">
          <UsersRound className="h-4 w-4 flex-none" style={{ color: T3 }} />
          <h3 className="text-[15px] font-semibold" style={{ color: T1, letterSpacing: '-0.01em' }}>
            {tt('Pas encore de participants', 'No participants yet', 'Aún no hay participantes')}
          </h3>
        </div>
        <p className="text-[13px]" style={{ color: T3 }}>
          {tt(
            'Dès que des billets, des tables ou des inscriptions guest list arrivent, l\'âge et le sexe de ton public apparaissent ici — agrégés et anonymes.',
            'As soon as tickets, tables or guest-list sign-ups come in, your crowd\'s age and gender show up here — aggregated and anonymous.',
            'En cuanto lleguen entradas, mesas o inscripciones a la guest list, la edad y el sexo de tu público aparecerán aquí, agregados y anónimos.',
          )}
        </p>
      </div>
    );
  }

  // ── Age buckets (ordered, leading bucket gets RED) ──
  const ageTotal = data.age_buckets.reduce((a, b) => a + b.count, 0);
  const ageMax = Math.max(0, ...data.age_buckets.map(b => b.count));
  const ageRows = data.age_buckets.map((b) => ({
    label: b.bucket,
    count: b.count,
    pct: ageTotal ? Math.round((b.count / ageTotal) * 100) : 0,
    color: b.count === ageMax ? RED : 'rgba(255,255,255,0.42)',
  }));

  // ── Gender (normalize raw labels → Hommes / Femmes / Autres, rank-colored) ──
  const genderBuckets = new Map<string, { label: string; count: number }>();
  const addG = (key: string, label: string, count: number) => {
    const cur = genderBuckets.get(key);
    if (cur) cur.count += count; else genderBuckets.set(key, { label, count });
  };
  for (const g of data.gender) {
    const l = (g.label || '').toLowerCase();
    if (['male', 'm', 'homme', 'hombre', 'man', 'h'].includes(l)) addG('m', tt('Hommes', 'Men', 'Hombres'), g.count);
    else if (['female', 'f', 'femme', 'mujer', 'woman'].includes(l)) addG('f', tt('Femmes', 'Women', 'Mujeres'), g.count);
    else addG('o', tt('Autres', 'Other', 'Otros'), g.count);
  }
  const genderTotal = [...genderBuckets.values()].reduce((a, s) => a + s.count, 0) || 1;
  const genderRows = [...genderBuckets.values()]
    .sort((a, b) => b.count - a.count)
    .map((s, i) => ({ ...s, pct: Math.round((s.count / genderTotal) * 100), color: ramp(i) }));

  // ── Cities ──
  const cityMax = Math.max(0, ...data.cities.map(c => c.count));

  return (
    <div className="space-y-3">
      {/* Age · Gender · Participants */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-3">
        {/* Age group */}
        <div style={{ ...crd, padding: '20px 22px' }}>
          <h3 className="text-[15px] font-semibold mb-4 flex items-center gap-2.5" style={{ color: T1, letterSpacing: '-0.01em' }}>
            <Cake className="h-4 w-4 flex-none" style={{ color: RED }} />
            {tt('Tranche d\'âge', 'Age group', 'Rango de edad')}
          </h3>
          {ageRows.length ? (
            <>
              <div className="space-y-3.5">
                {ageRows.map(r => <BarRow key={r.label} {...r} />)}
              </div>
              <Coverage known={data.age_known} total={data.total}
                label={tt('Âge renseigné', 'Age known', 'Edad conocida')} />
            </>
          ) : (
            <p className="text-[13px]" style={{ color: T3 }}>
              {tt('Tes participants n\'ont pas encore renseigné leur date de naissance.', "Your participants haven't set their birth date yet.", 'Tus participantes aún no indicaron su fecha de nacimiento.')}
            </p>
          )}
        </div>

        {/* Gender */}
        <div style={{ ...crd, padding: '20px 22px' }}>
          <h3 className="text-[15px] font-semibold mb-4 flex items-center gap-2.5" style={{ color: T1, letterSpacing: '-0.01em' }}>
            <Users className="h-4 w-4 flex-none" style={{ color: RED }} />
            {tt('Sexe', 'Gender', 'Sexo')}
          </h3>
          {genderRows.length ? (
            <>
              {/* segmented split bar */}
              <div className="flex h-3 w-full overflow-hidden rounded-full mb-4" style={{ background: FAINT }}>
                {genderRows.map(s => (
                  <div key={s.label} title={s.label} style={{ width: `${(s.count / genderTotal) * 100}%`, background: s.color }} />
                ))}
              </div>
              <div className="space-y-3">
                {genderRows.map(s => (
                  <div key={s.label} className="flex items-center gap-2.5">
                    <span className="h-2.5 w-2.5 rounded-full flex-none" style={{ background: s.color }} />
                    <span className="text-[13px]" style={{ color: T2 }}>{s.label}</span>
                    <span className="text-[13px] font-[640] tabular-nums ml-auto" style={{ color: T1 }}>{s.pct}%</span>
                  </div>
                ))}
              </div>
              <Coverage known={data.gender_known} total={data.total}
                label={tt('Estimé via guest lists', 'Estimated via guest lists', 'Estimado vía guest lists')} />
            </>
          ) : (
            <p className="text-[13px]" style={{ color: T3 }}>
              {tt('Pas encore de signal de sexe (collecté en guest list).', 'No gender signal yet (collected at guest list).', 'Sin señal de sexo todavía (se recoge en guest list).')}
            </p>
          )}
        </div>

        {/* Participants count */}
        <div style={{ ...crd, padding: '20px 22px' }} className="flex flex-col">
          <h3 className="text-[15px] font-semibold mb-4 flex items-center gap-2.5" style={{ color: T1, letterSpacing: '-0.01em' }}>
            <UsersRound className="h-4 w-4 flex-none" style={{ color: RED }} />
            {tt('Participants', 'Participants', 'Participantes')}
          </h3>
          <div className="flex-1 flex flex-col items-center justify-center py-3">
            <ParticipantRing value={data.total} capacity={capacity} />
            <p className="mt-3 text-[12px] text-center" style={{ color: T3 }}>
              {fillPct != null
                ? tt(`${fillPct}% de la capacité`, `${fillPct}% of capacity`, `${fillPct}% de la capacidad`)
                : eventId
                  ? tt('À cette soirée', 'At this event', 'En este evento')
                  : tt('Sur tes événements', 'Across your events', 'En tus eventos')}
            </p>
          </div>
        </div>
      </div>

      {/* Cities */}
      {data.cities.length > 0 && (
        <div style={{ ...crd, padding: '20px 22px' }}>
          <h3 className="text-[15px] font-semibold mb-4 flex items-center gap-2.5" style={{ color: T1, letterSpacing: '-0.01em' }}>
            <MapPin className="h-4 w-4 flex-none" style={{ color: RED }} />
            {tt('Participants par ville', 'Participants by city', 'Participantes por ciudad')}
          </h3>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-x-8 gap-y-3.5">
            {data.cities.map((c, i) => (
              <BarRow key={c.city} label={c.city} count={c.count}
                pct={cityMax ? Math.round((c.count / cityMax) * 100) : 0}
                color={i === 0 ? RED : 'rgba(255,255,255,0.42)'} />
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

// ─── Participant count ring ────────────────────────────────────────────────────
// Track = the event's max capacity. Red arc = real fill (participants / capacity).
// When no capacity is configured, the arc falls back to a decorative sweep.
function ParticipantRing({ value, capacity }: { value: number; capacity: number | null }) {
  const size = 132;
  const stroke = 9;
  const r = (size - stroke) / 2;
  const c = 2 * Math.PI * r;
  const hasCap = capacity != null && capacity > 0;
  const ratio = hasCap ? Math.min(1, value / capacity!) : null;
  // ratio known → fill that fraction of the circle; otherwise keep the old decorative sweep.
  const offset = ratio != null ? c * (1 - ratio) : c * 0.18;
  return (
    <div className="relative" style={{ width: size, height: size }}>
      <svg width={size} height={size} className="-rotate-90">
        <circle cx={size / 2} cy={size / 2} r={r} fill="none" stroke={FAINT} strokeWidth={stroke} />
        {(ratio == null || ratio > 0) && (
          <circle
            cx={size / 2} cy={size / 2} r={r} fill="none" stroke={RED} strokeWidth={stroke}
            strokeLinecap="round" strokeDasharray={c} strokeDashoffset={offset}
            style={{ filter: `drop-shadow(0 0 8px ${RED}66)`, transition: 'stroke-dashoffset .6s ease' }}
          />
        )}
      </svg>
      <div className="absolute inset-0 flex flex-col items-center justify-center">
        <span className="text-[clamp(26px,4vw,34px)] font-[680] tabular-nums leading-none"
          style={{ color: T1, letterSpacing: '-0.03em' }}>
          {value.toLocaleString()}
        </span>
        {hasCap && (
          <span className="mt-1 text-[12px] font-[560] tabular-nums leading-none" style={{ color: T3 }}>
            / {capacity!.toLocaleString()}
          </span>
        )}
      </div>
    </div>
  );
}
