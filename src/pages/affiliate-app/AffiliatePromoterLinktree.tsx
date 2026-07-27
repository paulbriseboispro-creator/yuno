import { useEffect, useState, useCallback } from 'react';
import { motion } from 'framer-motion';
import { supabase } from '@/integrations/supabase/client';
import { useAuth } from '@/hooks/useAuth';
import { useToast } from '@/hooks/use-toast';
import { CalendarDays, Plus, Trash2, ExternalLink, Link2, Save, ArrowUpDown, Send, Copy } from 'lucide-react';
import { format, addDays } from 'date-fns';
import { fr, enUS, es } from 'date-fns/locale';
import { useLanguage } from '@/contexts/LanguageContext';
import {
  AffPage, AffHeading, AffCard, AffButton, AffLinkButton, SectionLabel, AffSpinner,
  RED, T1, T2, T3, BORDER, F_BORDER, INNER_BG, TILE_BG,
} from '@/components/affiliate/affiliate-ui';

const MAX_EVENTS = 15;

type AffiliateEvent = {
  id: string;
  name: string;
  slug: string;
  event_date: string;
  start_time: string | null;
  flyer_url: string | null;
  affiliate_venues: { name: string } | null;
};

type LinktreeEntry = {
  id: string;
  affiliate_event_id: string;
  promo_link: string | null;
  sort_order: number;
  event: AffiliateEvent | null;
};

const SORT_LABEL_KEYS: Record<string, string> = {
  by_day: 'aff.plink.sortByDay',
  by_genre: 'aff.plink.sortByGenre',
  by_price: 'aff.plink.sortByPrice',
  custom: 'aff.plink.sortCustom',
};

