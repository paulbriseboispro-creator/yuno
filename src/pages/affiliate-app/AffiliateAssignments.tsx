import { useEffect, useState } from 'react';
import { motion } from 'framer-motion';
import { supabase } from '@/integrations/supabase/client';
import { useAuth } from '@/hooks/useAuth';
import { useLanguage } from '@/contexts/LanguageContext';
import { useToast } from '@/hooks/use-toast';
import { format, parseISO } from 'date-fns';
import { fr, es, enUS } from 'date-fns/locale';
import { UserPlus, ListChecks, ExternalLink } from 'lucide-react';
import {
  AffPage, AffHeading, AffCard, Pill, AffButton, AffSpinner, AffEmpty, TabBar,
  FieldLabel, DarkSelect, SegToggle,
  RED, POS, T1, T2, T3, BORDER, TILE_BG, F_BORDER,
} from '@/components/affiliate/affiliate-ui';

type EventOption = { id: string; name: string; event_date: string; affiliate_venue_id: string | null };
type MemberOption = { id: string; display_name: string; venue_scope: string[] | null };
// Soirées Yuno des clubs sous contrat actif de l'agence fusionnée : elles se
// mêlent au sélecteur, l'assignation passe alors par les enregistrements
// promoteurs (assign_agency_promoter_to_event), pas par la collecte d'URL.
type YunoEventOption = { event_id: string; title: string; start_at: string; venue_id: string | null; venue_name: string | null; organizer_user_id: string | null };
type YunoPromoterRecord = {
  id: string; user_id: string; first_name: string | null; last_name: string | null;
  promo_code: string | null; venue_id: string | null; organizer_user_id: string | null;
};
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
const STATUS_LABEL_KEYS: Record<string, string> = {
  pending_url: 'aff.assign.status.pendingUrl', url_submitted: 'aff.assign.status.urlSubmitted', skipped: 'aff.assign.status.skipped',
};

type Tab = 'assign' | 'track';

