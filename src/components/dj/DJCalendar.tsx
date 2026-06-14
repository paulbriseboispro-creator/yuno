import { useState, useMemo } from 'react';
import { format, startOfMonth, endOfMonth, startOfWeek, endOfWeek, startOfYear, endOfYear, eachDayOfInterval, eachMonthOfInterval, eachWeekOfInterval, isSameDay, isSameMonth, addMonths, subMonths, addYears, subYears, addWeeks, subWeeks, addDays, subDays, isWithinInterval, startOfDay, endOfDay } from 'date-fns';
import { fr, enUS, es } from 'date-fns/locale';
import { ChevronLeft, ChevronRight, Calendar as CalendarIcon, Clock, Music, Plus, MapPin, Euro, User, Trash2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { cn } from '@/lib/utils';
import { useLanguage } from '@/contexts/LanguageContext';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Textarea } from '@/components/ui/textarea';
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle } from '@/components/ui/alert-dialog';

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

  // Check if a date has any events
  const dateHasEvent = (date: Date) => {
    return getEventsForDate(date).length > 0;
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

  const handleOpenAddSet = (date: Date) => {
    const dateEvents = getEventsForDate(date);
    
    // If no events on this date, show error
    if (dateEvents.length === 0) {
      return; // Will be handled by the button disable state
    }
    
    // If only one event, directly open with that event
    if (dateEvents.length === 1) {
      handleSelectEventForSet(dateEvents[0]);
      return;
    }
    
    // Multiple events, let user pick
    setAddSetDate(date);
    handleOpenEventSelectDialog();
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
      case 'week':
        const weekStart = startOfWeek(currentDate, { weekStartsOn: 1 });
        const weekEnd = endOfWeek(currentDate, { weekStartsOn: 1 });
        return `${format(weekStart, 'd', { locale: dateLocale })} - ${format(weekEnd, 'd MMMM yyyy', { locale: dateLocale })}`;
      case 'day':
        return format(currentDate, 'EEEE d MMMM yyyy', { locale: dateLocale });
    }
  };

  const renderYearView = () => {
    const months = eachMonthOfInterval({
      start: startOfYear(currentDate),
      end: endOfYear(currentDate),
    });

    return (
      <div className="grid grid-cols-3 md:grid-cols-4 gap-2">
        {months.map(month => {
          const monthSets = getSetsInRange(startOfMonth(month), endOfMonth(month));
          return (
            <Card
              key={month.toISOString()}
              className={cn(
                "p-3 cursor-pointer hover:bg-muted/50 transition-colors",
                isSameMonth(month, new Date()) && "ring-2 ring-primary"
              )}
              onClick={() => {
                setCurrentDate(month);
                setViewMode('month');
              }}
            >
              <p className="font-medium text-sm">{format(month, 'MMMM', { locale: dateLocale })}</p>
              {monthSets.length > 0 && (
                <Badge variant="secondary" className="mt-1 text-xs">
                  {monthSets.length} sets
                </Badge>
              )}
            </Card>
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
            <div key={i} className="text-center text-xs text-muted-foreground font-medium py-2">
              {day}
            </div>
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
                className={cn(
                  "min-h-[80px] p-1 rounded-lg cursor-pointer transition-colors",
                  isCurrentMonth ? "bg-muted/30" : "bg-muted/10",
                  isToday && "ring-2 ring-primary",
                  "hover:bg-muted/50"
                )}
                onClick={() => {
                  setCurrentDate(day);
                  onDateClick?.(day);
                  setViewMode('day');
                }}
              >
                <p className={cn(
                  "text-sm font-medium mb-1",
                  !isCurrentMonth && "text-muted-foreground"
                )}>
                  {format(day, 'd')}
                </p>
                <div className="space-y-0.5 overflow-hidden">
                  {daySets.slice(0, 2).map(set => (
                    <div
                      key={set.id}
                      className="text-[10px] bg-primary/20 text-primary rounded px-1 py-0.5 truncate cursor-pointer"
                      onClick={(e) => {
                        e.stopPropagation();
                        onSetClick?.(set);
                      }}
                    >
                      {showDJNames && set.dj ? (set.dj.stage_name || `${set.dj.first_name} ${set.dj.last_name}`) : format(new Date(set.start_time), 'HH:mm')}
                    </div>
                  ))}
                  {daySets.length > 2 && (
                    <p className="text-[10px] text-muted-foreground">+{daySets.length - 2}</p>
                  )}
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
            {days.map(day => (
              <div
                key={day.toISOString()}
                className={cn(
                  "text-center p-2 rounded-lg cursor-pointer",
                  isSameDay(day, new Date()) && "bg-primary text-primary-foreground"
                )}
                onClick={() => {
                  setCurrentDate(day);
                  setViewMode('day');
                }}
              >
                <p className="text-xs font-medium">{format(day, 'EEE', { locale: dateLocale })}</p>
                <p className="text-lg font-bold">{format(day, 'd')}</p>
              </div>
            ))}
          </div>

          {/* Time slots */}
          <div className="relative">
            {hours.map(hour => (
              <div key={hour} className="grid grid-cols-8 gap-1 h-12 border-t border-border/50">
                <div className="w-16 text-xs text-muted-foreground flex items-start justify-end pr-2 pt-1">
                  {hour.toString().padStart(2, '0')}:00
                </div>
                {days.map(day => {
                  const dayHourSets = getSetsForDate(day).filter(set => {
                    const setHour = new Date(set.start_time).getHours();
                    return setHour === hour;
                  });

                  return (
                    <div key={`${day.toISOString()}-${hour}`} className="relative">
                      {dayHourSets.map(set => (
                        <div
                          key={set.id}
                          className="absolute inset-x-0 top-0 bg-primary/80 text-primary-foreground rounded px-1 py-0.5 text-[10px] truncate cursor-pointer hover:bg-primary z-10"
                          onClick={() => onSetClick?.(set)}
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
                  <div className="w-12 text-xs text-muted-foreground flex items-center justify-end pr-2">
                    {hour.toString().padStart(2, '0')}:00
                  </div>
                  <div className="flex-1 relative border-l border-border/50 pl-2">
                    {hourSets.map(set => (
                      <div
                        key={set.id}
                        className="absolute inset-y-0 left-2 right-0 bg-primary/80 text-primary-foreground rounded px-2 flex items-center text-sm cursor-pointer hover:bg-primary"
                        onClick={() => onSetClick?.(set)}
                      >
                        <Music className="h-3 w-3 mr-1" />
                        {showDJNames && set.dj ? (set.dj.stage_name || `${set.dj.first_name} ${set.dj.last_name}`) : set.title}
                        {set.music_genre && (
                          <Badge variant="secondary" className="ml-2 text-[10px]">{set.music_genre}</Badge>
                        )}
                      </div>
                    ))}
                  </div>
                </div>
              );
            })}
          </div>

          {/* Sets list */}
          <div className="space-y-2">
            <h3 className="font-semibold text-sm">{t('djCalendar.daySets')}</h3>
            {daySets.length === 0 ? (
              <p className="text-sm text-muted-foreground">{t('djCalendar.noSetsScheduled')}</p>
            ) : (
              daySets.map(set => (
                <Card
                  key={set.id}
                  className="p-3 hover:bg-muted/50"
                >
                  <div className="flex items-start gap-3">
                    {set.dj?.profile_image_url ? (
                      <img 
                        src={set.dj.profile_image_url} 
                        alt="" 
                        className="w-10 h-10 rounded-full object-cover cursor-pointer" 
                        onClick={() => onSetClick?.(set)}
                      />
                    ) : (
                      <div 
                        className="w-10 h-10 rounded-full bg-primary/20 flex items-center justify-center cursor-pointer"
                        onClick={() => onSetClick?.(set)}
                      >
                        <Music className="h-5 w-5 text-primary" />
                      </div>
                    )}
                    <div className="flex-1 min-w-0 cursor-pointer" onClick={() => onSetClick?.(set)}>
                      <p className="font-medium truncate">
                        {set.dj ? (set.dj.stage_name || `${set.dj.first_name} ${set.dj.last_name}`) : set.title}
                      </p>
                      <div className="flex items-center gap-2 text-xs text-muted-foreground">
                        <Clock className="h-3 w-3" />
                        {format(new Date(set.start_time), 'HH:mm')} - {format(new Date(set.end_time), 'HH:mm')}
                      </div>
                      {set.music_genre && (
                        <Badge variant="outline" className="mt-1 text-[10px]">{set.music_genre}</Badge>
                      )}
                    </div>
                    <div className="flex items-center gap-2">
                      {set.fee > 0 && (
                        <div className="text-right">
                          <p className="font-semibold">{set.fee} €</p>
                          <Badge variant={set.fee_paid ? "default" : "destructive"} className="text-[10px]">
                            {set.fee_paid ? (t('ownerDj.paid')) : (t('ownerDj.pending'))}
                          </Badge>
                        </div>
                      )}
                      {canDeleteSets && isUpcomingSet(set) && (
                        <Button
                          variant="ghost"
                          size="icon"
                          className="h-8 w-8 text-destructive hover:text-destructive hover:bg-destructive/10"
                          onClick={(e) => {
                            e.stopPropagation();
                            setSetToDelete(set);
                          }}
                        >
                          <Trash2 className="h-4 w-4" />
                        </Button>
                      )}
                    </div>
                  </div>
                </Card>
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
          <Button variant="outline" size="icon" onClick={() => navigate('prev')}>
            <ChevronLeft className="h-4 w-4" />
          </Button>
          <h2 className="text-lg font-semibold min-w-[200px] text-center capitalize">{getTitle()}</h2>
          <Button variant="outline" size="icon" onClick={() => navigate('next')}>
            <ChevronRight className="h-4 w-4" />
          </Button>
          <Button variant="ghost" size="sm" onClick={goToToday}>
            {labels.today}
          </Button>
        </div>

        <div className="flex items-center gap-2">
          {canAddSets && events.length > 0 && (
            <Button 
              size="sm" 
              onClick={handleOpenEventSelectDialog}
            >
              <Plus className="h-4 w-4 mr-2" />
              {t('djCalendar.addDjSet')}
            </Button>
          )}
          <div className="flex gap-1">
            {(['year', 'month', 'week', 'day'] as ViewMode[]).map(mode => (
              <Button
                key={mode}
                variant={viewMode === mode ? "default" : "ghost"}
                size="sm"
                onClick={() => setViewMode(mode)}
              >
                {labels[mode]}
              </Button>
            ))}
          </div>
        </div>
      </div>

      {/* View content */}
      <Card className="p-4">
        {viewMode === 'year' && renderYearView()}
        {viewMode === 'month' && renderMonthView()}
        {viewMode === 'week' && renderWeekView()}
        {viewMode === 'day' && renderDayView()}
      </Card>

      {/* Event Selection Dialog - First step */}
      <Dialog open={showEventSelectDialog} onOpenChange={setShowEventSelectDialog}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>
              {t('djCalendar.selectEventTitle')}
            </DialogTitle>
          </DialogHeader>
          
          <div className="space-y-2 py-2 max-h-[400px] overflow-y-auto">
            <p className="text-sm text-muted-foreground mb-3">
              {t('djCalendar.selectEventDesc')}
            </p>
            {events.length === 0 ? (
              <p className="text-sm text-muted-foreground text-center py-4">
                {t('djCalendar.noEventsAvailable')}
              </p>
            ) : (
              events
                .sort((a, b) => new Date(a.startAt).getTime() - new Date(b.startAt).getTime())
                .map(event => {
                  const eventDate = new Date(event.startAt);
                  const eventEnd = event.endAt ? new Date(event.endAt) : null;
                  
                  return (
                    <Card
                      key={event.id}
                      className="p-3 cursor-pointer hover:bg-muted/50 transition-colors"
                      onClick={() => handleSelectEventForSet(event)}
                    >
                      <div className="flex items-center gap-3">
                        <div className="flex-shrink-0 w-12 h-12 bg-primary/10 rounded-lg flex flex-col items-center justify-center">
                          <span className="text-xs text-muted-foreground">{format(eventDate, 'MMM', { locale: dateLocale })}</span>
                          <span className="text-lg font-bold text-primary">{format(eventDate, 'd')}</span>
                        </div>
                        <div className="flex-1 min-w-0">
                          <p className="font-medium truncate">{event.title}</p>
                          <div className="flex items-center gap-2 text-xs text-muted-foreground">
                            <Clock className="h-3 w-3" />
                            {format(eventDate, 'HH:mm')}
                            {eventEnd && ` - ${format(eventEnd, 'HH:mm')}`}
                          </div>
                        </div>
                        <ChevronRight className="h-4 w-4 text-muted-foreground" />
                      </div>
                    </Card>
                  );
                })
            )}
          </div>

          <DialogFooter>
            <Button variant="outline" onClick={() => setShowEventSelectDialog(false)}>
              {t('djCalendar.cancelBtn')}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Add Set Dialog - Second step */}
      <Dialog open={showAddSetDialog} onOpenChange={setShowAddSetDialog}>
        <DialogContent className="sm:max-w-lg">
          <DialogHeader>
            <DialogTitle>
              {t('djCalendar.addDJSetTitle')}
            </DialogTitle>
          </DialogHeader>
          
          <div className="space-y-4 py-2">
            {/* Event info banner */}
            {selectedEventForSet && (
              <div className="p-3 bg-primary/10 border border-primary/20 rounded-lg">
                <div className="flex items-center gap-3">
                  <CalendarIcon className="h-5 w-5 text-primary" />
                  <div>
                    <p className="font-medium text-primary">{selectedEventForSet.title}</p>
                    <p className="text-xs text-muted-foreground">
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
                <Input
                  type="time"
                  value={newSetStartTime}
                  onChange={(e) => setNewSetStartTime(e.target.value)}
                />
                <p className="text-[10px] text-muted-foreground mt-1">
                  {t('djCalendar.withinRange')}
                </p>
              </div>
              <div>
                <Label>{t('djCalendar.endTimeLabel')}</Label>
                <Input
                  type="time"
                  value={newSetEndTime}
                  onChange={(e) => setNewSetEndTime(e.target.value)}
                />
              </div>
            </div>

            <div>
              <Label>{t('djCalendar.musicGenre')}</Label>
              <Input
                value={newSetGenre}
                onChange={(e) => setNewSetGenre(e.target.value)}
                placeholder="House, Techno, Hip-Hop..."
              />
            </div>

            <div>
              <Label>{t('djCalendar.feeEuro')}</Label>
              <Input
                type="number"
                value={newSetFee}
                onChange={(e) => setNewSetFee(e.target.value)}
                placeholder="0"
              />
            </div>

            {venueAddress && (
              <div className="p-3 bg-muted rounded-lg">
                <div className="flex items-center gap-2 text-sm">
                  <MapPin className="h-4 w-4 text-muted-foreground" />
                  <span>{venueAddress}</span>
                </div>
              </div>
            )}

            <div>
              <Label>{t('djCalendar.notes')}</Label>
              <Textarea
                value={newSetNotes}
                onChange={(e) => setNewSetNotes(e.target.value)}
                placeholder={t('djCalendar.notesPlaceholderAlt')}
                rows={2}
              />
            </div>
          </div>

          <DialogFooter className="gap-2 sm:gap-0">
            <Button variant="outline" onClick={() => setShowAddSetDialog(false)}>
              {t('djCalendar.cancelBtn')}
            </Button>
            <Button onClick={handleAddSet} disabled={!newSetDjId || !newSetEventId || addSetLoading}>
              {addSetLoading ? '...' : t('djCalendar.addBtn')}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Delete Confirmation Dialog */}
      <AlertDialog open={!!setToDelete} onOpenChange={(open) => !open && setSetToDelete(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>
              {t('djCalendar.deleteSetTitle')}
            </AlertDialogTitle>
            <AlertDialogDescription>
              {setToDelete && (
                <>
                  <span className="block font-medium text-foreground">
                    {setToDelete.dj 
                      ? (setToDelete.dj.stage_name || `${setToDelete.dj.first_name} ${setToDelete.dj.last_name}`)
                      : setToDelete.title
                    }
                  </span>
                  <span className="block text-sm">
                    {format(new Date(setToDelete.start_time), 'EEEE d MMMM yyyy', { locale: dateLocale })}
                    {' • '}
                    {format(new Date(setToDelete.start_time), 'HH:mm')} - {format(new Date(setToDelete.end_time), 'HH:mm')}
                  </span>
                  {setToDelete.fee > 0 && (
                    <span className="block text-sm mt-2">
                      {t('djCalendar.feeDisplay')}: {setToDelete.fee} €
                      {!setToDelete.fee_paid && (
                        <span className="text-orange-500 ml-2">
                          ({t('djCalendar.unpaidLabel')})
                        </span>
                      )}
                    </span>
                  )}
                </>
              )}
              <span className="block mt-3 text-muted-foreground">
                {t('djCalendar.deleteSetDesc')}
              </span>
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={deleteLoading}>
              {t('djCalendar.cancelBtn')}
            </AlertDialogCancel>
            <AlertDialogAction
              onClick={handleDeleteSet}
              disabled={deleteLoading}
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
            >
              {deleteLoading 
                ? t('djCalendar.deletingLabel') 
                : t('djCalendar.deleteBtn')}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
