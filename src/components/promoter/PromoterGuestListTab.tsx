import { useState, useEffect } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { useLanguage } from '@/contexts/LanguageContext';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Badge } from '@/components/ui/badge';
import { Progress } from '@/components/ui/progress';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { toast } from 'sonner';
import { UserPlus, Users, Loader2, BarChart3, Calendar, Zap, Clock, Mail, Link2 } from 'lucide-react';
import { PublicTypesEditor } from '@/components/guest-list/PublicTypesEditor';
import { PublicLinksPanel } from '@/components/guest-list/PublicLinksPanel';
import { InviteLinksPanel } from '@/components/guest-list/InviteLinksPanel';
import { glSlugify } from '@/lib/guestListShare';
import type { GLTypeSource } from '@/lib/guestListTypes';

interface PromoterProfile {
  id: string;
  user_id: string;
  venue_id: string | null;
  organizer_user_id?: string | null;
  promo_code: string;
  is_active: boolean;
  default_commission_template_id?: string;
  venue?: { id: string; name: string; logo_url?: string };
  organizerName?: string;
}

interface PromoterGuestListTabProps {
  promoterProfiles: PromoterProfile[];
}

interface GuestEntry {
  id: string;
  fullName: string;
  email: string;
  entryType: string;
  createdAt: string;
}

interface QuotaBreakdown {
  globalQuota: number | null;
  normalQuota: number | null;
  tableQuota: number | null;
  drinkQuota: number | null;
  femaleQuota: number | null;
  maleQuota: number | null;
}

interface QuotaUsage {
  total: number;
  normal: number;
  table: number;
  drink: number;
}

type EntryType = 'normal' | 'table' | 'drink';

interface EventOption {
  id: string;
  title: string;
  startAt: string;
  endAt: string;
  venueId: string | null;
  organizerUserId: string | null;
  venueName: string;
}

