import { useMemo, useState } from 'react';
import { Input } from '@/components/ui/input';
import { Search, Users, Bell, MapPin, DoorOpen, ChevronDown } from 'lucide-react';
import { useLanguage } from '@/contexts/LanguageContext';
import { CreditGauge } from './CreditGauge';
import {
  ServiceReservation, TableServiceInfo, reservationPriority, fmtAge, timeHM,
} from './serviceTypes';

const T1 = 'rgba(255,255,255,0.96)';
const T2 = 'rgba(255,255,255,0.58)';
const T3 = 'rgba(255,255,255,0.36)';
const BORDER = 'rgba(255,255,255,0.085)';
const RED = '#E8192C';
const GOLD = '#E7C15A';

interface ServiceTablesTabProps {
  reservations: ServiceReservation[];
  serviceInfo: Map<string, TableServiceInfo>;
  disabled: boolean;
  onSelect: (r: ServiceReservation) => void;
  onSeat: (r: ServiceReservation) => void;
}

function GuestRow({
  r,
  info,
  onSelect,
  onSeat,
  disabled,
}: {
  r: ServiceReservation;
  info: TableServiceInfo;
  onSelect: () => void;
  onSeat: () => void;
  disabled: boolean;
}) {
  const { t } = useLanguage();
  const seated = r.vipStatus === 'placed' || r.vipStatus === 'active';
  const closed = ['finished', 'no_show', 'denied'].includes(r.vipStatus);

  return (
    <div
      className="cursor-pointer rounded-2xl p-3 transition-all duration-150"
      style={{
        background: 'linear-gradient(180deg,rgba(255,255,255,.045) 0%,rgba(255,255,255,.008) 100%),#0a0a0c',
        border: `1px solid ${info.toSeat ? 'rgba(231,193,90,0.45)' : info.pendingOrders > 0 ? 'rgba(232,25,44,0.35)' : BORDER}`,
        opacity: closed ? 0.55 : 1,
      }}
      onClick={onSelect}
    >
      <div className="flex items-center gap-2.5">
        <div className="min-w-0 flex-1">
          <p className="truncate" style={{ color: T1, fontSize: 14, fontWeight: 700, letterSpacing: '-0.01em' }}>
            {r.fullName}
          </p>
          <p className="mt-0.5 flex flex-wrap items-center gap-x-2 gap-y-0.5" style={{ color: T3, fontSize: 11 }}>
            <span className="inline-flex items-center gap-1">
              <span className="inline-block h-1.5 w-1.5 rounded-full" style={{ background: r.zoneColor }} />
              {r.zoneName}
              {r.assignedTableName && <span style={{ color: T2, fontWeight: 600 }}>→ {r.assignedTableName}</span>}
            </span>
            <span className="inline-flex items-center gap-0.5 tabular-nums">
              <Users className="h-3 w-3" /> {r.guestCount}
            </span>
            {info.toSeat && r.checkedInAt && (
              <span className="tabular-nums" style={{ color: GOLD }}>
                {t('vipnight.arrivedAgo').replace('{time}', fmtAge(r.checkedInAt))}
              </span>
            )}
            {!r.hasArrived && r.vipStatus === 'waiting' && r.requestedTableName && (
              <span className="inline-flex items-center gap-0.5" style={{ color: '#FCA5A5' }}>
                <MapPin className="h-3 w-3" />
                {r.requestedTableName}
              </span>
            )}
            {closed && r.finishedAt && <span className="tabular-nums">{timeHM(r.finishedAt)}</span>}
          </p>
        </div>

        <div className="flex shrink-0 items-center gap-1.5">
          {info.pendingOrders > 0 && (
            <span
              className="flex h-6 items-center gap-1 rounded-full px-2 text-[10px] font-bold tabular-nums"
              style={{ background: 'rgba(232,25,44,0.14)', color: '#FCA5A5', border: '1px solid rgba(232,25,44,0.4)' }}
            >
              <Bell className="h-3 w-3" />
              {info.pendingOrders}
            </span>
          )}
          {info.preorders > 0 && (
            <span
              className="h-2.5 w-2.5 rounded-full"
              style={{ background: GOLD, boxShadow: '0 0 6px rgba(231,193,90,0.7)' }}
              title={t('vipnight.preordersToValidate')}
            />
          )}
          {(info.toSeat || (r.vipStatus === 'waiting' && !r.hasArrived)) && (
            <button
              type="button"
              disabled={disabled}
              onClick={e => {
                e.stopPropagation();
                onSeat();
              }}
              className="flex h-9 cursor-pointer items-center gap-1.5 rounded-lg px-3 text-xs font-semibold transition-all duration-150 disabled:opacity-40"
              style={
                info.toSeat
                  ? { background: RED, color: '#fff' }
                  : { background: 'rgba(255,255,255,0.05)', border: `1px solid ${BORDER}`, color: T1 }
              }
            >
              <DoorOpen className="h-3.5 w-3.5" />
              {t('vipnight.seat')}
            </button>
          )}
        </div>
      </div>

      {seated && (
        <div className="mt-2.5">
          <CreditGauge consumed={info.consumed} budget={info.budget} minimum={info.minimum} compact />
        </div>
      )}
    </div>
  );
}

