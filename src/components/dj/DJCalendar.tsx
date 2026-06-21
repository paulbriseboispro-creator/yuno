import { useState } from 'react';
import { format, startOfMonth, endOfMonth, startOfWeek, endOfWeek, startOfYear, endOfYear, eachDayOfInterval, eachMonthOfInterval, isSameDay, isSameMonth, addMonths, subMonths, addYears, subYears, addWeeks, subWeeks, addDays, subDays, isWithinInterval } from 'date-fns';
import { fr, enUS, es } from 'date-fns/locale';
import { ChevronLeft, ChevronRight, Calendar as CalendarIcon, Clock, Music, Plus, MapPin, Trash2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { useLanguage } from '@/contexts/LanguageContext';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Textarea } from '@/components/ui/textarea';
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle } from '@/components/ui/alert-dialog';

// ─── Yuno Design Tokens ───────────────────────────────────────────────────────
const RED       = '#E8192C';
const POS       = '#34D399';
const NEG       = '#FF5C63';
const T1        = 'rgba(255,255,255,0.96)';
const T2        = 'rgba(255,255,255,0.58)';
const T3        = 'rgba(255,255,255,0.36)';
const C_FAINT   = 'rgba(255,255,255,0.06)';
const BORDER    = 'rgba(255,255,255,0.085)';
const F_BORDER  = 'rgba(255,255,255,0.055)';
const INNER_BG  = 'rgba(255,255,255,0.032)';
const TILE_BG   = 'rgba(255,255,255,0.025)';
const CARD_BG   = 'linear-gradient(180deg,rgba(255,255,255,.045) 0%,rgba(255,255,255,.008) 100%),#0a0a0c';
const CARD_SHADOW = '0 1px 0 rgba(255,255,255,.05) inset,0 18px 40px -28px rgba(0,0,0,.9)';

type ViewMode = 'year' | 'month' | 'week' | 'day';

export interface DJSet {
  id: string;
  dj_id: string;
  event_id?: string;
  venue_id: string;
  title?: string;
  start_time: string;
  end_time: string;
  music_genre?: string;
  notes?: string;
  fee: number;
  fee_paid: boolean;
  dj?: {
    first_name: string;
    last_name: string;
    stage_name?: string;
    profile_image_url?: string;
  };
  event?: {
    title: string;
  };
  venue?: {
    name: string;
    address?: string;
  };
}

interface DJ {
  id: string;
  first_name: string;
  last_name: string;
  stage_name?: string;
}

interface Event {
  id: string;
  title: string;
  startAt: string;
  endAt?: string;
}

interface DJCalendarProps {
  sets: DJSet[];
  djs?: DJ[];
  events?: Event[];
  venueAddress?: string;
  onSetClick?: (set: DJSet) => void;
  onDateClick?: (date: Date) => void;
  onAddSet?: (set: { dj_id: string; event_id?: string; start_time: string; end_time: string; music_genre?: string; fee: number; notes?: string }) => Promise<void>;
  onDeleteSet?: (setId: string) => Promise<void>;
  showDJNames?: boolean;
  canAddSets?: boolean;
  canDeleteSets?: boolean;
}

// ─── Small pill ───────────────────────────────────────────────────────────────
function Pill({ children, tone = 'default' }: { children: React.ReactNode; tone?: 'default' | 'pos' | 'warn' | 'accent' }) {
  const style: React.CSSProperties =
    tone === 'pos' ? { background: 'rgba(52,211,153,0.1)', border: '1px solid rgba(52,211,153,0.25)', color: POS }
    : tone === 'warn' ? { background: 'rgba(234,179,8,0.08)', border: '1px solid rgba(234,179,8,0.25)', color: '#FCD34D' }
    : tone === 'accent' ? { background: 'rgba(232,25,44,0.1)', border: '1px solid rgba(232,25,44,0.25)', color: RED }
    : { background: C_FAINT, border: `1px solid ${BORDER}`, color: T2 };
  return (
    <span className="inline-flex items-center rounded-full px-2 py-0.5 text-[10px] font-semibold tabular-nums" style={style}>
      {children}
    </span>
  );
}