export function PromoterGuestListTab({ promoterProfiles }: PromoterGuestListTabProps) {
  const { t, language } = useLanguage();
  const [events, setEvents] = useState<EventOption[]>([]);
  const [selectedEventId, setSelectedEventId] = useState<string>('');
  const [entries, setEntries] = useState<GuestEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [adding, setAdding] = useState(false);
  const [firstName, setFirstName] = useState('');
  const [lastName, setLastName] = useState('');
  const [email, setEmail] = useState('');
  const [entryType, setEntryType] = useState<EntryType>('normal');
  // Sexe optionnel : ne compte que si le club a fixé un quota Femmes/Hommes sur la
  // part (valeurs stockées 'female'/'male' ; le trigger d'atomic-capacity applique).
  const [gender, setGender] = useState<'female' | 'male' | ''>('');

  const [quota, setQuota] = useState<QuotaBreakdown>({ globalQuota: null, normalQuota: null, tableQuota: null, drinkQuota: null, femaleQuota: null, maleQuota: null });
  const [usage, setUsage] = useState<QuotaUsage>({ total: 0, normal: 0, table: 0, drink: 0 });
  // Une part peut exister avec quota NULL = allocation ILLIMITÉE : il faut donc
  // distinguer « pas de part » (aucune allocation) de « part sans plafond ».
  const [hasAllocation, setHasAllocation] = useState(false);
  // La part complète — nécessaire aux canaux (types offerts, liens uniques).
  const [partRow, setPartRow] = useState<(GLTypeSource & { id: string; public_entry_types: string[] | null; share_token: string }) | null>(null);

  // Get the promoter profile that owns the selected event — by venue for club events,
  // by organizer for organizer events.
  const selectedEvent = events.find(e => e.id === selectedEventId);
  const activePromoter = selectedEvent
    ? promoterProfiles.find(p =>
        selectedEvent.venueId
          ? p.venue_id === selectedEvent.venueId
          : !!p.organizer_user_id && p.organizer_user_id === selectedEvent.organizerUserId)
    : null;

  // Fetch events across all venues
  useEffect(() => {
    fetchEvents();
  }, [promoterProfiles]);

  // Auto-sélection : la soirée en cours (triée en tête par start_at) ou la
  // prochaine — le promoteur n'a plus à choisir dans le cas courant.
  useEffect(() => {
    if (!selectedEventId && events.length > 0) {
      setSelectedEventId(events[0].id);
    }
  }, [events, selectedEventId]);

  async function fetchEvents() {
    setLoading(true);
    try {
      const venueIds = [...new Set(promoterProfiles.map(p => p.venue_id).filter(Boolean))] as string[];
      const orgIds = [...new Set(promoterProfiles.map(p => p.organizer_user_id).filter(Boolean))] as string[];
      if (!venueIds.length && !orgIds.length) { setEvents([]); setLoading(false); return; }

      // Cover both scopes: club events (venue_id, host OU partenaire de co-event)
      // and organizer events (own or partner).
      const orParts: string[] = [];
      if (venueIds.length) {
        orParts.push(`venue_id.in.(${venueIds.join(',')})`);
        orParts.push(`partner_venue_id.in.(${venueIds.join(',')})`);
      }
      if (orgIds.length) {
        orParts.push(`organizer_user_id.in.(${orgIds.join(',')})`);
        orParts.push(`partner_organizer_id.in.(${orgIds.join(',')})`);
      }

      const now = new Date().toISOString();
      const { data } = await supabase.from('events')
        .select('id, title, start_at, end_at, venue_id, organizer_user_id, venues!events_venue_id_fkey(name)')
        .or(orParts.join(','))
        .gte('end_at', now)
        .order('start_at', { ascending: true })
        .limit(30);

      const mapped: EventOption[] = (data || []).map((e: any) => {
        const orgProfile = !e.venue_id && e.organizer_user_id
          ? promoterProfiles.find(p => p.organizer_user_id === e.organizer_user_id)
          : null;
        return {
          id: e.id,
          title: e.title,
          startAt: e.start_at,
          endAt: e.end_at,
          venueId: e.venue_id ?? null,
          organizerUserId: e.organizer_user_id ?? null,
          venueName: e.venues?.name || orgProfile?.organizerName || '',
        };
      });
      setEvents(mapped);
    } catch (err) {
      console.error(err);
    } finally {
      setLoading(false);
    }
  }

  // Fetch quota + entries when event selected
  useEffect(() => {
    if (selectedEventId && activePromoter) {
      fetchQuotaAndEntries();
    } else {
      setEntries([]);
      setQuota({ globalQuota: null, normalQuota: null, tableQuota: null, drinkQuota: null, femaleQuota: null, maleQuota: null });
      setUsage({ total: 0, normal: 0, table: 0, drink: 0 });
      setHasAllocation(false);
    }
  }, [selectedEventId, activePromoter?.id]);

  async function fetchQuotaAndEntries() {
    if (!activePromoter || !selectedEventId) return;
    try {
      // The promoter's guest list is now their OWN allocation: a guest_lists "part"
      // with holder_type='promoter', created and capped by the club on the Guest List
      // page (single global quota). No part = no allocation yet.
      const { data: part } = await supabase.from('guest_lists')
        .select('id, holder_type, quota, quota_normal, quota_drink, quota_table, quota_female, quota_male, entry_kind, public_entry_types, share_token')
        .eq('event_id', selectedEventId)
        .eq('holder_type', 'promoter')
        .eq('promoter_id', activePromoter.id)
        .maybeSingle();

      if (!part) {
        setHasAllocation(false);
        setPartRow(null);
        setQuota({ globalQuota: null, normalQuota: null, tableQuota: null, drinkQuota: null, femaleQuota: null, maleQuota: null });
        setEntries([]);
        setUsage({ total: 0, normal: 0, table: 0, drink: 0 });
        return;
      }
      setHasAllocation(true);
      setPartRow(part);
      // Per-type allocation set by the club on the Guest List page (e.g. 10 normal + 2 VIP).
      // part.quota NULL = allocation illimitée.
      setQuota({
        globalQuota: part.quota,
        normalQuota: part.quota_normal || null,
        drinkQuota: part.quota_drink || null,
        tableQuota: part.quota_table || null,
        femaleQuota: part.quota_female || null,
        maleQuota: part.quota_male || null,
      });

      // Fetch entries by this promoter on their part
      const { data: entriesData } = await supabase.from('guest_list_entries')
        .select('id, full_name, email, entry_type, created_at')
        .eq('guest_list_id', part.id)
        .eq('promoter_id', activePromoter.id)
        .neq('status', 'cancelled')
        .order('created_at', { ascending: false });

      const mapped: GuestEntry[] = (entriesData || []).map(d => ({
        id: d.id,
        fullName: d.full_name || '',
        email: d.email || '',
        entryType: (d as any).entry_type || 'normal',
        createdAt: d.created_at,
      }));
      setEntries(mapped);

      // Compute usage
      const u: QuotaUsage = { total: mapped.length, normal: 0, table: 0, drink: 0 };
      mapped.forEach(e => {
        if (e.entryType === 'table') u.table++;
        else if (e.entryType === 'drink') u.drink++;
        else u.normal++;
      });
      setUsage(u);
    } catch (err) {
      console.error(err);
    }
  }

  async function handleAdd() {
    if (!firstName.trim() || !lastName.trim()) {
      toast.error(t('promoterGuestlist.nameRequired'));
      return;
    }
    if (!activePromoter || !selectedEventId) return;

    setAdding(true);
    try {
      const fullName = `${firstName.trim()} ${lastName.trim()}`;
      // Send a type the allocation actually offers (per-type quotas set by the club).
      const offered: EntryType[] = [];
      if ((quota.normalQuota ?? 0) > 0) offered.push('normal');
      if ((quota.tableQuota ?? 0) > 0) offered.push('table');
      if ((quota.drinkQuota ?? 0) > 0) offered.push('drink');
      const sendType: EntryType = offered.includes(entryType) ? entryType : (offered[0] ?? 'normal');
      const { data, error } = await supabase.functions.invoke('promoter-add-guest', {
        body: {
          promoterId: activePromoter.id,
          eventId: selectedEventId,
          fullName,
          gender: gender || null,
          email: email.trim() || null,
          entryType: sendType,
        },
      });

      if (error) {
        let fnMessage = '';
        const errorContext = (error as any)?.context;

        if (errorContext && typeof errorContext.json === 'function') {
          try {
            const parsed = await errorContext.json();
            fnMessage = parsed?.error || '';
          } catch {
            // ignore parse errors
          }
        }

        throw new Error(fnMessage || (error as any)?.message || t('promoterGuestlist.addError'));
      }

      if (data?.error) throw new Error(data.error);

      toast.success(t('promoterGuestlist.added'));
      setFirstName('');
      setLastName('');
      setEmail('');
      setEntryType('normal');
      setGender('');
      fetchQuotaAndEntries();
    } catch (err: any) {
      console.error(err);
      toast.error(err.message || t('promoterGuestlist.addError'));
    } finally { setAdding(false); }
  }

  const getEventStatus = (startAt: string, endAt: string) => {
    const now = new Date();
    if (new Date(startAt) <= now && new Date(endAt) >= now) return 'live';
    return 'upcoming';
  };

  const formatDate = (dateStr: string) => {
    return new Date(dateStr).toLocaleDateString(language === 'fr' ? 'fr-FR' : language === 'es' ? 'es-ES' : 'en-US', {
      day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit',
    });
  };

  // Allocation illimitée : une part existe mais sans plafond global (quota NULL).
  const isUnlimited = hasAllocation && quota.globalQuota == null;

  // Available entry types from the club's per-type allocation (only kinds with quota > 0).
  const availableEntryTypes: Array<{ value: EntryType; label: string }> = [];
  if ((quota.normalQuota ?? 0) > 0) availableEntryTypes.push({ value: 'normal', label: t('promoterGuestlist.typeStandard') });
  if ((quota.tableQuota ?? 0) > 0) availableEntryTypes.push({ value: 'table', label: t('promoterGuestlist.typeTable') });
  if ((quota.drinkQuota ?? 0) > 0) availableEntryTypes.push({ value: 'drink', label: t('promoterGuestlist.typeDrink') });
  if (availableEntryTypes.length === 0 && (isUnlimited || (quota.globalQuota ?? 0) > 0)) availableEntryTypes.push({ value: 'normal', label: t('promoterGuestlist.typeStandard') });

  const globalQuotaPercent = quota.globalQuota ? Math.min(100, (usage.total / quota.globalQuota) * 100) : 0;
  const isQuotaFull = quota.globalQuota != null && usage.total >= quota.globalQuota;
  // Places restantes — le chiffre que le promoteur suit toute la soirée.
  const remainingGlobal = isUnlimited ? null : quota.globalQuota != null ? Math.max(0, quota.globalQuota - usage.total) : 0;

  // Check per-type full
  const isTypeFull = (type: EntryType) => {
    if (type === 'normal' && quota.normalQuota != null) return usage.normal >= quota.normalQuota;
    if (type === 'table' && quota.tableQuota != null) return usage.table >= quota.tableQuota;
    if (type === 'drink' && quota.drinkQuota != null) return usage.drink >= quota.drinkQuota;
    return false;
  };

  const entryTypeBadge = (type: string) => {
    if (type === 'table') return <Badge variant="outline" className="shrink-0 whitespace-nowrap text-[10px]">{t('promoterGuestlist.badgeVip')}</Badge>;
    if (type === 'drink') return <Badge variant="outline" className="shrink-0 whitespace-nowrap text-[10px]">{t('promoterGuestlist.badgeDrink')}</Badge>;
    return <Badge variant="secondary" className="shrink-0 whitespace-nowrap text-[10px]">{t('promoterGuestlist.badgeStandard')}</Badge>;
  };

  if (loading) {
    return (
      <div className="flex justify-center py-12">
        <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
      </div>
    );
  }

  return (
    <div className="space-y-4">
      {/* Event Selector */}
      <Card className="border-border">
        <CardHeader className="px-4 pb-2 pt-4 sm:px-6 sm:pt-6">
          <CardTitle className="text-base flex items-center gap-2">
            <Calendar className="h-4 w-4 shrink-0" />
            <span className="min-w-0 truncate">{t('promoterGuestlist.selectEvent')}</span>
          </CardTitle>
        </CardHeader>
        <CardContent className="px-4 pb-4 sm:px-6 sm:pb-6">
          {events.length === 0 ? (
            <p className="text-sm text-muted-foreground">{t('promoterGuestlist.noUpcoming')}</p>
          ) : (
            <Select value={selectedEventId} onValueChange={setSelectedEventId}>
              <SelectTrigger>
                <SelectValue placeholder={t('promoterGuestlist.chooseEvent')} />
              </SelectTrigger>
              <SelectContent>
                {events.map(ev => {
                  const status = getEventStatus(ev.startAt, ev.endAt);
                  return (
                    <SelectItem key={ev.id} value={ev.id}>
                      {/* Titres de soirée / noms de club saisis par le club → tronquer, pas élargir le popup. */}
                      <div className="flex max-w-[min(78vw,20rem)] items-center gap-2">
                        <span className="min-w-0 truncate">{ev.title}</span>
                        {promoterProfiles.length > 1 && (
                          <span className="min-w-0 truncate text-muted-foreground text-xs">— {ev.venueName}</span>
                        )}
                        {status === 'live' ? (
                          <Badge className="bg-destructive text-destructive-foreground text-[9px] px-1.5 py-0 animate-pulse shrink-0">{t('promoterGuestlist.live')}</Badge>
                        ) : (
                          <Badge variant="secondary" className="shrink-0 whitespace-nowrap text-[9px] px-1.5 py-0">
                            <Clock className="h-2.5 w-2.5 mr-0.5" />
                            {t('promoterGuestlist.upcoming')}
                          </Badge>
                        )}
                      </div>
                    </SelectItem>
                  );
                })}
              </SelectContent>
            </Select>
          )}
        </CardContent>
      </Card>

      {/* Content when event selected */}
      {selectedEventId && activePromoter && (
        <>
          {/* Quota Tracking */}
          <Card className="border-border">
            <CardContent className="p-4">
              <div className="flex items-center gap-2 mb-3">
                <BarChart3 className="h-4 w-4 shrink-0 text-muted-foreground" />
                <span className="min-w-0 truncate text-sm font-medium">{t('promoterGuestlist.quotaLabel')}</span>
                {quota.globalQuota != null && (
                  <Badge variant={isQuotaFull ? 'destructive' : 'secondary'} className="ml-auto shrink-0 whitespace-nowrap text-xs tabular-nums">
                    {usage.total} / {quota.globalQuota}
                  </Badge>
                )}
                {isUnlimited && (
                  <Badge variant="secondary" className="ml-auto shrink-0 whitespace-nowrap text-xs tabular-nums">
                    {usage.total} / ∞
                  </Badge>
                )}
              </div>

              {quota.globalQuota != null && (
                <Progress value={globalQuotaPercent} className="h-2 mb-3" />
              )}

              {/* Compteur de places restantes — le suivi live du quota. */}
              {hasAllocation && (
                <div className="mb-3 flex items-center justify-between gap-3 rounded-lg border border-primary/25 bg-primary/5 px-3 py-2.5">
                  <span className="min-w-0 truncate text-xs text-muted-foreground">{t('promoterGuestlist.remaining')}</span>
                  <span className={`shrink-0 text-lg font-bold tabular-nums ${isQuotaFull ? 'text-destructive' : 'text-primary'}`}>
                    {isUnlimited ? '∞' : remainingGlobal}
                  </span>
                </div>
              )}

              {/* Per-type breakdown */}
              <div className="grid grid-cols-3 gap-2">
                {quota.normalQuota != null && (
                  <div className="min-w-0 bg-muted/50 rounded-lg p-2.5 text-center">
                    <p className="truncate text-lg font-bold tabular-nums">{usage.normal}<span className="text-xs font-normal text-muted-foreground">/{quota.normalQuota}</span></p>
                    <p className="truncate text-[10px] text-muted-foreground">{t('promoterGuestlist.entriesLabel')}</p>
                    {usage.normal >= quota.normalQuota && (
                      <Badge variant="destructive" className="text-[9px] mt-1">{t('promoterGuestlist.full')}</Badge>
                    )}
                  </div>
                )}
                {quota.tableQuota != null && (
                  <div className="min-w-0 bg-muted/50 rounded-lg p-2.5 text-center">
                    <p className="truncate text-lg font-bold tabular-nums">{usage.table}<span className="text-xs font-normal text-muted-foreground">/{quota.tableQuota}</span></p>
                    <p className="truncate text-[10px] text-muted-foreground">{t('promoterGuestlist.tablesVip')}</p>
                    {usage.table >= quota.tableQuota && (
                      <Badge variant="destructive" className="text-[9px] mt-1">{t('promoterGuestlist.full')}</Badge>
                    )}
                  </div>
                )}
                {quota.drinkQuota != null && (
                  <div className="min-w-0 bg-muted/50 rounded-lg p-2.5 text-center">
                    <p className="truncate text-lg font-bold tabular-nums">{usage.drink}<span className="text-xs font-normal text-muted-foreground">/{quota.drinkQuota}</span></p>
                    <p className="truncate text-[10px] text-muted-foreground">{t('promoterGuestlist.drinks')}</p>
                    {usage.drink >= quota.drinkQuota && (
                      <Badge variant="destructive" className="text-[9px] mt-1">{t('promoterGuestlist.full')}</Badge>
                    )}
                  </div>
                )}
              </div>

              {!hasAllocation && (
                <p className="text-xs text-amber-500">{t('promoterGuestlist.noAllocation')}</p>
              )}
              {isUnlimited && (
                <p className="text-xs text-muted-foreground">{t('promoterGuestlist.unlimitedHint')}</p>
              )}

              {isQuotaFull && (
                <p className="text-xs text-destructive mt-2">{t('promoterGuestlist.quotaReachedFull')}</p>
              )}
            </CardContent>
          </Card>

          {/* Add Guest Form */}
          <Card className="border-primary/30">
            <CardHeader className="px-4 pb-2 pt-4 sm:px-6 sm:pt-6">
              <CardTitle className="text-base flex items-center gap-2">
                <UserPlus className="h-4 w-4 shrink-0" />
                <span className="min-w-0 truncate">{t('promoterGuestlist.addGuest')}</span>
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-3 px-4 pb-4 sm:px-6 sm:pb-6">
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <Label className="text-xs">{t('promoterGuestlist.firstName')}</Label>
                  <Input value={firstName} onChange={e => setFirstName(e.target.value)} placeholder={t('promoterGuestlist.firstNamePlaceholder')} />
                </div>
                <div>
                  <Label className="text-xs">{t('promoterGuestlist.lastName')}</Label>
                  <Input value={lastName} onChange={e => setLastName(e.target.value)} placeholder={t('promoterGuestlist.lastNamePlaceholder')} />
                </div>
              </div>

              <div>
                <Label className="text-xs flex items-center gap-1">
                  <Mail className="h-3 w-3" />
                  {t('promoterGuestlist.email')}
                </Label>
                <Input type="email" value={email} onChange={e => setEmail(e.target.value)} placeholder={t('promoterGuestlist.emailPlaceholder')} />
                <p className="text-[10px] text-muted-foreground mt-0.5">{t('promoterGuestlist.emailHint')}</p>
              </div>

              {/* Entry type selector */}
              {availableEntryTypes.length > 1 && (
                <div>
                  <Label className="text-xs">{t('promoterGuestlist.entryType')}</Label>
                  <Select value={entryType} onValueChange={v => setEntryType(v as EntryType)}>
                    <SelectTrigger>
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      {availableEntryTypes.map(opt => (
                        <SelectItem key={opt.value} value={opt.value} disabled={isTypeFull(opt.value)}>
                          <div className="flex items-center gap-2">
                            <span>{opt.label}</span>
                            {isTypeFull(opt.value) && <Badge variant="destructive" className="text-[9px]">{t('promoterGuestlist.full')}</Badge>}
                          </div>
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
              )}

              {/* Sexe — n'apparaît que si le club a fixé un quota Femmes/Hommes */}
              {((quota.femaleQuota ?? 0) > 0 || (quota.maleQuota ?? 0) > 0) && (
                <div>
                  <Label className="text-xs">{t('promoterGuestlist.gender')}</Label>
                  <Select value={gender || 'none'} onValueChange={v => setGender(v === 'none' ? '' : v as 'female' | 'male')}>
                    <SelectTrigger>
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="none">{t('promoterGuestlist.genderUnset')}</SelectItem>
                      <SelectItem value="female">{t('promoterGuestlist.female')}</SelectItem>
                      <SelectItem value="male">{t('promoterGuestlist.male')}</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
              )}

              <Button
                onClick={handleAdd}
                disabled={adding || !hasAllocation || !firstName.trim() || !lastName.trim() || isQuotaFull || isTypeFull(entryType)}
                className="w-full"
              >
                {adding ? <Loader2 className="h-4 w-4 animate-spin mr-2" /> : <UserPlus className="h-4 w-4 mr-2" />}
                {t('promoterGuestlist.addToList')}
              </Button>
            </CardContent>
          </Card>

          {/* Lien public & liens uniques — les deux autres canaux de distribution */}
          {partRow && selectedEvent && (
            <Card className="border-border">
              <CardHeader className="px-4 pb-2 pt-4 sm:px-6 sm:pt-6">
                <CardTitle className="text-base flex items-center gap-2">
                  <Link2 className="h-4 w-4 shrink-0" />
                  <span className="min-w-0 truncate">{t('glTools.channelsTitle')}</span>
                </CardTitle>
              </CardHeader>
              <CardContent className="px-4 pb-4 sm:px-6 sm:pb-6">
                {(() => {
                  const partSlugValue = selectedEvent.venueId
                    ? glSlugify(selectedEvent.venueName)
                    : (activePromoter?.organizer_user_id ?? 'organizer');
                  return (
                    <>
                      <PublicTypesEditor guestList={partRow} />
                      <PublicLinksPanel
                        guestListId={partRow.id}
                        shareToken={partRow.share_token}
                        slug={partSlugValue}
                        eventId={selectedEvent.id}
                      />
                      <InviteLinksPanel guestList={partRow} slug={partSlugValue} eventId={selectedEvent.id} />
                    </>
                  );
                })()}
              </CardContent>
            </Card>
          )}

          {/* Entries List */}
          <div className="flex items-center justify-between gap-3 bg-muted/50 rounded-lg p-3">
            <span className="min-w-0 text-sm text-muted-foreground flex items-center gap-2">
              <Users className="h-4 w-4 shrink-0" />
              <span className="truncate">{t('promoterGuestlist.guestsAdded')}</span>
            </span>
            <Badge variant="secondary" className="shrink-0 tabular-nums">{entries.length}</Badge>
          </div>

          {entries.length === 0 ? (
            <Card><CardContent className="p-6 text-center text-muted-foreground text-sm">
              {t('promoterGuestlist.noGuestsEvent')}
            </CardContent></Card>
          ) : (
            <div className="space-y-2">
              {entries.map(entry => (
                <Card key={entry.id}>
                  <CardContent className="p-3 flex items-center justify-between">
                    <div className="min-w-0 flex-1">
                      <div className="flex items-center gap-2">
                        <p className="min-w-0 flex-1 font-medium text-sm truncate">{entry.fullName}</p>
                        {entryTypeBadge(entry.entryType)}
                      </div>
                      <div className="flex items-center gap-2 mt-0.5">
                        {entry.email && (
                          <p className="min-w-0 flex-1 text-[11px] text-muted-foreground truncate">{entry.email}</p>
                        )}
                        <p className="shrink-0 whitespace-nowrap text-[11px] text-muted-foreground">
                          {formatDate(entry.createdAt)}
                        </p>
                      </div>
                    </div>
                  </CardContent>
                </Card>
              ))}
            </div>
          )}
        </>
      )}

      {/* No event selected */}
      {!selectedEventId && events.length > 0 && (
        <Card>
          <CardContent className="p-8 text-center text-muted-foreground text-sm">
            {t('promoterGuestlist.selectToManage')}
          </CardContent>
        </Card>
      )}
    </div>
  );
}
