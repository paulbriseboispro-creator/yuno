import { useEffect, useState } from 'react';
import { motion } from 'framer-motion';
import { supabase } from '@/integrations/supabase/client';
import { useAuth } from '@/hooks/useAuth';
import { useToast } from '@/hooks/use-toast';
import { Bell, Send, History, Settings2 } from 'lucide-react';
import { format, parseISO } from 'date-fns';
import { fr } from 'date-fns/locale';
import {
  AffPage, AffHeading, AffCard, AffButton, AffSpinner, AffEmpty, TabBar, Toggle,
  FieldLabel, DarkInput, DarkSelect, DarkTextarea, SegToggle,
  POS, T1, T3, BORDER,
} from '@/components/affiliate/affiliate-ui';

type MemberOption = { id: string; display_name: string };
type Automation = {
  id: string;
  automation_type: string;
  is_enabled: boolean;
};
type NotifHistory = {
  id: string;
  title: string;
  body: string;
  sent_at: string;
  type: string;
  automation_type: string | null;
  read_count: number;
};

const AUTOMATION_META: Record<string, { label: string; description: string }> = {
  new_event_published:  { label: 'Nouvel événement publié',       description: 'Notifie tous les promoteurs quand un événement passe à Publié/Featured' },
  event_sold_out:       { label: 'Événement sold-out',            description: 'Notifie tous les promoteurs quand un événement est marqué Complet' },
  assignment_reminder:  { label: 'Rappel assignment',             description: "24h après création d'un assignment sans URL soumise" },
  event_in_48h:         { label: 'Événement dans 48h',            description: "Rappel 48h avant la date d'un événement sur le linktree du promoteur" },
  linktree_stale:       { label: 'Linktree inactif',              description: 'Linktree non mis à jour depuis 7 jours' },
  weekly_top_promoter:  { label: 'Top promoteur hebdo',           description: 'Chaque lundi : notifie le top promoteur de la semaine' },
  missing_ticket_url:   { label: 'URL billeterie manquante',      description: 'Événement publié depuis plus de 6h sans lien billeterie (admin)' },
  weekly_recap:         { label: 'Récap hebdomadaire',            description: 'Chaque lundi : résumé clics/vues/top événements (admin)' },
};

type Tab = 'manual' | 'automations' | 'history';

