import { useEffect, useState } from 'react';
import { motion } from 'framer-motion';
import { supabase } from '@/integrations/supabase/client';
import { useAuth } from '@/hooks/useAuth';
import { useLanguage } from '@/contexts/LanguageContext';
import { useToast } from '@/hooks/use-toast';
import { Bell, Send, History, Settings2 } from 'lucide-react';
import { format, parseISO } from 'date-fns';
import { fr, es, enUS } from 'date-fns/locale';
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

const AUTOMATION_KEYS: Record<string, { label: string; description: string }> = {
  new_event_published:  { label: 'aff.comms.auto.new_event_published', description: 'aff.comms.auto.new_event_published.desc' },
  event_sold_out:       { label: 'aff.comms.auto.event_sold_out', description: 'aff.comms.auto.event_sold_out.desc' },
  assignment_reminder:  { label: 'aff.comms.auto.assignment_reminder', description: 'aff.comms.auto.assignment_reminder.desc' },
  event_in_48h:         { label: 'aff.comms.auto.event_in_48h', description: 'aff.comms.auto.event_in_48h.desc' },
  linktree_stale:       { label: 'aff.comms.auto.linktree_stale', description: 'aff.comms.auto.linktree_stale.desc' },
  weekly_top_promoter:  { label: 'aff.comms.auto.weekly_top_promoter', description: 'aff.comms.auto.weekly_top_promoter.desc' },
  missing_ticket_url:   { label: 'aff.comms.auto.missing_ticket_url', description: 'aff.comms.auto.missing_ticket_url.desc' },
  weekly_recap:         { label: 'aff.comms.auto.weekly_recap', description: 'aff.comms.auto.weekly_recap.desc' },
};

type Tab = 'manual' | 'automations' | 'history';

export default function AffiliateNotifications() {
  const { user } = useAuth();
  const { t, language } = useLanguage();
  const { toast } = useToast();
  const dfLocale = language === 'fr' ? fr : language === 'es' ? es : enUS;
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
    setMembers((memData ?? []).map((m: { id: string; first_name: string | null; last_name: string | null }) => ({
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
    if (error) { toast({ title: t('aff.comms.toast.error'), description: error.message, variant: 'destructive' }); return; }
    setAutomations(prev => prev.map(a => a.id === id ? { ...a, is_enabled: !current } : a));
  };

  const sendManual = async () => {
    if (!affiliateId || !title.trim() || !body.trim()) {
      toast({ title: t('aff.comms.toast.titleBodyRequired'), variant: 'destructive' }); return;
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
      toast({ title: t('aff.comms.toast.error'), description: error.message, variant: 'destructive' });
    } else {
      toast({ title: t('aff.comms.toast.saved'), description: t('aff.comms.toast.savedDesc') });
      setTitle(''); setBody(''); setActionUrl('');
    }
  };

  return (
    <AffPage>
      <motion.div initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }}>
        <AffHeading title={t('aff.comms.title')} subtitle={t('aff.comms.subtitle')} />
      </motion.div>

      <TabBar<Tab>
        active={tab} onChange={setTab}
        tabs={[
          { id: 'manual', label: t('aff.comms.tabManual'), icon: Send },
          { id: 'automations', label: t('aff.comms.tabAutomations'), icon: Settings2 },
          { id: 'history', label: t('aff.comms.tabHistory'), icon: History },
        ]}
      />

      {/* ── Manual tab ── */}
      {tab === 'manual' && (
        <AffCard padding={22} style={{ maxWidth: 540 }}>
          <div className="space-y-4">
            <div>
              <FieldLabel>{t('aff.comms.recipient')}</FieldLabel>
              <SegToggle<'all' | 'one'>
                value={targetAll ? 'all' : 'one'}
                onChange={(v) => setTargetAll(v === 'all')}
                options={[{ key: 'all', label: t('aff.comms.allPromoters') }, { key: 'one', label: t('aff.comms.onePromoter') }]}
              />
              {!targetAll && (
                <div className="mt-2">
                  <DarkSelect value={targetMember} onChange={setTargetMember}>
                    <option value="">{t('aff.comms.selectPh')}</option>
                    {members.map(m => <option key={m.id} value={m.id}>{m.display_name}</option>)}
                  </DarkSelect>
                </div>
              )}
            </div>

            <div>
              <FieldLabel>{t('aff.comms.titleLabel')}</FieldLabel>
              <DarkInput value={title} onChange={setTitle} placeholder={t('aff.comms.titlePh')} />
            </div>

            <div>
              <FieldLabel>{t('aff.comms.messageLabel')}</FieldLabel>
              <DarkTextarea value={body} onChange={setBody} placeholder={t('aff.comms.messagePh')} rows={3} />
            </div>

            <div>
              <FieldLabel hint={t('aff.comms.optional')}>{t('aff.comms.actionLink')}</FieldLabel>
              <DarkInput type="url" value={actionUrl} onChange={setActionUrl} placeholder="https://…" />
            </div>

            <AffButton onClick={sendManual} disabled={sending} full>
              <Send className="h-4 w-4" /> {sending ? t('aff.comms.sending') : t('aff.comms.sendBtn')}
            </AffButton>
          </div>
        </AffCard>
      )}

      {/* ── Automations tab ── */}
      {tab === 'automations' && (
        loadingAutos ? <AffSpinner /> : (
          automations.length === 0 ? (
            <AffEmpty icon={Settings2} title={t('aff.comms.emptyAutomations')} />
          ) : (
            <AffCard padding={0}>
              <div className="divide-y" style={{ borderColor: BORDER }}>
                {automations.map(a => {
                  const meta = AUTOMATION_KEYS[a.automation_type];
                  return (
                    <div key={a.id} className="flex items-start gap-4 px-5 py-4">
                      <div className="flex-1 min-w-0">
                        <p style={{ color: T1, fontSize: 13.5, fontWeight: 600 }}>{meta ? t(meta.label) : a.automation_type}</p>
                        <p style={{ color: T3, fontSize: 11.5, marginTop: 2, lineHeight: 1.5 }}>{meta && t(meta.description)}</p>
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
            <AffEmpty icon={Bell} title={t('aff.comms.emptyHistory')} />
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
                        <p style={{ color: T3, fontSize: 11 }}>{format(parseISO(n.sent_at), 'd MMM', { locale: dfLocale })}</p>
                        {n.read_count > 0 && (
                          <p style={{ color: POS, fontSize: 11, marginTop: 1 }}>{n.read_count === 1 ? t('aff.comms.readOne') : t('aff.comms.readOther').replace('{n}', String(n.read_count))}</p>
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
