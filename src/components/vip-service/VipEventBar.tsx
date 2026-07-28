import { useLanguage } from '@/contexts/LanguageContext';
import { CalendarClock, Users, Crown, MapPin, ClipboardList } from 'lucide-react';
import type { VipEventOption } from './serviceTypes';

const T1 = 'rgba(255,255,255,0.96)';
const T2 = 'rgba(255,255,255,0.58)';
const T3 = 'rgba(255,255,255,0.36)';
const C_FAINT = 'rgba(255,255,255,0.06)';
const BORDER = 'rgba(255,255,255,0.085)';
const RED = '#E8192C';
const GOLD = '#E7C15A';

const LOCALES: Record<string, string> = { fr: 'fr-FR', en: 'en-US', es: 'es-ES' };

/**
 * Index de « nuit » (frontière 6 h locale, comme get_staff_night_pulse) : une
 * soirée qui démarre à 00 h 00 appartient à la nuit de la veille, pas au
 * lendemain. Deux soirées de la même nuit partagent le même index.
 */
const NIGHT_SHIFT_MS = 6 * 60 * 60 * 1000;
function nightIndex(iso: string): number {
  const d = new Date(new Date(iso).getTime() - NIGHT_SHIFT_MS);
  return Math.floor(new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime() / 86_400_000);
}

interface PrepStats {
  total: number;
  placed: number;
  requests: number;
  preorders: number;
  guests: number;
}

interface VipEventBarProps {
  events: VipEventOption[];
  selectedEventId: string | null;
  isPlanning: boolean;
  prep: PrepStats;
  onSelect: (id: string) => void;
}

/**
 * Barre de préparation de l'hôte VIP : le sélecteur des soirées (en cours + à
 * venir) et, quand la soirée choisie n'a pas encore commencé, le bandeau de
 * préparation avec l'état des placements. C'est ce qui transforme l'écran en
 * outil d'organisation des résas AVANT la nuit, pas seulement en direct.
 */
export function VipEventBar({ events, selectedEventId, isPlanning, prep, onSelect }: VipEventBarProps) {
  const { t, language } = useLanguage();
  const locale = LOCALES[language] || 'en-US';
  const todayNight = nightIndex(new Date().toISOString());

  const chip = (ev: VipEventOption) => {
    const d = new Date(ev.startAt);
    const time = `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
    const diff = nightIndex(ev.startAt) - todayNight;
    const day =
      diff <= 0
        ? t('vipnight.tonight')
        : diff === 1
          ? t('vipnight.tomorrow')
          : new Intl.DateTimeFormat(locale, { weekday: 'short', day: 'numeric', month: 'short' }).format(d);
    return { day, time };
  };

  return (
    <div className="space-y-2.5">
      {events.length > 1 && (
        <div>
          <p
            className="mb-1.5 flex items-center gap-1.5 px-1"
            style={{ color: T3, fontSize: 11, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.08em' }}
          >
            <CalendarClock className="h-3.5 w-3.5" />
            {t('vipnight.eventsToPrep')}
          </p>
          <div className="scrollbar-none -mx-1 flex gap-2 overflow-x-auto px-1 pb-1">
            {events.map(ev => {
              const active = ev.id === selectedEventId;
              const { day, time } = chip(ev);
              return (
                <button
                  key={ev.id}
                  type="button"
                  onClick={() => onSelect(ev.id)}
                  className="flex shrink-0 cursor-pointer flex-col items-start gap-0.5 rounded-xl px-3 py-2 text-left transition-all duration-150"
                  style={{
                    background: active ? 'rgba(232,25,44,0.12)' : C_FAINT,
                    border: `1px solid ${active ? 'rgba(232,25,44,0.55)' : BORDER}`,
                    minWidth: 116,
                  }}
                >
                  <span
                    className="tabular-nums"
                    style={{ color: active ? '#FCA5A5' : T2, fontSize: 10.5, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.04em' }}
                  >
                    {day} · {time}
                  </span>
                  <span className="max-w-[150px] truncate" style={{ color: active ? T1 : T2, fontSize: 12.5, fontWeight: 600 }}>
                    {ev.title}
                  </span>
                </button>
              );
            })}
          </div>
        </div>
      )}

      {isPlanning && (
        <div className="rounded-2xl p-3.5" style={{ background: 'rgba(231,193,90,0.06)', border: '1px solid rgba(231,193,90,0.28)' }}>
          <div className="flex items-start gap-3">
            <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl" style={{ background: 'rgba(231,193,90,0.14)' }}>
              <CalendarClock style={{ color: GOLD, width: 18, height: 18 }} />
            </div>
            <div className="min-w-0">
              <p style={{ color: T1, fontSize: 13.5, fontWeight: 700 }}>{t('vipnight.planningTitle')}</p>
              <p style={{ color: T2, fontSize: 11.5, lineHeight: 1.5, marginTop: 2 }}>{t('vipnight.planningHint')}</p>
            </div>
          </div>

          <div className="mt-3 grid grid-cols-4 gap-2">
            <PrepStat icon={Crown} label={t('vipnight.prepReservations')} value={prep.total} sub={`${prep.guests} ${t('vipnight.prepGuests')}`} />
            <PrepStat icon={MapPin} label={t('vipnight.prepPlaced')} value={`${prep.placed}/${prep.total}`} accent={prep.placed >= prep.total && prep.total > 0} />
            <PrepStat icon={Users} label={t('vipnight.prepRequests')} value={prep.requests} hot={prep.requests > 0} />
            <PrepStat icon={ClipboardList} label={t('vipnight.prepPreorders')} value={prep.preorders} hot={prep.preorders > 0} />
          </div>
        </div>
      )}
    </div>
  );
}

function PrepStat({
  icon: Icon,
  label,
  value,
  sub,
  hot,
  accent,
}: {
  icon: typeof Crown;
  label: string;
  value: number | string;
  sub?: string;
  hot?: boolean;
  accent?: boolean;
}) {
  const valueColor = hot ? '#FCA5A5' : accent ? 'rgb(52,211,153)' : T1;
  return (
    <div className="rounded-xl p-2" style={{ background: C_FAINT, border: `1px solid ${hot ? 'rgba(232,25,44,0.3)' : BORDER}` }}>
      <div className="mb-1 flex items-center gap-1">
        <Icon className="h-3 w-3 flex-none" style={{ color: hot ? RED : T3 }} />
        <span className="truncate" style={{ color: T3, fontSize: 9.5 }}>{label}</span>
      </div>
      <p className="tabular-nums" style={{ color: valueColor, fontSize: 15, fontWeight: 700, lineHeight: 1.1 }}>{value}</p>
      {sub && <p className="tabular-nums" style={{ color: T3, fontSize: 9 }}>{sub}</p>}
    </div>
  );
}
