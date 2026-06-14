import { useEffect, useState } from 'react';
import { motion } from 'framer-motion';
import { supabase } from '@/integrations/supabase/client';
import { useAuth } from '@/hooks/useAuth';
import { useToast } from '@/hooks/use-toast';
import { format, parseISO } from 'date-fns';
import { fr } from 'date-fns/locale';
import { UserPlus, ListChecks, ExternalLink } from 'lucide-react';
import {
  AffPage, AffHeading, AffCard, Pill, AffButton, AffSpinner, AffEmpty, TabBar,
  FieldLabel, DarkSelect, SegToggle,
  RED, POS, T1, T2, T3, BORDER, TILE_BG, F_BORDER,
} from '@/components/affiliate/affiliate-ui';

type EventOption = { id: string; name: string; event_date: string };
type MemberOption = { id: string; display_name: string };
type AssignmentRow = {
  id: string;
  event_name: string;
  event_date: string;
  member_name: string | null;
  status: string;
  submitted_url: string | null;
  assigned_at: string;
};

const STATUS_TONE: Record<string, 'warn' | 'success' | 'muted'> = {
  pending_url: 'warn', url_submitted: 'success', skipped: 'muted',
};
const STATUS_LABEL: Record<string, string> = {
  pending_url: "En attente d'URL", url_submitted: 'URL soumise', skipped: 'Ignoré',
};

type Tab = 'assign' | 'track';

