/**
 * « Ce soir » — le poste informé.
 *
 * Toutes les données de la soirée existaient déjà côté owner (/owner/live) ;
 * le staff n'en voyait aucune. Ce panneau montre à chaque poste CE QUI LE
 * CONCERNE : la consigne du patron, les tuiles de son métier (entrées vs
 * capacité à la porte, file et ruptures au bar, tables au VIP, dépôts au
 * vestiaire), qui d'autre est en poste, et deux gestes — appeler un poste,
 * terminer son service.
 *
 * Il porte aussi les deux rituels de la nuit : l'ouverture (NightOpening,
 * 18h-6h Paris) et le récap de fin de service (NightRecap). En journée, la
 * prise de poste reste silencieuse comme avant.
 */

import { useEffect, useMemo, useRef, useState } from 'react';
import {
  Megaphone, Radio, Moon, Users as UsersIcon, DoorOpen, ListChecks, Crown, Timer,
  Wine, PackageX, Shirt, AlertTriangle, Check, Activity,
} from 'lucide-react';
import { useLanguage } from '@/contexts/LanguageContext';
import { useStaffIdentity } from '@/hooks/useStaffIdentity';
import { useStaffNightPulse, markBriefRead } from '@/hooks/useStaffNightPulse';
import { useStaffAlerts } from '@/hooks/useStaffAlerts';
import { roleTokens, staffInitials, type StaffRole } from '@/lib/staffIdentity';
import { isNightServiceParis, nightKeyParis } from '@/lib/liveops/nightWindow';
import { emitShiftStart } from '@/lib/liveops/shiftStart';
import { NightOpening } from './NightOpening';
import { NightRecap } from './NightRecap';
import { StationCallSheet } from './StationCallSheet';

const T1     = 'rgba(255,255,255,0.96)';
const T2     = 'rgba(255,255,255,0.70)';
const T3     = 'rgba(255,255,255,0.48)';
const BORDER = 'rgba(255,255,255,0.085)';
const CARD_BG = 'linear-gradient(180deg,rgba(255,255,255,.045) 0%,rgba(255,255,255,.008) 100%),#0a0a0c';
const CARD_SHADOW = '0 1px 0 rgba(255,255,255,.05) inset,0 18px 40px -28px rgba(0,0,0,.9)';
const C_FAINT = 'rgba(255,255,255,0.04)';

interface Tile {
  icon: typeof DoorOpen;
  labelKey: string;
  value: string;
  /** Alerte visuelle (file qui déborde, incident...). */
  hot?: boolean;
}

interface Props {
  role: StaffRole;
}

