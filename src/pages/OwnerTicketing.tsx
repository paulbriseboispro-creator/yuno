import { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { Plus, Pencil, Trash2, Ticket, Save, FolderOpen, Zap, Crown, Wine, ShieldCheck, Clock, ChevronDown, Users, Bell, Check, ArrowRight, ArrowLeft, Sparkles, Lock, Copy, Mail } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Switch } from '@/components/ui/switch';
import { Textarea } from '@/components/ui/textarea';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@/components/ui/tooltip';
import { ScrollArea } from '@/components/ui/scroll-area';

import { supabase } from '@/integrations/supabase/client';
import type { TablesUpdate } from '@/integrations/supabase/types';
import { Event } from '@/types';
import { TicketRound, TicketType, TicketSellingMode, PresetSellingMode } from '@/types/ticketing';
import { toast } from 'sonner';
import { useLanguage } from '@/contexts/LanguageContext';
import { useDashboardMode } from '@/contexts/DashboardModeContext';
import { formatInTimeZone } from 'date-fns-tz';
import { PARIS_TIMEZONE, fromParisTime, nowInParis, toParisTime } from '@/lib/timezone';
import { enUS, es, fr } from 'date-fns/locale';
import { useVenueContext } from '@/hooks/useVenueContext';
import { OwnerHeader } from '@/components/OwnerHeader';
import { OwnerPageSkeleton } from '@/components/DashboardSkeleton';
import { CollabReadOnlyBanner } from '@/components/CollabReadOnlyBanner';
import { RED, POS, GOLD, T1, T2, T3, C_FAINT, BORDER, TILE_BG, CARD_SHADOW, MAIN_CARD, INNER_CARD, TILE, LABEL, DIALOG_SURFACE, DIALOG_TITLE, HINT } from '@/components/owner/ticketing/ticketing-ui';
import type { PresetRound, TicketPreset, TicketSalesMode, SalesDraft, RoundFormData } from '@/components/owner/ticketing/ticketing-types';
import { toDateTimeLocalInput, toUtcIsoOrNull, resolveSalesMode } from '@/components/owner/ticketing/ticketing-utils';
import { RoundDialog } from '@/components/owner/ticketing/RoundDialog';
import { PresetDialog } from '@/components/owner/ticketing/PresetDialog';
import { PresetTypeDialog } from '@/components/owner/ticketing/PresetTypeDialog';
import { BulkDrinkDialog } from '@/components/owner/ticketing/BulkDrinkDialog';
import { ActivationWizardDialog } from '@/components/owner/ticketing/ActivationWizardDialog';
import { EventRoundRow } from '@/components/owner/ticketing/EventRoundRow';
import { EventRegistrationsViewer } from '@/components/owner/ticketing/EventRegistrationsViewer';

