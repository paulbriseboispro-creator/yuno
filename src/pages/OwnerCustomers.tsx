import { useState, useEffect, useMemo, useCallback } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { useToast } from '@/hooks/use-toast';
import { useLanguage } from '@/contexts/LanguageContext';
import { useVenueContext } from '@/hooks/useVenueContext';
import { OwnerHeader } from '@/components/OwnerHeader';
import { OwnerPageSkeleton } from '@/components/DashboardSkeleton';
import { useSubscriptionPlan } from '@/hooks/useSubscriptionPlan';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from '@/components/ui/dialog';
import { Sheet, SheetContent, SheetHeader, SheetTitle } from '@/components/ui/sheet';
import {
  Users, Search, Ban, CheckCircle, Ticket, Wine, Table, AlertTriangle, Euro,
  Crown, TrendingUp, TrendingDown, Calendar, Star, Target, ShoppingBag, Download, Filter, X,
  Activity, Clock3, History, ArrowDownRight, Mail, Globe, ShieldAlert, FileText,
} from 'lucide-react';
import { format, differenceInDays } from 'date-fns';
import { fr, es, enUS } from 'date-fns/locale';
import { PieChart, Pie, Cell, ResponsiveContainer, BarChart, Bar, XAxis, YAxis, Tooltip } from 'recharts';
import { motion, AnimatePresence } from 'framer-motion';
import { TierBadge } from '@/components/loyalty/TierBadge';
import { CustomerTimelineSheet } from '@/components/crm/CustomerTimelineSheet';
import { OwnerCustomerOrigins } from '@/components/owner/OwnerCustomerOrigins';
import { countryFromPhone, COUNTRIES, getCountryName } from '@/lib/countries';
import { fetchMinorDocsByEmail, ageFromBirthDate, type MinorDoc } from '@/lib/minorTicketDocs';

// ─── Yuno Design Tokens ───────────────────────────────────────────────────────
const RED      = '#E8192C';
const POS      = '#34D399';
const T1       = 'rgba(255,255,255,0.96)';
const T2       = 'rgba(255,255,255,0.58)';
const T3       = 'rgba(255,255,255,0.36)';
const C_FAINT  = 'rgba(255,255,255,0.06)';
const BORDER   = 'rgba(255,255,255,0.085)';
const F_BORDER = 'rgba(255,255,255,0.055)';
const CARD_BG  = 'linear-gradient(180deg,rgba(255,255,255,.045) 0%,rgba(255,255,255,.008) 100%),#0a0a0c';
const INNER_BG = 'rgba(255,255,255,0.032)';
const CARD_SHADOW = '0 1px 0 rgba(255,255,255,.05) inset,0 18px 40px -28px rgba(0,0,0,.9)';

// ─── Types ────────────────────────────────────────────────────────────────────
type SegmentKey = 'champions' | 'loyal' | 'promising' | 'new' | 'at_risk' | 'dormant' | 'lost';
type Tier = 'bronze' | 'silver' | 'gold' | 'platinum';
type TabKey = 'all' | 'top' | 'minors' | 'warned' | 'origins';
type TopLimit = 5 | 25 | 50 | 100;

interface VenueCustomer {
  id: string; user_id: string | null; email: string; first_name: string | null; last_name: string | null;
  phone: string | null; first_visit_at: string; last_visit_at: string; total_spent: number;
  ticket_count: number; order_count: number; table_count: number;
  is_banned: boolean; banned_at: string | null; ban_reason: string | null; notes: string | null;
  // RFM aggregates (from get_venue_customer_segments)
  revenue_30d: number; revenue_90d: number; revenue_prev_90d: number; avg_basket: number;
  visit_nights: number; visits_per_month: number; last_activity_at: string | null;
  preferred_dow: number | null; preferred_event_title: string | null;
  // synthetic email-only ban row (no account)
  emailOnly?: boolean;
}

// Derived scoring attached to each customer (computed client-side, venue-relative)
interface Scored {
  r: number; f: number; m: number;            // 1-5 quintiles
  segment: SegmentKey; tier: Tier;
  recencyDays: number; trendPct: number;       // revenue 90d vs prev 90d
  churnRisk: boolean;
  preferredCategory: 'tickets' | 'drinks' | 'tables' | 'mixed';
}
type ScoredCustomer = VenueCustomer & { _s: Scored };

interface CustomerIncident {
  id: string; incident_type: string; reason: string; details: string | null; created_at: string;
}

interface SegmentFilters {
  segment: SegmentKey | ''; recency: 'active' | 'dormant' | 'lost' | '';
  value: Tier | ''; category: 'tickets' | 'drinks' | 'tables' | ''; churn: boolean;
  origin: string; // ISO-2 country code, set from the Origins map/list
}
const emptyFilters: SegmentFilters = { segment: '', recency: '', value: '', category: '', churn: false, origin: '' };

// ─── Scoring helpers ──────────────────────────────────────────────────────────
function quintile(value: number, sortedAsc: number[], invert = false): number {
  const n = sortedAsc.length;
  if (n <= 1) return 3;
  // share of population strictly below this value
  let below = 0;
  // binary-ish linear scan is fine for venue-sized lists
  for (let i = 0; i < n; i++) { if (sortedAsc[i] < value) below++; else break; }
  const pct = below / (n - 1);
  const score = Math.min(5, Math.max(1, Math.floor(pct * 5) + 1));
  return invert ? 6 - score : score;
}

function tierFromM(m: number): Tier {
  if (m >= 5) return 'platinum';
  if (m >= 4) return 'gold';
  if (m >= 2) return 'silver';
  return 'bronze';
}

function segmentOf(r: number, f: number, m: number): SegmentKey {
  if (r >= 4 && f >= 4) return 'champions';
  if (f >= 4) return 'loyal';                       // frequent, recency fading
  if (r <= 2 && f >= 3) return 'at_risk';           // was regular, slipping away
  if (r >= 4 && f <= 2) return m >= 3 ? 'promising' : 'new';
  if (r >= 3) return 'loyal';                       // mid-active, decent freq
  if (r === 2) return 'dormant';
  return 'lost';                                    // r === 1
}

function preferredCategory(c: VenueCustomer): Scored['preferredCategory'] {
  const mx = Math.max(c.ticket_count || 0, c.order_count || 0, c.table_count || 0);
  if (mx === 0) return 'mixed';
  if (mx === (c.table_count || 0)) return 'tables';
  if (mx === (c.ticket_count || 0)) return 'tickets';
  if (mx === (c.order_count || 0)) return 'drinks';
  return 'mixed';
}

function DarkInput({ value, onChange, placeholder, type = 'text' }: {
  value: string; onChange: (v: string) => void; placeholder?: string; type?: string;
}) {
  return (
    <input type={type} value={value} onChange={e => onChange(e.target.value)} placeholder={placeholder}
      className="w-full px-3 py-2.5 rounded-xl text-[13px] transition-all duration-150"
      style={{ background: INNER_BG, border: `1px solid ${BORDER}`, color: T1, outline: 'none' }}
      onFocus={e => (e.target.style.borderColor = 'rgba(255,255,255,0.18)')}
      onBlur={e => (e.target.style.borderColor = BORDER)}
    />
  );
}

function FieldLabel({ children }: { children: React.ReactNode }) {
  return <p style={{ color: T3, fontSize: 11, fontWeight: 600, letterSpacing: '0.07em', textTransform: 'uppercase', marginBottom: 6 }}>{children}</p>;
}

