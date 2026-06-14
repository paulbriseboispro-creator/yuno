import { useEffect, useState } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { useAuth } from '@/hooks/useAuth';
import { useToast } from '@/hooks/use-toast';
import { Link } from 'react-router-dom';
import { motion } from 'framer-motion';
import { ExternalLink, Users, BarChart2, Link2, Eye, MousePointerClick, FileText, Send } from 'lucide-react';
import { format, parseISO, startOfWeek, endOfWeek } from 'date-fns';
import { fr } from 'date-fns/locale';
import {
  AffPage, AffHeading, AffCard, AffCardHeader, StatTile, SectionLabel, DarkInput,
  AffButton, AffSpinner, RED, T1, T2, T3, BORDER, C_FAINT,
} from '@/components/affiliate/affiliate-ui';

type MemberProfile = {
  id: string;
  first_name: string | null;
  last_name: string | null;
  linktree_slug: string | null;
  role: string;
  affiliate_id: string;
  affiliate: { name: string; city: string | null } | null;
};

type Assignment = {
  id: string;
  affiliate_event_id: string;
  event_name: string;
  event_date: string;
  flyer_url: string | null;
  submitted_url: string;
  has_brief: boolean;
};

type WeekStats = { views: number; clicks: number };

type BriefEvent = {
  id: string;
  name: string;
  event_date: string;
  flyer_url: string | null;
};