export default function AffiliateAssignments() {
  const { user } = useAuth();
  const { toast } = useToast();
  const [affiliateId, setAffiliateId] = useState<string | null>(null);
  const [tab, setTab] = useState<Tab>('assign');

  const [events, setEvents] = useState<EventOption[]>([]);
  const [members, setMembers] = useState<MemberOption[]>([]);
  const [selectedEvent, setSelectedEvent] = useState('');
  const [targetAll, setTargetAll] = useState(true);
  const [selectedMembers, setSelectedMembers] = useState<Set<string>>(new Set());
  const [assigning, setAssigning] = useState(false);

  const [assignments, setAssignments] = useState<AssignmentRow[]>([]);
  const [filterEvent, setFilterEvent] = useState('');
  const [filterStatus, setFilterStatus] = useState('');
  const [loadingTrack, setLoadingTrack] = useState(false);

  useEffect(() => {
    if (user) init();
  }, [user]);

  const init = async () => {
    const { data: aff } = await supabase.from('affiliates').select('id').eq('user_id', user!.id).single();
    if (!aff) return;
    setAffiliateId(aff.id);

    const [{ data: evData }, { data: memData }] = await Promise.all([
      supabase.from('affiliate_events')
        .select('id, name, event_date')
        .eq('affiliate_id', aff.id)
        .in('status', ['published', 'featured'])
        .gte('event_date', new Date().toISOString().split('T')[0])
        .order('event_date'),
      supabase.from('affiliate_members')
        .select('id, first_name, last_name')
        .eq('affiliate_id', aff.id)
        .eq('is_active', true)
        .order('first_name'),
    ]);

    setEvents((evData ?? []) as EventOption[]);
    setMembers((memData ?? []).map((m: any) => ({
      id: m.id,
      display_name: [m.first_name, m.last_name].filter(Boolean).join(' ') || m.id.slice(0, 8),
    })));
  };

  const handleAssign = async () => {
    if (!selectedEvent) { toast({ title: 'Sélectionne une soirée', variant: 'destructive' }); return; }
    setAssigning(true);

    const targets = targetAll ? [null] : Array.from(selectedMembers);
    if (!targetAll && targets.length === 0) {
      toast({ title: 'Sélectionne au moins un promoteur', variant: 'destructive' });
      setAssigning(false);
      return;
    }

    const rows = targets.map(memberId => ({
      affiliate_event_id: selectedEvent,
      member_id: memberId,
      assigned_by: user!.id,
      status: 'pending_url',
    }));

    const { error } = await supabase.from('affiliate_event_assignments').upsert(rows, {
      onConflict: 'affiliate_event_id,member_id',
      ignoreDuplicates: false,
    });

    setAssigning(false);
    if (error) {
      toast({ title: 'Erreur', description: error.message, variant: 'destructive' });
    } else {
      toast({ title: `Assignment créé pour ${targetAll ? 'tous les promoteurs' : `${targets.length} promoteur(s)`}` });
      setSelectedEvent('');
      setSelectedMembers(new Set());
      setTargetAll(true);
    }
  };

  const loadAssignments = async () => {
    if (!affiliateId) return;
    setLoadingTrack(true);
    const { data } = await supabase
      .from('affiliate_event_assignments')
      .select(`
        id, status, submitted_url, assigned_at,
        affiliate_events!inner(name, event_date, affiliate_id),
        affiliate_members(first_name, last_name)
      `)
      .eq('affiliate_events.affiliate_id', affiliateId)
      .order('assigned_at', { ascending: false })
      .limit(100);

    const rows: AssignmentRow[] = (data ?? []).map((r: any) => ({
      id: r.id,
      event_name: r.affiliate_events?.name ?? '—',
      event_date: r.affiliate_events?.event_date ?? '',
      member_name: r.member_id === null
        ? 'Tous les promoteurs'
        : [r.affiliate_members?.first_name, r.affiliate_members?.last_name].filter(Boolean).join(' ') || '—',
      status: r.status,
      submitted_url: r.submitted_url,
      assigned_at: r.assigned_at,
    }));

    setAssignments(rows);
    setLoadingTrack(false);
  };

  useEffect(() => {
    if (tab === 'track' && affiliateId) loadAssignments();
  }, [tab, affiliateId]);

  const toggleMember = (id: string) => {
    setSelectedMembers(prev => {
      const next = new Set(prev);
      next.has(id) ? next.delete(id) : next.add(id);
      return next;
    });
  };

  const filteredAssignments = assignments.filter(a => {
    if (filterEvent && a.event_name !== filterEvent) return false;
    if (filterStatus && a.status !== filterStatus) return false;
    return true;
  });

  return (
    <AffPage>
      <motion.div initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }}>
        <AffHeading title="Assignments" subtitle="Assignez des soirées à vos promoteurs pour collecte d'URL promo" />
      </motion.div>

      <TabBar<Tab>
        active={tab} onChange={setTab}
        tabs={[{ id: 'assign', label: 'Assigner', icon: UserPlus }, { id: 'track', label: 'Suivi', icon: ListChecks }]}
      />

      {/* ── Assign tab ── */}
      {tab === 'assign' && (
        <AffCard padding={22} style={{ maxWidth: 540 }}>
          <div className="space-y-5">
            <div>
              <FieldLabel>Soirée</FieldLabel>
              <DarkSelect value={selectedEvent} onChange={setSelectedEvent}>
                <option value="">Sélectionner une soirée…</option>
                {events.map(ev => (
                  <option key={ev.id} value={ev.id}>
                    {ev.name} — {format(parseISO(ev.event_date), 'd MMM yyyy', { locale: fr })}
                  </option>
                ))}
              </DarkSelect>
            </div>

            <div>
              <FieldLabel>Cible</FieldLabel>
              <SegToggle<'all' | 'sel'>
                value={targetAll ? 'all' : 'sel'}
                onChange={(v) => setTargetAll(v === 'all')}
                options={[{ key: 'all', label: 'Tous les promoteurs' }, { key: 'sel', label: 'Sélection individuelle' }]}
              />
            </div>

            {!targetAll && (
              <div className="space-y-1.5 max-h-48 overflow-y-auto pr-1">
                {members.map(m => {
                  const checked = selectedMembers.has(m.id);
                  return (
                    <button key={m.id} onClick={() => toggleMember(m.id)}
                      className="flex items-center gap-3 w-full px-3 py-2 rounded-lg transition-colors text-left"
                      style={{ background: checked ? 'rgba(232,25,44,0.08)' : TILE_BG, border: `1px solid ${checked ? 'rgba(232,25,44,0.25)' : F_BORDER}` }}>
                      <span className="flex-none flex items-center justify-center rounded"
                        style={{ width: 16, height: 16, background: checked ? RED : 'transparent', border: `1px solid ${checked ? RED : BORDER}` }}>
                        {checked && <span style={{ color: '#fff', fontSize: 11, lineHeight: 1 }}>✓</span>}
                      </span>
                      <span style={{ color: checked ? T1 : T2, fontSize: 13 }}>{m.display_name}</span>
                    </button>
                  );
                })}
                {members.length === 0 && <p style={{ color: T3, fontSize: 11.5, fontStyle: 'italic' }}>Aucun promoteur actif</p>}
              </div>
            )}

            <AffButton onClick={handleAssign} disabled={assigning} full>
              <UserPlus className="h-4 w-4" /> {assigning ? 'Assignment en cours…' : 'Assigner'}
            </AffButton>
          </div>
        </AffCard>
      )}

      {/* ── Track tab ── */}
      {tab === 'track' && (
        <div className="space-y-4">
          <div className="flex flex-wrap gap-3">
            <div style={{ minWidth: 200 }}>
              <DarkSelect value={filterEvent} onChange={setFilterEvent}>
                <option value="">Toutes les soirées</option>
                {Array.from(new Set(assignments.map(a => a.event_name))).map(n => <option key={n} value={n}>{n}</option>)}
              </DarkSelect>
            </div>
            <div style={{ minWidth: 180 }}>
              <DarkSelect value={filterStatus} onChange={setFilterStatus}>
                <option value="">Tous les statuts</option>
                {Object.entries(STATUS_LABEL).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
              </DarkSelect>
            </div>
          </div>

          {loadingTrack ? (
            <AffSpinner />
          ) : filteredAssignments.length === 0 ? (
            <AffEmpty icon={ListChecks} title="Aucun assignment trouvé" />
          ) : (
            <AffCard padding={0}>
              <div className="divide-y" style={{ borderColor: BORDER }}>
                {filteredAssignments.map(a => (
                  <div key={a.id} className="flex items-center gap-4 px-4 py-3 transition-colors"
                    onMouseEnter={(e) => (e.currentTarget.style.background = 'rgba(255,255,255,0.02)')}
                    onMouseLeave={(e) => (e.currentTarget.style.background = 'transparent')}>
                    <div className="flex-1 min-w-0">
                      <p className="truncate" style={{ color: T1, fontSize: 13.5, fontWeight: 560 }}>{a.event_name}</p>
                      <p style={{ color: T3, fontSize: 11.5, marginTop: 1 }}>
                        {a.event_date ? format(parseISO(a.event_date), 'd MMM', { locale: fr }) : '—'} · {a.member_name}
                      </p>
                    </div>
                    <Pill tone={STATUS_TONE[a.status] ?? 'muted'}>{STATUS_LABEL[a.status] ?? a.status}</Pill>
                    {a.submitted_url && (
                      <a href={a.submitted_url} target="_blank" rel="noopener noreferrer" title="Voir le lien soumis"
                        className="flex-none p-1 transition-colors" style={{ color: T3 }}
                        onMouseEnter={(e) => (e.currentTarget.style.color = POS)} onMouseLeave={(e) => (e.currentTarget.style.color = T3)}>
                        <ExternalLink className="h-3.5 w-3.5" />
                      </a>
                    )}
                  </div>
                ))}
              </div>
            </AffCard>
          )}
        </div>
      )}
    </AffPage>
  );
}