export default function OwnerCustomers() {
  const { toast } = useToast();
  const { t, language } = useLanguage();
  const { venue, loading: venueLoading } = useVenueContext();
  const { hasFeature } = useSubscriptionPlan();
  const hasAdvancedClients = hasFeature('personalization_advanced');
  const hasExportCsv = hasFeature('exports_csv');

  const [allCustomers, setAllCustomers] = useState<VenueCustomer[]>([]);
  const [warnedCustomers, setWarnedCustomers] = useState<VenueCustomer[]>([]);
  const [loading, setLoading] = useState(true);
  const [searchQuery, setSearchQuery] = useState('');
  const [activeTab, setActiveTab] = useState<TabKey>('all');
  // Minor-ticket record per lowercased email (badge + filter + signed doc in detail).
  const [minorByEmail, setMinorByEmail] = useState<Map<string, MinorDoc>>(new Map());
  const [selectedCustomer, setSelectedCustomer] = useState<VenueCustomer | null>(null);
  const [showBanDialog, setShowBanDialog] = useState(false);
  const [showUnbanDialog, setShowUnbanDialog] = useState(false);
  const [banReason, setBanReason] = useState('');
  const [processing, setProcessing] = useState(false);
  const [incidents, setIncidents] = useState<CustomerIncident[]>([]);
  const [topLimit, setTopLimit] = useState<TopLimit>(25);
  const [sheetOpen, setSheetOpen] = useState(false);
  const [segmentFilters, setSegmentFilters] = useState<SegmentFilters>(emptyFilters);
  const [showFilters, setShowFilters] = useState(false);
  const [notesDraft, setNotesDraft] = useState('');
  const [savingNotes, setSavingNotes] = useState(false);
  const [timelineOpen, setTimelineOpen] = useState(false);
  const dateLocale = language === 'fr' ? fr : language === 'es' ? es : enUS;

  const SEGMENT_META: Record<SegmentKey, { label: string; accent: string; bg: string }> = {
    champions: { label: t('seg.champions'), accent: '#FCD34D', bg: 'rgba(252,211,77,0.12)' },
    loyal:     { label: t('seg.loyal'),     accent: '#60A5FA', bg: 'rgba(96,165,250,0.12)' },
    promising: { label: t('seg.promising'), accent: '#A78BFA', bg: 'rgba(167,139,250,0.12)' },
    new:       { label: t('seg.new'),       accent: POS,       bg: 'rgba(52,211,153,0.12)' },
    at_risk:   { label: t('seg.atRisk'),    accent: '#FB923C', bg: 'rgba(251,146,60,0.12)' },
    dormant:   { label: t('seg.dormant'),   accent: T2,        bg: 'rgba(255,255,255,0.06)' },
    lost:      { label: t('seg.lost'),      accent: '#EF4444', bg: 'rgba(239,68,68,0.10)' },
  };

  const DOW_NAMES: Record<string, string[]> = {
    fr: ['Dim', 'Lun', 'Mar', 'Mer', 'Jeu', 'Ven', 'Sam'],
    en: ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'],
    es: ['Dom', 'Lun', 'Mar', 'Mié', 'Jue', 'Vie', 'Sáb'],
  };
  const dowName = (d: number | null) => (d == null ? '—' : (DOW_NAMES[language] || DOW_NAMES.en)[d] ?? '—');

  useEffect(() => {
    if (venue?.id) { fetchAllCustomers(); fetchWarnedCustomers(); fetchMinorEmails(); }
  }, [venue?.id]);

  const num = (v: any) => Number(v || 0);

  // Which customers bought a minor ticket on this venue's events (+ their doc).
  const fetchMinorEmails = async () => {
    if (!venue?.id) return;
    const { data: events } = await supabase
      .from('events')
      .select('id')
      .or(`venue_id.eq.${venue.id},partner_venue_id.eq.${venue.id}`);
    const eventIds = (events ?? []).map((e: any) => e.id);
    setMinorByEmail(await fetchMinorDocsByEmail(eventIds));
  };

  const fetchAllCustomers = async () => {
    if (!venue?.id) return;
    setLoading(true);
    try {
      const { data, error } = await supabase.rpc('get_venue_customer_segments', { p_venue_id: venue.id });
      if (error) throw error;
      const mapped: VenueCustomer[] = (data || []).map((r: any) => ({
        id: r.id, user_id: r.user_id, email: r.email, first_name: r.first_name, last_name: r.last_name,
        phone: r.phone, first_visit_at: r.first_visit_at, last_visit_at: r.last_visit_at,
        total_spent: num(r.total_spent), ticket_count: r.ticket_count || 0, order_count: r.order_count || 0,
        table_count: r.table_count || 0, is_banned: !!r.is_banned, banned_at: r.banned_at,
        ban_reason: r.ban_reason, notes: r.notes,
        revenue_30d: num(r.revenue_30d), revenue_90d: num(r.revenue_90d), revenue_prev_90d: num(r.revenue_prev_90d),
        avg_basket: num(r.avg_basket), visit_nights: r.visit_nights || 0, visits_per_month: num(r.visits_per_month),
        last_activity_at: r.last_activity_at, preferred_dow: r.preferred_dow,
        preferred_event_title: r.preferred_event_title,
      }));
      setAllCustomers(mapped);
    } catch {
      toast({ title: t('customers.error'), description: t('customers.loadError'), variant: 'destructive' });
    } finally { setLoading(false); }
  };

  const fetchWarnedCustomers = async () => {
    if (!venue?.id) return;
    try {
      // (a) account-linked warnings / bans / refunds (capacity-full excluded — that's not a flag)
      const { data: incidentData } = await supabase.from('customer_incidents')
        .select('venue_customer_id').eq('venue_id', venue.id)
        .in('incident_type', ['warning', 'refund', 'ban'])
        .not('reason', 'ilike', '%complet%').not('reason', 'ilike', '%full%').not('reason', 'ilike', '%lleno%');
      const uniqueIds = [...new Set((incidentData || []).map(i => i.venue_customer_id))];
      let accountRows: VenueCustomer[] = [];
      if (uniqueIds.length > 0) {
        accountRows = (allCustomers.filter(c => uniqueIds.includes(c.id)));
        // fall back to a direct fetch if the segments list hasn't populated yet
        if (accountRows.length === 0) {
          const { data } = await supabase.from('venue_customers').select('*').eq('venue_id', venue.id).in('id', uniqueIds);
          accountRows = (data || []).map((r: any) => ({ ...r, total_spent: num(r.total_spent), revenue_30d: 0, revenue_90d: 0, revenue_prev_90d: 0, avg_basket: 0, visit_nights: 0, visits_per_month: 0, last_activity_at: r.last_visit_at, preferred_dow: null, preferred_event_title: null }));
        }
      }
      // (b) email-only bans (guest / no account) that have no venue_customer
      const { data: emailBans } = await supabase.from('venue_banned_emails')
        .select('email, ban_reason, banned_at').eq('venue_id', venue.id);
      const accountEmails = new Set(accountRows.map(c => c.email.toLowerCase()));
      const emailOnly: VenueCustomer[] = (emailBans || [])
        .filter(b => !accountEmails.has(b.email.toLowerCase()))
        .map(b => ({
          id: `email:${b.email}`, user_id: null, email: b.email, first_name: null, last_name: null, phone: null,
          first_visit_at: b.banned_at, last_visit_at: b.banned_at, total_spent: 0,
          ticket_count: 0, order_count: 0, table_count: 0, is_banned: true, banned_at: b.banned_at,
          ban_reason: b.ban_reason, notes: null, revenue_30d: 0, revenue_90d: 0, revenue_prev_90d: 0,
          avg_basket: 0, visit_nights: 0, visits_per_month: 0, last_activity_at: b.banned_at,
          preferred_dow: null, preferred_event_title: null, emailOnly: true,
        }));
      setWarnedCustomers([...accountRows, ...emailOnly]);
    } catch {}
  };

  const fetchCustomerIncidents = async (customerId: string) => {
    if (customerId.startsWith('email:')) { setIncidents([]); return; }
    try {
      const { data, error } = await supabase.from('customer_incidents').select('*').eq('venue_customer_id', customerId).order('created_at', { ascending: false }).limit(20);
      if (error) throw error;
      setIncidents(data || []);
    } catch {}
  };

  const handleBanCustomer = async () => {
    if (!selectedCustomer || !banReason || !venue?.id) return;
    setProcessing(true);
    try {
      const { error } = await supabase.rpc('staff_ban_customer', {
        p_venue_id: venue.id, p_user_id: selectedCustomer.user_id ?? null, p_email: selectedCustomer.email,
        p_reason: banReason, p_first_name: selectedCustomer.first_name, p_last_name: selectedCustomer.last_name,
      });
      if (error) throw error;
      toast({ title: t('customers.banned'), description: selectedCustomer.email });
      setShowBanDialog(false); setBanReason(''); setSelectedCustomer(null); setSheetOpen(false);
      fetchAllCustomers(); fetchWarnedCustomers();
    } catch { toast({ title: t('customers.error'), variant: 'destructive' }); }
    finally { setProcessing(false); }
  };

  const handleUnbanCustomer = async () => {
    if (!selectedCustomer || !venue?.id) return;
    setProcessing(true);
    try {
      const { error } = await supabase.rpc('staff_unban_customer', {
        p_venue_id: venue.id, p_user_id: selectedCustomer.user_id ?? null, p_email: selectedCustomer.email,
        p_reason: t('customers.manualUnban'),
      });
      if (error) throw error;
      toast({ title: t('customers.unbanned'), description: selectedCustomer.email });
      setShowUnbanDialog(false); setSelectedCustomer(null); setSheetOpen(false);
      fetchAllCustomers(); fetchWarnedCustomers();
    } catch { toast({ title: t('customers.error'), variant: 'destructive' }); }
    finally { setProcessing(false); }
  };

  const saveNotes = async () => {
    if (!selectedCustomer || selectedCustomer.emailOnly) return;
    setSavingNotes(true);
    try {
      const { error } = await supabase.from('venue_customers').update({ notes: notesDraft }).eq('id', selectedCustomer.id);
      if (error) throw error;
      setAllCustomers(list => list.map(c => c.id === selectedCustomer.id ? { ...c, notes: notesDraft } : c));
      setSelectedCustomer(c => c ? { ...c, notes: notesDraft } : c);
      toast({ title: t('customers.notesSaved') });
    } catch { toast({ title: t('customers.error'), variant: 'destructive' }); }
    finally { setSavingNotes(false); }
  };

  // ─── Venue-relative RFM scoring (single source of truth) ─────────────────────
  const scored = useMemo<ScoredCustomer[]>(() => {
    const now = new Date();
    const recencyOf = (c: VenueCustomer) => differenceInDays(now, new Date(c.last_activity_at || c.last_visit_at || c.first_visit_at));
    const freqOf = (c: VenueCustomer) => c.visit_nights || ((c.ticket_count || 0) + (c.order_count || 0) + (c.table_count || 0));
    const recArr = allCustomers.map(recencyOf).sort((a, b) => a - b);
    const freqArr = allCustomers.map(freqOf).sort((a, b) => a - b);
    const monArr = allCustomers.map(c => c.total_spent).sort((a, b) => a - b);
    return allCustomers.map(c => {
      const recencyDays = recencyOf(c);
      const r = quintile(recencyDays, recArr, true);   // recent → high
      const f = quintile(freqOf(c), freqArr);
      const m = quintile(c.total_spent, monArr);
      const segment = segmentOf(r, f, m);
      const trendPct = c.revenue_prev_90d > 0
        ? ((c.revenue_90d - c.revenue_prev_90d) / c.revenue_prev_90d) * 100
        : (c.revenue_90d > 0 ? 100 : 0);
      const churnRisk = f >= 3 && recencyDays > 45 && recencyDays <= 180;
      return { ...c, _s: { r, f, m, segment, tier: tierFromM(m), recencyDays, trendPct, churnRisk, preferredCategory: preferredCategory(c) } };
    });
  }, [allCustomers]);

  const scoredById = useMemo(() => {
    const map = new Map<string, ScoredCustomer>();
    scored.forEach(c => map.set(c.id, c));
    return map;
  }, [scored]);

  const analytics = useMemo(() => {
    const segments: Record<SegmentKey, number> = { champions: 0, loyal: 0, promising: 0, new: 0, at_risk: 0, dormant: 0, lost: 0 };
    const categories = { tickets: 0, drinks: 0, tables: 0, mixed: 0 };
    let churn = 0, revenue30 = 0;
    scored.forEach(c => {
      segments[c._s.segment]++;
      categories[c._s.preferredCategory]++;
      if (c._s.churnRisk) churn++;
      revenue30 += c.revenue_30d;
    });
    const totalSpent = allCustomers.reduce((s, c) => s + c.total_spent, 0);
    return {
      segments, categories, totalSpent, churn, revenue30,
      avgSpentPerCustomer: allCustomers.length ? totalSpent / allCustomers.length : 0,
      activeCustomers: scored.filter(c => c._s.recencyDays <= 30).length,
      totalCustomers: allCustomers.length,
    };
  }, [scored, allCustomers]);

  const topCustomers = useMemo(() => [...allCustomers].sort((a, b) => b.total_spent - a.total_spent).slice(0, topLimit), [allCustomers, topLimit]);

  const activeFilterCount = useMemo(() =>
    (segmentFilters.segment ? 1 : 0) + (segmentFilters.recency ? 1 : 0) + (segmentFilters.value ? 1 : 0) +
    (segmentFilters.category ? 1 : 0) + (segmentFilters.churn ? 1 : 0) + (segmentFilters.origin ? 1 : 0), [segmentFilters]);

  const originCountry = useMemo(() => COUNTRIES.find(c => c.code === segmentFilters.origin) || null, [segmentFilters.origin]);

  const filteredCustomers = useMemo(() => {
    const searchLower = searchQuery.toLowerCase();
    const baseList = activeTab === 'all' ? allCustomers
      : activeTab === 'top' ? topCustomers
      : activeTab === 'minors' ? allCustomers.filter(c => minorByEmail.has(c.email.toLowerCase()))
      : warnedCustomers;
    let list = baseList;
    if (searchQuery) list = list.filter(c => c.email.toLowerCase().includes(searchLower) || c.first_name?.toLowerCase().includes(searchLower) || c.last_name?.toLowerCase().includes(searchLower) || c.phone?.includes(searchQuery));
    const { segment, recency, value, category, churn, origin } = segmentFilters;
    if (origin) list = list.filter(c => countryFromPhone(c.phone)?.code === origin);
    if (segment) list = list.filter(c => scoredById.get(c.id)?._s.segment === segment);
    if (recency) list = list.filter(c => { const d = scoredById.get(c.id)?._s.recencyDays ?? 999; return recency === 'active' ? d <= 30 : recency === 'dormant' ? d > 30 && d <= 90 : d > 90; });
    if (value) list = list.filter(c => scoredById.get(c.id)?._s.tier === value);
    if (category) list = list.filter(c => category === 'tickets' ? (c.ticket_count || 0) > 0 : category === 'drinks' ? (c.order_count || 0) > 0 : (c.table_count || 0) > 0);
    if (churn) list = list.filter(c => scoredById.get(c.id)?._s.churnRisk);
    return list;
  }, [allCustomers, topCustomers, warnedCustomers, minorByEmail, searchQuery, activeTab, segmentFilters, scoredById]);

  const getIncidentTypeLabel = (type: string) => {
    const m: Record<string, Record<string, string>> = {
      refund: { fr: 'Remboursement', en: 'Refund', es: 'Reembolso' },
      warning: { fr: 'Avertissement', en: 'Warning', es: 'Advertencia' },
      ban: { fr: 'Bannissement', en: 'Ban', es: 'Prohibición' },
      unban: { fr: 'Débannissement', en: 'Unban', es: 'Desprohibición' },
      note: { fr: 'Note', en: 'Note', es: 'Nota' },
    };
    return m[type]?.[language] || type;
  };

  const INCIDENT_COLORS: Record<string, { color: string; bg: string }> = {
    refund:  { color: '#FB923C', bg: 'rgba(251,146,60,0.1)' },
    warning: { color: '#FCD34D', bg: 'rgba(252,211,77,0.1)' },
    ban:     { color: RED,       bg: 'rgba(232,25,44,0.1)'  },
    unban:   { color: POS,       bg: 'rgba(52,211,153,0.1)' },
    note:    { color: '#60A5FA', bg: 'rgba(96,165,250,0.1)' },
  };

  const translateIncidentReason = (reason: string) => {
    const m: Record<string, Record<string, string>> = {
      'Ivresse': { fr: 'Ivresse', en: 'Intoxication', es: 'Intoxicación' },
      'Comportement inapproprié': { fr: 'Comportement inapproprié', en: 'Inappropriate behavior', es: 'Comportamiento inapropiado' },
      'Documents non valides': { fr: 'Documents non valides', en: 'Invalid documents', es: 'Documentos no válidos' },
      'Mineur': { fr: 'Mineur', en: 'Minor', es: 'Menor de edad' },
      'Dress code non respecté': { fr: 'Dress code non respecté', en: 'Dress code violation', es: 'Incumplimiento del código de vestimenta' },
      'Capacité maximale atteinte': { fr: 'Capacité maximale atteinte', en: 'Maximum capacity reached', es: 'Capacidad máxima alcanzada' },
      'Autre raison': { fr: 'Autre raison', en: 'Other reason', es: 'Otra razón' },
      'Intoxication': { fr: 'Ivresse', en: 'Intoxication', es: 'Intoxicación' },
      'Inappropriate behavior': { fr: 'Comportement inapproprié', en: 'Inappropriate behavior', es: 'Comportamiento inapropiado' },
      'Invalid documents': { fr: 'Documents non valides', en: 'Invalid documents', es: 'Documentos no válidos' },
      'Minor': { fr: 'Mineur', en: 'Minor', es: 'Menor de edad' },
      'Dress code violation': { fr: 'Dress code non respecté', en: 'Dress code violation', es: 'Incumplimiento del código de vestimenta' },
      'Maximum capacity reached': { fr: 'Capacité maximale atteinte', en: 'Maximum capacity reached', es: 'Capacidad máxima alcanzada' },
      'Other reason': { fr: 'Autre raison', en: 'Other reason', es: 'Otra razón' },
    };
    return m[reason]?.[language] || reason;
  };

  const segmentChartData = (Object.keys(analytics.segments) as SegmentKey[])
    .map(k => ({ name: SEGMENT_META[k].label, value: analytics.segments[k], color: SEGMENT_META[k].accent, key: k }))
    .filter(d => d.value > 0);

  const categoryChartData = [
    { name: t('customers.tickets'), value: analytics.categories.tickets },
    { name: t('customers.drinks'), value: analytics.categories.drinks },
    { name: t('customers.tables'), value: analytics.categories.tables },
    { name: t('customers.mixed'), value: analytics.categories.mixed },
  ].filter(d => d.value > 0);

  const exportCustomersCsv = () => {
    const sep = ',';
    const rows = [['Email', t('profile.firstName'), t('profile.lastName'), 'Phone', 'Segment', 'Tier', 'Tickets', 'Orders', 'Tables', 'TotalSpent', 'Revenue30d', 'VisitsPerMonth', 'LastActivity', 'Status'].join(sep)];
    filteredCustomers.forEach(c => {
      const s = scoredById.get(c.id)?._s;
      rows.push([c.email, c.first_name || '', c.last_name || '', c.phone || '',
        s ? SEGMENT_META[s.segment].label : '', s?.tier || '',
        String(c.ticket_count || 0), String(c.order_count || 0), String(c.table_count || 0),
        c.total_spent.toFixed(2), c.revenue_30d.toFixed(2), String(c.visits_per_month),
        c.last_activity_at ? format(new Date(c.last_activity_at), 'yyyy-MM-dd') : '',
        c.is_banned ? 'Banned' : (s ? SEGMENT_META[s.segment].label : '')].map(v => `"${v.replace(/"/g, '""')}"`).join(sep));
    });
    const blob = new Blob(['﻿' + rows.join('\n')], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url; a.download = `customers-${format(new Date(), 'yyyy-MM-dd')}.csv`;
    document.body.appendChild(a); a.click(); document.body.removeChild(a); URL.revokeObjectURL(url);
    toast({ title: t('customers.exportSuccess') });
  };

  const openCustomer = useCallback((customer: VenueCustomer) => {
    setSelectedCustomer(customer); setNotesDraft(customer.notes || '');
    fetchCustomerIncidents(customer.id); setSheetOpen(true);
  }, []);

  const TABS = [
    { key: 'all' as TabKey, label: t('customers.allClients'), Icon: Users },
    { key: 'top' as TabKey, label: t('customers.topClients'), Icon: Crown },
    { key: 'minors' as TabKey, label: t('minorClients.filter'), Icon: ShieldAlert },
    { key: 'warned' as TabKey, label: t('customers.warnedClients'), Icon: AlertTriangle },
    { key: 'origins' as TabKey, label: t('customers.originsTab'), Icon: Globe },
  ];

  if (venueLoading) return <OwnerPageSkeleton />;

  function CustomerRow({ customer, rank }: { customer: VenueCustomer; rank?: number }) {
    const s = scoredById.get(customer.id)?._s;
    const seg = s ? SEGMENT_META[s.segment] : null;
    const country = countryFromPhone(customer.phone);
    return (
      <motion.div initial={{ opacity: 0, y: 6 }} animate={{ opacity: 1, y: 0 }}
        onClick={() => openCustomer(customer)}
        className="flex items-center gap-3 px-4 py-3 cursor-pointer transition-all duration-150"
        style={{ borderBottom: `1px solid ${F_BORDER}` }}
        whileHover={{ background: 'rgba(255,255,255,0.024)' }}>
        {rank && (
          <div className="w-6 h-6 flex items-center justify-center rounded-full flex-shrink-0 text-[11px] font-bold"
            style={rank <= 3
              ? { background: rank === 1 ? '#FCD34D' : rank === 2 ? 'rgba(255,255,255,0.35)' : '#CD7F32', color: '#000' }
              : { background: INNER_BG, color: T3 }}>
            {rank <= 3 ? <Crown className="w-3 h-3" /> : rank}
          </div>
        )}
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-1.5 flex-wrap">
            {country && (
              <span title={getCountryName(country, language)} style={{ fontSize: 14, lineHeight: 1 }}>{country.flag}</span>
            )}
            <span style={{ color: T1, fontSize: 13, fontWeight: 500 }}>
              {[customer.first_name, customer.last_name].filter(Boolean).join(' ') || customer.email}
            </span>
            {seg && (
              <span className="px-1.5 py-0.5 rounded-full text-[10px] font-semibold"
                style={{ background: seg.bg, color: seg.accent }}>{seg.label}</span>
            )}
            {s?.churnRisk && !customer.is_banned && (
              <span className="px-1.5 py-0.5 rounded-full text-[10px] font-semibold flex items-center gap-0.5"
                style={{ background: 'rgba(251,146,60,0.1)', color: '#FB923C' }}>
                <ArrowDownRight className="w-2.5 h-2.5" />{t('customers.churnTag')}
              </span>
            )}
            {customer.is_banned && (
              <span className="px-1.5 py-0.5 rounded-full text-[10px] font-semibold"
                style={{ background: 'rgba(232,25,44,0.1)', color: RED }}>
                <Ban className="w-2.5 h-2.5 inline mr-0.5" />{t('customers.banned')}
              </span>
            )}
            {minorByEmail.has(customer.email.toLowerCase()) && (
              <span className="px-1.5 py-0.5 rounded-full text-[10px] font-semibold flex items-center gap-0.5"
                style={{ background: 'rgba(232,25,44,0.12)', color: '#FF7A80' }}>
                <ShieldAlert className="w-2.5 h-2.5" />{t('minorClients.badge')}
              </span>
            )}
          </div>
          <p style={{ color: T3, fontSize: 11.5, marginTop: 1 }} className="truncate">{customer.email}</p>
        </div>
        <div className="flex items-center gap-3 flex-shrink-0">
          <div className="hidden sm:flex items-center gap-2 text-[11px]" style={{ color: T3 }}>
            <span className="flex items-center gap-0.5"><Ticket className="w-3 h-3" />{customer.ticket_count || 0}</span>
            <span className="flex items-center gap-0.5"><Wine className="w-3 h-3" />{customer.order_count || 0}</span>
            <span className="flex items-center gap-0.5"><Table className="w-3 h-3" />{customer.table_count || 0}</span>
          </div>
          {s && <TierBadge tier={s.tier} size="sm" />}
          <span style={{ color: T1, fontSize: 14, fontWeight: 700, fontVariantNumeric: 'tabular-nums', minWidth: 48, textAlign: 'right' }}>
            {customer.total_spent.toFixed(0)}€
          </span>
        </div>
      </motion.div>
    );
  }

  const selScore = selectedCustomer ? scoredById.get(selectedCustomer.id)?._s : null;

  return (
    <div className="min-h-screen pb-28" style={{ background: '#000' }}>
      <div className="fixed inset-0 pointer-events-none z-0"
        style={{ background: 'radial-gradient(120% 60% at 50% -10%,rgba(255,255,255,.025),transparent 55%)' }} />

      <OwnerHeader
        title={t('customers.title')}
        showBackButton backTo="/owner"
        rightContent={hasExportCsv ? (
          <button onClick={exportCustomersCsv}
            className="inline-flex items-center gap-1.5 px-3 py-2 rounded-xl text-[12px] font-medium cursor-pointer transition-all duration-150"
            style={{ background: INNER_BG, border: `1px solid ${BORDER}`, color: T2 }}>
            <Download className="w-3.5 h-3.5" />CSV
          </button>
        ) : undefined}
      />

      <div className="relative z-10 mx-auto max-w-[1340px] px-4 sm:px-6 pt-2 space-y-5">

        {/* Stats strip */}
        <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-3">
          {[
            { icon: Users, label: t('customers.totalClients'), value: analytics.totalCustomers, color: T2 },
            { icon: TrendingUp, label: t('customers.activeClients'), value: analytics.activeCustomers, color: POS },
            { icon: ArrowDownRight, label: t('customers.churnRiskStat'), value: analytics.churn, color: '#FB923C' },
            { icon: Euro, label: t('customers.totalRevenue'), value: `${analytics.totalSpent.toFixed(0)}€`, color: T2 },
            { icon: Activity, label: t('customers.revenue30'), value: `${analytics.revenue30.toFixed(0)}€`, color: T2 },
            { icon: Target, label: t('customers.avgSpent'), value: `${analytics.avgSpentPerCustomer.toFixed(0)}€`, color: T2 },
          ].map(({ icon: Icon, label, value, color }) => (
            <div key={label} className="px-4 py-3 rounded-xl" style={{ background: CARD_BG, border: `1px solid ${BORDER}`, boxShadow: CARD_SHADOW }}>
              <div className="flex items-center gap-1.5 mb-0.5">
                <Icon className="w-3 h-3" style={{ color }} />
                <p style={{ color: T3, fontSize: 10.5, fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.05em' }}>{label}</p>
              </div>
              <p style={{ color: T1, fontSize: 22, fontWeight: 700, letterSpacing: '-0.02em', marginTop: 2, fontVariantNumeric: 'tabular-nums' }}>{value}</p>
            </div>
          ))}
        </div>

        {/* Segment overview + preferences (Elite) */}
        {allCustomers.length > 0 && hasAdvancedClients && (
          <div className="grid md:grid-cols-2 gap-3">
            <div style={{ background: CARD_BG, border: `1px solid ${BORDER}`, borderRadius: 18, boxShadow: CARD_SHADOW, padding: 20 }}>
              <div className="flex items-center gap-2 mb-3">
                <Star className="w-4 h-4" style={{ color: T3 }} />
                <p style={{ color: T2, fontSize: 13, fontWeight: 600 }}>{t('customers.segments')}</p>
              </div>
              <div className="flex items-center gap-4">
                <div className="w-24 h-24 flex-shrink-0">
                  <ResponsiveContainer width="100%" height="100%">
                    <PieChart>
                      <Pie data={segmentChartData} dataKey="value" cx="50%" cy="50%" innerRadius={20} outerRadius={40}>
                        {segmentChartData.map((e, i) => <Cell key={i} fill={e.color} />)}
                      </Pie>
                    </PieChart>
                  </ResponsiveContainer>
                </div>
                <div className="flex-1 grid grid-cols-2 gap-1.5">
                  {segmentChartData.map(item => (
                    <button key={item.key} onClick={() => { setActiveTab('all'); setSegmentFilters(f => ({ ...f, segment: f.segment === item.key ? '' : item.key as SegmentKey })); }}
                      className="flex items-center gap-1.5 text-left cursor-pointer rounded-md px-1 py-0.5"
                      style={{ background: segmentFilters.segment === item.key ? 'rgba(255,255,255,0.06)' : 'transparent' }}>
                      <div className="w-2 h-2 rounded-full flex-shrink-0" style={{ background: item.color }} />
                      <span style={{ color: T3, fontSize: 11 }}>{item.name}: <span style={{ color: T1 }}>{item.value}</span></span>
                    </button>
                  ))}
                </div>
              </div>
            </div>
            <div style={{ background: CARD_BG, border: `1px solid ${BORDER}`, borderRadius: 18, boxShadow: CARD_SHADOW, padding: 20 }}>
              <div className="flex items-center gap-2 mb-3">
                <ShoppingBag className="w-4 h-4" style={{ color: T3 }} />
                <p style={{ color: T2, fontSize: 13, fontWeight: 600 }}>{t('customers.preferences')}</p>
              </div>
              <ResponsiveContainer width="100%" height={80}>
                <BarChart data={categoryChartData} layout="vertical">
                  <XAxis type="number" hide />
                  <YAxis dataKey="name" type="category" width={60} tick={{ fontSize: 10, fill: T3 }} />
                  <Tooltip contentStyle={{ background: '#0a0a0c', border: `1px solid ${BORDER}`, borderRadius: 10, color: T1, fontSize: 12 }} cursor={{ fill: 'rgba(255,255,255,0.03)' }} />
                  <Bar dataKey="value" fill={RED} radius={[0, 4, 4, 0]} />
                </BarChart>
              </ResponsiveContainer>
            </div>
          </div>
        )}

        {/* Tab bar */}
        <div>
          <div className="flex gap-0.5" style={{ borderBottom: `1px solid ${BORDER}` }}>
            {TABS.map(({ key, label, Icon }) => (
              <button key={key} onClick={() => setActiveTab(key)}
                className="relative inline-flex items-center gap-2 px-4 py-3 text-[13px] font-[560] transition-colors duration-150 cursor-pointer"
                style={{ color: activeTab === key ? T1 : T3 }}>
                <Icon className="w-3.5 h-3.5" />
                <span className="hidden sm:inline">{label}</span>
                {key === 'warned' && warnedCustomers.length > 0 && (
                  <span className="w-4 h-4 flex items-center justify-center rounded-full text-[10px] font-bold"
                    style={{ background: 'rgba(232,25,44,0.15)', color: RED }}>{warnedCustomers.length}</span>
                )}
                {activeTab === key && (
                  <span className="absolute left-3 right-3 rounded-full"
                    style={{ bottom: -1, height: 2, background: RED, boxShadow: `0 0 10px rgba(232,25,44,0.6)` }} />
                )}
              </button>
            ))}
          </div>

          {activeTab === 'origins' ? (
            <OwnerCustomerOrigins
              customers={allCustomers}
              scope={venue?.id ? { kind: 'venue', id: venue.id } : undefined}
              onSelectCountry={(code) => { setActiveTab('all'); setSegmentFilters({ ...emptyFilters, origin: code }); }}
            />
          ) : (
          <>
          {/* Active origin filter chip */}
          {segmentFilters.origin && originCountry && (
            <div className="mt-4 inline-flex items-center gap-2 px-3 py-1.5 rounded-full"
              style={{ background: 'rgba(232,25,44,0.1)', border: `1px solid rgba(232,25,44,0.3)` }}>
              <Globe className="w-3.5 h-3.5" style={{ color: RED }} />
              <span style={{ color: T1, fontSize: 12, fontWeight: 600 }}>{originCountry.flag} {originCountry.names[language as 'en' | 'fr' | 'es'] || originCountry.names.en}</span>
              <button onClick={() => setSegmentFilters(f => ({ ...f, origin: '' }))} className="cursor-pointer">
                <X className="w-3.5 h-3.5" style={{ color: T3 }} />
              </button>
            </div>
          )}

          {/* Search + filters bar */}
          <div className="flex gap-2 mt-4">
            <div className="relative flex-1">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 pointer-events-none" style={{ color: T3 }} />
              <input
                type="text" value={searchQuery} onChange={e => setSearchQuery(e.target.value)}
                placeholder={t('customers.searchPlaceholder')}
                className="w-full pl-9 pr-3 py-2.5 rounded-xl text-[13px] transition-all duration-150"
                style={{ background: INNER_BG, border: `1px solid ${BORDER}`, color: T1, outline: 'none' }}
                onFocus={e => (e.target.style.borderColor = 'rgba(255,255,255,0.18)')}
                onBlur={e => (e.target.style.borderColor = BORDER)}
              />
            </div>
            <button onClick={() => setShowFilters(!showFilters)}
              className="relative w-10 h-10 flex items-center justify-center rounded-xl cursor-pointer transition-all duration-150"
              style={{ background: showFilters ? RED : INNER_BG, border: `1px solid ${showFilters ? RED : BORDER}`, color: showFilters ? '#fff' : T2 }}>
              <Filter className="w-4 h-4" />
              {activeFilterCount > 0 && (
                <span className="absolute -top-1 -right-1 w-4 h-4 flex items-center justify-center rounded-full text-[10px] font-bold"
                  style={{ background: RED, color: '#fff' }}>{activeFilterCount}</span>
              )}
            </button>
            {activeTab === 'top' && (
              <select value={topLimit.toString()} onChange={e => setTopLimit(parseInt(e.target.value) as TopLimit)}
                className="px-3 py-2 rounded-xl text-[12px] cursor-pointer"
                style={{ background: INNER_BG, border: `1px solid ${BORDER}`, color: T2, outline: 'none' }}>
                {[5, 25, 50, 100].map(v => <option key={v} value={v}>Top {v}</option>)}
              </select>
            )}
          </div>

          {/* Segment filters */}
          <AnimatePresence>
            {showFilters && (
              <motion.div initial={{ opacity: 0, height: 0 }} animate={{ opacity: 1, height: 'auto' }} exit={{ opacity: 0, height: 0 }}
                className="overflow-hidden">
                <div className="mt-3 p-4 rounded-xl space-y-4" style={{ background: INNER_BG, border: `1px solid ${BORDER}` }}>
                  <div className="flex items-center justify-between">
                    <p style={{ color: T3, fontSize: 10.5, fontWeight: 700, letterSpacing: '0.08em', textTransform: 'uppercase' }}>Segmentation</p>
                    {activeFilterCount > 0 && (
                      <button onClick={() => setSegmentFilters(emptyFilters)}
                        className="inline-flex items-center gap-1 px-2 py-1 rounded-lg text-[11px] cursor-pointer"
                        style={{ background: 'rgba(232,25,44,0.08)', color: RED }}>
                        <X className="w-3 h-3" />Reset
                      </button>
                    )}
                  </div>

                  {/* Segment chips */}
                  <div>
                    <p style={{ color: T3, fontSize: 11, marginBottom: 6 }}>{t('customers.segments')}</p>
                    <div className="flex flex-wrap gap-1.5">
                      {(Object.keys(SEGMENT_META) as SegmentKey[]).map(k => {
                        const active = segmentFilters.segment === k;
                        return (
                          <button key={k} type="button"
                            onClick={() => setSegmentFilters(f => ({ ...f, segment: f.segment === k ? '' : k }))}
                            className="px-2.5 py-1 rounded-full text-[11px] font-medium cursor-pointer transition-all duration-150"
                            style={{ background: active ? SEGMENT_META[k].bg : INNER_BG, border: `1px solid ${active ? SEGMENT_META[k].accent : BORDER}`, color: active ? SEGMENT_META[k].accent : T2 }}>
                            {SEGMENT_META[k].label} <span style={{ opacity: 0.6 }}>{analytics.segments[k]}</span>
                          </button>
                        );
                      })}
                    </div>
                  </div>

                  {[
                    { key: 'recency', label: t('owner.cust.activity'), opts: [{ v: 'active', l: t('owner.cust.actActive') }, { v: 'dormant', l: t('owner.cust.actDormant') }, { v: 'lost', l: t('owner.cust.actLost') }] },
                    { key: 'value', label: t('owner.cust.tier'), opts: ['bronze', 'silver', 'gold', 'platinum'].map(v => ({ v, l: v.charAt(0).toUpperCase() + v.slice(1) })) },
                    { key: 'category', label: t('owner.cust.purchaseType'), opts: [{ v: 'tickets', l: t('owner.cust.tickets') }, { v: 'drinks', l: t('owner.cust.drinks') }, { v: 'tables', l: t('customers.tables') }] },
                  ].map(({ key, label, opts }) => (
                    <div key={key}>
                      <p style={{ color: T3, fontSize: 11, marginBottom: 6 }}>{label}</p>
                      <div className="flex flex-wrap gap-1.5">
                        {opts.map(({ v, l }) => {
                          const active = (segmentFilters as any)[key] === v;
                          return (
                            <button key={v} type="button"
                              onClick={() => setSegmentFilters(f => ({ ...f, [key]: (f as any)[key] === v ? '' : v }))}
                              className="px-2.5 py-1 rounded-full text-[11px] font-medium cursor-pointer transition-all duration-150"
                              style={{ background: active ? `rgba(232,25,44,0.12)` : INNER_BG, border: `1px solid ${active ? RED : BORDER}`, color: active ? RED : T2 }}>
                              {l}
                            </button>
                          );
                        })}
                      </div>
                    </div>
                  ))}

                  {/* Churn toggle */}
                  <button type="button"
                    onClick={() => setSegmentFilters(f => ({ ...f, churn: !f.churn }))}
                    className="inline-flex items-center gap-1.5 px-2.5 py-1.5 rounded-full text-[11px] font-medium cursor-pointer"
                    style={{ background: segmentFilters.churn ? 'rgba(251,146,60,0.12)' : INNER_BG, border: `1px solid ${segmentFilters.churn ? '#FB923C' : BORDER}`, color: segmentFilters.churn ? '#FB923C' : T2 }}>
                    <ArrowDownRight className="w-3 h-3" />{t('customers.churnFilter')} <span style={{ opacity: 0.6 }}>{analytics.churn}</span>
                  </button>

                  <p style={{ color: T3, fontSize: 11.5 }}>
                    {filteredCustomers.length} {t('owner.cust.customersMatch')}
                  </p>
                </div>
              </motion.div>
            )}
          </AnimatePresence>

          {/* Customer list */}
          <div className="mt-4" style={{ background: CARD_BG, border: `1px solid ${BORDER}`, borderRadius: 18, boxShadow: CARD_SHADOW, overflow: 'hidden' }}>
            <div className="flex items-center gap-3 px-4 py-2.5" style={{ borderBottom: `1px solid ${BORDER}` }}>
              {activeTab === 'top' && <div className="w-6 flex-shrink-0" />}
              <p className="flex-1" style={{ color: T3, fontSize: 10.5, fontWeight: 700, letterSpacing: '0.07em', textTransform: 'uppercase' }}>{t('customers.client')}</p>
              <div className="hidden sm:flex items-center gap-6 flex-shrink-0" style={{ color: T3, fontSize: 10.5, fontWeight: 700, letterSpacing: '0.07em', textTransform: 'uppercase' }}>
                <span>T/B/V</span>
                <span>Tier</span>
              </div>
              <p style={{ color: T3, fontSize: 10.5, fontWeight: 700, letterSpacing: '0.07em', textTransform: 'uppercase', minWidth: 48, textAlign: 'right' }}>{t('owner.cust.spent')}</p>
            </div>
            {loading ? (
              <div className="flex items-center justify-center py-14">
                <div className="h-8 w-8 animate-spin rounded-full border-2" style={{ borderColor: `${BORDER} ${BORDER} ${BORDER} ${RED}` }} />
              </div>
            ) : filteredCustomers.length === 0 ? (
              <div className="text-center py-14 px-4">
                <Users className="h-9 w-9 mx-auto mb-2" style={{ color: 'rgba(255,255,255,0.10)' }} />
                <p style={{ color: T3, fontSize: 13 }}>{searchQuery ? t('customers.noResults') : activeTab === 'warned' ? t('customers.noWarned') : t('customers.noCustomers')}</p>
              </div>
            ) : (
              filteredCustomers.map((customer, i) => (
                <CustomerRow key={customer.id} customer={customer} rank={activeTab === 'top' ? i + 1 : undefined} />
              ))
            )}
          </div>
          </>
          )}
        </div>
      </div>

      {/* Customer Detail Sheet */}
      <Sheet open={sheetOpen} onOpenChange={setSheetOpen}>
        <SheetContent className="border-0 overflow-y-auto"
          style={{ background: '#0a0a0c', borderLeft: `1px solid ${BORDER}` }}>
          {selectedCustomer && (() => {
            const s = selScore;
            const seg = s ? SEGMENT_META[s.segment] : null;
            return (
              <div className="space-y-5">
                <SheetHeader>
                  <SheetTitle className="flex items-center gap-2 flex-wrap" style={{ color: T1 }}>
                    {[selectedCustomer.first_name, selectedCustomer.last_name].filter(Boolean).join(' ') || t('customers.client')}
                    {selectedCustomer.emailOnly && (
                      <span className="px-2 py-0.5 rounded-full text-[11px] font-semibold flex items-center gap-1"
                        style={{ background: 'rgba(96,165,250,0.12)', color: '#60A5FA' }}>
                        <Mail className="w-3 h-3" />{t('customers.emailOnly')}
                      </span>
                    )}
                    {selectedCustomer.is_banned && (
                      <span className="px-2 py-0.5 rounded-full text-[11px] font-semibold"
                        style={{ background: 'rgba(232,25,44,0.1)', color: RED }}>
                        <Ban className="w-3 h-3 inline mr-1" />{t('customers.banned')}
                      </span>
                    )}
                  </SheetTitle>
                </SheetHeader>

                <div className="space-y-1">
                  <p style={{ color: T3, fontSize: 12 }}>{selectedCustomer.email}</p>
                  {selectedCustomer.phone && <p style={{ color: T3, fontSize: 12 }}>{selectedCustomer.phone}</p>}
                </div>

                {/* Minor ticket → birth date + signed authorization */}
                {(() => {
                  const md = minorByEmail.get(selectedCustomer.email.toLowerCase());
                  if (!md) return null;
                  const age = ageFromBirthDate(md.birthDate);
                  return (
                    <div className="rounded-xl p-3.5 space-y-2.5" style={{ background: 'rgba(232,25,44,0.06)', border: '1px solid rgba(232,25,44,0.25)' }}>
                      <p className="flex items-center gap-1.5" style={{ color: '#FF7A80', fontSize: 11, fontWeight: 700, letterSpacing: '0.07em', textTransform: 'uppercase' }}>
                        <ShieldAlert className="w-3.5 h-3.5" />{t('minorClients.badge')}
                      </p>
                      {md.birthDate && (
                        <p style={{ color: T2, fontSize: 12 }}>
                          {t('minorClients.bornOn')} {format(new Date(md.birthDate), 'dd/MM/yyyy')}
                          {age != null && <span style={{ color: T3 }}> · {age} {language === 'fr' ? 'ans' : language === 'es' ? 'años' : 'yo'}</span>}
                        </p>
                      )}
                      {md.docUrl ? (
                        <a href={md.docUrl} target="_blank" rel="noopener noreferrer" download
                          className="flex items-center gap-2.5 px-3 py-2.5 rounded-lg" style={{ background: INNER_BG, border: `1px solid ${F_BORDER}` }}>
                          <FileText className="w-4 h-4 shrink-0" style={{ color: RED }} />
                          <span style={{ color: T1, fontSize: 13 }} className="flex-1 truncate">{md.docName || t('minorClients.signedDoc')}</span>
                          <Download className="w-4 h-4 shrink-0" style={{ color: T2 }} />
                        </a>
                      ) : (
                        <p style={{ color: T3, fontSize: 12 }}>{t('minorClients.noDoc')}</p>
                      )}
                    </div>
                  );
                })()}

                {!selectedCustomer.emailOnly && (
                  <>
                    <div className="flex flex-wrap gap-2 items-center">
                      {seg && <span className="px-2.5 py-1 rounded-full text-[11px] font-semibold" style={{ background: seg.bg, color: seg.accent }}>{seg.label}</span>}
                      {s && <TierBadge tier={s.tier} size="sm" />}
                      {(() => {
                        const country = countryFromPhone(selectedCustomer.phone);
                        return country ? (
                          <span className="px-2.5 py-1 rounded-full text-[11px] font-semibold flex items-center gap-1"
                            style={{ background: INNER_BG, border: `1px solid ${F_BORDER}`, color: T2 }}>
                            {country.flag} {getCountryName(country, language)}
                          </span>
                        ) : (
                          <span className="px-2.5 py-1 rounded-full text-[11px] font-medium"
                            style={{ background: INNER_BG, border: `1px solid ${F_BORDER}`, color: T3 }}>
                            🏳️ {t('origins.unknownShort')}
                          </span>
                        );
                      })()}
                      {s?.churnRisk && (
                        <span className="px-2.5 py-1 rounded-full text-[11px] font-semibold flex items-center gap-1"
                          style={{ background: 'rgba(251,146,60,0.1)', color: '#FB923C' }}>
                          <ArrowDownRight className="w-3 h-3" />{t('customers.churnTag')}
                        </span>
                      )}
                    </div>

                    {/* RFM mini-bars */}
                    {s && (
                      <div className="grid grid-cols-3 gap-2">
                        {[
                          { l: 'R', v: s.r, hint: t('customers.recency') },
                          { l: 'F', v: s.f, hint: t('customers.frequency') },
                          { l: 'M', v: s.m, hint: t('customers.monetary') },
                        ].map(({ l, v, hint }) => (
                          <div key={l} className="p-2.5 rounded-xl" style={{ background: INNER_BG, border: `1px solid ${F_BORDER}` }}>
                            <div className="flex items-center justify-between">
                              <span style={{ color: T3, fontSize: 10.5, fontWeight: 700 }}>{l}</span>
                              <span style={{ color: T1, fontSize: 13, fontWeight: 700 }}>{v}/5</span>
                            </div>
                            <div className="mt-1.5 h-1 rounded-full overflow-hidden" style={{ background: 'rgba(255,255,255,0.08)' }}>
                              <div style={{ width: `${v * 20}%`, height: '100%', background: seg?.accent || RED }} />
                            </div>
                            <p style={{ color: T3, fontSize: 9.5, marginTop: 3 }}>{hint}</p>
                          </div>
                        ))}
                      </div>
                    )}

                    {/* Stats grid */}
                    <div className="grid grid-cols-2 gap-3">
                      {[
                        { label: t('customers.totalSpent'), value: `${selectedCustomer.total_spent.toFixed(0)}€` },
                        { label: t('customers.revenue30'), value: `${selectedCustomer.revenue_30d.toFixed(0)}€` },
                        { label: t('customers.avgBasket'), value: `${selectedCustomer.avg_basket.toFixed(0)}€` },
                        { label: t('customers.visitsPerMonth'), value: selectedCustomer.visits_per_month.toFixed(1) },
                        { label: t('customers.preferredDay'), value: dowName(selectedCustomer.preferred_dow) },
                        { label: t('owner.cust.totalVisits'), value: selectedCustomer.visit_nights || ((selectedCustomer.ticket_count || 0) + (selectedCustomer.order_count || 0) + (selectedCustomer.table_count || 0)) },
                      ].map(({ label, value }) => (
                        <div key={label} className="p-3 rounded-xl" style={{ background: INNER_BG, border: `1px solid ${F_BORDER}` }}>
                          <p style={{ color: T3, fontSize: 10.5, textTransform: 'uppercase', letterSpacing: '0.07em', fontWeight: 600 }}>{label}</p>
                          <p style={{ color: T1, fontSize: 18, fontWeight: 700, marginTop: 2 }}>{value}</p>
                        </div>
                      ))}
                    </div>

                    {/* Trend + preferred event */}
                    <div className="flex flex-wrap gap-2">
                      {s && (selectedCustomer.revenue_90d > 0 || selectedCustomer.revenue_prev_90d > 0) && (
                        <div className="flex items-center gap-1.5 px-3 py-1.5 rounded-xl" style={{ background: INNER_BG, border: `1px solid ${F_BORDER}` }}>
                          {s.trendPct >= 0
                            ? <TrendingUp className="w-3.5 h-3.5" style={{ color: POS }} />
                            : <TrendingDown className="w-3.5 h-3.5" style={{ color: RED }} />}
                          <span style={{ color: s.trendPct >= 0 ? POS : RED, fontSize: 12, fontWeight: 600 }}>
                            {s.trendPct >= 0 ? '+' : ''}{s.trendPct.toFixed(0)}%
                          </span>
                          <span style={{ color: T3, fontSize: 11 }}>{t('customers.trend90')}</span>
                        </div>
                      )}
                      {selectedCustomer.preferred_event_title && (
                        <div className="flex items-center gap-1.5 px-3 py-1.5 rounded-xl" style={{ background: INNER_BG, border: `1px solid ${F_BORDER}` }}>
                          <Calendar className="w-3.5 h-3.5" style={{ color: T3 }} />
                          <span style={{ color: T2, fontSize: 11.5 }} className="truncate max-w-[160px]">{selectedCustomer.preferred_event_title}</span>
                        </div>
                      )}
                    </div>

                    {/* History + notes actions */}
                    <button onClick={() => setTimelineOpen(true)}
                      className="w-full py-2.5 rounded-xl text-[13px] font-medium cursor-pointer flex items-center justify-center gap-2"
                      style={{ background: INNER_BG, border: `1px solid ${BORDER}`, color: T2 }}>
                      <History className="w-4 h-4" />{t('customers.viewHistory')}
                    </button>

                    {/* Editable notes */}
                    <div>
                      <FieldLabel>{t('customers.notes')}</FieldLabel>
                      <textarea value={notesDraft} onChange={e => setNotesDraft(e.target.value)} rows={3}
                        placeholder={t('customers.notesPlaceholder')}
                        className="w-full px-3 py-2.5 rounded-xl text-[13px] resize-none"
                        style={{ background: INNER_BG, border: `1px solid ${BORDER}`, color: T1, outline: 'none' }} />
                      {notesDraft !== (selectedCustomer.notes || '') && (
                        <button onClick={saveNotes} disabled={savingNotes}
                          className="mt-2 px-3 py-1.5 rounded-lg text-[12px] font-semibold cursor-pointer disabled:opacity-40"
                          style={{ background: RED, color: '#fff' }}>
                          {savingNotes ? '...' : t('customers.saveNotes')}
                        </button>
                      )}
                    </div>
                  </>
                )}

                {/* Ban reason */}
                {selectedCustomer.is_banned && selectedCustomer.ban_reason && (
                  <div className="p-3 rounded-xl" style={{ background: 'rgba(232,25,44,0.06)', border: '1px solid rgba(232,25,44,0.2)' }}>
                    <p className="flex items-center gap-1.5 mb-1" style={{ color: RED, fontSize: 12, fontWeight: 600 }}>
                      <AlertTriangle className="w-3.5 h-3.5" />{t('customers.banReason')}
                    </p>
                    <p style={{ color: T2, fontSize: 12 }}>{selectedCustomer.ban_reason}</p>
                    {selectedCustomer.banned_at && <p style={{ color: T3, fontSize: 11, marginTop: 4 }}>{format(new Date(selectedCustomer.banned_at), 'dd/MM/yyyy HH:mm', { locale: dateLocale })}</p>}
                  </div>
                )}

                {/* Incidents */}
                {!selectedCustomer.emailOnly && (
                  <div>
                    <p className="flex items-center gap-1.5 mb-3" style={{ color: T2, fontSize: 13, fontWeight: 600 }}>
                      <AlertTriangle className="w-4 h-4" />{t('customers.incidentHistory')}
                    </p>
                    {incidents.length === 0 ? (
                      <p style={{ color: T3, fontSize: 13 }}>{t('customers.noIncidents')}</p>
                    ) : (
                      <div className="space-y-2 max-h-48 overflow-y-auto">
                        {incidents.map(incident => {
                          const ic = INCIDENT_COLORS[incident.incident_type] || { color: T3, bg: INNER_BG };
                          return (
                            <div key={incident.id} className="p-3 rounded-xl" style={{ background: INNER_BG, border: `1px solid ${F_BORDER}` }}>
                              <div className="flex items-center justify-between mb-1">
                                <span className="px-2 py-0.5 rounded-full text-[10px] font-semibold"
                                  style={{ background: ic.bg, color: ic.color }}>{getIncidentTypeLabel(incident.incident_type)}</span>
                                <span style={{ color: T3, fontSize: 11 }}>{format(new Date(incident.created_at), 'dd/MM/yy HH:mm', { locale: dateLocale })}</span>
                              </div>
                              <p style={{ color: T2, fontSize: 12 }}>{translateIncidentReason(incident.reason)}</p>
                              {incident.details && <p style={{ color: T3, fontSize: 11, marginTop: 2 }}>{incident.details}</p>}
                            </div>
                          );
                        })}
                      </div>
                    )}
                  </div>
                )}

                {/* Actions */}
                <div className="space-y-2 pt-3" style={{ borderTop: `1px solid ${BORDER}` }}>
                  {selectedCustomer.is_banned ? (
                    <button onClick={() => setShowUnbanDialog(true)}
                      className="w-full py-2.5 rounded-xl text-[13px] font-semibold cursor-pointer flex items-center justify-center gap-2"
                      style={{ background: 'rgba(52,211,153,0.1)', border: '1px solid rgba(52,211,153,0.25)', color: POS }}>
                      <CheckCircle className="w-4 h-4" />{t('customers.unbanCustomer')}
                    </button>
                  ) : (
                    <button onClick={() => setShowBanDialog(true)}
                      className="w-full py-2.5 rounded-xl text-[13px] font-semibold cursor-pointer flex items-center justify-center gap-2"
                      style={{ background: 'rgba(232,25,44,0.1)', border: '1px solid rgba(232,25,44,0.25)', color: RED }}>
                      <Ban className="w-4 h-4" />{t('customers.banCustomer')}
                    </button>
                  )}
                  <button onClick={() => setSheetOpen(false)}
                    className="w-full py-2.5 rounded-xl text-[13px] font-medium cursor-pointer"
                    style={{ background: INNER_BG, border: `1px solid ${BORDER}`, color: T2 }}>
                    {t('customers.close')}
                  </button>
                </div>
              </div>
            );
          })()}
        </SheetContent>
      </Sheet>

      {/* Timeline */}
      {selectedCustomer && (
        <CustomerTimelineSheet
          open={timelineOpen}
          onClose={() => setTimelineOpen(false)}
          email={selectedCustomer.email}
          name={[selectedCustomer.first_name, selectedCustomer.last_name].filter(Boolean).join(' ') || undefined}
          venueId={venue?.id}
        />
      )}

      {/* Ban Dialog */}
      <Dialog open={showBanDialog} onOpenChange={setShowBanDialog}>
        <DialogContent className="border-0 p-0" style={{ background: '#0a0a0c', border: `1px solid ${BORDER}`, borderRadius: 18, maxWidth: 420 }}>
          <DialogHeader className="px-6 pt-6 pb-0">
            <DialogTitle className="flex items-center gap-2" style={{ color: T1, fontSize: 15 }}>
              <Ban className="w-4 h-4" style={{ color: RED }} />{t('customers.banCustomer')}
            </DialogTitle>
            <DialogDescription style={{ color: T3, fontSize: 12 }}>{selectedCustomer?.email}</DialogDescription>
          </DialogHeader>
          <div className="p-6 space-y-4">
            <div>
              <FieldLabel>{t('customers.banReason')} *</FieldLabel>
              <textarea value={banReason} onChange={e => setBanReason(e.target.value)}
                placeholder={t('customers.banPlaceholder')} rows={3}
                className="w-full px-3 py-2.5 rounded-xl text-[13px] resize-none transition-all duration-150"
                style={{ background: INNER_BG, border: `1px solid ${BORDER}`, color: T1, outline: 'none' }}
                onFocus={e => (e.target.style.borderColor = 'rgba(255,255,255,0.18)')}
                onBlur={e => (e.target.style.borderColor = BORDER)}
              />
            </div>
            <p style={{ color: T3, fontSize: 11.5 }}>{t('customers.banScopeNote')}</p>
            <div className="flex gap-3">
              <button onClick={handleBanCustomer} disabled={processing || !banReason}
                className="flex-1 py-2.5 rounded-xl text-[13px] font-semibold cursor-pointer disabled:opacity-40"
                style={{ background: RED, color: '#fff' }}>
                {processing ? '...' : t('customers.confirmBan')}
              </button>
              <button onClick={() => setShowBanDialog(false)} disabled={processing}
                className="px-4 py-2.5 rounded-xl text-[13px] font-medium cursor-pointer"
                style={{ background: INNER_BG, border: `1px solid ${BORDER}`, color: T2 }}>
                {t('customers.cancel')}
              </button>
            </div>
          </div>
        </DialogContent>
      </Dialog>

      {/* Unban Dialog */}
      <Dialog open={showUnbanDialog} onOpenChange={setShowUnbanDialog}>
        <DialogContent className="border-0 p-0" style={{ background: '#0a0a0c', border: `1px solid ${BORDER}`, borderRadius: 18, maxWidth: 380 }}>
          <DialogHeader className="px-6 pt-6 pb-0">
            <DialogTitle className="flex items-center gap-2" style={{ color: T1, fontSize: 15 }}>
              <CheckCircle className="w-4 h-4" style={{ color: POS }} />{t('customers.unbanCustomer')}
            </DialogTitle>
            <DialogDescription style={{ color: T3, fontSize: 12 }}>{selectedCustomer?.email}</DialogDescription>
          </DialogHeader>
          <div className="p-6 flex gap-3">
            <button onClick={handleUnbanCustomer} disabled={processing}
              className="flex-1 py-2.5 rounded-xl text-[13px] font-semibold cursor-pointer disabled:opacity-40"
              style={{ background: 'rgba(52,211,153,0.1)', border: '1px solid rgba(52,211,153,0.25)', color: POS }}>
              {processing ? '...' : t('customers.confirmUnban')}
            </button>
            <button onClick={() => setShowUnbanDialog(false)} disabled={processing}
              className="px-4 py-2.5 rounded-xl text-[13px] font-medium cursor-pointer"
              style={{ background: INNER_BG, border: `1px solid ${BORDER}`, color: T2 }}>
              {t('customers.cancel')}
            </button>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}
