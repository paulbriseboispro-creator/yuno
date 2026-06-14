import { useState, useEffect, useMemo } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { useAuth } from '@/hooks/useAuth';
import { useLanguage } from '@/contexts/LanguageContext';
import { translate } from '@/i18n/orgTranslate';
import { Sheet, SheetContent, SheetHeader, SheetTitle } from '@/components/ui/sheet';
import {
  Users, Search, Ticket, Table, Euro,
  Crown, TrendingUp, Star, Target, ShoppingBag, Download, Filter, X, ShieldAlert, FileText,
} from 'lucide-react';
import { fetchMinorDocsByEmail, ageFromBirthDate, type MinorDoc } from '@/lib/minorTicketDocs';
import { format, differenceInDays } from 'date-fns';
import { fr, enUS } from 'date-fns/locale';
import { PieChart, Pie, Cell, ResponsiveContainer, BarChart, Bar, XAxis, YAxis, Tooltip } from 'recharts';
import { motion, AnimatePresence } from 'framer-motion';
import { TierBadge } from '@/components/loyalty/TierBadge';
import { OrgPageHeader } from '@/components/org-ui';

// ─── Yuno Design Tokens ───────────────────────────────────────────────────────
const RED      = '#E8192C';
const POS      = '#34D399';
const T1       = 'rgba(255,255,255,0.96)';
const T2       = 'rgba(255,255,255,0.58)';
const T3       = 'rgba(255,255,255,0.36)';
const BORDER   = 'rgba(255,255,255,0.085)';
const F_BORDER = 'rgba(255,255,255,0.055)';
const CARD_BG  = 'linear-gradient(180deg,rgba(255,255,255,.045) 0%,rgba(255,255,255,.008) 100%),#0a0a0c';
const INNER_BG = 'rgba(255,255,255,0.032)';
const CARD_SHADOW = '0 1px 0 rgba(255,255,255,.05) inset,0 18px 40px -28px rgba(0,0,0,.9)';

type SegmentFrequency = 'new' | 'regular' | 'loyal' | '';
type SegmentSpending  = 'low' | 'medium' | 'high' | '';
type SegmentActivity  = 'active' | 'dormant' | 'lost' | '';
type SegmentTier      = 'bronze' | 'silver' | 'gold' | 'platinum' | '';
type SegmentPurchase  = 'tickets' | 'vip' | '';

interface SegmentFilters {
  frequency: SegmentFrequency; spending: SegmentSpending; activity: SegmentActivity;
  tier: SegmentTier; purchase: SegmentPurchase;
}
const emptyFilters: SegmentFilters = { frequency: '', spending: '', activity: '', tier: '', purchase: '' };

function getCustomerTier(totalSpent: number): 'bronze' | 'silver' | 'gold' | 'platinum' {
  if (totalSpent >= 1000) return 'platinum';
  if (totalSpent >= 500) return 'gold';
  if (totalSpent >= 200) return 'silver';
  return 'bronze';
}

interface OrgCustomer {
  id: string; email: string; first_name: string | null; last_name: string | null;
  phone: string | null; first_visit_at: string; last_visit_at: string; total_spent: number;
  ticket_count: number; table_count: number; preferred_event: string;
}

interface CustomerProfile {
  type: 'vip' | 'regular' | 'occasional' | 'new'; label: string;
  color: string; accentColor: string; avgSpent: number;
  preferredCategory: 'tickets' | 'tables' | 'mixed';
}

type TopLimit = 5 | 25 | 50 | 100;
type TabKey = 'all' | 'top' | 'minors';

