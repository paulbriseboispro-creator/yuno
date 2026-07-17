import { useMemo, useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { supabase } from '@/integrations/supabase/client';
import { useAgency } from '@/hooks/useAgency';
import { useAgencyData, promoterName, contractScopeLabel, AgencyContract, AgencyPromoter } from '@/hooks/useAgencyData';
import { useLanguage } from '@/contexts/LanguageContext';
import { translate } from '@/i18n/orgTranslate';
import { toast } from 'sonner';
import { UserPlus, Users, Mail, Wallet, ChevronRight, Building2 } from 'lucide-react';
import {
  PromoCard, PromoButton, PromoEmpty, PromoAvatar, PromoPill, DarkInput, FieldLabel, SectionLabel,
  T1, T2, T3, RED, POS, INNER_BG, BORDER,
} from '@/components/promoter/promoter-ui';

const eur = (n: number) => `${(Number(n) || 0).toFixed(2)} €`;

type PersonGroup = {
  userId: string;
  name: string;
  profileImageUrl: string | null;
  records: AgencyPromoter[];
  totalPending: number;
  totalPaid: number;
  groupId: string | null;
  isMultiClub: boolean;
};

export default function AgencyRoster() {
  const { agency } = useAgency();
  const { promoters, contracts, groups, loading, refetch } = useAgencyData(agency?.id ?? null);
  const { language } = useLanguage();
  const tt = (fr: string, en: string) => translate(language, fr, en);
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const filterClub = searchParams.get('club');

  const [inviteOpen, setInviteOpen] = useState(false);
  const [email, setEmail] = useState('');
  const [firstName, setFirstName] = useState('');
  const [contractId, setContractId] = useState('');
  const [ticketValue, setTicketValue] = useState('');
  const [ticketType, setTicketType] = useState<'fixed' | 'percentage'>('fixed');
  const [tableValue, setTableValue] = useState('');
  const [tableType, setTableType] = useState<'fixed' | 'percentage'>('fixed');
  const [sending, setSending] = useState(false);
  const [settling, setSettling] = useState<string | null>(null);
  const [selectedGroup, setSelectedGroup] = useState<string | null>(null);

  const activeContracts = contracts.filter(c => c.status === 'active');

  // Group promoters by user_id to show multi-club people as one card
  const grouped: PersonGroup[] = useMemo(() => {
    const byUser = new Map<string, AgencyPromoter[]>();
    for (const p of promoters) {
      if (!byUser.has(p.user_id)) byUser.set(p.user_id, []);
      byUser.get(p.user_id)!.push(p);
    }
    return [...byUser.values()].map((records): PersonGroup => ({
      userId: records[0].user_id,
      name: promoterName(records[0]),
      profileImageUrl: records[0].profile_image_url,
      records,
      totalPending: records.reduce((s, r) => s + Number(r.pending_amount || 0), 0),
      totalPaid: records.reduce((s, r) => s + Number(r.total_paid || 0), 0),
      groupId: records[0].agency_group_id ?? null,
      isMultiClub: records.length > 1,
    }));
  }, [promoters]);

  // Apply filters
  const filtered = useMemo(() => {
    let list = grouped;
    if (filterClub) {
      list = list.filter(pg => pg.records.some(r => r.venue_id === filterClub));
    }
    if (selectedGroup === 'none') {
      list = list.filter(pg => !pg.groupId);
    } else if (selectedGroup) {
      list = list.filter(pg => pg.groupId === selectedGroup);
    }
    return list;
  }, [grouped, filterClub, selectedGroup]);

  const handleInvite = async () => {
    const contract = activeContracts.find(c => c.id === contractId);
    if (!email.trim() || !contract) {
      toast.error(tt('Email et club requis', 'Email and club required'));
      return;
    }
    setSending(true);
    const { data, error } = await supabase.functions.invoke('invite-promoter', {
      body: {
        email: email.trim(),
        first_name: firstName.trim() || undefined,
        agency_id: agency!.id,
        venue_id: contract.venue_id ?? undefined,
        organizer_user_id: contract.organizer_user_id ?? undefined,
        commission_config: {
          ticket_commission_type: ticketType,
          ticket_commission_value: Number(ticketValue) || 0,
          table_commission_type: tableType,
          table_commission_value: Number(tableValue) || 0,
        },
      },
    });
    setSending(false);
    if (error || (data as any)?.error) {
      toast.error((data as any)?.error || error?.message || tt("Échec de l'invitation", 'Invite failed'));
      return;
    }
    toast.success(tt('Invitation envoyée', 'Invitation sent'));
    setEmail(''); setFirstName(''); setTicketValue(''); setTableValue(''); setInviteOpen(false);
    refetch();
  };

  const handleSettle = async (promoterId: string) => {
    setSettling(promoterId);
    const { data, error } = await (supabase as any).rpc('settle_agency_promoter_payout', {
      p_promoter_id: promoterId,
    });
    setSettling(null);
    if (error) { toast.error(error.message); return; }
    if (data?.settled) toast.success(tt('Réglé', 'Settled') + ` — ${eur(data.amount)}`);
    else toast.info(tt('Rien à régler', 'Nothing to settle'));
    refetch();
  };

  const handleSettleGroup = async (pg: PersonGroup) => {
    for (const r of pg.records.filter(r => Number(r.pending_amount) > 0)) {
      await (supabase as any).rpc('settle_agency_promoter_payout', { p_promoter_id: r.id });
    }
    toast.success(tt('Réglé', 'Settled'));
    refetch();
  };

  const venueName = (p: AgencyPromoter) =>
    contracts.find(c => c.venue_id === p.venue_id || c.organizer_user_id === p.organizer_user_id)?.venues?.name
    || p.venues?.name
    || p.venue_id
    || tt('Organisateur', 'Organizer');

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <SectionLabel>{tt('Mes promoteurs', 'My promoters')}</SectionLabel>
        <PromoButton size="sm" onClick={() => setInviteOpen(v => !v)} disabled={activeContracts.length === 0}>
          <UserPlus className="h-4 w-4" /> {tt('Inviter', 'Invite')}
        </PromoButton>
      </div>

      {/* Group filter pills */}
      {groups.length > 0 && (
        <div className="flex gap-2 flex-wrap">
          <button
            onClick={() => setSelectedGroup(null)}
            style={{
              padding: '5px 12px', borderRadius: 20, fontSize: 12, fontWeight: 600, cursor: 'pointer',
              background: selectedGroup === null ? INNER_BG : 'transparent',
              border: `1px solid ${selectedGroup === null ? BORDER : 'rgba(255,255,255,0.08)'}`,
              color: selectedGroup === null ? T1 : T3,
            }}
          >
            {tt('Tous', 'All')} ({grouped.length})
          </button>
          {groups.map(g => {
            const count = grouped.filter(pg => pg.groupId === g.id).length;
            return (
              <button
                key={g.id}
                onClick={() => setSelectedGroup(selectedGroup === g.id ? null : g.id)}
                style={{
                  padding: '5px 12px', borderRadius: 20, fontSize: 12, fontWeight: 600, cursor: 'pointer',
                  background: selectedGroup === g.id ? INNER_BG : 'transparent',
                  border: `1px solid ${selectedGroup === g.id ? BORDER : 'rgba(255,255,255,0.08)'}`,
                  color: selectedGroup === g.id ? T1 : T3,
                  display: 'flex', alignItems: 'center', gap: 6,
                }}
              >
                <span style={{ width: 8, height: 8, borderRadius: '50%', background: g.color, display: 'inline-block' }} />
                {g.name} ({count})
              </button>
            );
          })}
          <button
            onClick={() => setSelectedGroup(selectedGroup === 'none' ? null : 'none')}
            style={{
              padding: '5px 12px', borderRadius: 20, fontSize: 12, fontWeight: 600, cursor: 'pointer',
              background: selectedGroup === 'none' ? INNER_BG : 'transparent',
              border: `1px solid ${selectedGroup === 'none' ? BORDER : 'rgba(255,255,255,0.08)'}`,
              color: selectedGroup === 'none' ? T1 : T3,
            }}
          >
            {tt('Sans groupe', 'No group')} ({grouped.filter(pg => !pg.groupId).length})
          </button>
        </div>
      )}

      {activeContracts.length === 0 && (
        <p style={{ color: T3, fontSize: 12 }}>
          {tt(
            "Signez d'abord un contrat actif avec un club pour recruter des promoteurs.",
            'Sign an active contract with a club first to recruit promoters.'
          )}
        </p>
      )}

      {inviteOpen && activeContracts.length > 0 && (
        <PromoCard>
          <SectionLabel>{tt('Nouveau promoteur', 'New promoter')}</SectionLabel>
          <div className="mt-3 space-y-3">
            <div>
              <FieldLabel>{tt('Email', 'Email')}</FieldLabel>
              <DarkInput value={email} onChange={setEmail} placeholder="promoteur@email.com" type="email" icon={Mail} />
            </div>
            <div>
              <FieldLabel>{tt('Prénom (optionnel)', 'First name (optional)')}</FieldLabel>
              <DarkInput value={firstName} onChange={setFirstName} placeholder={tt('Prénom', 'First name')} />
            </div>
            <div>
              <FieldLabel>{tt('Club de rattachement', 'Assigned club')}</FieldLabel>
              <select
                value={contractId}
                onChange={e => setContractId(e.target.value)}
                className="w-full outline-none"
                style={{
                  background: INNER_BG, border: `1px solid ${BORDER}`,
                  borderRadius: 10, padding: '9px 12px', color: T1, fontSize: 13.5,
                }}
              >
                <option value="" style={{ background: '#111' }}>{tt('Choisir un club…', 'Choose a club…')}</option>
                {activeContracts.map(c => (
                  <option key={c.id} value={c.id} style={{ background: '#111' }}>
                    {contractScopeLabel(c)}
                  </option>
                ))}
              </select>
            </div>
            <div>
              <FieldLabel>{tt('Commission billets (net)', 'Ticket commission (net)')}</FieldLabel>
              <div className="flex gap-2">
                <DarkInput value={ticketValue} onChange={setTicketValue} placeholder="0" type="number" />
                <select
                  value={ticketType}
                  onChange={e => setTicketType(e.target.value as 'fixed' | 'percentage')}
                  style={{
                    background: INNER_BG, border: `1px solid ${BORDER}`,
                    borderRadius: 10, padding: '0 12px', color: T1, fontSize: 13,
                  }}
                >
                  <option value="fixed" style={{ background: '#111' }}>€</option>
                  <option value="percentage" style={{ background: '#111' }}>%</option>
                </select>
              </div>
            </div>
            <div>
              <FieldLabel>{tt('Commission tables (net)', 'Table commission (net)')}</FieldLabel>
              <div className="flex gap-2">
                <DarkInput value={tableValue} onChange={setTableValue} placeholder="0" type="number" />
                <select
                  value={tableType}
                  onChange={e => setTableType(e.target.value as 'fixed' | 'percentage')}
                  style={{
                    background: INNER_BG, border: `1px solid ${BORDER}`,
                    borderRadius: 10, padding: '0 12px', color: T1, fontSize: 13,
                  }}
                >
                  <option value="fixed" style={{ background: '#111' }}>€</option>
                  <option value="percentage" style={{ background: '#111' }}>%</option>
                </select>
              </div>
            </div>
            <PromoButton onClick={handleInvite} disabled={sending} full>
              {sending ? tt('Envoi…', 'Sending…') : tt("Envoyer l'invitation", 'Send invitation')}
            </PromoButton>
          </div>
        </PromoCard>
      )}

      {loading ? (
        <div className="py-10 text-center" style={{ color: T3, fontSize: 13 }}>{tt('Chargement…', 'Loading…')}</div>
      ) : filtered.length === 0 ? (
        <PromoEmpty
          icon={Users}
          title={tt('Aucun promoteur', 'No promoters')}
          description={tt('Invitez votre premier promoteur.', 'Invite your first promoter.')}
        />
      ) : (
        <div className="space-y-2">
          {filtered.map(pg => {
            const group = groups.find(g => g.id === pg.groupId);
            return (
              <PromoCard key={pg.userId} style={{ padding: 12 }}>
                <div className="flex items-center gap-3">
                  <PromoAvatar src={pg.profileImageUrl} fallback={pg.name.slice(0, 1)} size={42} />
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-2 flex-wrap">
                      <p className="truncate" style={{ color: T1, fontSize: 14, fontWeight: 640 }}>{pg.name}</p>
                      {pg.isMultiClub && (
                        <PromoPill tone="muted">
                          <Building2 className="h-3 w-3 inline mr-0.5" />
                          {pg.records.length} clubs
                        </PromoPill>
                      )}
                      {group && (
                        <span style={{
                          display: 'inline-flex', alignItems: 'center', gap: 4,
                          padding: '2px 8px', borderRadius: 20, fontSize: 10.5, fontWeight: 600,
                          background: `${group.color}22`, color: group.color,
                          border: `1px solid ${group.color}44`,
                        }}>
                          <span style={{ width: 6, height: 6, borderRadius: '50%', background: group.color }} />
                          {group.name}
                        </span>
                      )}
                    </div>
                    {/* Club chips */}
                    <div className="flex flex-wrap gap-1 mt-1">
                      {pg.records.map(r => (
                        <span key={r.id} style={{ color: T3, fontSize: 10.5 }}>
                          {venueName(r)}{r.promo_code ? ` · ${r.promo_code}` : ''}
                          {pg.records.indexOf(r) < pg.records.length - 1 ? ' / ' : ''}
                        </span>
                      ))}
                    </div>
                  </div>
                  <div className="text-right flex-none">
                    <p style={{ color: pg.totalPending > 0 ? POS : T3, fontSize: 14, fontWeight: 680 }}>
                      {eur(pg.totalPending)}
                    </p>
                    <p style={{ color: T3, fontSize: 10 }}>{tt('à reverser', 'to pay')}</p>
                  </div>
                  <button
                    onClick={() => navigate(`/agency-app/promoters/${pg.userId}`)}
                    style={{ color: T3, cursor: 'pointer', background: 'none', border: 'none', padding: 4 }}
                  >
                    <ChevronRight className="h-4 w-4" />
                  </button>
                </div>

                {pg.totalPending > 0 && (
                  <div className="mt-2 flex justify-end">
                    <PromoButton
                      size="sm"
                      variant="secondary"
                      onClick={() => {
                        if (pg.records.length === 1) {
                          handleSettle(pg.records[0].id);
                        } else {
                          handleSettleGroup(pg);
                        }
                      }}
                      disabled={!!settling}
                    >
                      <Wallet className="h-3.5 w-3.5" />
                      {tt(`Reverser ${eur(pg.totalPending)}`, `Pay ${eur(pg.totalPending)}`)}
                    </PromoButton>
                  </div>
                )}
              </PromoCard>
            );
          })}
        </div>
      )}
    </div>
  );
}
