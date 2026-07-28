import { useMemo } from 'react';
import {
  DoorOpen, MapPin, Bell, ClipboardList, TrendingUp, ChevronRight, CheckCircle2,
} from 'lucide-react';
import { useLanguage } from '@/contexts/LanguageContext';
import {
  ServiceReservation, ServiceOrder, TableServiceInfo, fmtEuro, fmtAge,
} from './serviceTypes';

const T1 = 'rgba(255,255,255,0.96)';
const T2 = 'rgba(255,255,255,0.58)';
const T3 = 'rgba(255,255,255,0.36)';
const C_FAINT = 'rgba(255,255,255,0.06)';
const BORDER = 'rgba(255,255,255,0.085)';
const RED = '#E8192C';
const GOLD = '#E7C15A';
const CARD_BG = 'linear-gradient(180deg,rgba(255,255,255,.045) 0%,rgba(255,255,255,.008) 100%),#0a0a0c';

type Tone = 'urgent' | 'gold' | 'normal';
type Kind = 'seat' | 'pending' | 'preorder' | 'under-min' | 'plan-place' | 'plan-request' | 'plan-preorder';

interface ActionItem {
  key: string;
  kind: Kind;
  label: string;
  sub: string;
  priority: number;
  tone: Tone;
  onTap: () => void;
}

const TONE: Record<Tone, { fg: string; ring: string; bg: string }> = {
  urgent: { fg: '#FCA5A5', ring: 'rgba(232,25,44,0.4)', bg: 'rgba(232,25,44,0.09)' },
  gold: { fg: GOLD, ring: 'rgba(231,193,90,0.4)', bg: 'rgba(231,193,90,0.08)' },
  normal: { fg: T2, ring: BORDER, bg: C_FAINT },
};

const ICON: Record<Kind, typeof DoorOpen> = {
  seat: DoorOpen,
  pending: Bell,
  preorder: ClipboardList,
  'under-min': TrendingUp,
  'plan-place': MapPin,
  'plan-request': MapPin,
  'plan-preorder': ClipboardList,
};

const MAX_VISIBLE = 7;

interface VipHomeTabProps {
  reservations: ServiceReservation[];
  serviceInfo: Map<string, TableServiceInfo>;
  orders: ServiceOrder[];
  isPlanning: boolean;
  /** Ouvre le sélecteur de place (installation / pré-placement). */
  onSeat: (r: ServiceReservation) => void;
  /** Ouvre le détail d'une table (commandes, pré-commandes, minimum). */
  onSelect: (r: ServiceReservation) => void;
  /** Bascule vers l'onglet Tables (voir toute la liste). */
  onGoToTables: () => void;
}

/**
 * L'onglet Accueil : le poste de commande stratégique de l'hôte VIP. Il ne sert
 * PAS à faire le service (c'est la Salle), il dit CE QU'IL FAUT FAIRE — à
 * installer, demandes de table à honorer, commandes et pré-commandes à valider,
 * tables sous le minimum. Adapté à la préparation (avant l'ouverture) comme au
 * direct. Chaque ligne est un raccourci vers le bon geste.
 */