export default function OrgAppCustomers() {
  const { user } = useAuth();
  const { language } = useLanguage();
  const tt = (frTxt: string, en: string, es?: string) => translate(language, frTxt, en, es);
  const dateLocale = language === 'fr' ? fr : enUS;

  const [allCustomers, setAllCustomers] = useState<OrgCustomer[]>([]);
  const [loading, setLoading] = useState(true);
  const [searchQuery, setSearchQuery] = useState('');
  const [activeTab, setActiveTab] = useState<TabKey>('all');
  // Minor-ticket record per lowercased email (badge + filter + signed doc in detail).
  const [minorByEmail, setMinorByEmail] = useState<Map<string, MinorDoc>>(new Map());
  const [selectedCustomer, setSelectedCustomer] = useState<OrgCustomer | null>(null);
  const [topLimit, setTopLimit] = useState<TopLimit>(25);
  const [sheetOpen, setSheetOpen] = useState(false);
  const [segmentFilters, setSegmentFilters] = useState<SegmentFilters>(emptyFilters);
  const [showFilters, setShowFilters] = useState(false);

  useEffect(() => { if (user?.id) fetchAllCustomers(); }, [user?.id]);

  const fetchAllCustomers = async () => {
    if (!user?.id) return;
    setLoading(true);
    try {
      const { data: events } = await supabase
        .from('events').select('id, title')
        .or(`organizer_user_id.eq.${user.id},partner_organizer_id.eq.${user.id}`);
      const eventIds = (events ?? []).map(e => e.id);
      const eventTitles = new Map((events ?? []).map(e => [e.id, e.title]));
      if (eventIds.length === 0) { setAllCustomers([]); setLoading(false); return; }

      setMinorByEmail(await fetchMinorDocsByEmail(eventIds));

      const [{ data: tickets }, { data: tables }] = await Promise.all([
        supabase.from('tickets').select('user_email, full_name, phone, total_price, quantity, created_at, event_id').in('event_id', eventIds).eq('status', 'paid'),
        supabase.from('table_reservations').select('user_email, full_name, phone, total_price, created_at, event_id').in('event_id', eventIds).eq('status', 'paid'),
      ]);

      const map = new Map<string, OrgCustomer & { _eventCounts: Map<string, number> }>();
      const ensure = (email: string) => {
        let r = map.get(email);
        if (!r) {
          r = { id: email, email, first_name: null, last_name: null, phone: null, first_visit_at: '', last_visit_at: '', total_spent: 0, ticket_count: 0, table_count: 0, preferred_event: '', _eventCounts: new Map() };
          map.set(email, r);
        }
        return r;
      };
      const applyName = (r: OrgCustomer, full?: string | null) => {
        if (r.first_name || !full) return;
        const parts = full.trim().split(/\s+/);
        r.first_name = parts[0] || null;
        r.last_name = parts.slice(1).join(' ') || null;
      };

      (tickets ?? []).forEach((t: any) => {
        const e = (t.user_email ?? '').toLowerCase();
        if (!e) return;
        const r = ensure(e);
        applyName(r, t.full_name);
        if (!r.phone) r.phone = t.phone ?? null;
        r.total_spent += Number(t.total_price ?? 0);
        r.ticket_count += t.quantity ?? 1;
        if (!r.first_visit_at || t.created_at < r.first_visit_at) r.first_visit_at = t.created_at;
        if (!r.last_visit_at || t.created_at > r.last_visit_at) r.last_visit_at = t.created_at;
        r._eventCounts.set(t.event_id, (r._eventCounts.get(t.event_id) ?? 0) + (t.quantity ?? 1));
      });
      (tables ?? []).forEach((t: any) => {
        const e = (t.user_email ?? '').toLowerCase();
        if (!e) return;
        const r = ensure(e);
        applyName(r, t.full_name);
        if (!r.phone) r.phone = t.phone ?? null;
        r.total_spent += Number(t.total_price ?? 0);
        r.table_count += 1;
        if (!r.first_visit_at || t.created_at < r.first_visit_at) r.first_visit_at = t.created_at;
        if (!r.last_visit_at || t.created_at > r.last_visit_at) r.last_visit_at = t.created_at;
        r._eventCounts.set(t.event_id, (r._eventCounts.get(t.event_id) ?? 0) + 1);
      });

      const out: OrgCustomer[] = [...map.values()].map(r => {
        let bestId = ''; let bestC = 0;
        r._eventCounts.forEach((c, id) => { if (c > bestC) { bestC = c; bestId = id; } });
        const { _eventCounts, ...rest } = r;
        return { ...rest, preferred_event: eventTitles.get(bestId) ?? '' };
      }).sort((a, b) => b.total_spent - a.total_spent);

      setAllCustomers(out);
    } finally {
      setLoading(false);
    }
  };

  const getCustomerProfile = (customer: OrgCustomer): CustomerProfile => {
    const totalPurchases = customer.ticket_count + customer.table_count;
    const avgSpent = totalPurchases > 0 ? customer.total_spent / totalPurchases : 0;
    const daysSinceFirstVisit = customer.first_visit_at ? differenceInDays(new Date(), new Date(customer.first_visit_at)) : 0;
    let preferredCategory: CustomerProfile['preferredCategory'] = 'mixed';
    if (customer.table_count > customer.ticket_count && customer.table_count > 0) preferredCategory = 'tables';
    else if (customer.ticket_count > 0) preferredCategory = 'tickets';
    if (customer.total_spent >= 500 || customer.table_count >= 3)
      return { type: 'vip', label: 'VIP', color: 'rgba(252,211,77,0.1)', accentColor: '#FCD34D', avgSpent, preferredCategory };
    if (totalPurchases >= 5 || customer.total_spent >= 200)
      return { type: 'regular', label: tt('Régulier', 'Regular'), color: 'rgba(96,165,250,0.1)', accentColor: '#60A5FA', avgSpent, preferredCategory };
    if (daysSinceFirstVisit <= 30 && totalPurchases <= 2)
      return { type: 'new', label: tt('Nouveau', 'New'), color: 'rgba(52,211,153,0.1)', accentColor: POS, avgSpent, preferredCategory };
    return { type: 'occasional', label: tt('Occasionnel', 'Occasional'), color: 'rgba(255,255,255,0.05)', accentColor: T3, avgSpent, preferredCategory };
  };

  const analytics = useMemo(() => {
    const profiles = { vip: 0, regular: 0, occasional: 0, new: 0 };
    const categories = { tickets: 0, tables: 0, mixed: 0 };
    allCustomers.forEach(c => {
      const p = getCustomerProfile(c);
      profiles[p.type]++;
      categories[p.preferredCategory]++;
    });
    const totalSpent = allCustomers.reduce((s, c) => s + Number(c.total_spent || 0), 0);
    return {
      profiles, categories, totalSpent,
      avgSpentPerCustomer: allCustomers.length > 0 ? totalSpent / allCustomers.length : 0,
      activeCustomers: allCustomers.filter(c => c.last_visit_at && differenceInDays(new Date(), new Date(c.last_visit_at)) <= 30).length,
      totalCustomers: allCustomers.length,
    };
  }, [allCustomers, language]);

  const topCustomers = useMemo(() => [...allCustomers].sort((a, b) => Number(b.total_spent) - Number(a.total_spent)).slice(0, topLimit), [allCustomers, topLimit]);

  const activeFilterCount = useMemo(() => Object.values(segmentFilters).filter(v => v !== '').length, [segmentFilters]);

  const filteredCustomers = useMemo(() => {
    const searchLower = searchQuery.toLowerCase();
    const baseList = activeTab === 'top' ? topCustomers
      : activeTab === 'minors' ? allCustomers.filter(c => minorByEmail.has(c.email.toLowerCase()))
      : allCustomers;
    let list = baseList;
    if (searchQuery) list = list.filter(c => c.email.toLowerCase().includes(searchLower) || c.first_name?.toLowerCase().includes(searchLower) || c.last_name?.toLowerCase().includes(searchLower) || c.phone?.includes(searchQuery));
    const { frequency, spending, activity, tier, purchase } = segmentFilters;
    if (frequency) list = list.filter(c => { const v = (c.ticket_count || 0) + (c.table_count || 0); return frequency === 'new' ? v <= 1 : frequency === 'regular' ? v >= 2 && v <= 5 : v >= 6; });
    if (spending) list = list.filter(c => { const s = Number(c.total_spent || 0); return spending === 'low' ? s < 50 : spending === 'medium' ? s >= 50 && s <= 150 : s > 150; });
    if (activity) list = list.filter(c => { const d = c.last_visit_at ? differenceInDays(new Date(), new Date(c.last_visit_at)) : 999; return activity === 'active' ? d <= 30 : activity === 'dormant' ? d > 30 && d <= 90 : d > 90; });
    if (tier) list = list.filter(c => getCustomerTier(Number(c.total_spent || 0)) === tier);
    if (purchase) list = list.filter(c => purchase === 'tickets' ? (c.ticket_count || 0) > 0 : (c.table_count || 0) > 0);
    return list;
  }, [allCustomers, topCustomers, minorByEmail, searchQuery, activeTab, segmentFilters]);

  const profileChartData = [
    { name: 'VIP', value: analytics.profiles.vip, color: '#FCD34D' },
    { name: tt('Régulier', 'Regular'), value: analytics.profiles.regular, color: '#60A5FA' },
    { name: tt('Occasionnel', 'Occasional'), value: analytics.profiles.occasional, color: T3 },
    { name: tt('Nouveau', 'New'), value: analytics.profiles.new, color: POS },
  ].filter(d => d.value > 0);

  const categoryChartData = [
    { name: tt('Billets', 'Tickets'), value: analytics.categories.tickets },
    { name: tt('Tables', 'Tables'), value: analytics.categories.tables },
    { name: tt('Mixte', 'Mixed'), value: analytics.categories.mixed },
  ].filter(d => d.value > 0);

  const exportCustomersCsv = () => {
    const sep = ',';
    const rows = [['Email', 'Prénom', 'Nom', 'Phone', 'Tickets', 'Tables', 'TotalSpent', 'LastVisit', 'Profile'].join(sep)];
    filteredCustomers.forEach(c => {
      const profile = getCustomerProfile(c);
      rows.push([c.email, c.first_name || '', c.last_name || '', c.phone || '', String(c.ticket_count || 0), String(c.table_count || 0), Number(c.total_spent || 0).toFixed(2), c.last_visit_at ? format(new Date(c.last_visit_at), 'yyyy-MM-dd') : '', profile.label].map(v => `"${v.replace(/"/g, '""')}"`).join(sep));
    });
    const blob = new Blob(['﻿' + rows.join('\n')], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url; a.download = `clients-${format(new Date(), 'yyyy-MM-dd')}.csv`;
    document.body.appendChild(a); a.click(); document.body.removeChild(a); URL.revokeObjectURL(url);
  };

  const TABS = [
    { key: 'all' as TabKey, label: tt('Tous les clients', 'All clients'), Icon: Users },
    { key: 'top' as TabKey, label: tt('Top clients', 'Top clients'), Icon: Crown },
    { key: 'minors' as TabKey, label: tt('Mineurs', 'Minors', 'Menores'), Icon: ShieldAlert },
  ];

  function CustomerRow({ customer, rank }: { customer: OrgCustomer; rank?: number }) {
    const profile = getCustomerProfile(customer);
    return (
      <motion.div initial={{ opacity: 0, y: 6 }} animate={{ opacity: 1, y: 0 }}
        onClick={() => { setSelectedCustomer(customer); setSheetOpen(true); }}
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
            <span style={{ color: T1, fontSize: 13, fontWeight: 500 }}>
              {[customer.first_name, customer.last_name].filter(Boolean).join(' ') || customer.email}
            </span>
            <span className="px-1.5 py-0.5 rounded-full text-[10px] font-semibold"
              style={{ background: profile.color, color: profile.accentColor }}>
              {profile.label}
            </span>
            {minorByEmail.has(customer.email.toLowerCase()) && (
              <span className="px-1.5 py-0.5 rounded-full text-[10px] font-semibold flex items-center gap-0.5"
                style={{ background: 'rgba(232,25,44,0.12)', color: '#FF7A80' }}>
                <ShieldAlert className="w-2.5 h-2.5" />{tt('Mineur', 'Minor', 'Menor')}
              </span>
            )}
          </div>
          <p style={{ color: T3, fontSize: 11.5, marginTop: 1 }} className="truncate">{customer.email}</p>
        </div>
        <div className="flex items-center gap-3 flex-shrink-0">
          <div className="hidden sm:flex items-center gap-2 text-[11px]" style={{ color: T3 }}>
            <span className="flex items-center gap-0.5"><Ticket className="w-3 h-3" />{customer.ticket_count || 0}</span>
            <span className="flex items-center gap-0.5"><Table className="w-3 h-3" />{customer.table_count || 0}</span>
          </div>
          <TierBadge tier={getCustomerTier(Number(customer.total_spent || 0))} size="sm" />
          <span style={{ color: T1, fontSize: 14, fontWeight: 700, fontVariantNumeric: 'tabular-nums', minWidth: 48, textAlign: 'right' }}>
            {Number(customer.total_spent || 0).toFixed(0)}€
          </span>
        </div>
      </motion.div>
    );
  }

  return (
    <div className="min-h-screen pb-28">
      <div className="fixed inset-0 pointer-events-none z-0"
        style={{ background: 'radial-gradient(120% 60% at 50% -10%,rgba(255,255,255,.025),transparent 55%)' }} />

      <div className="relative z-10 mx-auto max-w-[1340px] px-4 sm:px-6 pt-2 pb-12 space-y-5">
        <OrgPageHeader
          title={tt('Clients', 'Customers')}
          subtitle={tt('Votre base clients agrégée sur toutes vos soirées.', 'Your customer base across every event.')}
          actions={
            <button onClick={exportCustomersCsv}
              className="inline-flex items-center gap-1.5 px-3 py-2 rounded-xl text-[12px] font-medium cursor-pointer transition-all duration-150"
              style={{ background: INNER_BG, border: `1px solid ${BORDER}`, color: T2 }}>
              <Download className="w-3.5 h-3.5" />CSV
            </button>
          }
        />
        {/* Stats strip */}
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
          {[
            { label: tt('Clients', 'Clients'), value: analytics.totalCustomers },
            { label: tt('Actifs (30j)', 'Active (30d)'), value: analytics.activeCustomers },
            { label: tt('Revenu total', 'Total revenue'), value: `${analytics.totalSpent.toFixed(0)}€` },
            { label: tt('Panier moyen', 'Avg spent'), value: `${analytics.avgSpentPerCustomer.toFixed(0)}€` },
          ].map(({ label, value }) => (
            <div key={label} className="px-4 py-3 rounded-xl" style={{ background: CARD_BG, border: `1px solid ${BORDER}`, boxShadow: CARD_SHADOW }}>
              <p style={{ color: T3, fontSize: 10.5, fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.07em' }}>{label}</p>
              <p style={{ color: T1, fontSize: 22, fontWeight: 700, letterSpacing: '-0.02em', marginTop: 2, fontVariantNumeric: 'tabular-nums' }}>{value}</p>
            </div>
          ))}
        </div>

        {/* Charts */}
        {allCustomers.length > 0 && (
          <div className="grid md:grid-cols-2 gap-3">
            <div style={{ background: CARD_BG, border: `1px solid ${BORDER}`, borderRadius: 18, boxShadow: CARD_SHADOW, padding: 20 }}>
              <div className="flex items-center gap-2 mb-3">
                <Star className="w-4 h-4" style={{ color: T3 }} />
                <p style={{ color: T2, fontSize: 13, fontWeight: 600 }}>{tt('Profils clients', 'Customer profiles')}</p>
              </div>
              <div className="flex items-center gap-4">
                <div className="w-24 h-24 flex-shrink-0">
                  <ResponsiveContainer width="100%" height="100%">
                    <PieChart>
                      <Pie data={profileChartData} dataKey="value" cx="50%" cy="50%" innerRadius={20} outerRadius={40}>
                        {profileChartData.map((e, i) => <Cell key={i} fill={e.color} />)}
                      </Pie>
                    </PieChart>
                  </ResponsiveContainer>
                </div>
                <div className="flex-1 grid grid-cols-2 gap-2">
                  {profileChartData.map(item => (
                    <div key={item.name} className="flex items-center gap-1.5">
                      <div className="w-2 h-2 rounded-full flex-shrink-0" style={{ background: item.color }} />
                      <span style={{ color: T3, fontSize: 11 }}>{item.name}: <span style={{ color: T1 }}>{item.value}</span></span>
                    </div>
                  ))}
                </div>
              </div>
            </div>
            <div style={{ background: CARD_BG, border: `1px solid ${BORDER}`, borderRadius: 18, boxShadow: CARD_SHADOW, padding: 20 }}>
              <div className="flex items-center gap-2 mb-3">
                <ShoppingBag className="w-4 h-4" style={{ color: T3 }} />
                <p style={{ color: T2, fontSize: 13, fontWeight: 600 }}>{tt('Préférences', 'Preferences')}</p>
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
                {activeTab === key && (
                  <span className="absolute left-3 right-3 rounded-full"
                    style={{ bottom: -1, height: 2, background: RED, boxShadow: `0 0 10px rgba(232,25,44,0.6)` }} />
                )}
              </button>
            ))}
          </div>

          {/* Search + filters bar */}
          <div className="flex gap-2 mt-4">
            <div className="relative flex-1">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 pointer-events-none" style={{ color: T3 }} />
              <input
                type="text" value={searchQuery} onChange={e => setSearchQuery(e.target.value)}
                placeholder={tt('Rechercher email, nom, téléphone…', 'Search email, name, phone…')}
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
                  {[
                    { key: 'frequency', label: tt('Fréquence', 'Frequency'), opts: [{ v: 'new', l: tt('Nouveau', 'New') }, { v: 'regular', l: tt('Régulier', 'Regular') }, { v: 'loyal', l: tt('Fidèle', 'Loyal') }] },
                    { key: 'spending', label: tt('Dépenses', 'Spending'), opts: [{ v: 'low', l: '< 50€' }, { v: 'medium', l: '50-150€' }, { v: 'high', l: '150€+' }] },
                    { key: 'activity', label: tt('Activité', 'Activity'), opts: [{ v: 'active', l: tt('Actif', 'Active') }, { v: 'dormant', l: tt('Dormant', 'Dormant') }, { v: 'lost', l: tt('Perdu', 'Lost') }] },
                    { key: 'tier', label: tt('Palier', 'Tier'), opts: ['bronze', 'silver', 'gold', 'platinum'].map(v => ({ v, l: v.charAt(0).toUpperCase() + v.slice(1) })) },
                    { key: 'purchase', label: tt("Type d'achat", 'Purchase type'), opts: [{ v: 'tickets', l: tt('Billets', 'Tickets') }, { v: 'vip', l: 'VIP' }] },
                  ].map(({ key, label, opts }) => (
                    <div key={key}>
                      <p style={{ color: T3, fontSize: 11, marginBottom: 6 }}>{label}</p>
                      <div className="flex flex-wrap gap-1.5">
                        {opts.map(({ v, l }) => {
                          const active = segmentFilters[key as keyof SegmentFilters] === v;
                          return (
                            <button key={v} type="button"
                              onClick={() => setSegmentFilters(f => ({ ...f, [key]: f[key as keyof SegmentFilters] === v ? '' : v }))}
                              className="px-2.5 py-1 rounded-full text-[11px] font-medium cursor-pointer transition-all duration-150"
                              style={{ background: active ? `rgba(232,25,44,0.12)` : INNER_BG, border: `1px solid ${active ? RED : BORDER}`, color: active ? RED : T2 }}>
                              {l}
                            </button>
                          );
                        })}
                      </div>
                    </div>
                  ))}
                  <p style={{ color: T3, fontSize: 11.5 }}>
                    {filteredCustomers.length} {tt('clients correspondent', 'customers match')}
                  </p>
                </div>
              </motion.div>
            )}
          </AnimatePresence>

          {/* Customer list */}
          <div className="mt-4" style={{ background: CARD_BG, border: `1px solid ${BORDER}`, borderRadius: 18, boxShadow: CARD_SHADOW, overflow: 'hidden' }}>
            {/* Table header */}
            <div className="flex items-center gap-3 px-4 py-2.5" style={{ borderBottom: `1px solid ${BORDER}` }}>
              {activeTab === 'top' && <div className="w-6 flex-shrink-0" />}
              <p className="flex-1" style={{ color: T3, fontSize: 10.5, fontWeight: 700, letterSpacing: '0.07em', textTransform: 'uppercase' }}>{tt('Client', 'Customer')}</p>
              <div className="hidden sm:flex items-center gap-6 flex-shrink-0" style={{ color: T3, fontSize: 10.5, fontWeight: 700, letterSpacing: '0.07em', textTransform: 'uppercase' }}>
                <span>T/V</span>
                <span>Tier</span>
              </div>
              <p style={{ color: T3, fontSize: 10.5, fontWeight: 700, letterSpacing: '0.07em', textTransform: 'uppercase', minWidth: 48, textAlign: 'right' }}>{tt('Dépensé', 'Spent')}</p>
            </div>
            {loading ? (
              <div className="flex items-center justify-center py-14">
                <div className="h-8 w-8 animate-spin rounded-full border-2" style={{ borderColor: `${BORDER} ${BORDER} ${BORDER} ${RED}` }} />
              </div>
            ) : filteredCustomers.length === 0 ? (
              <div className="text-center py-14 px-4">
                <Users className="h-9 w-9 mx-auto mb-2" style={{ color: 'rgba(255,255,255,0.10)' }} />
                <p style={{ color: T3, fontSize: 13 }}>{searchQuery ? tt('Aucun résultat', 'No results') : tt('Aucun client pour le moment', 'No customers yet')}</p>
              </div>
            ) : (
              filteredCustomers.map((customer, i) => (
                <CustomerRow key={customer.id} customer={customer} rank={activeTab === 'top' ? i + 1 : undefined} />
              ))
            )}
          </div>
        </div>
      </div>

      {/* Customer Detail Sheet */}
      <Sheet open={sheetOpen} onOpenChange={setSheetOpen}>
        <SheetContent className="border-0 overflow-y-auto" style={{ background: '#0a0a0c', borderLeft: `1px solid ${BORDER}` }}>
          {selectedCustomer && (() => {
            const profile = getCustomerProfile(selectedCustomer);
            const tier = getCustomerTier(Number(selectedCustomer.total_spent || 0));
            return (
              <div className="space-y-5">
                <SheetHeader>
                  <SheetTitle className="flex items-center gap-2" style={{ color: T1 }}>
                    {[selectedCustomer.first_name, selectedCustomer.last_name].filter(Boolean).join(' ') || tt('Client', 'Customer')}
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
                        <ShieldAlert className="w-3.5 h-3.5" />{tt('Client mineur', 'Minor customer', 'Cliente menor')}
                      </p>
                      {md.birthDate && (
                        <p style={{ color: T2, fontSize: 12 }}>
                          {tt('Né(e) le', 'Born on', 'Nacido(a) el')} {format(new Date(md.birthDate), 'dd/MM/yyyy', { locale: dateLocale })}
                          {age != null && <span style={{ color: T3 }}> · {age} {tt('ans', 'yo', 'años')}</span>}
                        </p>
                      )}
                      {md.docUrl ? (
                        <a href={md.docUrl} target="_blank" rel="noopener noreferrer" download
                          className="flex items-center gap-2.5 px-3 py-2.5 rounded-lg" style={{ background: INNER_BG, border: `1px solid ${F_BORDER}` }}>
                          <FileText className="w-4 h-4 shrink-0" style={{ color: RED }} />
                          <span style={{ color: T1, fontSize: 13 }} className="flex-1 truncate">{md.docName || tt('Document signé', 'Signed document', 'Documento firmado')}</span>
                          <Download className="w-4 h-4 shrink-0" style={{ color: T2 }} />
                        </a>
                      ) : (
                        <p style={{ color: T3, fontSize: 12 }}>{tt('Aucun document', 'No document provided', 'Sin documento')}</p>
                      )}
                    </div>
                  );
                })()}

                <div className="flex flex-wrap gap-2">
                  <span className="px-2.5 py-1 rounded-full text-[11px] font-semibold"
                    style={{ background: profile.color, color: profile.accentColor }}>{profile.label}</span>
                  <TierBadge tier={tier} size="sm" />
                </div>

                {/* Stats grid */}
                <div className="grid grid-cols-2 gap-3">
                  {[
                    { label: tt('Total dépensé', 'Total spent'), value: `${Number(selectedCustomer.total_spent || 0).toFixed(0)}€` },
                    { label: tt('Visites totales', 'Total visits'), value: (selectedCustomer.ticket_count || 0) + (selectedCustomer.table_count || 0) },
                    { label: tt('Billets', 'Tickets'), value: selectedCustomer.ticket_count || 0 },
                    { label: tt('Tables', 'Tables'), value: selectedCustomer.table_count || 0 },
                    { label: tt('Première visite', 'First visit'), value: selectedCustomer.first_visit_at ? format(new Date(selectedCustomer.first_visit_at), 'dd/MM/yy', { locale: dateLocale }) : '—' },
                    { label: tt('Dernière visite', 'Last visit'), value: selectedCustomer.last_visit_at ? format(new Date(selectedCustomer.last_visit_at), 'dd/MM/yy', { locale: dateLocale }) : '—' },
                  ].map(({ label, value }) => (
                    <div key={label} className="p-3 rounded-xl" style={{ background: INNER_BG, border: `1px solid ${F_BORDER}` }}>
                      <p style={{ color: T3, fontSize: 10.5, textTransform: 'uppercase', letterSpacing: '0.07em', fontWeight: 600 }}>{label}</p>
                      <p style={{ color: T1, fontSize: 18, fontWeight: 700, marginTop: 2 }}>{value}</p>
                    </div>
                  ))}
                </div>

                {/* Preferred event */}
                {selectedCustomer.preferred_event && (
                  <div className="p-3 rounded-xl" style={{ background: INNER_BG, border: `1px solid ${F_BORDER}` }}>
                    <p style={{ color: T3, fontSize: 10.5, textTransform: 'uppercase', letterSpacing: '0.07em', fontWeight: 600 }}>{tt('Soirée préférée', 'Favorite event')}</p>
                    <p style={{ color: T1, fontSize: 14, fontWeight: 600, marginTop: 3 }}>{selectedCustomer.preferred_event}</p>
                  </div>
                )}

                <div className="pt-3" style={{ borderTop: `1px solid ${BORDER}` }}>
                  <button onClick={() => setSheetOpen(false)}
                    className="w-full py-2.5 rounded-xl text-[13px] font-medium cursor-pointer"
                    style={{ background: INNER_BG, border: `1px solid ${BORDER}`, color: T2 }}>
                    {tt('Fermer', 'Close')}
                  </button>
                </div>
              </div>
            );
          })()}
        </SheetContent>
      </Sheet>
    </div>
  );
}