/**
 * La liste des tables triée par « qui a besoin de moi » : à installer et
 * commandes en attente d'abord, puis les tables en service, les attendus,
 * et les clôturées repliées.
 */
export function ServiceTablesTab({ reservations, serviceInfo, disabled, onSelect, onSeat }: ServiceTablesTabProps) {
  const { t } = useLanguage();
  const [search, setSearch] = useState('');
  const [showClosed, setShowClosed] = useState(false);

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return reservations;
    return reservations.filter(
      r => r.fullName.toLowerCase().includes(q) || (r.assignedTableName || '').toLowerCase().includes(q)
    );
  }, [reservations, search]);

  const groups = useMemo(() => {
    const needsAction: ServiceReservation[] = [];
    const inService: ServiceReservation[] = [];
    const expected: ServiceReservation[] = [];
    const closed: ServiceReservation[] = [];
    filtered.forEach(r => {
      const info = serviceInfo.get(r.id)!;
      const p = reservationPriority(r, info);
      if (['finished', 'no_show', 'denied'].includes(r.vipStatus)) closed.push(r);
      else if (p <= 3) needsAction.push(r);
      else if (r.vipStatus === 'waiting') expected.push(r);
      else inService.push(r);
    });
    return { needsAction, inService, expected, closed };
  }, [filtered, serviceInfo]);

  const sectionTitle = (label: string, count: number, accent?: string) => (
    <p
      className="flex items-center gap-2 px-1 pt-1"
      style={{ color: accent || T3, fontSize: 11, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.08em' }}
    >
      {label}
      <span className="tabular-nums" style={{ color: T3, fontWeight: 600 }}>{count}</span>
    </p>
  );

  const renderRows = (list: ServiceReservation[]) =>
    list.map(r => (
      <GuestRow
        key={r.id}
        r={r}
        info={serviceInfo.get(r.id)!}
        disabled={disabled}
        onSelect={() => onSelect(r)}
        onSeat={() => onSeat(r)}
      />
    ));

  return (
    <div className="space-y-2.5">
      <div className="relative">
        <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2" style={{ color: T3 }} />
        <Input
          value={search}
          onChange={e => setSearch(e.target.value)}
          placeholder={t('vipnight.searchGuest')}
          className="h-10 pl-9"
        />
      </div>

      {filtered.length === 0 && (
        <p className="py-10 text-center text-sm" style={{ color: T3 }}>
          {t('vipnight.emptyNight')}
        </p>
      )}

      {groups.needsAction.length > 0 && (
        <>
          {sectionTitle(t('vipnight.actionNeeded'), groups.needsAction.length, '#FCA5A5')}
          {renderRows(groups.needsAction)}
        </>
      )}
      {groups.inService.length > 0 && (
        <>
          {sectionTitle(t('vipnight.inService'), groups.inService.length)}
          {renderRows(groups.inService)}
        </>
      )}
      {groups.expected.length > 0 && (
        <>
          {sectionTitle(t('vipnight.expected'), groups.expected.length)}
          {renderRows(groups.expected)}
        </>
      )}
      {groups.closed.length > 0 && (
        <>
          <button
            type="button"
            className="flex w-full cursor-pointer items-center justify-between px-1 pt-1"
            onClick={() => setShowClosed(s => !s)}
          >
            <span style={{ color: T3, fontSize: 11, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.08em' }}>
              {t('vipnight.closed')} <span className="tabular-nums">{groups.closed.length}</span>
            </span>
            <ChevronDown
              className="h-4 w-4 transition-transform duration-150"
              style={{ color: T3, transform: showClosed ? 'rotate(180deg)' : 'none' }}
            />
          </button>
          {showClosed && renderRows(groups.closed)}
        </>
      )}
    </div>
  );
}