export default function OwnerTicketing() {
  const { t, language } = useLanguage();
  const navigate = useNavigate();
  const { venueId, organizerUserId, scope, loading: venueLoading } = useVenueContext();
  const { basePath, mode: dashboardMode } = useDashboardMode();
  const isOrganizerScope = scope === 'organizer';
  
  const [events, setEvents] = useState<(Event & { ticketingEnabled: boolean; tablesEnabled: boolean; ticketSellingMode: TicketSellingMode; presaleStartAt?: string; publicSaleStartAt?: string; waitlistEnabled?: boolean; maxTickets?: number | null; roundsVisibility?: 'sequential' | 'preview_upcoming' | 'all_open'; maxTicketsPerPerson?: number | null; salePasswordEnabled?: boolean })[]>([]);
  const [advancedOptionsDraft, setAdvancedOptionsDraft] = useState<Record<string, SalesDraft>>({});
  const [ticketRounds, setTicketRounds] = useState<Record<string, TicketRound[]>>({});
  const [presets, setPresets] = useState<TicketPreset[]>([]);
  const [loading, setLoading] = useState(true);
  const [selectedEvent, setSelectedEvent] = useState<Event | null>(null);
  const [isRoundDialogOpen, setIsRoundDialogOpen] = useState(false);
  const [isPresetDialogOpen, setIsPresetDialogOpen] = useState(false);
  
  const [isPresetTypeDialogOpen, setIsPresetTypeDialogOpen] = useState(false);
  const [isBulkDrinkDialogOpen, setIsBulkDrinkDialogOpen] = useState(false);
  const [editingRound, setEditingRound] = useState<TicketRound | null>(null);
  const [editingPreset, setEditingPreset] = useState<TicketPreset | null>(null);
  const [activeTab, setActiveTab] = useState('events');
  const [presetTicketType, setPresetTicketType] = useState<TicketType>('standard');
  const [presetSellingMode, setPresetSellingMode] = useState<PresetSellingMode>('rounds');
  const [presetTypeStep, setPresetTypeStep] = useState<'mode' | 'type'>('mode');

  // Activation wizard state
  const [isActivationWizardOpen, setIsActivationWizardOpen] = useState(false);
  const [wizardStep, setWizardStep] = useState<1 | 2 | 2.5 | 3>(1);
  const [wizardSellingMode, setWizardSellingMode] = useState<TicketSellingMode | null>(null);
  const [wizardEventId, setWizardEventId] = useState<string | null>(null);
  const [wizardSelectedPresets, setWizardSelectedPresets] = useState<{ standard?: string; vip?: string }>({});
  const [wizardSalesDraft, setWizardSalesDraft] = useState<SalesDraft>({ mode: 'normal', presaleStartAt: '', publicSaleStartAt: '', waitlistEnabled: false });
  const [wizardModeChange, setWizardModeChange] = useState(false);
  // Guided rounds builder draft (used when user skips preset)
  const [wizardCustomRounds, setWizardCustomRounds] = useState<Array<{ name: string; price: string; maxTickets: string; ticketType: TicketType; includesDrink: boolean; entryDeadline?: string }>>([]);
  const [waitlistEntries, setWaitlistEntries] = useState<Record<string, { id: string; email: string; full_name: string | null; created_at: string; presale_access: boolean }[]>>({});
  const [freeDrinkMode, setFreeDrinkMode] = useState<'credits' | 'bouncer_notify'>('credits');
  
  const [roundFormData, setRoundFormData] = useState<RoundFormData>({
    name: '',
    price: '',
    maxTickets: '',
    isActive: false,
    autoActivate: true,
    lastTicketsThreshold: '20',
    includesDrink: false,
    drinkDeadlineType: 'hours_after_start',
    drinkDeadlineHours: '2',
    drinkCutoffTime: '02:00',
    ticketType: 'standard',
    entryDeadline: '',
  });

  const [presetFormData, setPresetFormData] = useState({
    name: '',
    totalCapacity: '',
    lastTicketsThreshold: '20',
    includesDrink: false,
    drinkDeadlineType: 'fixed_time' as 'hours_after_start' | 'fixed_time' | 'none',
    drinkDeadlineHours: '2',
    drinkCutoffTime: '02:00',
    rounds: [
      { name: '', price: '', maxTickets: '', entryDeadline: '', includesDrink: false },
      { name: '', price: '', maxTickets: '', entryDeadline: '', includesDrink: false },
      { name: '', price: '', maxTickets: '', entryDeadline: '', includesDrink: false },
    ],
  });

  const [bulkDrinkFormData, setBulkDrinkFormData] = useState({
    includesDrink: true,
    drinkDeadlineType: 'fixed_time' as 'hours_after_start' | 'fixed_time' | 'none',
    drinkDeadlineHours: '2',
    drinkCutoffTime: '02:00',
    applyToStandard: true,
    applyToVip: true,
  });

  const [insuranceEnabled, setInsuranceEnabled] = useState(true);

  const defaultRoundPlaceholders = [
    { name: 'Early Birds', price: '8', maxTickets: '20' },
    { name: 'First Release', price: '11', maxTickets: '50' },
    { name: 'Regular', price: '15', maxTickets: '130' },
  ];

  const getLocale = () => {
    switch (language) {
      case 'es': return es;
      case 'fr': return fr;
      default: return enUS;
    }
  };

  useEffect(() => {
    if (isOrganizerScope) {
      if (organizerUserId) {
        fetchEvents();
        fetchPresets();
      }
      return;
    }
    if (venueId) {
      fetchEvents();
      fetchPresets();
      // Fetch insurance setting + free drink mode (venue-scoped only)
      supabase.from('venues').select('cancellation_insurance_enabled, free_drink_mode').eq('id', venueId).maybeSingle().then(({ data }) => {
        if (data) {
          setInsuranceEnabled(data.cancellation_insurance_enabled ?? true);
          setFreeDrinkMode((data as any).free_drink_mode || 'credits');
        }
      });
    }
  }, [venueId, organizerUserId, isOrganizerScope]);

  const fetchWaitlistEntries = async (eventIds: string[]) => {
    if (eventIds.length === 0) return;
    const { data } = await supabase
      .from('event_waitlist')
      .select('id, email, full_name, created_at, presale_access, event_id')
      .in('event_id', eventIds)
      .order('created_at', { ascending: true });
    if (data) {
      const grouped: Record<string, typeof data> = {};
      data.forEach(entry => {
        if (!grouped[entry.event_id]) grouped[entry.event_id] = [];
        grouped[entry.event_id].push(entry);
      });
      setWaitlistEntries(grouped);
    }
  };

  const handleCopyEmails = (eventId: string) => {
    const entries = waitlistEntries[eventId] || [];
    const emails = entries.map(e => e.email).join(', ');
    navigator.clipboard.writeText(emails);
    toast.success(t('tickets.emailsCopied'));
  };

  const handleToggleInsurance = async (enabled: boolean) => {
    if (!venueId) return;
    setInsuranceEnabled(enabled);
    const { error } = await supabase.from('venues').update({ cancellation_insurance_enabled: enabled }).eq('id', venueId);
    if (error) {
      setInsuranceEnabled(!enabled);
      toast.error(t('common.error'));
    } else {
      toast.success(enabled ? t('tickets.insuranceEnabled') : t('tickets.insuranceDisabled'));
    }
  };

  const fetchEvents = async () => {
    if (!isOrganizerScope && !venueId) return;
    if (isOrganizerScope && !organizerUserId) return;

    try {
      const baseQuery = supabase
        .from('events')
        .select('*')
        .gte('end_at', nowInParis().toISOString())
        .order('start_at', { ascending: true });

      // For venue scope: include co-events where the venue is partner_venue_id
      const { data, error } = isOrganizerScope
        ? await baseQuery.eq('organizer_user_id', organizerUserId!)
        : await baseQuery.or(`venue_id.eq.${venueId},partner_venue_id.eq.${venueId}`);

      if (error) throw error;

      const mappedEvents = (data || []).map((event) => ({
        id: event.id,
        venueId: event.venue_id,
        title: event.title,
        description: event.description || undefined,
        startAt: event.start_at,
        endAt: event.end_at,
        isActive: event.is_active,
        ticketingEnabled: event.ticketing_enabled,
        tablesEnabled: event.tables_enabled,
        ticketSellingMode: ((event as any).ticket_selling_mode as TicketSellingMode) || 'rounds',
        roundsVisibility: ((event as any).rounds_visibility as 'sequential' | 'preview_upcoming' | 'all_open') || 'sequential',
        presaleStartAt: event.presale_start_at || undefined,
        publicSaleStartAt: event.public_sale_start_at || undefined,
        waitlistEnabled: event.waitlist_enabled || false,
        maxTickets: event.max_tickets ?? null,
        maxTicketsPerPerson: (event as any).max_tickets_per_person ?? null,
        salePasswordEnabled: (event as any).sale_password_enabled || false,
        // Co-event metadata for read-only badges
        isCoEventPartner: !isOrganizerScope && venueId && event.venue_id !== venueId && event.partner_venue_id === venueId,
        partnerOrganizerId: (event as any).organizer_user_id || (event as any).partner_organizer_id || null,
        createdAt: event.created_at,
        updatedAt: event.updated_at,
      }));

      setEvents(mappedEvents);
      setAdvancedOptionsDraft(
        mappedEvents.reduce((acc, evt) => {
          const presaleStartAt = toDateTimeLocalInput(evt.presaleStartAt);
          const publicSaleStartAt = toDateTimeLocalInput(evt.publicSaleStartAt);
          const waitlistEnabled = evt.waitlistEnabled || false;

          acc[evt.id] = {
            mode: resolveSalesMode({ presaleStartAt, publicSaleStartAt, waitlistEnabled }),
            presaleStartAt,
            publicSaleStartAt,
            waitlistEnabled,
          };
          return acc;
        }, {} as Record<string, SalesDraft>)
      );

      await Promise.all(mappedEvents.map((evt) => fetchTicketRounds(evt.id)));
      
      // Fetch waitlist entries for private/presale events
      const waitlistEventIds = mappedEvents
        .filter(evt => evt.waitlistEnabled)
        .map(evt => evt.id);
      fetchWaitlistEntries(waitlistEventIds);
    } catch (error) {
      console.error('Error fetching events:', error);
      toast.error(t('tickets.errorLoading'));
    } finally {
      setLoading(false);
    }
  };

  const fetchPresets = async () => {
    if (!isOrganizerScope && !venueId) return;
    if (isOrganizerScope && !organizerUserId) return;

    try {
      const baseQuery = supabase
        .from('ticket_presets')
        .select('*')
        .order('created_at', { ascending: false });

      const { data, error } = isOrganizerScope
        ? await baseQuery.eq('organizer_user_id', organizerUserId!)
        : await baseQuery.eq('venue_id', venueId!);

      if (error) throw error;

      const mapped: TicketPreset[] = (data || []).map(p => ({
        id: p.id,
        venueId: p.venue_id,
        name: p.name,
        totalCapacity: p.total_capacity,
        rounds: (p.rounds as unknown as PresetRound[]) || [],
        ticketType: ((p as any).ticket_type as TicketType) || 'standard',
        sellingMode: ((p as any).selling_mode as PresetSellingMode) || 'rounds',
        includesDrink: (p as any).includes_drink ?? false,
        drinkDeadlineType: ((p as any).drink_deadline_type as 'hours_after_start' | 'fixed_time') ?? 'fixed_time',
        drinkDeadlineHours: (p as any).drink_deadline_hours ?? 2,
        drinkCutoffTime: (p as any).drink_cutoff_time ?? '02:00',
        createdAt: p.created_at,
        updatedAt: p.updated_at,
      }));

      setPresets(mapped);
    } catch (error) {
      console.error('Error fetching presets:', error);
    }
  };

  const fetchTicketRounds = async (eventId: string) => {
    const { data, error } = await supabase
      .from('ticket_rounds')
      .select('*')
      .eq('event_id', eventId)
      .order('position', { ascending: true });

    if (error) {
      console.error('Error fetching ticket rounds:', error);
      return;
    }

    const mapped: TicketRound[] = (data || []).map(r => ({
      id: r.id,
      eventId: r.event_id,
      name: r.name,
      description: r.description,
      price: Number(r.price),
      maxTickets: r.max_tickets,
      ticketsSold: r.tickets_sold,
      position: r.position,
      isActive: r.is_active,
      autoActivate: r.auto_activate,
      lastTicketsThreshold: r.last_tickets_threshold ?? 20,
      includesDrink: r.includes_drink ?? false,
      drinkDeadlineHours: r.drink_deadline_hours ?? 2,
      drinkDeadlineType: (r.drink_deadline_type as 'hours_after_start' | 'fixed_time') ?? 'hours_after_start',
      drinkCutoffTime: r.drink_cutoff_time ?? undefined,
      entryDeadline: (r as any).entry_deadline ? (r as any).entry_deadline.substring(0, 5) : undefined,
      ticketType: ((r as any).ticket_type as 'standard' | 'vip') ?? 'standard',
      createdAt: r.created_at,
      updatedAt: r.updated_at,
    }));

    setTicketRounds(prev => ({ ...prev, [eventId]: mapped }));
  };

  const handleUpdateAdvancedOption = (
    eventId: string,
    updates: Partial<Omit<SalesDraft, 'mode'>>
  ) => {
    setAdvancedOptionsDraft((prev) => ({
      ...prev,
      [eventId]: {
        mode: prev[eventId]?.mode || 'normal',
        presaleStartAt: prev[eventId]?.presaleStartAt || '',
        publicSaleStartAt: prev[eventId]?.publicSaleStartAt || '',
        waitlistEnabled: prev[eventId]?.waitlistEnabled || false,
        ...updates,
      },
    }));
  };

  const handleSetSalesMode = (eventId: string, mode: TicketSalesMode) => {
    setAdvancedOptionsDraft((prev) => {
      const current = prev[eventId] || {
        mode: 'normal',
        presaleStartAt: '',
        publicSaleStartAt: '',
        waitlistEnabled: false,
      };

      if (mode === 'normal') {
        return {
          ...prev,
          [eventId]: {
            mode,
            presaleStartAt: '',
            publicSaleStartAt: '',
            waitlistEnabled: false,
          },
        };
      }

      if (mode === 'private') {
        return {
          ...prev,
          [eventId]: {
            mode,
            presaleStartAt: '',
            publicSaleStartAt: '',
            waitlistEnabled: true,
          },
        };
      }

      return {
        ...prev,
        [eventId]: {
          ...current,
          mode,
          waitlistEnabled: true,
        },
      };
    });
  };

  const handleSaveAdvancedOptions = async (eventId: string) => {
    const currentOptions = advancedOptionsDraft[eventId];
    if (!currentOptions) return;

    // Determine old mode from the event data
    const event = events.find(e => e.id === eventId);
    const oldMode = event ? resolveSalesMode({
      presaleStartAt: event.presaleStartAt,
      publicSaleStartAt: event.publicSaleStartAt,
      waitlistEnabled: event.waitlistEnabled,
    }) : 'normal';
    const newMode = currentOptions.mode;

    let presaleStartAt: string | null = null;
    let publicSaleStartAt: string | null = null;
    let waitlistEnabled = false;

    if (currentOptions.mode === 'presale') {
      if (!currentOptions.presaleStartAt || !currentOptions.publicSaleStartAt) {
        toast.error(t('tickets.presaleDatesRequired'));
        return;
      }

      presaleStartAt = toUtcIsoOrNull(currentOptions.presaleStartAt);
      publicSaleStartAt = toUtcIsoOrNull(currentOptions.publicSaleStartAt);

      if (!presaleStartAt || !publicSaleStartAt || new Date(publicSaleStartAt) <= new Date(presaleStartAt)) {
        toast.error(t('tickets.publicSaleAfterPresale'));
        return;
      }

      waitlistEnabled = true;
    } else if (currentOptions.mode === 'private') {
      waitlistEnabled = true;
    }

    try {
      const { error } = await supabase
        .from('events')
        .update({
          presale_start_at: presaleStartAt,
          public_sale_start_at: publicSaleStartAt,
          waitlist_enabled: waitlistEnabled,
        })
        .eq('id', eventId);

      if (error) throw error;

      // Notify waitlist members when transitioning to presale or normal
      const shouldNotify = (
        (newMode === 'presale' && oldMode !== 'presale') ||
        (newMode === 'normal' && (oldMode === 'private' || oldMode === 'presale'))
      );

      if (shouldNotify) {
        // Grant presale access
        await supabase
          .from('event_waitlist')
          .update({ presale_access: true })
          .eq('event_id', eventId)
          .eq('presale_access', false);

        // Send opening notification to all waitlist members
        supabase.functions.invoke('notify-event-waitlist', {
          body: { eventId, type: 'opening' },
        }).then(({ error }) => {
          if (error) { console.error('Waitlist notification failed:', error); return; }
          toast.success(t('tickets.salesOpenNotificationSent'));
        }).catch((err) => console.error('Waitlist notification failed:', err));

        // Hide waitlist entries from orders when going to normal
        if (newMode === 'normal') {
          await supabase
            .from('event_waitlist')
            .update({ show_in_orders: false })
            .eq('event_id', eventId);
        }
      }

      toast.success(t('tickets.salesModeSaved'));
      fetchEvents();
    } catch (error) {
      console.error('Error saving advanced options:', error);
      toast.error(t('tickets.errorSaving'));
    }
  };

  const handleToggleTicketing = async (event: Event & { ticketingEnabled: boolean }) => {
    // If enabling and no rounds exist, open wizard
    if (!event.ticketingEnabled) {
      const rounds = ticketRounds[event.id] || [];
      if (rounds.length === 0) {
        setWizardEventId(event.id);
        setWizardStep(1);
        setWizardSellingMode(null);
        setWizardSelectedPresets({});
        setWizardCustomRounds([]);
        setWizardSalesDraft({ mode: 'normal', presaleStartAt: '', publicSaleStartAt: '', waitlistEnabled: false });
        setIsActivationWizardOpen(true);
        return;
      }
    }

    try {
      const { error } = await supabase
        .from('events')
        .update({ ticketing_enabled: !event.ticketingEnabled })
        .eq('id', event.id);

      if (error) throw error;

      toast.success(event.ticketingEnabled ? t('tickets.ticketingDisabled') : t('tickets.ticketingEnabled'));
      fetchEvents();
    } catch (error) {
      console.error('Error toggling ticketing:', error);
      toast.error(t('tickets.errorSaving'));
    }
  };

  const handleWizardApplyModeChange = async () => {
    if (!wizardEventId) return;
    try {
      // Update selling mode + global capacity
      const updateData: TablesUpdate<'events'> = { ticket_selling_mode: wizardSellingMode };
      if (wizardSellingMode === 'simple') {
        const selectedPresetId = wizardSelectedPresets.standard || wizardSelectedPresets.vip;
        const selectedPreset = selectedPresetId ? presets.find(p => p.id === selectedPresetId) : null;
        if (selectedPreset?.totalCapacity) {
          updateData.max_tickets = selectedPreset.totalCapacity;
        }
      }
      await supabase.from('events').update(updateData).eq('id', wizardEventId);

      // Delete ALL existing rounds for this event (mode change = fresh start)
      const existingRounds = ticketRounds[wizardEventId] || [];
      if (existingRounds.length > 0) {
        await supabase.from('ticket_rounds').delete().in('id', existingRounds.map(r => r.id));
      }

      // Apply selected presets
      const event = events.find(e => e.id === wizardEventId);
      if (event) {
        for (const type of ['standard', 'vip'] as const) {
          const presetId = wizardSelectedPresets[type];
          if (presetId) {
            const preset = presets.find(p => p.id === presetId);
            if (preset) {
              await handleApplyPreset(preset, event);
            }
          }
        }
      }

      const modeKey = wizardSellingMode === 'simple' ? 'tickets.sellingModeSimple' : wizardSellingMode === 'timed_entry' ? 'tickets.sellingModeTimed' : 'tickets.sellingModeRounds';
      toast.success(t(modeKey));
      setIsActivationWizardOpen(false);
      setWizardModeChange(false);
      fetchEvents();
      if (wizardEventId) await fetchTicketRounds(wizardEventId);
    } catch (error) {
      console.error('Error applying mode change:', error);
      toast.error(t('tickets.errorSaving'));
    }
  };

  const handleWizardPublish = async () => {
    if (!wizardEventId) return;

    try {
      const hasSelectedPreset = !!(wizardSelectedPresets.standard || wizardSelectedPresets.vip);
      const validCustomRounds = wizardCustomRounds.filter(
        r => r.name.trim() && r.price.trim() && (wizardSellingMode === 'simple' || r.maxTickets.trim()),
      );
      const usingCustomRounds = !hasSelectedPreset && validCustomRounds.length > 0;

      // Step 1: Set selling mode + global capacity from preset for simple mode
      const updateData: TablesUpdate<'events'> = { ticket_selling_mode: wizardSellingMode };
      if (wizardSellingMode === 'simple') {
        const selectedPresetId = wizardSelectedPresets.standard || wizardSelectedPresets.vip;
        const selectedPreset = selectedPresetId ? presets.find(p => p.id === selectedPresetId) : null;
        if (selectedPreset?.totalCapacity) {
          updateData.max_tickets = selectedPreset.totalCapacity;
        } else if (usingCustomRounds) {
          // Sum capacities of custom rounds for simple mode
          const totalCap = validCustomRounds.reduce((s, r) => s + (parseInt(r.maxTickets) || 999999), 0);
          if (totalCap > 0) updateData.max_tickets = totalCap;
        }
      }
      await supabase.from('events').update(updateData).eq('id', wizardEventId);

      // Step 2: Apply selected presets OR insert custom rounds
      const event = events.find(e => e.id === wizardEventId);
      if (event && hasSelectedPreset) {
        for (const type of ['standard', 'vip'] as const) {
          const presetId = wizardSelectedPresets[type];
          if (presetId) {
            const preset = presets.find(p => p.id === presetId);
            if (preset) {
              await handleApplyPreset(preset, event);
            }
          }
        }
      } else if (usingCustomRounds) {
        // Wipe existing rounds for this event then insert the guided ones
        await supabase.from('ticket_rounds').delete().eq('event_id', wizardEventId);
        const roundsToInsert = validCustomRounds.map((r, index) => ({
          event_id: wizardEventId,
          name: r.name.trim(),
          price: parseFloat(r.price) || 0,
          max_tickets: wizardSellingMode === 'simple' ? 999999 : parseInt(r.maxTickets) || 0,
          last_tickets_threshold: 20,
          position: index,
          is_active: wizardSellingMode === 'simple' ? true : index === 0,
          auto_activate: wizardSellingMode === 'rounds',
          ticket_type: r.ticketType,
          includes_drink: r.includesDrink,
          drink_deadline_type: r.includesDrink ? 'fixed_time' : 'none',
          drink_deadline_hours: null,
          drink_cutoff_time: r.includesDrink ? '02:00' : null,
          entry_deadline: wizardSellingMode === 'timed_entry' && r.entryDeadline ? r.entryDeadline + ':00' : null,
        }));
        const { error: insertErr } = await supabase.from('ticket_rounds').insert(roundsToInsert);
        if (insertErr) throw insertErr;
      }

      // Step 3: Save sales mode
      let presaleStartAt: string | null = null;
      let publicSaleStartAt: string | null = null;
      let waitlistEnabled = false;

      if (wizardSalesDraft.mode === 'presale') {
        presaleStartAt = toUtcIsoOrNull(wizardSalesDraft.presaleStartAt);
        publicSaleStartAt = toUtcIsoOrNull(wizardSalesDraft.publicSaleStartAt);
        waitlistEnabled = true;
      } else if (wizardSalesDraft.mode === 'private') {
        waitlistEnabled = true;
      }

      await supabase.from('events').update({
        ticketing_enabled: true,
        presale_start_at: presaleStartAt,
        public_sale_start_at: publicSaleStartAt,
        waitlist_enabled: waitlistEnabled,
      }).eq('id', wizardEventId);

      // Notify waitlist if presale
      if (wizardSalesDraft.mode === 'presale') {
        await supabase.from('event_waitlist').update({ presale_access: true }).eq('event_id', wizardEventId).eq('presale_access', false);
        supabase.functions.invoke('notify-event-waitlist', { body: { eventId: wizardEventId, type: 'opening' } }).catch((err) => console.error('Waitlist notification failed:', err));
      }

      toast.success(t('tickets.ticketingEnabled'));
      setIsActivationWizardOpen(false);
      setWizardCustomRounds([]);
      fetchEvents();
      if (wizardEventId) await fetchTicketRounds(wizardEventId);
    } catch (error) {
      console.error('Error publishing tickets:', error);
      toast.error(t('tickets.errorSaving'));
    }
  };

  const handleChangeSellingMode = async (event: Event & { ticketSellingMode: TicketSellingMode }, newMode: TicketSellingMode) => {
    if (newMode === event.ticketSellingMode) return;
    // Open the wizard at step 2 (preset selection) with the new mode pre-selected
    setWizardEventId(event.id);
    setWizardSellingMode(newMode);
    setWizardSelectedPresets({});
    setWizardModeChange(true);
    setWizardStep(2);
    setIsActivationWizardOpen(true);
  };

  const handleAddRound = (event: Event & { ticketSellingMode?: TicketSellingMode }, ticketType: TicketType = 'standard') => {
    const isSimpleMode = event.ticketSellingMode === 'simple';
    setSelectedEvent(event);
    setEditingRound(null);
    setRoundFormData({
      name: '',
      price: '',
      maxTickets: '',
      isActive: isSimpleMode ? true : false,
      autoActivate: isSimpleMode ? false : true,
      lastTicketsThreshold: '20',
      includesDrink: false,
      drinkDeadlineType: 'hours_after_start',
      drinkDeadlineHours: '2',
      drinkCutoffTime: '02:00',
      ticketType,
      entryDeadline: '',
    });
    setIsRoundDialogOpen(true);
  };

  const handleEditRound = (round: TicketRound, event: Event) => {
    setSelectedEvent(event);
    setEditingRound(round);
    setRoundFormData({
      name: round.name,
      price: round.price.toString(),
      maxTickets: round.maxTickets.toString(),
      isActive: round.isActive,
      autoActivate: round.autoActivate,
      lastTicketsThreshold: round.lastTicketsThreshold.toString(),
      includesDrink: round.includesDrink || false,
      drinkDeadlineType: round.drinkDeadlineType || 'hours_after_start',
      drinkDeadlineHours: (round.drinkDeadlineHours || 2).toString(),
      drinkCutoffTime: round.drinkCutoffTime || '02:00',
      ticketType: round.ticketType || 'standard',
      entryDeadline: round.entryDeadline || '',
    });
    setIsRoundDialogOpen(true);
  };

  const handleDeleteRound = async (roundId: string, eventId: string) => {
    if (!confirm(t('tickets.confirmDeleteRound'))) return;

    try {
      const { error } = await supabase
        .from('ticket_rounds')
        .delete()
        .eq('id', roundId);

      if (error) throw error;

      toast.success(t('tickets.roundDeleted'));
      await fetchTicketRounds(eventId);
    } catch (error) {
      console.error('Error deleting round:', error);
      toast.error(t('tickets.errorDeleting'));
    }
  };

  const handleSaveRound = async (e: React.FormEvent) => {
    e.preventDefault();

    const isSimpleMode = selectedEvent && events.find(ev => ev.id === selectedEvent.id)?.ticketSellingMode === 'simple';

    if (!selectedEvent || !roundFormData.name || !roundFormData.price || (!isSimpleMode && !roundFormData.maxTickets)) {
      toast.error(t('tickets.fillRequired'));
      return;
    }

    try {
      const roundData = {
        event_id: selectedEvent.id,
        name: roundFormData.name,
        price: parseFloat(roundFormData.price),
        max_tickets: isSimpleMode ? 999999 : parseInt(roundFormData.maxTickets),
        is_active: isSimpleMode ? true : roundFormData.isActive,
        auto_activate: isSimpleMode ? false : roundFormData.autoActivate,
        last_tickets_threshold: parseInt(roundFormData.lastTicketsThreshold) || 20,
        includes_drink: roundFormData.includesDrink,
        drink_deadline_type: roundFormData.includesDrink ? roundFormData.drinkDeadlineType : null,
        drink_deadline_hours: roundFormData.includesDrink && roundFormData.drinkDeadlineType === 'hours_after_start'
          ? parseInt(roundFormData.drinkDeadlineHours) || 2
          : null,
        drink_cutoff_time: roundFormData.includesDrink && roundFormData.drinkDeadlineType === 'fixed_time'
          ? roundFormData.drinkCutoffTime
          : null,
        position: editingRound?.position ?? (ticketRounds[selectedEvent.id]?.length || 0),
        ticket_type: roundFormData.ticketType,
        entry_deadline: roundFormData.entryDeadline ? roundFormData.entryDeadline + ':00' : null,
      };

      if (editingRound) {
        const { error } = await supabase
          .from('ticket_rounds')
          .update(roundData)
          .eq('id', editingRound.id);

        if (error) throw error;
        toast.success(t('tickets.roundUpdated'));
      } else {
        const { error } = await supabase
          .from('ticket_rounds')
          .insert(roundData);

        if (error) throw error;
        toast.success(t('tickets.roundCreated'));
      }

      setIsRoundDialogOpen(false);
      await fetchTicketRounds(selectedEvent.id);
    } catch (error) {
      console.error('Error saving round:', error);
      toast.error(t('tickets.errorSaving'));
    }
  };

  const handleUpdateGlobalCapacity = async (eventId: string, maxTickets: number) => {
    try {
      const { error } = await supabase
        .from('events')
        .update({ max_tickets: maxTickets || null })
        .eq('id', eventId);

      if (error) throw error;
      toast.success(t('common.saved'));
      fetchEvents();
    } catch (error) {
      console.error('Error updating global capacity:', error);
      toast.error(t('tickets.errorSaving'));
    }
  };

  // Max tickets per person (null = no limit). Cumulative cap enforced server-side
  // in reserve_ticket_capacity; the buyer-side selector mirrors it.
  const handleUpdateMaxPerPerson = async (eventId: string, value: number | null) => {
    try {
      const { error } = await supabase
        .from('events')
        .update({ max_tickets_per_person: value && value > 0 ? value : null } as any)
        .eq('id', eventId);
      if (error) throw error;
      setEvents(prev => prev.map(ev => ev.id === eventId ? { ...ev, maxTicketsPerPerson: value && value > 0 ? value : null } : ev));
      toast.success(t('common.saved'));
    } catch (error) {
      console.error('Error updating max per person:', error);
      toast.error(t('tickets.errorSaving'));
    }
  };

  // Password-gated sale. Pass a non-empty password to protect, null to remove.
  // Hash + grant invalidation happen server-side in set_event_sale_password.
  const [salePasswordDraft, setSalePasswordDraft] = useState<Record<string, string>>({});
  const [salePasswordSaving, setSalePasswordSaving] = useState<string | null>(null);

  const handleSetSalePassword = async (eventId: string, password: string | null) => {
    setSalePasswordSaving(eventId);
    try {
      const { error } = await supabase.rpc('set_event_sale_password' as any, {
        p_event_id: eventId,
        p_password: password,
      });
      if (error) throw error;
      setEvents(prev => prev.map(ev => ev.id === eventId ? { ...ev, salePasswordEnabled: !!password } : ev));
      setSalePasswordDraft(prev => ({ ...prev, [eventId]: '' }));
      toast.success(password ? t('tickets.salePasswordSaved') : t('tickets.salePasswordRemoved'));
    } catch (error: any) {
      console.error('Error setting sale password:', error);
      toast.error(error?.message || t('tickets.errorSaving'));
    } finally {
      setSalePasswordSaving(null);
    }
  };

  // Preset management
  const handleSavePreset = async (e: React.FormEvent) => {
    e.preventDefault();

    if (!presetFormData.name) {
      toast.error(t('tickets.fillRequired'));
      return;
    }
    if (!isOrganizerScope && !venueId) {
      toast.error(t('tickets.fillRequired'));
      return;
    }
    if (isOrganizerScope && !organizerUserId) {
      toast.error(t('tickets.fillRequired'));
      return;
    }

    const rounds: PresetRound[] = presetFormData.rounds
      .filter(r => r.name && r.price && (presetSellingMode === 'simple' || r.maxTickets))
      .map(r => ({
        name: r.name,
        price: parseFloat(r.price),
        maxTickets: presetSellingMode === 'simple' ? 999999 : parseInt(r.maxTickets),
        lastTicketsThreshold: parseInt(presetFormData.lastTicketsThreshold) || 20,
        includesDrink: r.includesDrink || false,
        ...(presetSellingMode === 'timed_entry' && r.entryDeadline ? { entryDeadline: r.entryDeadline } : {}),
      }));

    const presetData = {
      name: presetFormData.name,
      total_capacity: parseInt(presetFormData.totalCapacity) || rounds.reduce((s, r) => s + r.maxTickets, 0),
      rounds: JSON.parse(JSON.stringify(rounds)),
      ticket_type: presetTicketType,
      selling_mode: presetSellingMode,
      includes_drink: presetFormData.includesDrink,
      drink_deadline_type: presetFormData.includesDrink ? presetFormData.drinkDeadlineType : null,
      drink_deadline_hours: presetFormData.includesDrink && presetFormData.drinkDeadlineType === 'hours_after_start'
        ? parseInt(presetFormData.drinkDeadlineHours) || 2
        : null,
      drink_cutoff_time: presetFormData.includesDrink && presetFormData.drinkDeadlineType === 'fixed_time'
        ? presetFormData.drinkCutoffTime
        : null,
    };

    try {
      if (editingPreset) {
        // Update existing preset
        const { error } = await supabase
          .from('ticket_presets')
          .update(presetData)
          .eq('id', editingPreset.id);

        if (error) throw error;
        toast.success(t('tickets.presetUpdated'));
      } else {
        // Create new preset, scoped to organizer or venue
        const insertPayload = isOrganizerScope
          ? { organizer_user_id: organizerUserId!, venue_id: null as any, ...presetData }
          : { venue_id: venueId!, organizer_user_id: null as any, ...presetData };
        const { error } = await supabase
          .from('ticket_presets')
          .insert([insertPayload]);

        if (error) throw error;
        toast.success(t('tickets.presetSaved'));
      }

      setIsPresetDialogOpen(false);
      setEditingPreset(null);
      fetchPresets();
      resetPresetForm();
    } catch (error) {
      console.error('Error saving preset:', error);
      toast.error(t('tickets.errorSaving'));
    }
  };

  const handleEditPreset = (preset: TicketPreset) => {
    setEditingPreset(preset);
    setPresetTicketType(preset.ticketType);
    setPresetSellingMode(preset.sellingMode);
    setPresetFormData({
      name: preset.name,
      totalCapacity: preset.totalCapacity.toString(),
      lastTicketsThreshold: preset.rounds[0]?.lastTicketsThreshold?.toString() || '20',
      includesDrink: preset.includesDrink || false,
      drinkDeadlineType: preset.drinkDeadlineType || 'fixed_time',
      drinkDeadlineHours: (preset.drinkDeadlineHours || 2).toString(),
      drinkCutoffTime: preset.drinkCutoffTime || '02:00',
      rounds: preset.rounds.map(r => ({
        name: r.name,
        price: r.price.toString(),
        maxTickets: r.maxTickets.toString(),
        entryDeadline: r.entryDeadline || '',
        includesDrink: r.includesDrink || false,
      })),
    });
    setIsPresetDialogOpen(true);
  };

  const handleCreatePreset = (ticketType?: TicketType) => {
    if (ticketType) {
      setEditingPreset(null);
      setPresetTicketType(ticketType);
      resetPresetForm();
      setIsPresetDialogOpen(true);
    } else {
      setPresetTypeStep('mode');
      setIsPresetTypeDialogOpen(true);
    }
  };

  const handleSelectPresetMode = (mode: PresetSellingMode) => {
    setPresetSellingMode(mode);
    setPresetTypeStep('type');
  };

  const handleSelectPresetType = (ticketType: TicketType) => {
    setIsPresetTypeDialogOpen(false);
    setPresetTicketType(ticketType);
    setEditingPreset(null);
    resetPresetForm();
    setIsPresetDialogOpen(true);
  };

  const handleDeletePreset = async (presetId: string) => {
    if (!confirm(t('tickets.confirmDeletePreset'))) return;

    try {
      const { error } = await supabase
        .from('ticket_presets')
        .delete()
        .eq('id', presetId);

      if (error) throw error;

      toast.success(t('tickets.presetDeleted'));
      fetchPresets();
    } catch (error) {
      console.error('Error deleting preset:', error);
      toast.error(t('tickets.errorDeleting'));
    }
  };

  const handleApplyPreset = async (preset: TicketPreset, event: Event) => {
    try {
      // Only delete rounds of the same ticket type
      const existingRounds = ticketRounds[event.id] || [];
      const roundsToDelete = existingRounds.filter(r => r.ticketType === preset.ticketType).map(r => r.id);
      
      if (roundsToDelete.length > 0) {
        await supabase.from('ticket_rounds').delete().in('id', roundsToDelete);
      }

      // Get highest position of remaining rounds
      const remainingRounds = existingRounds.filter(r => r.ticketType !== preset.ticketType);
      const maxPosition = remainingRounds.length > 0 
        ? Math.max(...remainingRounds.map(r => r.position)) + 1 
        : 0;

      // If timed_entry preset, also update event selling mode
      if (preset.sellingMode === 'timed_entry') {
        await supabase.from('events').update({ ticket_selling_mode: 'timed_entry' }).eq('id', event.id);
      }

      // Insert new rounds from preset with the preset's ticket type and per-round drink settings
      const roundsToInsert = preset.rounds.map((r, index) => ({
        event_id: event.id,
        name: r.name,
        price: r.price,
        max_tickets: r.maxTickets,
        last_tickets_threshold: r.lastTicketsThreshold,
        position: maxPosition + index,
        is_active: preset.sellingMode === 'simple' ? true : (index === 0 && remainingRounds.filter(rr => rr.ticketType === preset.ticketType).length === 0),
        auto_activate: preset.sellingMode !== 'timed_entry' && preset.sellingMode !== 'simple',
        ticket_type: preset.ticketType,
        includes_drink: r.includesDrink || preset.includesDrink || false,
        drink_deadline_type: (r.includesDrink || preset.includesDrink) ? (preset.drinkDeadlineType || 'none') : 'none',
        drink_deadline_hours: (r.includesDrink || preset.includesDrink) && preset.drinkDeadlineType === 'hours_after_start' ? preset.drinkDeadlineHours : null,
        drink_cutoff_time: (r.includesDrink || preset.includesDrink) && preset.drinkDeadlineType === 'fixed_time' ? preset.drinkCutoffTime : null,
        entry_deadline: r.entryDeadline ? r.entryDeadline + ':00' : null,
      }));

      const { error } = await supabase.from('ticket_rounds').insert(roundsToInsert);

      if (error) throw error;

      toast.success(t('tickets.presetApplied'));
      setIsPresetDialogOpen(false);
      await fetchTicketRounds(event.id);
      if (preset.sellingMode === 'timed_entry') await fetchEvents();
    } catch (error) {
      console.error('Error applying preset:', error);
      toast.error(t('tickets.errorSaving'));
    }
  };

  const resetPresetForm = () => {
    setPresetFormData({
      name: '',
      totalCapacity: '',
      lastTicketsThreshold: '20',
      includesDrink: false,
      drinkDeadlineType: 'fixed_time',
      drinkDeadlineHours: '2',
      drinkCutoffTime: '02:00',
      rounds: [
        { name: '', price: '', maxTickets: '', entryDeadline: '', includesDrink: false },
        { name: '', price: '', maxTickets: '', entryDeadline: '', includesDrink: false },
        { name: '', price: '', maxTickets: '', entryDeadline: '', includesDrink: false },
      ],
    });
  };

  const addPresetRound = () => {
    const totalCapacity = parseInt(presetFormData.totalCapacity) || 0;
    const currentTotal = presetFormData.rounds.reduce((sum, r) => sum + (parseInt(r.maxTickets) || 0), 0);
    
    if (totalCapacity > 0 && currentTotal >= totalCapacity) {
      toast.error(t('tickets.capacityExceeded'));
      return;
    }
    
    setPresetFormData({
      ...presetFormData,
      rounds: [...presetFormData.rounds, { name: '', price: '', maxTickets: '', entryDeadline: '', includesDrink: false }],
    });
  };

  const removePresetRound = (index: number) => {
    const newRounds = [...presetFormData.rounds];
    newRounds.splice(index, 1);
    setPresetFormData({ ...presetFormData, rounds: newRounds });
  };

  const updatePresetRound = (index: number, field: string, value: string) => {
    const newRounds = [...presetFormData.rounds];
    newRounds[index] = { ...newRounds[index], [field]: value };
    
    // Validate capacity
    if (field === 'maxTickets') {
      const totalCapacity = parseInt(presetFormData.totalCapacity) || 0;
      const newTotal = newRounds.reduce((sum, r) => sum + (parseInt(r.maxTickets) || 0), 0);
      
      if (totalCapacity > 0 && newTotal > totalCapacity) {
        toast.error(t('tickets.capacityExceeded'));
        return;
      }
    }
    
    setPresetFormData({ ...presetFormData, rounds: newRounds });
  };

  const getCurrentRoundsTotal = () => {
    return presetFormData.rounds.reduce((sum, r) => sum + (parseInt(r.maxTickets) || 0), 0);
  };

  const getRemainingCapacity = () => {
    const totalCapacity = parseInt(presetFormData.totalCapacity) || 0;
    if (totalCapacity === 0) return null;
    return totalCapacity - getCurrentRoundsTotal();
  };

  // Bulk add drink to all rounds of an event
  const handleBulkAddDrink = async () => {
    if (!selectedEvent) return;

    try {
      const rounds = ticketRounds[selectedEvent.id] || [];
      const roundsToUpdate = rounds.filter(r => {
        if (bulkDrinkFormData.applyToStandard && r.ticketType === 'standard') return true;
        if (bulkDrinkFormData.applyToVip && r.ticketType === 'vip') return true;
        return false;
      });

      if (roundsToUpdate.length === 0) {
        toast.error(t('tickets.noRoundsSelected'));
        return;
      }

      const updateData: TablesUpdate<'ticket_rounds'> = {
        includes_drink: bulkDrinkFormData.includesDrink,
        drink_deadline_type: bulkDrinkFormData.includesDrink ? bulkDrinkFormData.drinkDeadlineType : null,
        drink_deadline_hours: bulkDrinkFormData.includesDrink && bulkDrinkFormData.drinkDeadlineType === 'hours_after_start'
          ? parseInt(bulkDrinkFormData.drinkDeadlineHours) || 2
          : null,
        drink_cutoff_time: bulkDrinkFormData.includesDrink && bulkDrinkFormData.drinkDeadlineType === 'fixed_time'
          ? bulkDrinkFormData.drinkCutoffTime
          : null,
      };

      const { error } = await supabase
        .from('ticket_rounds')
        .update(updateData)
        .in('id', roundsToUpdate.map(r => r.id));

      if (error) throw error;

      toast.success(t('tickets.bulkDrinkApplied'));
      setIsBulkDrinkDialogOpen(false);
      await fetchTicketRounds(selectedEvent.id);
    } catch (error) {
      console.error('Error applying bulk drink:', error);
      toast.error(t('tickets.errorSaving'));
    }
  };

  if (venueLoading || loading) return <OwnerPageSkeleton />;

  return (
    <div className={isOrganizerScope ? '' : 'min-h-screen pb-28'} style={isOrganizerScope ? undefined : { background: '#000' }}>
      {!isOrganizerScope && (
        <div
          className="fixed inset-0 pointer-events-none z-0"
          style={{ background: 'radial-gradient(120% 60% at 50% -10%,rgba(255,255,255,.025),transparent 55%)' }}
        />
      )}
      {!isOrganizerScope && <OwnerHeader title={t('tickets.ticketManagement')} />}

      <div className="relative z-10 container mx-auto px-3 sm:px-4 py-4 sm:py-8 space-y-5">
        <CollabReadOnlyBanner action="La création de billetterie" />
        {/* Insurance toggle (venue-scoped only) */}
        {!isOrganizerScope && (
          <div className="flex items-center justify-between gap-3 px-5 py-4" style={MAIN_CARD}>
            <div className="flex items-center gap-3">
              <div
                className="w-8 h-8 flex items-center justify-center rounded-xl flex-none"
                style={{ background: C_FAINT, border: `1px solid ${BORDER}`, color: T2 }}
              >
                <ShieldCheck className="h-4 w-4" />
              </div>
              <div>
                <p style={{ color: T1, fontSize: 14, fontWeight: 600, letterSpacing: '-0.01em' }}>{t('tickets.cancellationInsurance')}</p>
                <p style={{ color: T3, fontSize: 11.5, marginTop: 2 }}>{t('tickets.cancellationInsuranceDesc')}</p>
              </div>
            </div>
            <Switch checked={insuranceEnabled} onCheckedChange={handleToggleInsurance} />
          </div>
        )}

        {/* Tab bar (DA underline) */}
        <div className="flex gap-0.5" style={{ borderBottom: `1px solid ${BORDER}` }}>
          {([
            { id: 'events', label: t('tickets.events'), icon: Ticket, show: true },
            { id: 'presets', label: t('tickets.presets'), icon: FolderOpen, show: !isOrganizerScope },
          ] as const)
            .filter((tb) => tb.show)
            .map((tb) => {
              const Icon = tb.icon;
              const isActive = activeTab === tb.id;
              return (
                <button
                  key={tb.id}
                  onClick={() => setActiveTab(tb.id)}
                  className="relative inline-flex items-center gap-2 px-4 py-3 text-[13.5px] font-[560] transition-colors duration-150 cursor-pointer"
                  style={{ color: isActive ? T1 : T3, background: 'transparent', border: 'none' }}
                >
                  <Icon className="w-4 h-4" />
                  {tb.label}
                  {isActive && (
                    <span
                      className="absolute left-3 right-3 rounded-full"
                      style={{ bottom: -1, height: 2, background: RED, boxShadow: '0 0 10px rgba(232,25,44,0.6)' }}
                    />
                  )}
                </button>
              );
            })}
        </div>

        {activeTab === 'events' && (
            events.length === 0 ? (
              <div className="py-16 text-center" style={MAIN_CARD}>
                <Ticket className="mx-auto h-14 w-14 mb-4" style={{ color: 'rgba(255,255,255,0.12)' }} />
                <p className="mb-4" style={{ color: T2, fontSize: 14 }}>{t('tickets.noUpcomingEvents')}</p>
                <Button onClick={() => navigate(isOrganizerScope ? '/organizer-app/events' : '/owner/events')} style={{ background: RED, color: '#fff' }}>
                  {t('tickets.createEvent')}
                </Button>
              </div>
            ) : (
              <div className="space-y-4">
                {events.map((event) => {
                  const rounds = ticketRounds[event.id] || [];
                  const isSimpleMode = event.ticketSellingMode === 'simple';
                  const totalTickets = isSimpleMode ? (event.maxTickets || 0) : rounds.reduce((sum, r) => sum + r.maxTickets, 0);
                  const soldTickets = rounds.reduce((sum, r) => sum + r.ticketsSold, 0);

                  return (
                    <div key={event.id} className="p-5 sm:p-6" style={MAIN_CARD}>
                      <div className="flex items-start justify-between gap-4 mb-5">
                        <div className="min-w-0">
                          <h3 className="truncate" style={{ color: T1, fontSize: 18, fontWeight: 600, letterSpacing: '-0.015em' }}>{event.title}</h3>
                          <p style={{ color: T3, fontSize: 12.5, marginTop: 3 }}>
                            {formatInTimeZone(new Date(event.startAt), PARIS_TIMEZONE, 'EEEE d MMMM yyyy, HH:mm', { locale: getLocale() })}
                          </p>
                        </div>
                        <div className="flex items-center gap-2 flex-none">
                          <span className="hidden sm:inline" style={{ color: T3, fontSize: 12.5 }}>{t('tickets.enableTicketing')}</span>
                          <Switch
                            checked={event.ticketingEnabled}
                            onCheckedChange={() => handleToggleTicketing(event)}
                          />
                        </div>
                      </div>

                      <div>
                        {event.ticketingEnabled ? (
                          <div className="space-y-3">
                            {/* Selling mode toggle */}
                            <div className="flex items-center justify-between gap-3 p-3.5" style={INNER_CARD}>
                              <div className="flex items-center gap-3">
                                <Clock className="h-4 w-4 flex-none" style={{ color: T3 }} />
                                <div>
                                  <p style={{ color: T1, fontSize: 13.5, fontWeight: 560 }}>{t('tickets.sellingMode')}</p>
                                  <p style={{ color: T3, fontSize: 11.5, marginTop: 1 }}>
                                    {event.ticketSellingMode === 'simple'
                                      ? t('tickets.sellingModeSimpleDesc')
                                      : event.ticketSellingMode === 'timed_entry'
                                        ? t('tickets.sellingModeTimedDesc')
                                        : t('tickets.sellingModeRoundsDesc')}
                                  </p>
                                </div>
                              </div>
                              {soldTickets > 0 ? (
                                <TooltipProvider>
                                  <Tooltip>
                                    <TooltipTrigger asChild>
                                      <div className="flex items-center gap-2 px-3 py-1.5 text-[13px]" style={{ ...TILE, color: T2 }}>
                                        <Lock className="h-3.5 w-3.5" />
                                        {event.ticketSellingMode === 'simple' ? t('tickets.sellingModeSimple') : event.ticketSellingMode === 'timed_entry' ? t('tickets.sellingModeTimed') : t('tickets.sellingModeRounds')}
                                      </div>
                                    </TooltipTrigger>
                                    <TooltipContent>
                                      <p>{t('tickets.sellingModeLocked')}</p>
                                    </TooltipContent>
                                  </Tooltip>
                                </TooltipProvider>
                              ) : (
                                <Select
                                  value={event.ticketSellingMode}
                                  onValueChange={(value) => handleChangeSellingMode(event as any, value as TicketSellingMode)}
                                >
                                  <SelectTrigger className="w-[160px]">
                                    <SelectValue />
                                  </SelectTrigger>
                                  <SelectContent>
                                    <SelectItem value="simple">{t('tickets.sellingModeSimple')}</SelectItem>
                                    <SelectItem value="rounds">{t('tickets.sellingModeRounds')}</SelectItem>
                                    <SelectItem value="timed_entry">{t('tickets.sellingModeTimed')}</SelectItem>
                                  </SelectContent>
                                </Select>
                              )}
                            </div>

                            {/* Rounds visibility (only for rounds mode) */}
                            {event.ticketSellingMode === 'rounds' && (
                              <div className="flex items-center justify-between gap-3 flex-wrap p-3.5" style={INNER_CARD}>
                                <div className="flex items-center gap-3 min-w-0">
                                  <Ticket className="h-4 w-4 flex-shrink-0" style={{ color: T3 }} />
                                  <div className="min-w-0">
                                    <p style={{ color: T1, fontSize: 13.5, fontWeight: 560 }}>{t('tickets.roundsVisibilityLabel')}</p>
                                    <p className="truncate" style={{ color: T3, fontSize: 11.5, marginTop: 1 }}>
                                      {(event.roundsVisibility ?? 'sequential') === 'sequential' && t('tickets.roundsVisibilitySequential')}
                                      {event.roundsVisibility === 'preview_upcoming' && t('tickets.roundsVisibilityPreview')}
                                      {event.roundsVisibility === 'all_open' && t('tickets.roundsVisibilityAll')}
                                    </p>
                                  </div>
                                </div>
                                <Select
                                  value={event.roundsVisibility ?? 'sequential'}
                                  onValueChange={async (value) => {
                                    const { error } = await supabase
                                      .from('events')
                                      .update({ rounds_visibility: value } as any)
                                      .eq('id', event.id);
                                    if (error) {
                                      toast.error(error.message);
                                      return;
                                    }
                                    setEvents(prev => prev.map(ev => ev.id === event.id ? { ...ev, roundsVisibility: value as any } : ev));
                                    toast.success(t('common.saved') || 'Enregistré');
                                  }}
                                >
                                  <SelectTrigger className="w-[180px]">
                                    <SelectValue />
                                  </SelectTrigger>
                                  <SelectContent>
                                    <SelectItem value="sequential">{t('tickets.roundsVisibilitySequential')}</SelectItem>
                                    <SelectItem value="preview_upcoming">{t('tickets.roundsVisibilityPreview')}</SelectItem>
                                    <SelectItem value="all_open">{t('tickets.roundsVisibilityAll')}</SelectItem>
                                  </SelectContent>
                                </Select>
                              </div>
                            )}

                            {/* Global capacity for simple mode */}
                            {event.ticketSellingMode === 'simple' && (
                              <div className="p-3.5 space-y-2.5" style={INNER_CARD}>
                                <div className="flex items-center gap-3">
                                  <Users className="h-4 w-4 flex-none" style={{ color: T3 }} />
                                  <div>
                                    <p style={{ color: T1, fontSize: 13.5, fontWeight: 560 }}>{t('tickets.globalCapacity')}</p>
                                    <p style={{ color: T3, fontSize: 11.5, marginTop: 1 }}>{t('tickets.globalCapacityDesc')}</p>
                                  </div>
                                </div>
                                <div className="flex gap-2">
                                  <Input
                                    type="number"
                                    min="1"
                                    placeholder="200"
                                    defaultValue={event.maxTickets || ''}
                                    onBlur={(e) => {
                                      const val = parseInt(e.target.value);
                                      if (val > 0) handleUpdateGlobalCapacity(event.id, val);
                                    }}
                                  />
                                </div>
                                {event.maxTickets && (
                                  <div style={{ color: T3, fontSize: 11.5 }}>
                                    {soldTickets} / {event.maxTickets} {t('tickets.sold')}
                                  </div>
                                )}
                              </div>
                            )}

                            {/* Max tickets per person */}
                            <div className="p-3.5 space-y-2.5" style={INNER_CARD}>
                              <div className="flex items-center gap-3">
                                <Ticket className="h-4 w-4 flex-none" style={{ color: T3 }} />
                                <div>
                                  <p style={{ color: T1, fontSize: 13.5, fontWeight: 560 }}>{t('tickets.maxPerPerson')}</p>
                                  <p style={{ color: T3, fontSize: 11.5, marginTop: 1 }}>{t('tickets.maxPerPersonDesc')}</p>
                                </div>
                              </div>
                              <Input
                                type="number"
                                min="1"
                                placeholder={t('tickets.maxPerPersonPlaceholder')}
                                defaultValue={event.maxTicketsPerPerson ?? ''}
                                onBlur={(e) => {
                                  const raw = e.target.value.trim();
                                  const val = raw === '' ? null : parseInt(raw, 10);
                                  const current = event.maxTicketsPerPerson ?? null;
                                  const next = val && val > 0 ? val : null;
                                  if (next !== current) handleUpdateMaxPerPerson(event.id, next);
                                }}
                              />
                              <p style={{ color: T3, fontSize: 11 }}>
                                {event.maxTicketsPerPerson
                                  ? t('tickets.maxPerPersonActive').replace('{count}', String(event.maxTicketsPerPerson))
                                  : t('tickets.maxPerPersonNone')}
                              </p>
                            </div>

                            {/* Password-gated sale */}
                            <div className="p-3.5 space-y-3" style={INNER_CARD}>
                              <div className="flex items-center justify-between gap-3">
                                <div className="flex items-center gap-3 min-w-0">
                                  <Lock className="h-4 w-4 flex-none" style={{ color: event.salePasswordEnabled ? RED : T3 }} />
                                  <div className="min-w-0">
                                    <p style={{ color: T1, fontSize: 13.5, fontWeight: 560 }}>{t('tickets.salePassword')}</p>
                                    <p style={{ color: T3, fontSize: 11.5, marginTop: 1 }}>{t('tickets.salePasswordDesc')}</p>
                                  </div>
                                </div>
                                {event.salePasswordEnabled && (
                                  <span
                                    className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10.5px] font-semibold shrink-0"
                                    style={{ background: 'rgba(232,25,44,0.12)', border: `1px solid rgba(232,25,44,0.3)`, color: RED }}
                                  >
                                    <Lock className="h-2.5 w-2.5" />
                                    {t('tickets.salePasswordOn')}
                                  </span>
                                )}
                              </div>
                              <Input
                                type="text"
                                autoComplete="off"
                                placeholder={event.salePasswordEnabled ? t('tickets.salePasswordChangePlaceholder') : t('tickets.salePasswordPlaceholder')}
                                value={salePasswordDraft[event.id] ?? ''}
                                onChange={(e) => setSalePasswordDraft(prev => ({ ...prev, [event.id]: e.target.value }))}
                              />
                              <div className="flex gap-2">
                                <Button
                                  type="button"
                                  className="flex-1"
                                  disabled={salePasswordSaving === event.id || !(salePasswordDraft[event.id] ?? '').trim()}
                                  onClick={() => handleSetSalePassword(event.id, (salePasswordDraft[event.id] ?? '').trim())}
                                  style={{ background: RED, color: '#fff' }}
                                >
                                  {event.salePasswordEnabled ? t('tickets.salePasswordUpdate') : t('tickets.salePasswordActivate')}
                                </Button>
                                {event.salePasswordEnabled && (
                                  <Button
                                    type="button"
                                    variant="outline"
                                    disabled={salePasswordSaving === event.id}
                                    onClick={() => handleSetSalePassword(event.id, null)}
                                  >
                                    {t('tickets.salePasswordRemove')}
                                  </Button>
                                )}
                              </div>
                            </div>

                            {/* Sales mode */}
                            <div className="p-3.5 space-y-4" style={INNER_CARD}>
                              <div className="space-y-1">
                                <div className="flex items-center gap-2">
                                  <Bell className="h-4 w-4" style={{ color: RED }} />
                                  <p style={{ color: T1, fontSize: 13.5, fontWeight: 560 }}>{t('tickets.salesMode')}</p>
                                </div>
                                <p style={{ color: T3, fontSize: 11.5 }}>{t('tickets.salesModeDesc')}</p>
                              </div>

                              <Select
                                value={advancedOptionsDraft[event.id]?.mode || 'normal'}
                                onValueChange={(value) => handleSetSalesMode(event.id, value as TicketSalesMode)}
                              >
                                <SelectTrigger>
                                  <SelectValue />
                                </SelectTrigger>
                                <SelectContent>
                                  <SelectItem value="private">{t('tickets.salesMode.private')}</SelectItem>
                                  <SelectItem value="presale">{t('tickets.salesMode.presale')}</SelectItem>
                                  <SelectItem value="normal">{t('tickets.salesMode.normal')}</SelectItem>
                                </SelectContent>
                              </Select>

                              {advancedOptionsDraft[event.id]?.mode === 'private' && (
                                <p style={{ color: T3, fontSize: 11.5 }}>{t('tickets.privateModeHint')}</p>
                              )}

                              {advancedOptionsDraft[event.id]?.mode === 'normal' && (
                                <p style={{ color: T3, fontSize: 11.5 }}>{t('tickets.normalModeHint')}</p>
                              )}

                              {advancedOptionsDraft[event.id]?.mode === 'presale' && (
                                <div className="space-y-3">
                                  <p style={{ color: T3, fontSize: 11.5 }}>{t('tickets.presaleModeHint')}</p>
                                  <div>
                                    <Label style={{ ...LABEL, fontSize: 10.5 }}>{t('tickets.presaleMembersStart')}</Label>
                                    <p style={{ color: T3, fontSize: 10, marginTop: 3 }}>{t('tickets.presaleMembersStartDesc')}</p>
                                    <Input
                                      type="datetime-local"
                                      className="mt-1.5"
                                      value={advancedOptionsDraft[event.id]?.presaleStartAt || ''}
                                      onChange={(e) => handleUpdateAdvancedOption(event.id, { presaleStartAt: e.target.value })}
                                    />
                                  </div>

                                  <div>
                                    <Label style={{ ...LABEL, fontSize: 10.5 }}>{t('tickets.publicSaleStart')}</Label>
                                    <p style={{ color: T3, fontSize: 10, marginTop: 3 }}>{t('tickets.publicSaleStartDesc')}</p>
                                    <Input
                                      type="datetime-local"
                                      className="mt-1.5"
                                      value={advancedOptionsDraft[event.id]?.publicSaleStartAt || ''}
                                      onChange={(e) => handleUpdateAdvancedOption(event.id, { publicSaleStartAt: e.target.value })}
                                    />
                                  </div>
                                </div>
                              )}

                              <Button
                                type="button"
                                className="w-full"
                                onClick={() => handleSaveAdvancedOptions(event.id)}
                                style={{ background: RED, color: '#fff' }}
                              >
                                {t('common.save')}
                              </Button>
                            </div>

                            {/* Private List Registrations Viewer */}
                            {(advancedOptionsDraft[event.id]?.mode === 'private' || advancedOptionsDraft[event.id]?.mode === 'presale' || event.waitlistEnabled) && (
                              <EventRegistrationsViewer
                                entries={waitlistEntries[event.id]}
                                onCopyEmails={() => handleCopyEmails(event.id)}
                              />
                            )}

                            {/* Stats */}
                            <div className="grid grid-cols-3 gap-3">
                              {[
                                { val: rounds.length, label: event.ticketSellingMode === 'simple' ? t('tickets.options') : t('tickets.rounds') },
                                { val: totalTickets, label: t('tickets.totalTickets') },
                                { val: soldTickets, label: t('tickets.sold') },
                              ].map((s, i) => (
                                <div key={i} className="text-center p-3.5" style={TILE}>
                                  <div className="tabular-nums leading-none" style={{ color: T1, fontSize: 26, fontWeight: 640, letterSpacing: '-0.025em' }}>{s.val}</div>
                                  <div style={{ ...LABEL, fontSize: 10.5, marginTop: 7 }}>{s.label}</div>
                                </div>
                              ))}
                            </div>

                            {/* Standard Rounds List */}
                            {rounds.filter(r => r.ticketType === 'standard').length > 0 && (
                              <div className="space-y-2">
                                <div className="flex items-center gap-2" style={{ ...LABEL, fontSize: 11, color: T3 }}>
                                  <Ticket className="h-3.5 w-3.5" />
                                  {t('tickets.standardTickets')}
                                </div>
                                {rounds.filter(r => r.ticketType === 'standard').map((round) => (
                                  <EventRoundRow
                                    key={round.id}
                                    round={round}
                                    event={event}
                                    isSimpleMode={isSimpleMode}
                                    isVip={false}
                                    onEdit={handleEditRound}
                                    onDelete={handleDeleteRound}
                                  />
                                ))}
                              </div>
                            )}

                            {/* VIP Rounds List */}
                            {rounds.filter(r => r.ticketType === 'vip').length > 0 && (
                              <div className="space-y-2">
                                <div className="flex items-center gap-2" style={{ ...LABEL, fontSize: 11, color: GOLD }}>
                                  <Crown className="h-3.5 w-3.5" />
                                  {t('tickets.vipTickets')}
                                </div>
                                {rounds.filter(r => r.ticketType === 'vip').map((round) => (
                                  <EventRoundRow
                                    key={round.id}
                                    round={round}
                                    event={event}
                                    isSimpleMode={isSimpleMode}
                                    isVip={true}
                                    onEdit={handleEditRound}
                                    onDelete={handleDeleteRound}
                                  />
                                ))}
                              </div>
                            )}

                            <div className="flex gap-2 flex-wrap pt-1">
                              <Button
                                variant="outline"
                                className="flex-1"
                                onClick={() => handleAddRound(event, 'standard')}
                                style={{ background: C_FAINT, border: `1px solid ${BORDER}`, color: T1 }}
                              >
                                <Plus className="h-4 w-4 mr-2" />
                                {event.ticketSellingMode === 'simple' ? t('tickets.addOption') : t('tickets.addRound')}
                              </Button>
                              {rounds.length > 0 && (() => {
                                const allHaveDrink = rounds.every(r => r.includesDrink);
                                return (
                                  <Button
                                    variant="outline"
                                    className="disabled:opacity-40 disabled:cursor-not-allowed"
                                    disabled={allHaveDrink}
                                    onClick={() => {
                                      setSelectedEvent(event);
                                      setBulkDrinkFormData({
                                        includesDrink: true,
                                        drinkDeadlineType: 'fixed_time',
                                        drinkDeadlineHours: '2',
                                        drinkCutoffTime: '02:00',
                                        applyToStandard: true,
                                        applyToVip: true,
                                      });
                                      setIsBulkDrinkDialogOpen(true);
                                    }}
                                    title={allHaveDrink ? t('tickets.allRoundsHaveDrink') : undefined}
                                    style={{ background: 'rgba(52,211,153,0.08)', border: '1px solid rgba(52,211,153,0.25)', color: POS }}
                                  >
                                    <Wine className="h-4 w-4 mr-2" />
                                    {t('tickets.addDrinkToAll')}
                                  </Button>
                                );
                              })()}
                            </div>
                          </div>
                        ) : (
                          <p className="text-center py-4" style={{ color: T3, fontSize: 13 }}>
                            {t('tickets.ticketingDisabledDesc')}
                          </p>
                        )}
                      </div>
                    </div>
                  );
                })}
              </div>
            )
        )}

        {activeTab === 'presets' && (
            <div className="space-y-5">
              <div className="flex justify-between items-center gap-3">
                <p style={{ color: T3, fontSize: 12.5 }}>{t('tickets.presetsDescription')}</p>
                <Button onClick={() => handleCreatePreset()} className="flex-none" style={{ background: RED, color: '#fff' }}>
                  <Plus className="h-4 w-4 mr-2" />
                  {t('tickets.createPreset')}
                </Button>
              </div>

              {presets.length === 0 ? (
                <div className="py-16 text-center" style={MAIN_CARD}>
                  <FolderOpen className="mx-auto h-14 w-14 mb-4" style={{ color: 'rgba(255,255,255,0.12)' }} />
                  <p className="mb-4" style={{ color: T2, fontSize: 14 }}>{t('tickets.noPresets')}</p>
                  <Button onClick={() => handleCreatePreset()} style={{ background: RED, color: '#fff' }}>
                    {t('tickets.createPreset')}
                  </Button>
                </div>
              ) : (
                <>
                  {/* Group by selling mode */}
                  {([
                    { mode: 'simple' as PresetSellingMode, label: t('tickets.presetsSimple'), icon: <Ticket className="h-4 w-4" style={{ color: RED }} /> },
                    { mode: 'rounds' as PresetSellingMode, label: t('tickets.presetsRounds'), icon: <Zap className="h-4 w-4" style={{ color: RED }} /> },
                    { mode: 'timed_entry' as PresetSellingMode, label: t('tickets.presetsTimed'), icon: <Clock className="h-4 w-4" style={{ color: RED }} /> },
                  ]).map(({ mode, label, icon }) => {
                    const modePresets = presets.filter(p => p.sellingMode === mode);
                    if (modePresets.length === 0) return null;

                    const standardPresets = modePresets.filter(p => p.ticketType === 'standard');
                    const vipPresets = modePresets.filter(p => p.ticketType === 'vip');

                    return (
                      <div key={mode} className="space-y-4">
                        <div className="flex items-center gap-2 pb-2" style={{ borderBottom: `1px solid ${BORDER}` }}>
                          {icon}
                          <h3 style={{ color: T1, fontSize: 15.5, fontWeight: 600, letterSpacing: '-0.01em' }}>{label}</h3>
                          <span className="inline-flex items-center px-2 py-0.5 rounded-full text-[11px] font-semibold tabular-nums" style={{ background: C_FAINT, border: `1px solid ${BORDER}`, color: T2 }}>{modePresets.length}</span>
                        </div>

                        {standardPresets.length > 0 && (
                          <div className="space-y-3">
                            <div className="flex items-center gap-2" style={{ ...LABEL, fontSize: 11, color: T3 }}>
                              <Ticket className="h-3.5 w-3.5" />
                              {t('tickets.standardPresets')}
                            </div>
                            <div className="grid gap-3 md:grid-cols-2">
                              {standardPresets.map((preset) => (
                                <div key={preset.id} className="p-4" style={MAIN_CARD}>
                                  <div className="flex items-start justify-between gap-2 mb-3">
                                    <div className="min-w-0">
                                      <h4 className="truncate" style={{ color: T1, fontSize: 15, fontWeight: 600, letterSpacing: '-0.01em' }}>{preset.name}</h4>
                                      <p className="tabular-nums" style={{ color: T3, fontSize: 12, marginTop: 2 }}>
                                        {mode !== 'simple' && <>{preset.totalCapacity} {t('tickets.places')} · </>}
                                        {preset.rounds.length} {mode === 'simple' ? t('tickets.options') : t('tickets.rounds')}
                                      </p>
                                    </div>
                                    <div className="flex items-center gap-1 flex-none">
                                      <Button variant="ghost" size="icon" onClick={() => handleEditPreset(preset)} style={{ color: T2 }}>
                                        <Pencil className="h-4 w-4" />
                                      </Button>
                                      <Button variant="ghost" size="icon" onClick={() => handleDeletePreset(preset.id)} style={{ color: RED }}>
                                        <Trash2 className="h-4 w-4" />
                                      </Button>
                                    </div>
                                  </div>
                                  <div className="space-y-1.5">
                                    {preset.rounds.map((round, index) => (
                                      <div key={index} className="flex justify-between items-center gap-2 tabular-nums" style={{ fontSize: 13 }}>
                                        <span className="flex items-center gap-1.5 min-w-0" style={{ color: T2 }}>
                                          <span className="truncate">{round.name}</span>
                                          {round.entryDeadline && <span className="inline-flex items-center gap-0.5 flex-none" style={{ color: RED, fontSize: 11 }}><Clock className="h-3 w-3" />{round.entryDeadline}</span>}
                                          {round.includesDrink && <Wine className="h-3 w-3 flex-none" style={{ color: POS }} />}
                                        </span>
                                        <span className="flex-none" style={{ color: T1, fontWeight: 560 }}>
                                          {mode !== 'simple' && <>{round.maxTickets} × </>}{round.price}€
                                        </span>
                                      </div>
                                    ))}
                                  </div>
                                </div>
                              ))}
                            </div>
                          </div>
                        )}

                        {vipPresets.length > 0 && (
                          <div className="space-y-3">
                            <div className="flex items-center gap-2" style={{ ...LABEL, fontSize: 11, color: GOLD }}>
                              <Crown className="h-3.5 w-3.5" />
                              {t('tickets.vipPresets')}
                            </div>
                            <div className="grid gap-3 md:grid-cols-2">
                              {vipPresets.map((preset) => (
                                <div key={preset.id} className="p-4" style={{ background: 'rgba(252,211,153,0.05)', border: '1px solid rgba(252,211,153,0.18)', borderRadius: 18, boxShadow: CARD_SHADOW }}>
                                  <div className="flex items-start justify-between gap-2 mb-3">
                                    <div className="min-w-0">
                                      <div className="flex items-center gap-2">
                                        <h4 className="truncate" style={{ color: T1, fontSize: 15, fontWeight: 600, letterSpacing: '-0.01em' }}>{preset.name}</h4>
                                        <span className="inline-flex items-center px-2 py-0.5 rounded-full text-[10.5px] font-semibold flex-none" style={{ background: 'rgba(252,211,153,0.12)', border: '1px solid rgba(252,211,153,0.3)', color: GOLD }}>VIP</span>
                                      </div>
                                      <p className="tabular-nums" style={{ color: T3, fontSize: 12, marginTop: 2 }}>
                                        {mode !== 'simple' && <>{preset.totalCapacity} {t('tickets.places')} · </>}
                                        {preset.rounds.length} {mode === 'simple' ? t('tickets.options') : t('tickets.rounds')}
                                      </p>
                                    </div>
                                    <div className="flex items-center gap-1 flex-none">
                                      <Button variant="ghost" size="icon" onClick={() => handleEditPreset(preset)} style={{ color: T2 }}>
                                        <Pencil className="h-4 w-4" />
                                      </Button>
                                      <Button variant="ghost" size="icon" onClick={() => handleDeletePreset(preset.id)} style={{ color: RED }}>
                                        <Trash2 className="h-4 w-4" />
                                      </Button>
                                    </div>
                                  </div>
                                  <div className="space-y-1.5">
                                    {preset.rounds.map((round, index) => (
                                      <div key={index} className="flex justify-between items-center gap-2 tabular-nums" style={{ fontSize: 13 }}>
                                        <span className="flex items-center gap-1.5 min-w-0" style={{ color: T2 }}>
                                          <span className="truncate">{round.name}</span>
                                          {round.entryDeadline && <span className="inline-flex items-center gap-0.5 flex-none" style={{ color: RED, fontSize: 11 }}><Clock className="h-3 w-3" />{round.entryDeadline}</span>}
                                          {round.includesDrink && <Wine className="h-3 w-3 flex-none" style={{ color: POS }} />}
                                        </span>
                                        <span className="flex-none" style={{ color: T1, fontWeight: 560 }}>
                                          {mode !== 'simple' && <>{round.maxTickets} × </>}{round.price}€
                                        </span>
                                      </div>
                                    ))}
                                  </div>
                                </div>
                              ))}
                            </div>
                          </div>
                        )}
                      </div>
                    );
                  })}
                </>
              )}
            </div>
        )}

        {/* Round Dialog */}
        <RoundDialog
          isRoundDialogOpen={isRoundDialogOpen}
          setIsRoundDialogOpen={setIsRoundDialogOpen}
          editingRound={editingRound}
          roundFormData={roundFormData}
          setRoundFormData={setRoundFormData}
          selectedEvent={selectedEvent}
          events={events}
          freeDrinkMode={freeDrinkMode}
          setFreeDrinkMode={setFreeDrinkMode}
          venueId={venueId}
          handleSaveRound={handleSaveRound}
        />

        {/* Create/Edit Preset Dialog */}
        <PresetDialog
          isPresetDialogOpen={isPresetDialogOpen}
          setIsPresetDialogOpen={setIsPresetDialogOpen}
          setEditingPreset={setEditingPreset}
          presetTicketType={presetTicketType}
          editingPreset={editingPreset}
          presetSellingMode={presetSellingMode}
          presetFormData={presetFormData}
          setPresetFormData={setPresetFormData}
          handleSavePreset={handleSavePreset}
          getRemainingCapacity={getRemainingCapacity}
          getCurrentRoundsTotal={getCurrentRoundsTotal}
          addPresetRound={addPresetRound}
          removePresetRound={removePresetRound}
          updatePresetRound={updatePresetRound}
          defaultRoundPlaceholders={defaultRoundPlaceholders}
        />


        {/* Preset Type Selection Dialog — 2 steps: mode then type */}
        <PresetTypeDialog
          isPresetTypeDialogOpen={isPresetTypeDialogOpen}
          setIsPresetTypeDialogOpen={setIsPresetTypeDialogOpen}
          presetTypeStep={presetTypeStep}
          setPresetTypeStep={setPresetTypeStep}
          presetSellingMode={presetSellingMode}
          handleSelectPresetMode={handleSelectPresetMode}
          handleSelectPresetType={handleSelectPresetType}
        />

        {/* Bulk Drink Dialog */}
        <BulkDrinkDialog
          isBulkDrinkDialogOpen={isBulkDrinkDialogOpen}
          setIsBulkDrinkDialogOpen={setIsBulkDrinkDialogOpen}
          bulkDrinkFormData={bulkDrinkFormData}
          setBulkDrinkFormData={setBulkDrinkFormData}
          handleBulkAddDrink={handleBulkAddDrink}
        />

        {/* Activation Wizard Dialog */}
        <ActivationWizardDialog
          isActivationWizardOpen={isActivationWizardOpen}
          setIsActivationWizardOpen={setIsActivationWizardOpen}
          wizardModeChange={wizardModeChange}
          setWizardModeChange={setWizardModeChange}
          wizardStep={wizardStep}
          setWizardStep={setWizardStep}
          wizardSellingMode={wizardSellingMode}
          setWizardSellingMode={setWizardSellingMode}
          wizardSelectedPresets={wizardSelectedPresets}
          setWizardSelectedPresets={setWizardSelectedPresets}
          wizardCustomRounds={wizardCustomRounds}
          setWizardCustomRounds={setWizardCustomRounds}
          wizardSalesDraft={wizardSalesDraft}
          setWizardSalesDraft={setWizardSalesDraft}
          presets={presets}
          handleWizardApplyModeChange={handleWizardApplyModeChange}
          handleWizardPublish={handleWizardPublish}
        />
      </div>
    </div>
  );
}