export function DJCalendar({ sets, djs = [], events = [], venueAddress, onSetClick, onDateClick, onAddSet, onDeleteSet, showDJNames = true, canAddSets = false, canDeleteSets = false }: DJCalendarProps) {
  const { t, language } = useLanguage();
  const [currentDate, setCurrentDate] = useState(new Date());
  const [viewMode, setViewMode] = useState<ViewMode>('month');
  const [showAddSetDialog, setShowAddSetDialog] = useState(false);
  const [showEventSelectDialog, setShowEventSelectDialog] = useState(false);
  const [addSetDate, setAddSetDate] = useState<Date>(new Date());
  const [addSetLoading, setAddSetLoading] = useState(false);
  const [selectedEventForSet, setSelectedEventForSet] = useState<Event | null>(null);
  const [setToDelete, setSetToDelete] = useState<DJSet | null>(null);
  const [deleteLoading, setDeleteLoading] = useState(false);

  // Form state for adding a new set
  const [newSetDjId, setNewSetDjId] = useState('');
  const [newSetEventId, setNewSetEventId] = useState('');
  const [newSetStartTime, setNewSetStartTime] = useState('22:00');
  const [newSetEndTime, setNewSetEndTime] = useState('02:00');
  const [newSetGenre, setNewSetGenre] = useState('');
  const [newSetFee, setNewSetFee] = useState('');
  const [newSetNotes, setNewSetNotes] = useState('');

  const dateLocale = language === 'fr' ? fr : language === 'es' ? es : enUS;

  const labels = {
    year: t('djCalendar.year'),
    month: t('djCalendar.month'),
    week: t('djCalendar.week'),
    day: t('djCalendar.day'),
    today: t('djCalendar.today'),
  };

  const navigate = (direction: 'prev' | 'next') => {
    switch (viewMode) {
      case 'year':
        setCurrentDate(direction === 'prev' ? subYears(currentDate, 1) : addYears(currentDate, 1));
        break;
      case 'month':
        setCurrentDate(direction === 'prev' ? subMonths(currentDate, 1) : addMonths(currentDate, 1));
        break;
      case 'week':
        setCurrentDate(direction === 'prev' ? subWeeks(currentDate, 1) : addWeeks(currentDate, 1));
        break;
      case 'day':
        setCurrentDate(direction === 'prev' ? subDays(currentDate, 1) : addDays(currentDate, 1));
        break;
    }
  };

  const goToToday = () => setCurrentDate(new Date());

  const getSetsForDate = (date: Date) => {
    return sets.filter(set => {
      const setStart = new Date(set.start_time);
      return isSameDay(setStart, date);
    });
  };

  const getSetsInRange = (start: Date, end: Date) => {
    return sets.filter(set => {
      const setStart = new Date(set.start_time);
      return isWithinInterval(setStart, { start, end });
    });
  };

  // Get events that occur on a specific date
  const getEventsForDate = (date: Date) => {
    return events.filter(event => {
      const eventDate = new Date(event.startAt);
      return isSameDay(eventDate, date);
    });
  };

  // Open event selection dialog first
  const handleOpenEventSelectDialog = () => {
    setShowEventSelectDialog(true);
  };

  // When an event is selected, open the add set dialog with pre-filled times
  const handleSelectEventForSet = (event: Event) => {
    const eventStart = new Date(event.startAt);
    const eventEnd = event.endAt ? new Date(event.endAt) : new Date(eventStart.getTime() + 6 * 60 * 60 * 1000); // Default 6h if no end

    setSelectedEventForSet(event);
    setAddSetDate(eventStart);
    setNewSetDjId('');
    setNewSetEventId(event.id);
    // Set default times based on event times
    setNewSetStartTime(format(eventStart, 'HH:mm'));
    setNewSetEndTime(format(eventEnd, 'HH:mm'));
    setNewSetGenre('');
    setNewSetFee('');
    setNewSetNotes('');
    setShowEventSelectDialog(false);
    setShowAddSetDialog(true);
  };

  const handleAddSet = async () => {
    if (!newSetDjId || !onAddSet) return;

    setAddSetLoading(true);
    try {
      const startDateTime = new Date(addSetDate);
      const [startH, startM] = newSetStartTime.split(':').map(Number);
      startDateTime.setHours(startH, startM, 0, 0);

      const endDateTime = new Date(addSetDate);
      const [endH, endM] = newSetEndTime.split(':').map(Number);
      endDateTime.setHours(endH, endM, 0, 0);

      // If end time is before start time, it's the next day
      if (endDateTime <= startDateTime) {
        endDateTime.setDate(endDateTime.getDate() + 1);
      }

      await onAddSet({
        dj_id: newSetDjId,
        event_id: newSetEventId, // Now required
        start_time: startDateTime.toISOString(),
        end_time: endDateTime.toISOString(),
        music_genre: newSetGenre || undefined,
        fee: parseFloat(newSetFee) || 0,
        notes: newSetNotes || undefined,
      });

      setShowAddSetDialog(false);
    } catch (error) {
      console.error('Error adding set:', error);
    } finally {
      setAddSetLoading(false);
    }
  };

  const handleDeleteSet = async () => {
    if (!setToDelete || !onDeleteSet) return;

    setDeleteLoading(true);
    try {
      await onDeleteSet(setToDelete.id);
      setSetToDelete(null);
    } catch (error) {
      console.error('Error deleting set:', error);
    } finally {
      setDeleteLoading(false);
    }
  };

  const isUpcomingSet = (set: DJSet) => {
    return new Date(set.start_time) >= new Date();
  };

  const getTitle = () => {
    switch (viewMode) {
      case 'year':
        return format(currentDate, 'yyyy', { locale: dateLocale });
      case 'month':
        return format(currentDate, 'MMMM yyyy', { locale: dateLocale });
      case 'week': {
        const weekStart = startOfWeek(currentDate, { weekStartsOn: 1 });
        const weekEnd = endOfWeek(currentDate, { weekStartsOn: 1 });
        return `${format(weekStart, 'd', { locale: dateLocale })} - ${format(weekEnd, 'd MMMM yyyy', { locale: dateLocale })}`;
      }
      case 'day':
        return format(currentDate, 'EEEE d MMMM yyyy', { locale: dateLocale });
    }
  };

  const setChipLabel = (set: DJSet) =>
    showDJNames && set.dj ? (set.dj.stage_name || `${set.dj.first_name} ${set.dj.last_name}`) : format(new Date(set.start_time), 'HH:mm');

  const renderYearView = () => {
    const months = eachMonthOfInterval({ start: startOfYear(currentDate), end: endOfYear(currentDate) });

    return (
      <div className="grid grid-cols-3 md:grid-cols-4 gap-2">
        {months.map(month => {
          const monthSets = getSetsInRange(startOfMonth(month), endOfMonth(month));
          const isCurrent = isSameMonth(month, new Date());
          return (
            <button
              key={month.toISOString()}
              onClick={() => { setCurrentDate(month); setViewMode('month'); }}
              className="text-left rounded-xl p-3 cursor-pointer transition-all duration-150 hover:bg-white/[0.05]"
              style={{ background: TILE_BG, border: isCurrent ? `1px solid rgba(232,25,44,0.4)` : `1px solid ${BORDER}` }}
            >
              <p className="text-sm font-[560] capitalize" style={{ color: T1 }}>{format(month, 'MMMM', { locale: dateLocale })}</p>
              {monthSets.length > 0 && <div className="mt-1.5"><Pill tone="accent">{monthSets.length} sets</Pill></div>}
            </button>
          );
        })}
      </div>
    );
  };

  const renderMonthView = () => {
    const monthStart = startOfMonth(currentDate);
    const monthEnd = endOfMonth(currentDate);
    const calendarStart = startOfWeek(monthStart, { weekStartsOn: 1 });
    const calendarEnd = endOfWeek(monthEnd, { weekStartsOn: 1 });

    const days = eachDayOfInterval({ start: calendarStart, end: calendarEnd });
    const weekDays = ['L', 'M', 'M', 'J', 'V', 'S', 'D'];

    return (
      <div>
        <div className="grid grid-cols-7 gap-1 mb-2">
          {weekDays.map((day, i) => (
            <div key={i} className="text-center text-[11px] font-semibold py-2" style={{ color: T3 }}>{day}</div>
          ))}
        </div>
        <div className="grid grid-cols-7 gap-1">
          {days.map(day => {
            const daySets = getSetsForDate(day);
            const isCurrentMonth = isSameMonth(day, currentDate);
            const isToday = isSameDay(day, new Date());

            return (
              <div
                key={day.toISOString()}
                onClick={() => { setCurrentDate(day); onDateClick?.(day); setViewMode('day'); }}
                className="min-h-[80px] p-1.5 rounded-lg cursor-pointer transition-colors duration-150 hover:bg-white/[0.05]"
                style={{
                  background: isCurrentMonth ? TILE_BG : 'transparent',
                  border: isToday ? `1px solid rgba(232,25,44,0.45)` : `1px solid ${F_BORDER}`,
                }}
              >
                <p className="text-[13px] font-[560] mb-1 tabular-nums" style={{ color: isCurrentMonth ? (isToday ? RED : T1) : T3 }}>
                  {format(day, 'd')}
                </p>
                <div className="space-y-0.5 overflow-hidden">
                  {daySets.slice(0, 2).map(set => (
                    <div
                      key={set.id}
                      onClick={(e) => { e.stopPropagation(); onSetClick?.(set); }}
                      className="text-[10px] rounded px-1 py-0.5 truncate cursor-pointer tabular-nums"
                      style={{ background: 'rgba(232,25,44,0.16)', color: '#FF8A93' }}
                    >
                      {setChipLabel(set)}
                    </div>
                  ))}
                  {daySets.length > 2 && <p className="text-[10px]" style={{ color: T3 }}>+{daySets.length - 2}</p>}
                </div>
              </div>
            );
          })}
        </div>
      </div>
    );
  };

  const renderWeekView = () => {
    const weekStart = startOfWeek(currentDate, { weekStartsOn: 1 });
    const weekEnd = endOfWeek(currentDate, { weekStartsOn: 1 });
    const days = eachDayOfInterval({ start: weekStart, end: weekEnd });
    const hours = Array.from({ length: 24 }, (_, i) => i);

    return (
      <div className="overflow-x-auto">
        <div className="min-w-[800px]">
          {/* Header */}
          <div className="grid grid-cols-8 gap-1 mb-2">
            <div className="w-16" />
            {days.map(day => {
              const isToday = isSameDay(day, new Date());
              return (
                <button
                  key={day.toISOString()}
                  onClick={() => { setCurrentDate(day); setViewMode('day'); }}
                  className="text-center p-2 rounded-lg cursor-pointer transition-colors duration-150 hover:bg-white/[0.05]"
                  style={isToday ? { background: RED } : { background: TILE_BG, border: `1px solid ${F_BORDER}` }}
                >
                  <p className="text-[11px] font-medium capitalize" style={{ color: isToday ? '#fff' : T3 }}>{format(day, 'EEE', { locale: dateLocale })}</p>
                  <p className="text-lg font-[640] tabular-nums" style={{ color: isToday ? '#fff' : T1 }}>{format(day, 'd')}</p>
                </button>
              );
            })}
          </div>

          {/* Time slots */}
          <div className="relative">
            {hours.map(hour => (
              <div key={hour} className="grid grid-cols-8 gap-1 h-12" style={{ borderTop: `1px solid ${F_BORDER}` }}>
                <div className="w-16 text-[11px] flex items-start justify-end pr-2 pt-1 tabular-nums" style={{ color: T3 }}>
                  {hour.toString().padStart(2, '0')}:00
                </div>
                {days.map(day => {
                  const dayHourSets = getSetsForDate(day).filter(set => new Date(set.start_time).getHours() === hour);
                  return (
                    <div key={`${day.toISOString()}-${hour}`} className="relative">
                      {dayHourSets.map(set => (
                        <div
                          key={set.id}
                          onClick={() => onSetClick?.(set)}
                          className="absolute inset-x-0 top-0 rounded px-1 py-0.5 text-[10px] truncate cursor-pointer z-10 transition-opacity hover:opacity-90"
                          style={{ background: RED, color: '#fff' }}
                        >
                          {showDJNames && set.dj ? (set.dj.stage_name || set.dj.first_name) : format(new Date(set.start_time), 'HH:mm')}
                        </div>
                      ))}
                    </div>
                  );
                })}
              </div>
            ))}
          </div>
        </div>
      </div>
    );
  };

  const renderDayView = () => {
    const hours = Array.from({ length: 24 }, (_, i) => i);
    const daySets = getSetsForDate(currentDate);

    return (
      <div className="space-y-4">
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          {/* Timeline */}
          <div className="space-y-1">
            {hours.map(hour => {
              const hourSets = daySets.filter(set => {
                const setStart = new Date(set.start_time);
                const setEnd = new Date(set.end_time);
                return setStart.getHours() <= hour && setEnd.getHours() >= hour;
              });

              return (
                <div key={hour} className="flex gap-2 h-10">
                  <div className="w-12 text-[11px] flex items-center justify-end pr-2 tabular-nums" style={{ color: T3 }}>
                    {hour.toString().padStart(2, '0')}:00
                  </div>
                  <div className="flex-1 relative pl-2" style={{ borderLeft: `1px solid ${F_BORDER}` }}>
                    {hourSets.map(set => (
                      <div
                        key={set.id}
                        onClick={() => onSetClick?.(set)}
                        className="absolute inset-y-0 left-2 right-0 rounded px-2 flex items-center text-sm cursor-pointer transition-opacity hover:opacity-90"
                        style={{ background: RED, color: '#fff' }}
                      >
                        <Music className="h-3 w-3 mr-1" />
                        <span className="truncate">{showDJNames && set.dj ? (set.dj.stage_name || `${set.dj.first_name} ${set.dj.last_name}`) : set.title}</span>
                        {set.music_genre && <span className="ml-2"><Pill>{set.music_genre}</Pill></span>}
                      </div>
                    ))}
                  </div>
                </div>
              );
            })}
          </div>

          {/* Sets list */}
          <div className="space-y-2">
            <h3 className="text-sm font-semibold" style={{ color: T1 }}>{t('djCalendar.daySets')}</h3>
            {daySets.length === 0 ? (
              <p className="text-sm" style={{ color: T3 }}>{t('djCalendar.noSetsScheduled')}</p>
            ) : (
              daySets.map(set => (
                <div key={set.id} className="rounded-xl p-3" style={{ background: INNER_BG, border: `1px solid ${BORDER}` }}>
                  <div className="flex items-start gap-3">
                    {set.dj?.profile_image_url ? (
                      <img src={set.dj.profile_image_url} alt="" className="w-10 h-10 rounded-full object-cover cursor-pointer flex-none" onClick={() => onSetClick?.(set)} />
                    ) : (
                      <div className="w-10 h-10 rounded-full flex items-center justify-center cursor-pointer flex-none"
                        style={{ background: 'rgba(232,25,44,0.1)', border: '1px solid rgba(232,25,44,0.2)' }} onClick={() => onSetClick?.(set)}>
                        <Music className="h-5 w-5" style={{ color: RED }} />
                      </div>
                    )}
                    <div className="flex-1 min-w-0 cursor-pointer" onClick={() => onSetClick?.(set)}>
                      <p className="font-[560] truncate" style={{ color: T1 }}>
                        {set.dj ? (set.dj.stage_name || `${set.dj.first_name} ${set.dj.last_name}`) : set.title}
                      </p>
                      <div className="flex items-center gap-2 text-xs tabular-nums" style={{ color: T2 }}>
                        <Clock className="h-3 w-3" style={{ color: T3 }} />
                        {format(new Date(set.start_time), 'HH:mm')} - {format(new Date(set.end_time), 'HH:mm')}
                      </div>
                      {set.music_genre && <div className="mt-1"><Pill>{set.music_genre}</Pill></div>}
                    </div>
                    <div className="flex items-center gap-2 flex-none">
                      {set.fee > 0 && (
                        <div className="text-right">
                          <p className="font-[640] tabular-nums" style={{ color: T1 }}>{set.fee} €</p>
                          <Pill tone={set.fee_paid ? 'pos' : 'warn'}>{set.fee_paid ? t('ownerDj.paid') : t('ownerDj.pending')}</Pill>
                        </div>
                      )}
                      {canDeleteSets && isUpcomingSet(set) && (
                        <button
                          onClick={(e) => { e.stopPropagation(); setSetToDelete(set); }}
                          className="flex h-8 w-8 items-center justify-center rounded-lg cursor-pointer transition-colors hover:bg-white/[0.06]"
                          style={{ color: NEG }}
                        >
                          <Trash2 className="h-4 w-4" />
                        </button>
                      )}
                    </div>
                  </div>
                </div>
              ))
            )}
          </div>
        </div>
      </div>
    );
  };

  return (
    <div className="space-y-4">
      {/* Navigation */}
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex items-center gap-2">
          <button onClick={() => navigate('prev')}
            className="flex h-9 w-9 items-center justify-center rounded-xl cursor-pointer transition-colors hover:bg-white/[0.06]"
            style={{ background: TILE_BG, border: `1px solid ${BORDER}`, color: T2 }}>
            <ChevronLeft className="h-4 w-4" />
          </button>
          <h2 className="text-base font-semibold min-w-[180px] text-center capitalize" style={{ color: T1, letterSpacing: '-0.01em' }}>{getTitle()}</h2>
          <button onClick={() => navigate('next')}
            className="flex h-9 w-9 items-center justify-center rounded-xl cursor-pointer transition-colors hover:bg-white/[0.06]"
            style={{ background: TILE_BG, border: `1px solid ${BORDER}`, color: T2 }}>
            <ChevronRight className="h-4 w-4" />
          </button>
          <button onClick={goToToday}
            className="rounded-xl px-3 py-1.5 text-[13px] font-medium cursor-pointer transition-colors hover:bg-white/[0.06]"
            style={{ color: T2 }}>
            {labels.today}
          </button>
        </div>

        <div className="flex items-center gap-2">
          {canAddSets && events.length > 0 && (
            <button onClick={handleOpenEventSelectDialog}
              className="inline-flex items-center gap-1.5 rounded-xl px-3.5 py-2 text-[13px] font-semibold cursor-pointer transition-all duration-150"
              style={{ background: RED, color: '#fff', boxShadow: `0 0 16px -5px ${RED}88` }}>
              <Plus className="h-4 w-4" />
              {t('djCalendar.addDjSet')}
            </button>
          )}
          {/* View-mode segment control */}
          <div className="inline-flex gap-0.5 p-1 rounded-xl" style={{ background: TILE_BG, border: `1px solid ${BORDER}` }}>
            {(['year', 'month', 'week', 'day'] as ViewMode[]).map(mode => (
              <button
                key={mode}
                onClick={() => setViewMode(mode)}
                className="px-3 py-1.5 rounded-lg text-[12.5px] font-medium cursor-pointer transition-all duration-150"
                style={viewMode === mode
                  ? { color: T1, background: 'linear-gradient(180deg,rgba(255,255,255,.13),rgba(255,255,255,.07))', boxShadow: '0 1px 0 rgba(255,255,255,.08) inset,0 4px 10px -6px #000' }
                  : { color: T3 }}
              >
                {labels[mode]}
              </button>
            ))}
          </div>
        </div>
      </div>

      {/* View content */}
      <div className="overflow-hidden" style={{ background: CARD_BG, border: `1px solid ${BORDER}`, borderRadius: 18, boxShadow: CARD_SHADOW, padding: 18 }}>
        {viewMode === 'year' && renderYearView()}
        {viewMode === 'month' && renderMonthView()}
        {viewMode === 'week' && renderWeekView()}
        {viewMode === 'day' && renderDayView()}
      </div>

      {/* Event Selection Dialog - First step */}
      <Dialog open={showEventSelectDialog} onOpenChange={setShowEventSelectDialog}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>{t('djCalendar.selectEventTitle')}</DialogTitle>
          </DialogHeader>

          <div className="space-y-2 py-2 max-h-[400px] overflow-y-auto">
            <p className="text-sm mb-3" style={{ color: T3 }}>{t('djCalendar.selectEventDesc')}</p>
            {events.length === 0 ? (
              <p className="text-sm text-center py-4" style={{ color: T3 }}>{t('djCalendar.noEventsAvailable')}</p>
            ) : (
              events
                .sort((a, b) => new Date(a.startAt).getTime() - new Date(b.startAt).getTime())
                .map(event => {
                  const eventDate = new Date(event.startAt);
                  const eventEnd = event.endAt ? new Date(event.endAt) : null;
                  return (
                    <button
                      key={event.id}
                      onClick={() => handleSelectEventForSet(event)}
                      className="w-full text-left rounded-xl p-3 cursor-pointer transition-colors duration-150 hover:bg-white/[0.05]"
                      style={{ background: INNER_BG, border: `1px solid ${BORDER}` }}
                    >
                      <div className="flex items-center gap-3">
                        <div className="flex-shrink-0 w-12 h-12 rounded-lg flex flex-col items-center justify-center"
                          style={{ background: 'rgba(232,25,44,0.1)', border: '1px solid rgba(232,25,44,0.2)' }}>
                          <span className="text-[10px] uppercase" style={{ color: T3 }}>{format(eventDate, 'MMM', { locale: dateLocale })}</span>
                          <span className="text-lg font-[640] tabular-nums" style={{ color: RED }}>{format(eventDate, 'd')}</span>
                        </div>
                        <div className="flex-1 min-w-0">
                          <p className="font-[560] truncate" style={{ color: T1 }}>{event.title}</p>
                          <div className="flex items-center gap-2 text-xs tabular-nums" style={{ color: T3 }}>
                            <Clock className="h-3 w-3" />
                            {format(eventDate, 'HH:mm')}
                            {eventEnd && ` - ${format(eventEnd, 'HH:mm')}`}
                          </div>
                        </div>
                        <ChevronRight className="h-4 w-4" style={{ color: T3 }} />
                      </div>
                    </button>
                  );
                })
            )}
          </div>

          <DialogFooter>
            <Button variant="outline" onClick={() => setShowEventSelectDialog(false)}>{t('djCalendar.cancelBtn')}</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Add Set Dialog - Second step */}
      <Dialog open={showAddSetDialog} onOpenChange={setShowAddSetDialog}>
        <DialogContent className="sm:max-w-lg">
          <DialogHeader>
            <DialogTitle>{t('djCalendar.addDJSetTitle')}</DialogTitle>
          </DialogHeader>

          <div className="space-y-4 py-2">
            {/* Event info banner */}
            {selectedEventForSet && (
              <div className="p-3 rounded-xl" style={{ background: 'rgba(232,25,44,0.08)', border: '1px solid rgba(232,25,44,0.2)' }}>
                <div className="flex items-center gap-3">
                  <CalendarIcon className="h-5 w-5" style={{ color: RED }} />
                  <div>
                    <p className="font-[560]" style={{ color: RED }}>{selectedEventForSet.title}</p>
                    <p className="text-xs tabular-nums" style={{ color: T3 }}>
                      {format(new Date(selectedEventForSet.startAt), 'EEEE d MMMM yyyy', { locale: dateLocale })}
                      {' • '}
                      {format(new Date(selectedEventForSet.startAt), 'HH:mm')}
                      {selectedEventForSet.endAt && ` - ${format(new Date(selectedEventForSet.endAt), 'HH:mm')}`}
                    </p>
                  </div>
                </div>
              </div>
            )}

            <div>
              <Label>{t('djCalendar.addDJSet')}</Label>
              <Select value={newSetDjId} onValueChange={setNewSetDjId}>
                <SelectTrigger>
                  <SelectValue placeholder={t('djCalendar.selectDJPlaceholder')} />
                </SelectTrigger>
                <SelectContent>
                  {djs.map(dj => (
                    <SelectItem key={dj.id} value={dj.id}>
                      {dj.stage_name || `${dj.first_name} ${dj.last_name}`}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            <div className="grid grid-cols-2 gap-3">
              <div>
                <Label>{t('djCalendar.startTimeLabel')}</Label>
                <Input type="time" value={newSetStartTime} onChange={(e) => setNewSetStartTime(e.target.value)} />
                <p className="text-[10px] mt-1" style={{ color: T3 }}>{t('djCalendar.withinRange')}</p>
              </div>
              <div>
                <Label>{t('djCalendar.endTimeLabel')}</Label>
                <Input type="time" value={newSetEndTime} onChange={(e) => setNewSetEndTime(e.target.value)} />
              </div>
            </div>

            <div>
              <Label>{t('djCalendar.musicGenre')}</Label>
              <Input value={newSetGenre} onChange={(e) => setNewSetGenre(e.target.value)} placeholder="House, Techno, Hip-Hop..." />
            </div>

            <div>
              <Label>{t('djCalendar.feeEuro')}</Label>
              <Input type="number" value={newSetFee} onChange={(e) => setNewSetFee(e.target.value)} placeholder="0" />
            </div>

            {venueAddress && (
              <div className="p-3 rounded-xl" style={{ background: INNER_BG, border: `1px solid ${BORDER}` }}>
                <div className="flex items-center gap-2 text-sm" style={{ color: T2 }}>
                  <MapPin className="h-4 w-4" style={{ color: T3 }} />
                  <span>{venueAddress}</span>
                </div>
              </div>
            )}

            <div>
              <Label>{t('djCalendar.notes')}</Label>
              <Textarea value={newSetNotes} onChange={(e) => setNewSetNotes(e.target.value)} placeholder={t('djCalendar.notesPlaceholderAlt')} rows={2} />
            </div>
          </div>

          <DialogFooter className="gap-2 sm:gap-0">
            <Button variant="outline" onClick={() => setShowAddSetDialog(false)}>{t('djCalendar.cancelBtn')}</Button>
            <Button onClick={handleAddSet} disabled={!newSetDjId || !newSetEventId || addSetLoading} style={{ background: RED, color: '#fff' }}>
              {addSetLoading ? '...' : t('djCalendar.addBtn')}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Delete Confirmation Dialog */}
      <AlertDialog open={!!setToDelete} onOpenChange={(open) => !open && setSetToDelete(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>{t('djCalendar.deleteSetTitle')}</AlertDialogTitle>
            <AlertDialogDescription asChild>
              <div>
                {setToDelete && (
                  <>
                    <span className="block font-[560]" style={{ color: T1 }}>
                      {setToDelete.dj
                        ? (setToDelete.dj.stage_name || `${setToDelete.dj.first_name} ${setToDelete.dj.last_name}`)
                        : setToDelete.title}
                    </span>
                    <span className="block text-sm tabular-nums" style={{ color: T2 }}>
                      {format(new Date(setToDelete.start_time), 'EEEE d MMMM yyyy', { locale: dateLocale })}
                      {' • '}
                      {format(new Date(setToDelete.start_time), 'HH:mm')} - {format(new Date(setToDelete.end_time), 'HH:mm')}
                    </span>
                    {setToDelete.fee > 0 && (
                      <span className="block text-sm mt-2 tabular-nums" style={{ color: T2 }}>
                        {t('djCalendar.feeDisplay')}: {setToDelete.fee} €
                        {!setToDelete.fee_paid && <span className="ml-2" style={{ color: '#FCD34D' }}>({t('djCalendar.unpaidLabel')})</span>}
                      </span>
                    )}
                  </>
                )}
                <span className="block mt-3" style={{ color: T3 }}>{t('djCalendar.deleteSetDesc')}</span>
              </div>
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={deleteLoading}>{t('djCalendar.cancelBtn')}</AlertDialogCancel>
            <AlertDialogAction
              onClick={handleDeleteSet}
              disabled={deleteLoading}
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
            >
              {deleteLoading ? t('djCalendar.deletingLabel') : t('djCalendar.deleteBtn')}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