export function VipHomeTab({ reservations, serviceInfo, isPlanning, onSeat, onSelect, onGoToTables }: VipHomeTabProps) {
  const { t } = useLanguage();

  const items = useMemo<ActionItem[]>(() => {
    const out: ActionItem[] = [];
    const persons = (n: number) => `${n} ${t('vipnight.persons')}`;

    reservations.forEach(r => {
      const info = serviceInfo.get(r.id);
      if (!info) return;
      if (['finished', 'no_show', 'denied'].includes(r.vipStatus)) return;

      if (isPlanning) {
        if (r.placementStatus === 'requested' && !r.assignedTableId && r.requestedTableName) {
          out.push({
            key: `req-${r.id}`, kind: 'plan-request', priority: 1, tone: 'gold',
            label: t('vipnight.todoPlanRequest').replace('{name}', r.fullName).replace('{table}', r.requestedTableName),
            sub: persons(r.guestCount), onTap: () => onSeat(r),
          });
        } else if (!r.assignedTableId) {
          out.push({
            key: `place-${r.id}`, kind: 'plan-place', priority: 2, tone: 'normal',
            label: t('vipnight.todoPlanPlace').replace('{name}', r.fullName),
            sub: r.zoneName ? `${persons(r.guestCount)} · ${r.zoneName}` : persons(r.guestCount),
            onTap: () => onSeat(r),
          });
        }
        if (info.preorders > 0) {
          out.push({
            key: `ppre-${r.id}`, kind: 'plan-preorder', priority: 3, tone: 'gold',
            label: t('vipnight.todoPlanPreorder').replace('{name}', r.fullName),
            sub: `${info.preorders}× ${t('vipnight.statusPreorder')}`, onTap: () => onSelect(r),
          });
        }
        return;
      }

      // ── En direct ──
      if (info.toSeat) {
        out.push({
          key: `seat-${r.id}`, kind: 'seat', priority: 0, tone: 'urgent',
          label: r.requestedTableName
            ? t('vipnight.todoSeatReq').replace('{name}', r.fullName).replace('{table}', r.requestedTableName)
            : t('vipnight.todoSeat').replace('{name}', r.fullName),
          sub: r.checkedInAt ? t('vipnight.arrivedAgo').replace('{time}', fmtAge(r.checkedInAt)) : persons(r.guestCount),
          onTap: () => onSeat(r),
        });
      }
      if (info.pendingOrders > 0) {
        out.push({
          key: `pend-${r.id}`, kind: 'pending', priority: 2, tone: 'urgent',
          label: t('vipnight.todoPending').replace('{name}', r.fullName),
          sub: `${info.pendingOrders}× ${t('vipnight.statusPending')}`, onTap: () => onSelect(r),
        });
      }
      if (info.preorders > 0 && r.hasArrived) {
        out.push({
          key: `pre-${r.id}`, kind: 'preorder', priority: 3, tone: 'gold',
          label: t('vipnight.todoPreorder').replace('{name}', r.fullName),
          sub: `${info.preorders}× ${t('vipnight.statusPreorder')}`, onTap: () => onSelect(r),
        });
      }
      if (r.vipStatus === 'active' && info.minimum > 0 && !info.minReached) {
        out.push({
          key: `min-${r.id}`, kind: 'under-min', priority: 5, tone: 'normal',
          label: t('vipnight.todoUnderMin').replace('{name}', r.fullName).replace('{amount}', fmtEuro(Math.max(0, info.minimum - info.consumed))),
          sub: r.assignedTableName || r.zoneName, onTap: () => onSelect(r),
        });
      }
    });

    out.sort((a, b) => a.priority - b.priority);
    return out;
  }, [reservations, serviceInfo, isPlanning, t, onSeat, onSelect]);

  const visible = items.slice(0, MAX_VISIBLE);
  const overflow = items.length - visible.length;

  return (
    <div className="rounded-2xl p-3.5" style={{ background: CARD_BG, border: `1px solid ${BORDER}` }}>
      <div className="mb-2.5 flex items-center justify-between">
        <p className="flex items-center gap-1.5" style={{ color: T2, fontSize: 11.5, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.06em' }}>
          <CheckCircle2 className="h-3.5 w-3.5" style={{ color: items.length ? RED : 'rgb(52,211,153)' }} />
          {t('vipnight.todoTitle')}
        </p>
        {items.length > 0 && (
          <span className="tabular-nums" style={{ color: T3, fontSize: 11, fontWeight: 600 }}>{items.length}</span>
        )}
      </div>

      {items.length === 0 ? (
        <div className="flex flex-col items-center gap-1.5 py-6 text-center">
          <CheckCircle2 className="h-7 w-7" style={{ color: 'rgba(52,211,153,0.8)' }} />
          <p style={{ color: T1, fontSize: 13, fontWeight: 600 }}>
            {isPlanning ? t('vipnight.todoEmptyPlan') : t('vipnight.todoEmptyLive')}
          </p>
        </div>
      ) : (
        <div className="space-y-2">
          {visible.map(item => {
            const Icon = ICON[item.kind];
            const tone = TONE[item.tone];
            return (
              <button
                key={item.key}
                type="button"
                onClick={item.onTap}
                className="flex w-full cursor-pointer items-center gap-2.5 rounded-xl p-2.5 text-left transition-all duration-150 active:scale-[0.99]"
                style={{ background: tone.bg, border: `1px solid ${tone.ring}` }}
              >
                <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg" style={{ background: 'rgba(0,0,0,0.25)' }}>
                  <Icon className="h-4 w-4" style={{ color: tone.fg }} />
                </span>
                <span className="min-w-0 flex-1">
                  <span className="block truncate" style={{ color: T1, fontSize: 13, fontWeight: 600 }}>{item.label}</span>
                  <span className="block truncate" style={{ color: T3, fontSize: 11 }}>{item.sub}</span>
                </span>
                <ChevronRight className="h-4 w-4 shrink-0" style={{ color: T3 }} />
              </button>
            );
          })}

          {overflow > 0 && (
            <button
              type="button"
              onClick={onGoToTables}
              className="flex w-full cursor-pointer items-center justify-center gap-1 rounded-xl py-2.5 text-center transition-all duration-150"
              style={{ background: C_FAINT, border: `1px solid ${BORDER}`, color: T2, fontSize: 12, fontWeight: 600 }}
            >
              {t('vipnight.todoMore').replace('{count}', String(overflow))}
              <ChevronRight className="h-3.5 w-3.5" />
            </button>
          )}
        </div>
      )}
    </div>
  );
}
