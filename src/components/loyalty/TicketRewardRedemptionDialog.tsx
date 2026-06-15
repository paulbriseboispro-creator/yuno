import { useState, useEffect, useMemo } from 'react';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { ArrowLeft, Calendar, Check, Loader2, Ticket } from 'lucide-react';
import { motion, AnimatePresence } from 'framer-motion';
import { supabase } from '@/integrations/supabase/client';
import { useLanguage } from '@/contexts/LanguageContext';
import { cn } from '@/lib/utils';

interface Event {
  id: string;
  title: string;
  start_at: string;
  poster_url: string | null;
}

interface TicketRound {
  id: string;
  name: string;
  price: number;
  max_tickets: number;
  tickets_sold: number;
  is_active: boolean;
}

interface TicketRewardRedemptionDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  venueId: string;
  rewardName: string;
  rewardId: string;
  pointsRequired: number;
  maxTicketValue?: number; // Max ticket price allowed (if set by owner)
  onConfirm: (eventId: string, roundId: string, eventTitle: string, roundName: string) => Promise<void>;
}

type Step = 'event' | 'round' | 'confirm';

export function TicketRewardRedemptionDialog({
  open,
  onOpenChange,
  venueId,
  rewardName,
  rewardId,
  pointsRequired,
  maxTicketValue,
  onConfirm
}: TicketRewardRedemptionDialogProps) {
  const { t, language } = useLanguage();
  const [step, setStep] = useState<Step>('event');
  const [events, setEvents] = useState<Event[]>([]);
  const [rounds, setRounds] = useState<TicketRound[]>([]);
  const [selectedEvent, setSelectedEvent] = useState<Event | null>(null);
  const [selectedRound, setSelectedRound] = useState<TicketRound | null>(null);
  const [loading, setLoading] = useState(false);
  const [loadingRounds, setLoadingRounds] = useState(false);
  const [confirming, setConfirming] = useState(false);

  useEffect(() => {
    if (open && venueId) {
      fetchEvents();
    }
  }, [open, venueId]);

  useEffect(() => {
    if (!open) {
      setStep('event');
      setSelectedEvent(null);
      setSelectedRound(null);
      setRounds([]);
    }
  }, [open]);

  useEffect(() => {
    if (selectedEvent) {
      fetchRounds(selectedEvent.id);
    }
  }, [selectedEvent]);

  const fetchEvents = async () => {
    setLoading(true);
    try {
      const { data: eventsData } = await supabase
        .from('events')
        .select('id, title, start_at, poster_url')
        .eq('venue_id', venueId)
        .eq('is_active', true)
        .eq('ticketing_enabled', true)
        .gte('start_at', new Date().toISOString())
        .order('start_at', { ascending: true })
        .limit(20);

      setEvents(eventsData || []);
    } catch (error) {
      console.error('Error fetching events:', error);
    } finally {
      setLoading(false);
    }
  };

  const fetchRounds = async (eventId: string) => {
    setLoadingRounds(true);
    try {
      const { data: roundsData } = await supabase
        .from('ticket_rounds')
        .select('id, name, price, max_tickets, tickets_sold, is_active')
        .eq('event_id', eventId)
        .eq('is_active', true)
        .order('position', { ascending: true });

      setRounds(roundsData || []);
    } catch (error) {
      console.error('Error fetching rounds:', error);
    } finally {
      setLoadingRounds(false);
    }
  };

  // Filter rounds by maxTicketValue if set
  const filteredRounds = useMemo(() => {
    if (!maxTicketValue) return rounds;
    return rounds.filter(r => r.price <= maxTicketValue);
  }, [rounds, maxTicketValue]);

  const handleConfirm = async () => {
    if (!selectedEvent || !selectedRound) return;
    
    setConfirming(true);
    try {
      await onConfirm(selectedEvent.id, selectedRound.id, selectedEvent.title, selectedRound.name);
      onOpenChange(false);
    } catch (error) {
      console.error('Error confirming redemption:', error);
    } finally {
      setConfirming(false);
    }
  };

  const formatEventDate = (dateStr: string) => {
    return new Date(dateStr).toLocaleDateString(language === 'es' ? 'es-ES' : language === 'fr' ? 'fr-FR' : 'en-US', {
      weekday: 'short',
      month: 'short',
      day: 'numeric',
      hour: '2-digit',
      minute: '2-digit'
    });
  };

  const getTitle = () => {
    switch (step) {
      case 'event': return t('ticketRedeem.chooseEvent');
      case 'round': return t('ticketRedeem.chooseRound');
      case 'confirm': return t('ticketRedeem.confirmChoice');
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-md max-h-[85vh] flex flex-col p-0 overflow-hidden">
        <DialogHeader className="px-5 pt-5 pb-3 border-b shrink-0">
          <div className="flex items-center gap-3">
            {step !== 'event' && (
              <Button
                variant="ghost"
                size="icon"
                className="h-8 w-8 shrink-0"
                onClick={() => setStep(step === 'confirm' ? 'round' : 'event')}
              >
                <ArrowLeft className="h-4 w-4" />
              </Button>
            )}
            <DialogTitle className="flex-1">{getTitle()}</DialogTitle>
          </div>
          <div className="flex items-center gap-2 mt-2">
            <span className="text-sm text-muted-foreground">{rewardName}</span>
            <span className="text-xs bg-primary/10 text-primary px-2 py-0.5 rounded-full">
              {pointsRequired} {t('ticketRedeem.points')}
            </span>
            {maxTicketValue && (
              <span className="text-xs bg-muted text-muted-foreground px-2 py-0.5 rounded-full">
                {t('ticketRedeem.maxValue')}: {maxTicketValue}€
              </span>
            )}
          </div>
        </DialogHeader>

        <div className="flex-1 min-h-0 overflow-y-auto px-5 py-4">
          <AnimatePresence mode="wait">
            {step === 'event' && (
              <motion.div
                key="event"
                initial={{ opacity: 0, x: 20 }}
                animate={{ opacity: 1, x: 0 }}
                exit={{ opacity: 0, x: -20 }}
                className="space-y-2"
              >
                {loading ? (
                  <div className="flex justify-center py-8">
                    <Loader2 className="h-8 w-8 animate-spin text-primary" />
                  </div>
                ) : events.length === 0 ? (
                  <p className="text-center text-muted-foreground py-8">{t('ticketRedeem.noEvents')}</p>
                ) : (
                  events.map(event => (
                    <motion.button
                      key={event.id}
                      whileTap={{ scale: 0.98 }}
                      onClick={() => setSelectedEvent(event)}
                      className={cn(
                        'w-full flex items-center gap-3 p-3 rounded-xl border transition-all text-left',
                        selectedEvent?.id === event.id
                          ? 'border-primary bg-primary/10'
                          : 'border-border hover:border-primary/50'
                      )}
                    >
                      {event.poster_url ? (
                        <img
                          src={event.poster_url}
                          alt={event.title}
                          className="w-12 h-12 object-cover rounded-lg"
                        />
                      ) : (
                        <div className="w-12 h-12 rounded-lg bg-muted flex items-center justify-center">
                          <Calendar className="h-5 w-5 text-muted-foreground" />
                        </div>
                      )}
                      <div className="flex-1 min-w-0">
                        <p className="font-medium truncate">{event.title}</p>
                        <p className="text-sm text-muted-foreground">{formatEventDate(event.start_at)}</p>
                      </div>
                      {selectedEvent?.id === event.id && (
                        <div className="h-6 w-6 rounded-full bg-primary flex items-center justify-center">
                          <Check className="h-4 w-4 text-primary-foreground" />
                        </div>
                      )}
                    </motion.button>
                  ))
                )}
              </motion.div>
            )}

            {step === 'round' && (
              <motion.div
                key="round"
                initial={{ opacity: 0, x: 20 }}
                animate={{ opacity: 1, x: 0 }}
                exit={{ opacity: 0, x: -20 }}
                className="space-y-2"
              >
                {loadingRounds ? (
                  <div className="flex justify-center py-8">
                    <Loader2 className="h-8 w-8 animate-spin text-primary" />
                  </div>
                ) : filteredRounds.length === 0 ? (
                  <p className="text-center text-muted-foreground py-8">{t('ticketRedeem.noRounds')}</p>
                ) : (
                  filteredRounds.map(round => {
                    const remaining = round.max_tickets - round.tickets_sold;
                    const isSoldOut = remaining <= 0;
                    
                    return (
                      <motion.button
                        key={round.id}
                        whileTap={{ scale: 0.98 }}
                        onClick={() => !isSoldOut && setSelectedRound(round)}
                        disabled={isSoldOut}
                        className={cn(
                          'w-full flex items-center gap-3 p-3 rounded-xl border transition-all text-left',
                          isSoldOut ? 'opacity-50 cursor-not-allowed border-border' :
                          selectedRound?.id === round.id
                            ? 'border-primary bg-primary/10'
                            : 'border-border hover:border-primary/50'
                        )}
                      >
                        <div className="w-12 h-12 rounded-lg bg-primary/10 flex items-center justify-center">
                          <Ticket className="h-5 w-5 text-primary" />
                        </div>
                        <div className="flex-1 min-w-0">
                          <p className="font-medium truncate">{round.name}</p>
                          <div className="flex items-center gap-2">
                            <span className="text-sm line-through text-muted-foreground">{round.price}€</span>
                            <span className="text-sm font-bold text-green-500">{t('ticketRedeem.free')}</span>
                          </div>
                          {isSoldOut ? (
                            <p className="text-xs text-destructive">{t('ticketRedeem.soldOut')}</p>
                          ) : remaining <= 20 && (
                            <p className="text-xs text-orange-400">{remaining} {t('ticketRedeem.remaining')}</p>
                          )}
                        </div>
                        {selectedRound?.id === round.id && !isSoldOut && (
                          <div className="h-6 w-6 rounded-full bg-primary flex items-center justify-center">
                            <Check className="h-4 w-4 text-primary-foreground" />
                          </div>
                        )}
                      </motion.button>
                    );
                  })
                )}
              </motion.div>
            )}

            {step === 'confirm' && selectedEvent && selectedRound && (
              <motion.div
                key="confirm"
                initial={{ opacity: 0, x: 20 }}
                animate={{ opacity: 1, x: 0 }}
                exit={{ opacity: 0, x: -20 }}
                className="space-y-4"
              >
                {/* Summary Card */}
                <div className="p-4 rounded-xl bg-gradient-to-br from-primary/10 to-primary/5 border border-primary/30">
                  <div className="flex items-center gap-3 mb-4">
                    <Calendar className="h-6 w-6 text-primary" />
                    <div>
                      <p className="text-sm text-muted-foreground">{t('ticketRedeem.event')}</p>
                      <p className="font-semibold">{selectedEvent.title}</p>
                      <p className="text-sm text-muted-foreground">{formatEventDate(selectedEvent.start_at)}</p>
                    </div>
                  </div>
                  <div className="flex items-center gap-3">
                    <Ticket className="h-6 w-6 text-primary" />
                    <div>
                      <p className="text-sm text-muted-foreground">{t('ticketRedeem.ticketType')}</p>
                      <p className="font-semibold">{selectedRound.name}</p>
                      <div className="flex items-center gap-2">
                        <span className="text-sm line-through text-muted-foreground">{selectedRound.price}€</span>
                        <span className="text-sm font-bold text-green-500">{t('ticketRedeem.free')}</span>
                      </div>
                    </div>
                  </div>
                </div>

                {/* Points to spend */}
                <div className="text-center py-2">
                  <p className="text-2xl font-bold text-primary">-{pointsRequired}</p>
                  <p className="text-sm text-muted-foreground">{t('ticketRedeem.points')}</p>
                </div>

                {/* Info */}
                <p className="text-sm text-center text-muted-foreground">
                  {t('ticketRedeem.willBeSent')}
                </p>
              </motion.div>
            )}
          </AnimatePresence>
        </div>

        {/* Footer */}
        <div className="p-5 border-t flex gap-3">
          <Button
            variant="outline"
            className="flex-1"
            onClick={() => onOpenChange(false)}
          >
            {t('ticketRedeem.cancel')}
          </Button>
          
          {step === 'event' && (
            <Button
              className="flex-1"
              disabled={!selectedEvent}
              onClick={() => setStep('round')}
            >
              {t('ticketRedeem.next')}
            </Button>
          )}
          
          {step === 'round' && (
            <Button
              className="flex-1"
              disabled={!selectedRound}
              onClick={() => setStep('confirm')}
            >
              {t('ticketRedeem.next')}
            </Button>
          )}
          
          {step === 'confirm' && (
            <Button
              className="flex-1"
              disabled={confirming}
              onClick={handleConfirm}
            >
              {confirming ? (
                <Loader2 className="h-4 w-4 animate-spin mr-2" />
              ) : (
                <Check className="h-4 w-4 mr-2" />
              )}
              {t('ticketRedeem.confirm')}
            </Button>
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}