export function StaffNightPanel({ role }: Props) {
  const { t } = useLanguage();
  const { identity, venueId, venueName } = useStaffIdentity();
  const { pulse, refetch } = useStaffNightPulse(venueId);
  const tokens = roleTokens(role);

  const userId = identity?.userId ?? null;
  useStaffAlerts({ venueId, role, userId, onBrief: refetch });

  const [callOpen, setCallOpen] = useState(false);
  const [recapOpen, setRecapOpen] = useState(false);
  const [openingDone, setOpeningDone] = useState(false);

  // ── Prise de poste ─────────────────────────────────────────────────────────
  // Journée : silencieuse (comme avant). Nuit : c'est NightOpening qui la rend
  // intentionnelle. Un remontage du dashboard ne rejoue rien (dédup serveur).
  const daytimeEmitted = useRef(false);
  useEffect(() => {
    if (!venueId || daytimeEmitted.current) return;
    if (!isNightServiceParis()) {
      daytimeEmitted.current = true;
      emitShiftStart(venueId, role);
    }
  }, [venueId, role]);

  const me = userId && pulse ? pulse.team.find((m) => m.user_id === userId) : undefined;
  const openingFlag = `yuno_night_opening_${nightKeyParis()}_${userId ?? ''}`;
  const openingSeen = useMemo(() => {
    try { return localStorage.getItem(openingFlag) === '1'; } catch { return false; }
  }, [openingFlag]);

  const showOpening =
    !openingDone &&
    !openingSeen &&
    isNightServiceParis() &&
    !!pulse &&
    !!venueId &&
    !!userId &&
    !me; // déjà en poste (ou service déjà clos) → pas de rituel

  const closeOpening = () => {
    try { localStorage.setItem(openingFlag, '1'); } catch { /* best-effort */ }
    setOpeningDone(true);
    refetch();
  };

  // ── Accusé de lecture de la consigne ───────────────────────────────────────
  const briefMarked = useRef<string | null>(null);
  useEffect(() => {
    const brief = pulse?.brief;
    if (!brief || brief.read_by_me || briefMarked.current === brief.id) return;
    briefMarked.current = brief.id;
    // Petite latence : « lu » veut dire affiché à l'écran, pas fetché.
    const timer = setTimeout(() => markBriefRead(brief.id), 1500);
    return () => clearTimeout(timer);
  }, [pulse?.brief]);

  // ── Tuiles par poste ───────────────────────────────────────────────────────
  const tiles = useMemo<Tile[]>(() => {
    if (!pulse) return [];
    const { live, expected } = pulse;
    const out: Tile[] = [];

    if (role === 'bouncer') {
      out.push({
        icon: DoorOpen,
        labelKey: 'staffnight.entries',
        value: expected.capacity ? `${live.entries} / ${expected.capacity}` : String(live.entries),
        hot: !!expected.capacity && live.entries >= expected.capacity * 0.9,
      });
      out.push({ icon: Activity, labelKey: 'staffnight.last10', value: String(live.entries_last10) });
      if (expected.guest_list > 0) {
        out.push({ icon: ListChecks, labelKey: 'staffnight.guestlist', value: `${live.gl_scanned} / ${expected.guest_list}` });
      }
      if (expected.vip_tables > 0) {
        out.push({ icon: Crown, labelKey: 'staffnight.vipTables', value: `${live.vip_arrived} / ${expected.vip_tables}` });
      }
      if (live.incidents > 0) {
        out.push({ icon: AlertTriangle, labelKey: 'staffnight.incidents', value: String(live.incidents), hot: true });
      }
    } else if (role === 'barman') {
      out.push({ icon: Wine, labelKey: 'staffnight.barQueue', value: String(live.bar_backlog), hot: live.bar_backlog >= 8 });
      out.push({
        icon: Timer,
        labelKey: 'staffnight.barOldest',
        value: live.bar_oldest_min !== null ? `${live.bar_oldest_min} ${t('staffnight.min')}` : '—',
        hot: (live.bar_oldest_min ?? 0) >= 10,
      });
      out.push({ icon: Check, labelKey: 'staffnight.barServed', value: String(live.bar_served_tonight) });
      if (live.out_of_stock.length > 0) {
        out.push({ icon: PackageX, labelKey: 'staffnight.outOfStock', value: String(live.out_of_stock.length), hot: true });
      }
      out.push({ icon: DoorOpen, labelKey: 'staffnight.entries', value: String(live.entries) });
    } else if (role === 'vip_host') {
      out.push({ icon: Crown, labelKey: 'staffnight.vipTables', value: `${live.vip_arrived} / ${expected.vip_tables}` });
      out.push({ icon: DoorOpen, labelKey: 'staffnight.entries', value: String(live.entries) });
      out.push({ icon: Activity, labelKey: 'staffnight.last10', value: String(live.entries_last10) });
      if (live.incidents > 0) {
        out.push({ icon: AlertTriangle, labelKey: 'staffnight.incidents', value: String(live.incidents), hot: true });
      }
    } else if (role === 'cloakroom') {
      out.push({ icon: Shirt, labelKey: 'staffnight.cloakActive', value: String(live.cloak_active) });
      out.push({ icon: Check, labelKey: 'staffnight.cloakReturned', value: String(live.cloak_retrieved) });
      out.push({ icon: DoorOpen, labelKey: 'staffnight.entries', value: String(live.entries) });
      out.push({ icon: Activity, labelKey: 'staffnight.last10', value: String(live.entries_last10) });
    }
    return out;
  }, [pulse, role, t]);

  // Rien de la nuit à montrer (pas de club, pouls pas encore là) : invisible.
  if (!venueId || !pulse) return null;

  const onShift = pulse.team.filter((m) => !m.ended_at);
  const outOfStockNames = role === 'barman' ? pulse.live.out_of_stock.slice(0, 4) : [];

  return (
    <>
      <div
        className="rounded-2xl p-4"
        style={{ background: CARD_BG, border: `1px solid ${BORDER}`, boxShadow: CARD_SHADOW }}
      >
        {/* En-tête : Ce soir + événement */}
        <div className="mb-3 flex items-center justify-between gap-2">
          <div className="flex min-w-0 items-center gap-2">
            <Moon className="h-3.5 w-3.5 flex-none" style={{ color: tokens.solid }} />
            <span style={{ color: T2, fontSize: 11.5, fontWeight: 600, letterSpacing: '0.03em', textTransform: 'uppercase' }}>
              {t('staffnight.title')}
            </span>
            {pulse.event && (
              <span className="min-w-0 truncate" style={{ color: T3, fontSize: 11.5 }}>
                · {pulse.event.title}
              </span>
            )}
          </div>
          <button
            type="button"
            onClick={() => setCallOpen(true)}
            className="flex min-h-[34px] flex-none items-center gap-1.5 rounded-full px-3 transition-transform active:scale-95"
            style={{ background: 'rgba(232,25,44,0.10)', border: '1px solid rgba(232,25,44,0.25)', color: '#E8192C', fontSize: 11.5, fontWeight: 600 }}
          >
            <Radio className="h-3 w-3" />
            {t('staffnight.callStation')}
          </button>
        </div>

        {/* La consigne du soir */}
        {pulse.brief && (
          <div className="mb-3 rounded-xl p-3" style={{ background: tokens.soft, border: `1px solid ${tokens.ring}` }}>
            <div className="mb-1 flex items-center gap-1.5">
              <Megaphone className="h-3 w-3" style={{ color: tokens.solid }} />
              <span style={{ color: tokens.solid, fontSize: 10.5, fontWeight: 600, letterSpacing: '0.05em', textTransform: 'uppercase' }}>
                {t('staffnight.brief')}
              </span>
            </div>
            <p style={{ color: T1, fontSize: 13, lineHeight: 1.5, whiteSpace: 'pre-wrap' }}>{pulse.brief.body}</p>
          </div>
        )}

        {/* Tuiles du poste */}
        {tiles.length > 0 && (
          <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
            {tiles.map(({ icon: Icon, labelKey, value, hot }) => (
              <div
                key={labelKey}
                className="rounded-xl p-2.5"
                style={{
                  background: hot ? 'rgba(232,25,44,0.07)' : C_FAINT,
                  border: `1px solid ${hot ? 'rgba(232,25,44,0.30)' : BORDER}`,
                }}
              >
                <div className="mb-1 flex items-center gap-1.5">
                  <Icon className="h-3 w-3 flex-none" style={{ color: hot ? '#E8192C' : tokens.solid }} />
                  <span className="truncate" style={{ color: T3, fontSize: 10 }}>{t(labelKey)}</span>
                </div>
                <p className="tabular-nums" style={{ color: hot ? '#FF5C63' : T1, fontSize: 17, fontWeight: 650, lineHeight: 1.1 }}>
                  {value}
                </p>
              </div>
            ))}
          </div>
        )}

        {/* Ruptures nominatives pour le bar */}
        {outOfStockNames.length > 0 && (
          <p className="mt-2 truncate" style={{ color: T3, fontSize: 10.5 }}>
            {t('staffnight.outOfStock')} : {outOfStockNames.join(', ')}
            {pulse.live.out_of_stock.length > outOfStockNames.length ? '…' : ''}
          </p>
        )}

        {/* Qui est en poste + terminer */}
        <div className="mt-3 flex items-center justify-between gap-2 border-t pt-3" style={{ borderColor: BORDER }}>
          <div className="flex min-w-0 items-center gap-1.5">
            <UsersIcon className="h-3 w-3 flex-none" style={{ color: T3 }} />
            {onShift.length === 0 ? (
              <span style={{ color: T3, fontSize: 11 }}>{t('staffnight.nooneOnShift')}</span>
            ) : (
              <div className="flex min-w-0 items-center gap-1">
                <div className="flex -space-x-1.5">
                  {onShift.slice(0, 5).map((m) => (
                    <div
                      key={m.user_id}
                      className="flex h-6 w-6 items-center justify-center overflow-hidden rounded-full"
                      style={{ background: '#141416', border: `1.5px solid #0a0a0c` }}
                      title={m.name}
                    >
                      {m.avatar_url ? (
                        <img src={m.avatar_url} alt="" className="h-full w-full object-cover" loading="lazy" />
                      ) : (
                        <span style={{ color: T2, fontSize: 8.5, fontWeight: 700 }}>{staffInitials(m.name)}</span>
                      )}
                    </div>
                  ))}
                </div>
                <span className="truncate" style={{ color: T3, fontSize: 11 }}>
                  {t('staffnight.onShift').replace('{count}', String(onShift.length))}
                </span>
              </div>
            )}
          </div>

          {me && !me.ended_at && (
            <button
              type="button"
              onClick={() => setRecapOpen(true)}
              className="flex min-h-[34px] flex-none items-center gap-1.5 rounded-full px-3 transition-transform active:scale-95"
              style={{ background: C_FAINT, border: `1px solid ${BORDER}`, color: T2, fontSize: 11.5, fontWeight: 600 }}
            >
              <Moon className="h-3 w-3" />
              {t('staffnight.endShift')}
            </button>
          )}
        </div>
      </div>

      <StationCallSheet open={callOpen} onClose={() => setCallOpen(false)} myRole={role} />

      {showOpening && identity && (
        <NightOpening
          open
          onClose={closeOpening}
          role={role}
          venueId={venueId}
          venueName={venueName}
          firstName={identity.firstName ?? identity.name}
          pulse={pulse}
        />
      )}

      {userId && (
        <NightRecap
          open={recapOpen}
          onClose={() => { setRecapOpen(false); refetch(); }}
          role={role}
          venueId={venueId}
          userId={userId}
          pulse={pulse}
        />
      )}
    </>
  );
}