export default function AffiliateNotifications() {
  const { user } = useAuth();
  const { toast } = useToast();
  const [affiliateId, setAffiliateId] = useState<string | null>(null);
  const [tab, setTab] = useState<Tab>('manual');

  const [members, setMembers] = useState<MemberOption[]>([]);
  const [targetAll, setTargetAll] = useState(true);
  const [targetMember, setTargetMember] = useState('');
  const [title, setTitle] = useState('');
  const [body, setBody] = useState('');
  const [actionUrl, setActionUrl] = useState('');
  const [sending, setSending] = useState(false);

  const [automations, setAutomations] = useState<Automation[]>([]);
  const [loadingAutos, setLoadingAutos] = useState(false);

  const [history, setHistory] = useState<NotifHistory[]>([]);
  const [loadingHistory, setLoadingHistory] = useState(false);

  useEffect(() => {
    if (user) init();
  }, [user]);

  const init = async () => {
    const { data: aff } = await supabase.from('affiliates').select('id').eq('user_id', user!.id).single();
    if (!aff) return;
    setAffiliateId(aff.id);

    const { data: memData } = await supabase
      .from('affiliate_members')
      .select('id, first_name, last_name')
      .eq('affiliate_id', aff.id)
      .eq('is_active', true)
      .order('first_name');
    setMembers((memData ?? []).map((m: any) => ({
      id: m.id,
      display_name: [m.first_name, m.last_name].filter(Boolean).join(' ') || m.id.slice(0, 8),
    })));
  };

  const loadAutomations = async () => {
    if (!affiliateId) return;
    setLoadingAutos(true);
    const { data } = await supabase
      .from('affiliate_notification_automations')
      .select('id, automation_type, is_enabled')
      .eq('affiliate_id', affiliateId)
      .order('automation_type');
    setAutomations((data ?? []) as Automation[]);
    setLoadingAutos(false);
  };

  const loadHistory = async () => {
    if (!affiliateId) return;
    setLoadingHistory(true);
    const { data } = await supabase
      .from('affiliate_notifications')
      .select('id, title, body, sent_at, type, automation_type, read_count')
      .eq('affiliate_id', affiliateId)
      .order('sent_at', { ascending: false })
      .limit(50);
    setHistory((data ?? []) as NotifHistory[]);
    setLoadingHistory(false);
  };

  useEffect(() => {
    if (tab === 'automations') loadAutomations();
    if (tab === 'history') loadHistory();
  }, [tab, affiliateId]);

  const toggleAutomation = async (id: string, current: boolean) => {
    const { error } = await supabase
      .from('affiliate_notification_automations')
      .update({ is_enabled: !current })
      .eq('id', id);
    if (error) { toast({ title: 'Erreur', description: error.message, variant: 'destructive' }); return; }
    setAutomations(prev => prev.map(a => a.id === id ? { ...a, is_enabled: !current } : a));
  };

  const sendManual = async () => {
    if (!affiliateId || !title.trim() || !body.trim()) {
      toast({ title: 'Titre et message requis', variant: 'destructive' }); return;
    }
    setSending(true);

    const payload = {
      affiliate_id: affiliateId,
      target_member_id: targetAll ? null : targetMember || null,
      type: 'manual',
      automation_type: null,
      title: title.trim(),
      body: body.trim(),
      action_url: actionUrl.trim() || null,
    };

    const { error } = await supabase.from('affiliate_notifications').insert(payload);

    setSending(false);
    if (error) {
      toast({ title: 'Erreur', description: error.message, variant: 'destructive' });
    } else {
      toast({ title: 'Notification enregistrée', description: 'Le push sera envoyé via la fonction edge.' });
      setTitle(''); setBody(''); setActionUrl('');
    }
  };

  return (
    <AffPage>
      <motion.div initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }}>
        <AffHeading title="Notifications" subtitle="Messages manuels, automatisations et historique" />
      </motion.div>

      <TabBar<Tab>
        active={tab} onChange={setTab}
        tabs={[
          { id: 'manual', label: 'Message manuel', icon: Send },
          { id: 'automations', label: 'Automatisations', icon: Settings2 },
          { id: 'history', label: 'Historique', icon: History },
        ]}
      />

      {/* ── Manual tab ── */}
      {tab === 'manual' && (
        <AffCard padding={22} style={{ maxWidth: 540 }}>
          <div className="space-y-4">
            <div>
              <FieldLabel>Destinataire</FieldLabel>
              <SegToggle<'all' | 'one'>
                value={targetAll ? 'all' : 'one'}
                onChange={(v) => setTargetAll(v === 'all')}
                options={[{ key: 'all', label: 'Tous les promoteurs' }, { key: 'one', label: 'Un promoteur' }]}
              />
              {!targetAll && (
                <div className="mt-2">
                  <DarkSelect value={targetMember} onChange={setTargetMember}>
                    <option value="">Sélectionner…</option>
                    {members.map(m => <option key={m.id} value={m.id}>{m.display_name}</option>)}
                  </DarkSelect>
                </div>
              )}
            </div>

            <div>
              <FieldLabel>Titre</FieldLabel>
              <DarkInput value={title} onChange={setTitle} placeholder="Nouvelle soirée ce weekend !" />
            </div>

            <div>
              <FieldLabel>Message</FieldLabel>
              <DarkTextarea value={body} onChange={setBody} placeholder="Détails du message…" rows={3} />
            </div>

            <div>
              <FieldLabel hint="(optionnel)">Lien action</FieldLabel>
              <DarkInput type="url" value={actionUrl} onChange={setActionUrl} placeholder="https://…" />
            </div>

            <AffButton onClick={sendManual} disabled={sending} full>
              <Send className="h-4 w-4" /> {sending ? 'Envoi…' : 'Envoyer la notification'}
            </AffButton>
          </div>
        </AffCard>
      )}

      {/* ── Automations tab ── */}
      {tab === 'automations' && (
        loadingAutos ? <AffSpinner /> : (
          automations.length === 0 ? (
            <AffEmpty icon={Settings2} title="Aucune automatisation configurée" />
          ) : (
            <AffCard padding={0}>
              <div className="divide-y" style={{ borderColor: BORDER }}>
                {automations.map(a => {
                  const meta = AUTOMATION_META[a.automation_type];
                  return (
                    <div key={a.id} className="flex items-start gap-4 px-5 py-4">
                      <div className="flex-1 min-w-0">
                        <p style={{ color: T1, fontSize: 13.5, fontWeight: 600 }}>{meta?.label ?? a.automation_type}</p>
                        <p style={{ color: T3, fontSize: 11.5, marginTop: 2, lineHeight: 1.5 }}>{meta?.description}</p>
                      </div>
                      <div className="mt-0.5">
                        <Toggle checked={a.is_enabled} onChange={() => toggleAutomation(a.id, a.is_enabled)} />
                      </div>
                    </div>
                  );
                })}
              </div>
            </AffCard>
          )
        )
      )}

      {/* ── History tab ── */}
      {tab === 'history' && (
        loadingHistory ? <AffSpinner /> : (
          history.length === 0 ? (
            <AffEmpty icon={Bell} title="Aucune notification envoyée" />
          ) : (
            <AffCard padding={0}>
              <div className="divide-y" style={{ borderColor: BORDER }}>
                {history.map(n => (
                  <div key={n.id} className="px-5 py-3 transition-colors"
                    onMouseEnter={(e) => (e.currentTarget.style.background = 'rgba(255,255,255,0.02)')}
                    onMouseLeave={(e) => (e.currentTarget.style.background = 'transparent')}>
                    <div className="flex items-start justify-between gap-3">
                      <div className="flex-1 min-w-0">
                        <p className="truncate" style={{ color: T1, fontSize: 13.5, fontWeight: 560 }}>{n.title}</p>
                        <p className="line-clamp-1" style={{ color: T3, fontSize: 11.5, marginTop: 2 }}>{n.body}</p>
                      </div>
                      <div className="text-right flex-none">
                        <p style={{ color: T3, fontSize: 11 }}>{format(parseISO(n.sent_at), 'd MMM', { locale: fr })}</p>
                        {n.read_count > 0 && (
                          <p style={{ color: POS, fontSize: 11, marginTop: 1 }}>{n.read_count} lu{n.read_count > 1 ? 's' : ''}</p>
                        )}
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            </AffCard>
          )
        )
      )}
    </AffPage>
  );
}