export default function AffiliatePromoterLinktree() {
  const { user } = useAuth();
  const { toast } = useToast();
  const { t, language } = useLanguage();
  const dateLocale = language === 'fr' ? fr : language === 'es' ? es : enUS;

  const [memberId, setMemberId] = useState<string | null>(null);
  const [linktreeSlug, setLinktreeSlug] = useState<string | null>(null);
  const [entries, setEntries] = useState<LinktreeEntry[]>([]);
  const [availableEvents, setAvailableEvents] = useState<AffiliateEvent[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState<string | null>(null);
  const [search, setSearch] = useState('');
  const [allowPromoterSort, setAllowPromoterSort] = useState(false);
  const [adminSortMode, setAdminSortMode] = useState<string>('by_day');
  const [memberSortMode, setMemberSortMode] = useState<string | null>(null);
  const [savingSort, setSavingSort] = useState(false);
  const [requestingReview, setRequestingReview] = useState(false);

  useEffect(() => {
    if (user) loadData();
  }, [user]);

  const loadData = async () => {
    setLoading(true);

    const { data: member } = await supabase
      .from('affiliate_members')
      .select('id, affiliate_id, linktree_slug, linktree_sort_mode')
      .eq('user_id', user!.id)
      .eq('is_active', true)
      .maybeSingle();

    if (!member) { setLoading(false); return; }

    setMemberId(member.id);
    setLinktreeSlug((member as any).linktree_slug ?? null);
    setMemberSortMode((member as any).linktree_sort_mode ?? null);

    const { data: aff } = await supabase
      .from('affiliates')
      .select('allow_promoter_sort, linktree_sort_mode')
      .eq('id', (member as any).affiliate_id)
      .maybeSingle();
    if (aff) {
      setAllowPromoterSort((aff as any).allow_promoter_sort ?? false);
      setAdminSortMode((aff as any).linktree_sort_mode ?? 'by_day');
    }

    const { data: existingEntries } = await supabase
      .from('promoter_linktree_events')
      .select('id, affiliate_event_id, promo_link, sort_order, affiliate_events(id, name, slug, event_date, start_time, flyer_url, affiliate_venues(name))')
      .eq('member_id', member.id)
      .order('sort_order', { ascending: true });

    const mapped: LinktreeEntry[] = (existingEntries ?? []).map((row: any) => ({
      id: row.id,
      affiliate_event_id: row.affiliate_event_id,
      promo_link: row.promo_link,
      sort_order: row.sort_order,
      event: row.affiliate_events
        ? {
            ...row.affiliate_events,
            affiliate_venues: Array.isArray(row.affiliate_events.affiliate_venues)
              ? row.affiliate_events.affiliate_venues[0] ?? null
              : row.affiliate_events.affiliate_venues,
          }
        : null,
    }));
    setEntries(mapped);

    const today = new Date().toISOString().split('T')[0];
    const in7days = addDays(new Date(), 7).toISOString().split('T')[0];

    const { data: upcoming } = await supabase
      .from('affiliate_events')
      .select('id, name, slug, event_date, start_time, flyer_url, affiliate_venues(name)')
      .eq('affiliate_id', (member as any).affiliate_id)
      .in('status', ['published', 'featured'])
      .gte('event_date', today)
      .lte('event_date', in7days)
      .order('event_date', { ascending: true });

    const normalised: AffiliateEvent[] = (upcoming ?? []).map((e: any) => ({
      ...e,
      affiliate_venues: Array.isArray(e.affiliate_venues) ? e.affiliate_venues[0] ?? null : e.affiliate_venues,
    }));
    setAvailableEvents(normalised);
    setLoading(false);
  };

  const selectedIds = new Set(entries.map(e => e.affiliate_event_id));

  const filteredAvailable = availableEvents.filter(ev => {
    if (selectedIds.has(ev.id)) return false;
    if (!search) return true;
    const q = search.toLowerCase();
    return ev.name.toLowerCase().includes(q) || (ev.affiliate_venues?.name ?? '').toLowerCase().includes(q);
  });

  const getEvent = useCallback((eventId: string) => availableEvents.find(e => e.id === eventId), [availableEvents]);

  async function addEvent(event: AffiliateEvent) {
    if (!memberId) return;
    if (entries.length >= MAX_EVENTS) {
      toast({ title: t('aff.plink.maxReached').replace('{max}', String(MAX_EVENTS)), variant: 'destructive' });
      return;
    }
    setSaving(event.id);
    const nextOrder = entries.length;
    const { data, error } = await supabase
      .from('promoter_linktree_events')
      .insert({ member_id: memberId, affiliate_event_id: event.id, sort_order: nextOrder })
      .select('id, affiliate_event_id, promo_link, sort_order')
      .single();

    if (error || !data) {
      toast({ title: t('aff.plink.errorTitle'), description: error?.message, variant: 'destructive' });
    } else {
      setEntries(prev => [...prev, { ...data, event }]);
    }
    setSaving(null);
  }

  async function removeEntry(entryId: string) {
    setSaving(entryId);
    const { error } = await supabase.from('promoter_linktree_events').delete().eq('id', entryId);
    if (error) {
      toast({ title: t('aff.plink.errorTitle'), description: error.message, variant: 'destructive' });
    } else {
      setEntries(prev => prev.filter(e => e.id !== entryId));
    }
    setSaving(null);
  }

  async function savePromoLink(entryId: string, link: string) {
    setSaving(entryId);
    const { error } = await supabase.from('promoter_linktree_events').update({ promo_link: link.trim() || null }).eq('id', entryId);
    if (error) {
      toast({ title: t('aff.plink.errorTitle'), description: error.message, variant: 'destructive' });
    } else {
      setEntries(prev => prev.map(e => e.id === entryId ? { ...e, promo_link: link.trim() || null } : e));
      toast({ title: t('aff.plink.linkSaved') });
    }
    setSaving(null);
  }

  function updatePromoLinkLocal(entryId: string, link: string) {
    setEntries(prev => prev.map(e => e.id === entryId ? { ...e, promo_link: link } : e));
  }

  async function saveSortMode(mode: string) {
    if (!memberId) return;
    setSavingSort(true);
    const { error } = await supabase.from('affiliate_members').update({ linktree_sort_mode: mode }).eq('id', memberId);
    if (error) {
      toast({ title: t('aff.plink.errorTitle'), description: error.message, variant: 'destructive' });
    } else {
      setMemberSortMode(mode);
      toast({ title: t('aff.plink.sortUpdated') });
    }
    setSavingSort(false);
  }

  async function requestReview() {
    if (!memberId) return;
    setRequestingReview(true);
    const { error } = await supabase.from('affiliate_members').update({ linktree_status: 'pending_review' }).eq('id', memberId);
    if (error) {
      toast({ title: t('aff.plink.errorTitle'), description: error.message, variant: 'destructive' });
    } else {
      toast({ title: t('aff.plink.reviewSentTitle'), description: t('aff.plink.reviewSentDesc') });
    }
    setRequestingReview(false);
  }

  if (loading) return <AffSpinner />;

  const linktreeUrl = linktreeSlug ? `${window.location.origin}/promo/${linktreeSlug}` : null;

  const flyerFallback = (
    <div className="w-10 h-10 rounded-lg flex-none flex items-center justify-center" style={{ background: 'rgba(232,25,44,0.1)', border: '1px solid rgba(232,25,44,0.18)' }}>
      <CalendarDays className="h-4 w-4" style={{ color: RED }} />
    </div>
  );

  return (
    <AffPage maxWidth={760}>
      <motion.div initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }}>
        <AffHeading
          title={t('aff.plink.title')}
          subtitle={t('aff.plink.subtitle').replace('{max}', String(MAX_EVENTS))}
          right={linktreeUrl ? <AffLinkButton href={linktreeUrl} external variant="secondary" size="sm"><ExternalLink className="h-3.5 w-3.5" /> {t('aff.plink.viewMyPage')}</AffLinkButton> : undefined}
        />
      </motion.div>

      {!linktreeSlug && (
        <div className="rounded-2xl p-4 flex items-center gap-3" style={{ background: 'rgba(232,25,44,0.08)', border: '1px solid rgba(232,25,44,0.25)' }}>
          <Link2 className="h-4 w-4 flex-none" style={{ color: RED }} />
          <p style={{ color: T2, fontSize: 13 }}>
            {t('aff.plink.configureSlugPrefix')} <a href="/affiliate/promoteur/settings" className="underline" style={{ color: RED }}>{t('aff.plink.settingsLink')}</a> {t('aff.plink.configureSlugSuffix')}
          </p>
        </div>
      )}

      {/* Sort mode + review request */}
      <div className="flex flex-col sm:flex-row gap-3">
        {allowPromoterSort ? (
          <AffCard padding={16} className="flex-1">
            <div className="flex items-center gap-2 mb-2">
              <ArrowUpDown className="h-3.5 w-3.5" style={{ color: T3 }} />
              <SectionLabel>{t('aff.plink.sortLabel')}</SectionLabel>
            </div>
            <div className="flex gap-2 flex-wrap">
              {(['by_day', 'by_genre', 'by_price', 'custom'] as const).map(mode => {
                const active = (memberSortMode ?? adminSortMode) === mode;
                return (
                  <button key={mode} onClick={() => saveSortMode(mode)} disabled={savingSort}
                    className="px-3 py-1.5 rounded-lg text-xs font-semibold transition-colors disabled:opacity-50"
                    style={active
                      ? { background: 'rgba(232,25,44,0.12)', border: '1px solid rgba(232,25,44,0.35)', color: RED }
                      : { background: 'rgba(255,255,255,0.04)', border: `1px solid ${BORDER}`, color: T2 }}>
                    {t(SORT_LABEL_KEYS[mode])}
                  </button>
                );
              })}
            </div>
          </AffCard>
        ) : (
          <AffCard padding={16} className="flex items-center gap-2 flex-1">
            <ArrowUpDown className="h-3.5 w-3.5 flex-none" style={{ color: T3 }} />
            <span style={{ color: T3, fontSize: 12 }}>{t('aff.plink.sortImposed')}&nbsp;
              <span style={{ color: T2, fontWeight: 600 }}>{t(SORT_LABEL_KEYS[adminSortMode] ?? 'aff.plink.sortCustom')}</span>
            </span>
          </AffCard>
        )}

        <AffButton variant="secondary" onClick={requestReview} disabled={requestingReview}>
          <Send className="h-3.5 w-3.5" /> {t('aff.plink.requestReview')}
        </AffButton>
      </div>

      {/* Selected events */}
      <div>
        <div className="mb-3">
          <SectionLabel>{t('aff.plink.onMyLinktree')} · {entries.length}/{MAX_EVENTS}</SectionLabel>
        </div>

        {entries.length === 0 ? (
          <div className="rounded-2xl p-8 text-center" style={{ border: '1px dashed rgba(255,255,255,0.12)', background: 'rgba(255,255,255,0.015)' }}>
            <CalendarDays className="h-8 w-8 mx-auto mb-3" style={{ color: 'rgba(255,255,255,0.14)' }} />
            <p style={{ color: T2, fontSize: 13 }}>{t('aff.plink.noneSelected')}</p>
            <p style={{ color: T3, fontSize: 11.5, marginTop: 2 }}>{t('aff.plink.addFromBelow')}</p>
          </div>
        ) : (
          <div className="space-y-2">
            {entries.map((entry, idx) => {
              const ev = entry.event ?? getEvent(entry.affiliate_event_id);
              if (!ev) return null;
              const dateStr = format(new Date(`${ev.event_date}T12:00:00`), 'EEE d MMM', { locale: dateLocale });

              return (
                <AffCard key={entry.id} padding={12}>
                  <div className="flex items-center gap-3">
                    <span className="flex-none text-center tabular-nums" style={{ color: T3, fontSize: 10.5, width: 16 }}>#{idx + 1}</span>
                    {ev.flyer_url
                      ? <img src={ev.flyer_url} alt={ev.name} className="w-10 h-10 rounded-lg object-cover flex-none" style={{ border: `1px solid ${BORDER}` }} />
                      : flyerFallback}
                    <div className="flex-1 min-w-0">
                      <p className="truncate" style={{ color: T1, fontSize: 13.5, fontWeight: 600 }}>{ev.name}</p>
                      <p style={{ color: T3, fontSize: 11.5, marginTop: 1 }}>{dateStr}{ev.affiliate_venues ? ` · ${ev.affiliate_venues.name}` : ''}</p>
                    </div>
                    {linktreeSlug && (
                      <button
                        onClick={() => {
                          // Lien tracé du promoteur vers la page publique de la
                          // soirée : les vues ET les clics lui sont crédités.
                          navigator.clipboard.writeText(`${window.location.origin}/affiliate-event/${ev.slug}?via=${linktreeSlug}`);
                          toast({ title: t('aff.plink.trackedCopied'), description: t('aff.plink.trackedCopiedDesc') });
                        }}
                        title={t('aff.plink.copyTracked')}
                        className="p-1.5 transition-colors flex-none" style={{ color: T3 }}
                        onMouseEnter={(e) => (e.currentTarget.style.color = T1)} onMouseLeave={(e) => (e.currentTarget.style.color = T3)}>
                        <Copy className="h-4 w-4" />
                      </button>
                    )}
                    <button onClick={() => removeEntry(entry.id)} disabled={saving === entry.id} title={t('aff.plink.remove')}
                      className="p-1.5 transition-colors flex-none disabled:opacity-30" style={{ color: T3 }}
                      onMouseEnter={(e) => (e.currentTarget.style.color = RED)} onMouseLeave={(e) => (e.currentTarget.style.color = T3)}>
                      <Trash2 className="h-4 w-4" />
                    </button>
                  </div>

                  {/* Promo link row */}
                  <div className="flex items-center gap-2 pl-7 mt-2.5">
                    <div className="flex items-center px-2 flex-none" style={{ height: 32, borderRadius: '8px 0 0 8px', background: 'rgba(255,255,255,0.02)', border: `1px solid ${BORDER}`, borderRight: 'none', color: T3, fontSize: 11.5 }}>
                      {t('aff.plink.linkAdorn')}
                    </div>
                    <input type="url" value={entry.promo_link ?? ''}
                      onChange={e => updatePromoLinkLocal(entry.id, e.target.value)}
                      onBlur={e => savePromoLink(entry.id, e.target.value)}
                      placeholder="https://tickets.example.com/ref=margot"
                      className="flex-1 outline-none"
                      style={{ height: 32, background: INNER_BG, border: `1px solid ${BORDER}`, borderRadius: '0 8px 8px 0', padding: '0 12px', color: T1, fontSize: 12 }}
                      onFocus={(e) => (e.target.style.borderColor = 'rgba(232,25,44,0.55)')} onBlurCapture={(e) => (e.currentTarget.style.borderColor = BORDER)} />
                    <button onClick={() => savePromoLink(entry.id, entry.promo_link ?? '')} disabled={saving === entry.id} title={t('aff.plink.saveLink')}
                      className="p-1.5 transition-colors disabled:opacity-30" style={{ color: T3 }}
                      onMouseEnter={(e) => (e.currentTarget.style.color = T1)} onMouseLeave={(e) => (e.currentTarget.style.color = T3)}>
                      <Save className="h-3.5 w-3.5" />
                    </button>
                  </div>
                </AffCard>
              );
            })}
          </div>
        )}
      </div>

      {/* Add events */}
      <div>
        <div className="mb-3">
          <SectionLabel>{t('aff.plink.addEventSection')}</SectionLabel>
        </div>

        <input type="text" value={search} onChange={e => setSearch(e.target.value)} placeholder={t('aff.plink.searchPlaceholder')}
          className="w-full mb-3 outline-none"
          style={{ height: 38, background: INNER_BG, border: `1px solid ${BORDER}`, borderRadius: 10, padding: '0 12px', color: T1, fontSize: 13.5 }}
          onFocus={(e) => (e.target.style.borderColor = 'rgba(232,25,44,0.55)')} onBlur={(e) => (e.target.style.borderColor = BORDER)} />

        <div className="space-y-2 max-h-96 overflow-y-auto pr-1">
          {filteredAvailable.length === 0 ? (
            <p className="text-center py-8" style={{ color: T3, fontSize: 13 }}>
              {search ? t('aff.plink.noSearchResults')
                : availableEvents.length === 0 ? t('aff.plink.noUpcoming')
                : t('aff.plink.allAdded')}
            </p>
          ) : (
            filteredAvailable.map(ev => {
              const dateStr = format(new Date(`${ev.event_date}T12:00:00`), 'EEE d MMM', { locale: dateLocale });
              return (
                <div key={ev.id} className="flex items-center gap-3 rounded-xl p-3" style={{ background: TILE_BG, border: `1px solid ${F_BORDER}` }}>
                  {ev.flyer_url
                    ? <img src={ev.flyer_url} alt={ev.name} className="w-10 h-10 rounded-lg object-cover flex-none" style={{ border: `1px solid ${BORDER}` }} />
                    : flyerFallback}
                  <div className="flex-1 min-w-0">
                    <p className="truncate" style={{ color: T1, fontSize: 13.5, fontWeight: 600 }}>{ev.name}</p>
                    <p style={{ color: T3, fontSize: 11.5, marginTop: 1 }}>{dateStr}{ev.affiliate_venues ? ` · ${ev.affiliate_venues.name}` : ''}</p>
                  </div>
                  <button onClick={() => addEvent(ev)} disabled={saving === ev.id || entries.length >= MAX_EVENTS}
                    className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-semibold transition-colors disabled:opacity-30 disabled:cursor-not-allowed flex-none"
                    style={{ background: 'rgba(232,25,44,0.1)', border: '1px solid rgba(232,25,44,0.3)', color: RED }}>
                    <Plus className="h-3 w-3" /> {t('aff.plink.add')}
                  </button>
                </div>
              );
            })
          )}
        </div>
      </div>
    </AffPage>
  );
}
