import { useEffect, useState } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { useAuth } from '@/hooks/useAuth';
import { useToast } from '@/hooks/use-toast';
import { CheckCircle, XCircle, Users, FileText } from 'lucide-react';
import { Link } from 'react-router-dom';
import { motion } from 'framer-motion';
import {
  AffPage, AffHeading, AffCard, AffCardHeader, AffButton, Pill, AffSpinner, SectionLabel, AffAvatar,
  RED, POS, WARN, T1, T3, BORDER,
} from '@/components/affiliate/affiliate-ui';

type TeamMember = {
  id: string;
  first_name: string | null;
  last_name: string | null;
  linktree_slug: string | null;
  linktree_status: string;
  is_active: boolean;
};

type BriefEvent = {
  id: string;
  name: string;
  event_date: string;
};

const STATUS_TONE: Record<string, 'muted' | 'warn' | 'success'> = {
  draft: 'muted', pending_review: 'warn', approved: 'success',
};
const STATUS_LABEL: Record<string, string> = {
  draft: 'Brouillon', pending_review: 'En révision', approved: 'Approuvé',
};

export default function ManagerDashboard() {
  const { user } = useAuth();
  const { toast } = useToast();
  const [members, setMembers] = useState<TeamMember[]>([]);
  const [briefEvents, setBriefEvents] = useState<BriefEvent[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (user) init();
  }, [user]);

  const init = async () => {
    const { data: mem } = await supabase
      .from('affiliate_members')
      .select('id, affiliate_id')
      .eq('user_id', user!.id)
      .eq('role', 'manager')
      .eq('is_active', true)
      .maybeSingle();
    if (!mem) { setLoading(false); return; }
    await Promise.all([
      fetchTeam((mem as any).affiliate_id),
      fetchBriefs((mem as any).affiliate_id),
    ]);
    setLoading(false);
  };

  const fetchTeam = async (affId: string) => {
    const { data } = await supabase
      .from('affiliate_members')
      .select('id, first_name, last_name, linktree_slug, linktree_status, is_active')
      .eq('affiliate_id', affId)
      .eq('role', 'promoter')
      .order('first_name');
    setMembers((data ?? []) as TeamMember[]);
  };

  const fetchBriefs = async (affId: string) => {
    const today = new Date().toISOString().split('T')[0];
    const { data: evs } = await supabase
      .from('affiliate_events')
      .select('id, name, event_date')
      .eq('affiliate_id', affId)
      .in('status', ['published', 'featured'])
      .gte('event_date', today)
      .order('event_date')
      .limit(10);
    if (!evs || evs.length === 0) return;
    const { data: briefs } = await supabase
      .from('affiliate_event_briefs')
      .select('affiliate_event_id')
      .in('affiliate_event_id', evs.map((e: any) => e.id));
    const briefSet = new Set((briefs ?? []).map((b: any) => b.affiliate_event_id));
    setBriefEvents(evs.filter((e: any) => briefSet.has(e.id)) as BriefEvent[]);
  };

  const setLinktreeStatus = async (memberId: string, status: string) => {
    const { error } = await supabase
      .from('affiliate_members')
      .update({ linktree_status: status })
      .eq('id', memberId);
    if (error) { toast({ title: 'Erreur', description: error.message, variant: 'destructive' }); return; }
    setMembers(prev => prev.map(m => m.id === memberId ? { ...m, linktree_status: status } : m));
    toast({ title: status === 'approved' ? 'Linktree approuvé' : 'Modification demandée' });
  };

  if (loading) return <AffSpinner />;

  const pending = members.filter(m => m.linktree_status === 'pending_review');
  const displayName = (m: TeamMember) =>
    [m.first_name, m.last_name].filter(Boolean).join(' ') || m.id.slice(0, 8);

  return (
    <AffPage maxWidth={760}>
      <motion.div initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }}>
        <AffHeading
          title="Dashboard Manager"
          subtitle={`${members.length} promoteur${members.length !== 1 ? 's' : ''} dans l'équipe`}
        />
      </motion.div>

      {/* Pending reviews */}
      {pending.length > 0 && (
        <motion.div initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.05 }} className="space-y-2">
          <SectionLabel>
            <span className="inline-flex items-center gap-2" style={{ color: WARN }}>
              <span className="w-2 h-2 rounded-full animate-pulse" style={{ background: WARN }} />
              Linktrees en attente de validation ({pending.length})
            </span>
          </SectionLabel>
          <AffCard padding={0} style={{ border: '1px solid rgba(251,191,36,0.22)' }}>
            <div className="divide-y" style={{ borderColor: BORDER }}>
              {pending.map(m => (
                <div key={m.id} className="flex items-center gap-3 px-4 py-3">
                  <AffAvatar fallback={(m.first_name ?? '?').slice(0, 1)} size={34} />
                  <div className="flex-1 min-w-0">
                    <p style={{ color: T1, fontSize: 13.5, fontWeight: 600 }}>{displayName(m)}</p>
                    {m.linktree_slug && (
                      <a href={`/promo/${m.linktree_slug}`} target="_blank" rel="noopener noreferrer"
                        className="transition-colors" style={{ fontSize: 11.5, color: T3 }}
                        onMouseEnter={(e) => (e.currentTarget.style.color = RED)} onMouseLeave={(e) => (e.currentTarget.style.color = T3)}>
                        /promo/{m.linktree_slug}
                      </a>
                    )}
                  </div>
                  <div className="flex items-center gap-2 flex-none">
                    <AffButton size="sm" variant="secondary" onClick={() => setLinktreeStatus(m.id, 'approved')}>
                      <CheckCircle className="h-3.5 w-3.5" style={{ color: POS }} /> Approuver
                    </AffButton>
                    <AffButton size="sm" variant="ghost" onClick={() => setLinktreeStatus(m.id, 'draft')}>
                      <XCircle className="h-3.5 w-3.5" /> Retour
                    </AffButton>
                  </div>
                </div>
              ))}
            </div>
          </AffCard>
        </motion.div>
      )}

      {/* All team members */}
      <motion.div initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.1 }}>
        <AffCard padding={18}>
          <AffCardHeader icon={Users} title="Équipe" subtitle={`${members.length} promoteur${members.length !== 1 ? 's' : ''}`} />
          {members.length === 0 ? (
            <div className="py-8 text-center" style={{ color: T3, fontSize: 13 }}>Aucun promoteur dans l'équipe</div>
          ) : (
            <div className="divide-y" style={{ borderColor: BORDER }}>
              {members.map(m => (
                <div key={m.id} className="flex items-center gap-3 py-3">
                  <AffAvatar fallback={(m.first_name ?? '?').slice(0, 1)} size={34} />
                  <div className="flex-1 min-w-0">
                    <p style={{ color: T1, fontSize: 13.5, fontWeight: 560 }}>{displayName(m)}</p>
                    {m.linktree_slug && (
                      <a href={`/promo/${m.linktree_slug}`} target="_blank" rel="noopener noreferrer"
                        className="transition-colors" style={{ fontSize: 11.5, color: T3 }}
                        onMouseEnter={(e) => (e.currentTarget.style.color = RED)} onMouseLeave={(e) => (e.currentTarget.style.color = T3)}>
                        /promo/{m.linktree_slug}
                      </a>
                    )}
                  </div>
                  <Pill tone={STATUS_TONE[m.linktree_status] ?? 'muted'}>
                    {STATUS_LABEL[m.linktree_status] ?? m.linktree_status}
                  </Pill>
                </div>
              ))}
            </div>
          )}
        </AffCard>
      </motion.div>

      {/* Briefs disponibles */}
      {briefEvents.length > 0 && (
        <motion.div initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.15 }}>
          <AffCard padding={18}>
            <AffCardHeader icon={FileText} title="Briefs à venir" subtitle="Consignes de promo publiées" accent />
            <div className="divide-y" style={{ borderColor: BORDER }}>
              {briefEvents.map(ev => (
                <Link key={ev.id} to={`/affiliate/events/${ev.id}/brief`} className="flex items-center gap-3 py-3">
                  <p className="flex-1 truncate" style={{ color: T1, fontSize: 13 }}>{ev.name}</p>
                  <FileText className="h-4 w-4 flex-none" style={{ color: RED }} />
                </Link>
              ))}
            </div>
          </AffCard>
        </motion.div>
      )}
    </AffPage>
  );
}