export default function AffiliatePromoterDashboard() {
  const { user } = useAuth();
  const { toast } = useToast();
  const [profile, setProfile] = useState<MemberProfile | null>(null);
  const [loading, setLoading] = useState(true);

  const [assignments, setAssignments] = useState<Assignment[]>([]);
  const [weekStats, setWeekStats] = useState<WeekStats>({ views: 0, clicks: 0 });
  const [briefEvents, setBriefEvents] = useState<BriefEvent[]>([]);
  const [submitting, setSubmitting] = useState<string | null>(null);
  const [urlInputs, setUrlInputs] = useState<Record<string, string>>({});

  useEffect(() => {
    if (!user) return;
    init();
  }, [user]);

  const init = async () => {
    const { data } = await supabase
      .from('affiliate_members')
      .select('id, first_name, last_name, linktree_slug, role, affiliate_id, affiliates(name, city)')
      .eq('user_id', user!.id)
      .eq('is_active', true)
      .maybeSingle();

    if (data) {
      const p: MemberProfile = {
        ...data,
        affiliate: Array.isArray(data.affiliates) ? data.affiliates[0] ?? null : (data.affiliates as any),
      };
      setProfile(p);
      await Promise.all([
        fetchAssignments(p.id),
        fetchWeekStats(p.id),
        fetchBriefEvents(p.affiliate_id),
      ]);
    }
    setLoading(false);
  };

  const fetchAssignments = async (memberId: string) => {
    const { data } = await supabase
      .from('affiliate_event_assignments')
      .select(`
        id, affiliate_event_id, submitted_url,
        affiliate_events(name, event_date, flyer_url)
      `)
      .or(`member_id.eq.${memberId},member_id.is.null`)
      .eq('status', 'pending_url')
      .order('assigned_at', { ascending: false });

    if (!data) return;

    // check which events have briefs
    const eventIds = (data as any[]).map((r: any) => r.affiliate_event_id).filter(Boolean);
    const { data: briefs } = eventIds.length
      ? await supabase.from('affiliate_event_briefs').select('affiliate_event_id').in('affiliate_event_id', eventIds)
      : { data: [] };
    const briefSet = new Set((briefs ?? []).map((b: any) => b.affiliate_event_id));

    setAssignments((data as any[]).map((r: any) => ({
      id: r.id,
      affiliate_event_id: r.affiliate_event_id,
      event_name: r.affiliate_events?.name ?? '—',
      event_date: r.affiliate_events?.event_date ?? '',
      flyer_url: r.affiliate_events?.flyer_url ?? null,
      submitted_url: r.submitted_url ?? '',
      has_brief: briefSet.has(r.affiliate_event_id),
    })));
  };

  const fetchWeekStats = async (memberId: string) => {
    const weekStart = startOfWeek(new Date(), { weekStartsOn: 1 }).toISOString();
    const weekEnd = endOfWeek(new Date(), { weekStartsOn: 1 }).toISOString();

    const [r1, r2] = await Promise.all([
      (supabase.from('affiliate_visitor_sessions') as any)
        .select('id', { count: 'exact', head: true })
        .eq('member_id', memberId)
        .gte('created_at', weekStart)
        .lte('created_at', weekEnd),
      (supabase.from('affiliate_clicks') as any)
        .select('id', { count: 'exact', head: true })
        .eq('member_id', memberId)
        .gte('clicked_at', weekStart)
        .lte('clicked_at', weekEnd),
    ]) as [{ count: number | null }, { count: number | null }];
    const views = r1.count;
    const clicks = r2.count;

    setWeekStats({ views: views ?? 0, clicks: clicks ?? 0 });
  };

  const fetchBriefEvents = async (affiliateId: string) => {
    const today = new Date().toISOString().split('T')[0];
    const { data: evs } = await supabase
      .from('affiliate_events')
      .select('id, name, event_date, flyer_url')
      .eq('affiliate_id', affiliateId)
      .in('status', ['published', 'featured'])
      .gte('event_date', today)
      .order('event_date')
      .limit(5);

    if (!evs || evs.length === 0) return;

    const evIds = evs.map((e: any) => e.id);
    const { data: briefs } = await supabase
      .from('affiliate_event_briefs')
      .select('affiliate_event_id')
      .in('affiliate_event_id', evIds);
    const briefSet = new Set((briefs ?? []).map((b: any) => b.affiliate_event_id));

    setBriefEvents(
      evs
        .filter((e: any) => briefSet.has(e.id))
        .map((e: any) => ({ id: e.id, name: e.name, event_date: e.event_date, flyer_url: e.flyer_url }))
    );
  };

  const submitUrl = async (assignmentId: string, eventId: string) => {
    const url = urlInputs[assignmentId]?.trim();
    if (!url) { toast({ title: 'Saisis l\'URL promotionnelle', variant: 'destructive' }); return; }
    setSubmitting(assignmentId);

    const { error: assignErr } = await supabase
      .from('affiliate_event_assignments')
      .update({ status: 'url_submitted', submitted_url: url, submitted_at: new Date().toISOString() })
      .eq('id', assignmentId);

    if (!assignErr && profile) {
      // auto-add to promoter linktree if not already present
      await supabase.from('promoter_linktree_events').upsert({
        member_id: profile.id,
        affiliate_event_id: eventId,
        promo_link: url,
        sort_order: 999,
      }, { onConflict: 'member_id,affiliate_event_id', ignoreDuplicates: true });
    }

    setSubmitting(null);
    if (assignErr) {
      toast({ title: 'Erreur', description: assignErr.message, variant: 'destructive' });
    } else {
      toast({ title: 'URL soumise et ajoutée à ton linktree' });
      setAssignments(prev => prev.filter(a => a.id !== assignmentId));
    }
  };

  if (loading) return <AffSpinner />;

  const displayName = profile?.first_name && profile?.last_name
    ? `${profile.first_name} ${profile.last_name}`
    : 'Promoteur';

  const linktreeUrl = profile?.linktree_slug
    ? `${window.location.origin}/promo/${profile.linktree_slug}`
    : null;

  const ctr = weekStats.views > 0 ? ((weekStats.clicks / weekStats.views) * 100).toFixed(1) : '0';

  const subtitle = profile?.affiliate
    ? `Équipe ${profile.affiliate.name}${profile.affiliate.city ? ` · ${profile.affiliate.city}` : ''}`
    : undefined;

  const QUICK_LINKS = [
    { to: '/affiliate/promoteur/linktree', icon: Link2, title: 'Mon Linktree', desc: 'Gérer mes soirées', accent: true },
    { to: '/affiliate/analytics', icon: BarChart2, title: 'Analytics', desc: 'Clics & vues' },
    { to: '/affiliate/promoteur/settings', icon: Users, title: 'Mon profil', desc: 'Avatar, réseaux & lien public' },
  ];

  return (
    <AffPage maxWidth={760}>
      <motion.div initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }}>
        <AffHeading title={`Bonjour, ${displayName}`} subtitle={subtitle} />
      </motion.div>

      {/* Week stats */}
      <div className="grid grid-cols-3 gap-3">
        {[
          { label: 'Vues cette semaine', value: weekStats.views, icon: Eye },
          { label: 'Clics cette semaine', value: weekStats.clicks, icon: MousePointerClick, tone: 'pos' as const },
          { label: 'Taux de clic', value: `${ctr}%`, icon: BarChart2, tone: 'warn' as const },
        ].map((s, i) => (
          <motion.div key={s.label}
            initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.05 + i * 0.04 }}>
            <StatTile {...s} />
          </motion.div>
        ))}
      </div>

      {/* Pending assignments */}
      {assignments.length > 0 && (
        <motion.div initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.18 }} className="space-y-3">
          <SectionLabel>Soirées en attente d'URL ({assignments.length})</SectionLabel>
          <div className="space-y-3">
            {assignments.map(a => (
              <AffCard key={a.id} padding={16}
                style={{ border: '1px solid rgba(232,25,44,0.22)', background: 'linear-gradient(135deg,rgba(232,25,44,0.06),rgba(232,25,44,0.01)),#0a0a0c' }}>
                <div className="flex items-center gap-3 mb-3">
                  {a.flyer_url
                    ? <img src={a.flyer_url} alt={a.event_name} className="w-11 h-11 rounded-lg object-cover flex-none" style={{ border: `1px solid ${BORDER}` }} />
                    : <div className="w-11 h-11 rounded-lg flex-none" style={{ background: C_FAINT, border: `1px solid ${BORDER}` }} />}
                  <div className="flex-1 min-w-0">
                    <p className="truncate" style={{ color: T1, fontSize: 13.5, fontWeight: 600 }}>{a.event_name}</p>
                    <p style={{ color: T3, fontSize: 11.5, marginTop: 1 }}>
                      {a.event_date ? format(parseISO(a.event_date), 'd MMM yyyy', { locale: fr }) : '—'}
                      {a.has_brief && <span style={{ color: RED, marginLeft: 8 }}>· Brief disponible</span>}
                    </p>
                  </div>
                  {a.has_brief && (
                    <Link to={`/affiliate/events/${a.affiliate_event_id}/brief`}
                      className="p-1.5 transition-colors flex-none" title="Voir le brief"
                      style={{ color: T3 }}
                      onMouseEnter={(e) => (e.currentTarget.style.color = RED)}
                      onMouseLeave={(e) => (e.currentTarget.style.color = T3)}
                    >
                      <FileText className="h-4 w-4" />
                    </Link>
                  )}
                </div>
                <div className="flex gap-2">
                  <DarkInput
                    type="url"
                    placeholder="https://billetreduc.com/ton-lien-promo…"
                    value={urlInputs[a.id] ?? ''}
                    onChange={(v) => setUrlInputs(prev => ({ ...prev, [a.id]: v }))}
                  />
                  <AffButton
                    size="sm"
                    onClick={() => submitUrl(a.id, a.affiliate_event_id)}
                    disabled={submitting === a.id}
                  >
                    <Send className="h-3.5 w-3.5" />
                    {submitting === a.id ? '…' : 'Soumettre'}
                  </AffButton>
                </div>
              </AffCard>
            ))}
          </div>
        </motion.div>
      )}

      {/* Linktree card */}
      {linktreeUrl && (
        <motion.div initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.22 }}>
          <AffCard padding={18}>
            <div className="flex items-center justify-between gap-3">
              <div className="min-w-0">
                <p style={{ color: T1, fontSize: 13.5, fontWeight: 600 }}>Ta page promoteur</p>
                <p className="truncate" style={{ color: T3, fontSize: 11.5, marginTop: 2 }}>{linktreeUrl}</p>
              </div>
              <a href={linktreeUrl} target="_blank" rel="noopener noreferrer"
                className="inline-flex items-center gap-1.5 flex-none transition-colors"
                style={{ color: RED, fontSize: 12.5, fontWeight: 600 }}
                onMouseEnter={(e) => (e.currentTarget.style.opacity = '0.8')}
                onMouseLeave={(e) => (e.currentTarget.style.opacity = '1')}
              >
                Voir ma page
                <ExternalLink className="h-3.5 w-3.5" />
              </a>
            </div>
          </AffCard>
        </motion.div>
      )}

      {/* Briefs disponibles */}
      {briefEvents.length > 0 && (
        <motion.div initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.26 }}>
          <AffCard padding={18}>
            <AffCardHeader icon={FileText} title="Briefs disponibles" subtitle="Consignes de promo par soirée" accent />
            <div className="divide-y" style={{ borderColor: BORDER }}>
              {briefEvents.map(ev => (
                <Link key={ev.id} to={`/affiliate/events/${ev.id}/brief`}
                  className="flex items-center gap-3 py-3 transition-colors group"
                >
                  {ev.flyer_url
                    ? <img src={ev.flyer_url} alt={ev.name} className="w-9 h-9 rounded-lg object-cover flex-none" style={{ border: `1px solid ${BORDER}` }} />
                    : <div className="w-9 h-9 rounded-lg flex-none" style={{ background: C_FAINT, border: `1px solid ${BORDER}` }} />}
                  <div className="flex-1 min-w-0">
                    <p className="truncate" style={{ color: T1, fontSize: 13, fontWeight: 500 }}>{ev.name}</p>
                    <p style={{ color: T3, fontSize: 11.5 }}>{format(parseISO(ev.event_date), 'd MMM', { locale: fr })}</p>
                  </div>
                  <FileText className="h-4 w-4 flex-none" style={{ color: RED }} />
                </Link>
              ))}
            </div>
          </AffCard>
        </motion.div>
      )}

      {/* Quick links */}
      <motion.div initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.3 }}
        className="grid grid-cols-2 gap-3">
        {QUICK_LINKS.map((q, i) => (
          <Link key={q.to} to={q.to} className={i === QUICK_LINKS.length - 1 && QUICK_LINKS.length % 2 === 1 ? 'col-span-2' : ''}>
            <AffCard interactive padding={16}>
              <div className="flex items-center gap-3">
                <div className="w-9 h-9 rounded-xl flex items-center justify-center flex-none"
                  style={q.accent
                    ? { background: 'rgba(232,25,44,0.12)', border: '1px solid rgba(232,25,44,0.22)' }
                    : { background: C_FAINT, border: `1px solid ${BORDER}` }}>
                  <q.icon className="h-4 w-4" style={{ color: q.accent ? RED : T2 }} />
                </div>
                <div className="min-w-0">
                  <p style={{ color: T1, fontSize: 13, fontWeight: 600 }}>{q.title}</p>
                  <p className="truncate" style={{ color: T3, fontSize: 11.5 }}>{q.desc}</p>
                </div>
              </div>
            </AffCard>
          </Link>
        ))}
      </motion.div>
    </AffPage>
  );
}