export default function AffiliateAssignments() {
  const { user } = useAuth();
  const { t, language } = useLanguage();
  const { toast } = useToast();
  const dfLocale = language === 'fr' ? fr : language === 'es' ? es : enUS;
  const [affiliateId, setAffiliateId] = useState<string | null>(null);
  const [tab, setTab] = useState<Tab>('assign');

  const [events, setEvents] = useState<EventOption[]>([]);
  const [members, setMembers] = useState<MemberOption[]>([]);
  const [yunoEvents, setYunoEvents] = useState<YunoEventOption[]>([]);
  const [yunoPromoters, setYunoPromoters] = useState<YunoPromoterRecord[]>([]);
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
    const { data: aff } = await supabase.from('affiliates').select('id, agency_id').eq('user_id', user!.id).single();
    if (!aff) return;
    setAffiliateId(aff.id);

    const [{ data: evData }, { data: memData }] = await Promise.all([
      supabase.from('affiliate_events')
        .select('id, name, event_date, affiliate_venue_id')
        .eq('affiliate_id', aff.id)
        .in('status', ['published', 'featured'])
        .gte('event_date', new Date().toISOString().split('T')[0])
        .order('event_date'),
      supabase.from('affiliate_members')
        .select('id, first_name, last_name, venue_scope')
        .eq('affiliate_id', aff.id)
        .eq('is_active', true)
        .order('first_name'),
    ]);

    setEvents((evData ?? []) as EventOption[]);
    setMembers((memData ?? []).map((m: any) => ({
      id: m.id,
      display_name: [m.first_name, m.last_name].filter(Boolean).join(' ') || m.id.slice(0, 8),
      venue_scope: m.venue_scope ?? null,
    })));

    // Entité fusionnée : les soirées Yuno des clubs sous contrat entrent dans
    // le sélecteur, aux côtés des soirées externes.
    if (aff.agency_id) {
      const [{ data: yEv }, { data: yProm }] = await Promise.all([
        (supabase as any).rpc('get_agency_upcoming_events', {
          p_agency_id: aff.agency_id,
          p_days_ahead: 60,
        }),
        supabase.from('promoters')
          .select('id, user_id, first_name, last_name, promo_code, venue_id, organizer_user_id')
          .eq('agency_id', aff.agency_id)
          .eq('is_active', true),
      ]);
      setYunoEvents((yEv ?? []) as YunoEventOption[]);
      setYunoPromoters((yProm ?? []) as YunoPromoterRecord[]);
    }
  };

  // Une personne = une carte, même si elle a un enregistrement par club.
  const yunoPersons = (() => {
    const byUser = new Map<string, YunoPromoterRecord[]>();
    for (const p of yunoPromoters) {
      if (!byUser.has(p.user_id)) byUser.set(p.user_id, []);
      byUser.get(p.user_id)!.push(p);
    }
    return [...byUser.entries()].map(([userId, records]) => ({
      userId,
      records,
      display_name: [records[0].first_name, records[0].last_name].filter(Boolean).join(' ')
        || records[0].promo_code || userId.slice(0, 8),
    }));
  })();

  const isYunoEvent = selectedEvent.startsWith('yuno:');
  const selectedYunoEvent = isYunoEvent
    ? yunoEvents.find(e => e.event_id === selectedEvent.slice(5)) ?? null
    : null;
  const selectedExternalEvent = !isYunoEvent && selectedEvent
    ? events.find(e => e.id === selectedEvent) ?? null
    : null;

  // Périmètre clubs externes : pour une soirée externe, on ne propose que les
  // membres dont le périmètre couvre le club de la soirée (null = tous).
  const scopedMembers = selectedExternalEvent?.affiliate_venue_id
    ? members.filter(m =>
        !m.venue_scope || m.venue_scope.length === 0
        || m.venue_scope.includes(selectedExternalEvent.affiliate_venue_id!))
    : members;

  const handleAssign = async () => {
    if (!selectedEvent) { toast({ title: t('aff.assign.toast.selectEvent'), variant: 'destructive' }); return; }

    // Soirée Yuno : l'assignation relie les enregistrements promoteurs à
    // l'événement in-app (linktree, « Mes Événements », scan suivent).
    if (isYunoEvent && selectedYunoEvent) {
      const persons = targetAll ? yunoPersons : yunoPersons.filter(p => selectedMembers.has(p.userId));
      if (persons.length === 0) {
        toast({ title: t('aff.assign.toast.selectOnePromoter'), variant: 'destructive' });
        return;
      }
      setAssigning(true);
      let ok = 0;
      let firstError: string | null = null;
      for (const person of persons) {
        // L'enregistrement du club de la soirée si la personne en a un,
        // sinon n'importe lequel — un promoteur n'est pas en monopole.
        const record = person.records.find(r =>
          (selectedYunoEvent.venue_id && r.venue_id === selectedYunoEvent.venue_id) ||
          (selectedYunoEvent.organizer_user_id && r.organizer_user_id === selectedYunoEvent.organizer_user_id)
        ) ?? person.records[0];
        const { error } = await (supabase as any).rpc('assign_agency_promoter_to_event', {
          p_promoter_id: record.id,
          p_event_id: selectedYunoEvent.event_id,
          p_assign: true,
        });
        if (error) { firstError = firstError ?? error.message; } else { ok++; }
      }
      setAssigning(false);
      if (firstError) {
        toast({ title: t('aff.assign.toast.error'), description: firstError, variant: 'destructive' });
      }
      if (ok > 0) {
        toast({ title: t('aff.assign.toast.created').replace('{target}', targetAll ? t('aff.assign.toast.allPromoters') : t('aff.assign.toast.nPromoters').replace('{n}', String(ok))) });
        setSelectedEvent('');
        setSelectedMembers(new Set());
        setTargetAll(true);
      }
      return;
    }

    setAssigning(true);

    const targets = targetAll ? [null] : Array.from(selectedMembers);
    if (!targetAll && targets.length === 0) {
      toast({ title: t('aff.assign.toast.selectOnePromoter'), variant: 'destructive' });
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
      toast({ title: t('aff.assign.toast.error'), description: error.message, variant: 'destructive' });
    } else {
      toast({ title: t('aff.assign.toast.created').replace('{target}', targetAll ? t('aff.assign.toast.allPromoters') : t('aff.assign.toast.nPromoters').replace('{n}', String(targets.length))) });
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
        ? t('aff.assign.allPromoters')
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
      if (next.has(id)) next.delete(id); else next.add(id);
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
        <AffHeading title={t('aff.assign.title')} subtitle={t('aff.assign.subtitle')} />
      </motion.div>

      <TabBar<Tab>
        active={tab} onChange={setTab}
        tabs={[{ id: 'assign', label: t('aff.assign.tabAssign'), icon: UserPlus }, { id: 'track', label: t('aff.assign.tabTrack'), icon: ListChecks }]}
      />

      {/* ── Assign tab ── */}
      {tab === 'assign' && (
        <AffCard padding={22} style={{ maxWidth: 540 }}>
          <div className="space-y-5">
            <div>
              <FieldLabel>{t('aff.assign.eventLabel')}</FieldLabel>
              <DarkSelect
                value={selectedEvent}
                onChange={(v: string) => { setSelectedEvent(v); setSelectedMembers(new Set()); }}
              >
                <option value="">{t('aff.assign.selectEventPh')}</option>
                {yunoEvents.length > 0 && (
                  <optgroup label={t('aff.assign.groupYuno')}>
                    {yunoEvents.map(ev => (
                      <option key={`yuno:${ev.event_id}`} value={`yuno:${ev.event_id}`}>
                        {ev.title}{ev.venue_name ? ` @ ${ev.venue_name}` : ''} — {format(new Date(ev.start_at), 'd MMM yyyy', { locale: dfLocale })}
                      </option>
                    ))}
                  </optgroup>
                )}
                {(yunoEvents.length > 0 && events.length > 0) ? (
                  <optgroup label={t('aff.assign.groupExternal')}>
                    {events.map(ev => (
                      <option key={ev.id} value={ev.id}>
                        {ev.name} — {format(parseISO(ev.event_date), 'd MMM yyyy', { locale: dfLocale })}
                      </option>
                    ))}
                  </optgroup>
                ) : events.map(ev => (
                  <option key={ev.id} value={ev.id}>
                    {ev.name} — {format(parseISO(ev.event_date), 'd MMM yyyy', { locale: dfLocale })}
                  </option>
                ))}
              </DarkSelect>
            </div>

            <div>
              <FieldLabel>{t('aff.assign.targetLabel')}</FieldLabel>
              <SegToggle<'all' | 'sel'>
                value={targetAll ? 'all' : 'sel'}
                onChange={(v) => setTargetAll(v === 'all')}
                options={[{ key: 'all', label: t('aff.assign.allPromoters') }, { key: 'sel', label: t('aff.assign.individualSelection') }]}
              />
            </div>

            {!targetAll && (
              <div className="space-y-1.5 max-h-48 overflow-y-auto pr-1">
                {/* Soirée Yuno → cibles = promoteurs de l'agence ; soirée
                    externe → membres du bras affilié dont le périmètre couvre
                    le club de la soirée. */}
                {(isYunoEvent
                  ? yunoPersons.map(p => ({ id: p.userId, display_name: p.display_name }))
                  : scopedMembers
                ).map(m => {
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
                {(isYunoEvent ? yunoPersons.length === 0 : scopedMembers.length === 0) && (
                  <p style={{ color: T3, fontSize: 11.5, fontStyle: 'italic' }}>{t('aff.assign.noActivePromoters')}</p>
                )}
              </div>
            )}

            <AffButton onClick={handleAssign} disabled={assigning} full>
              <UserPlus className="h-4 w-4" /> {assigning ? t('aff.assign.assigning') : t('aff.assign.assignBtn')}
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
                <option value="">{t('aff.assign.allEvents')}</option>
                {Array.from(new Set(assignments.map(a => a.event_name))).map(n => <option key={n} value={n}>{n}</option>)}
              </DarkSelect>
            </div>
            <div style={{ minWidth: 180 }}>
              <DarkSelect value={filterStatus} onChange={setFilterStatus}>
                <option value="">{t('aff.assign.allStatuses')}</option>
                {Object.entries(STATUS_LABEL_KEYS).map(([k, key]) => <option key={k} value={k}>{t(key)}</option>)}
              </DarkSelect>
            </div>
          </div>

          {loadingTrack ? (
            <AffSpinner />
          ) : filteredAssignments.length === 0 ? (
            <AffEmpty icon={ListChecks} title={t('aff.assign.emptyTitle')} />
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
                        {a.event_date ? format(parseISO(a.event_date), 'd MMM', { locale: dfLocale }) : '—'} · {a.member_name}
                      </p>
                    </div>
                    <Pill tone={STATUS_TONE[a.status] ?? 'muted'}>{STATUS_LABEL_KEYS[a.status] ? t(STATUS_LABEL_KEYS[a.status]) : a.status}</Pill>
                    {a.submitted_url && (
                      <a href={a.submitted_url} target="_blank" rel="noopener noreferrer" title={t('aff.assign.viewSubmittedLink')}
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
