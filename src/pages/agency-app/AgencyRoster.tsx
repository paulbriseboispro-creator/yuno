import { useMemo, useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { supabase } from '@/integrations/supabase/client';
import { useAgency } from '@/hooks/useAgency';
import { useAgencyData, promoterName, contractScopeLabel, AgencyPromoter, ExternalMember } from '@/hooks/useAgencyData';
import { useLanguage } from '@/contexts/LanguageContext';
import { translate } from '@/i18n/orgTranslate';
import { toast } from 'sonner';
import { UserPlus, Users, Mail, Wallet, ChevronRight, Building2, Globe, Check } from 'lucide-react';
import {
  PromoCard, PromoButton, PromoEmpty, PromoAvatar, PromoPill, DarkInput, FieldLabel, SectionLabel,
  T1, T2, T3, RED, POS, INNER_BG, BORDER,
} from '@/components/promoter/promoter-ui';
import { preparePayout, payoutErrorKey } from '@/lib/promoterPayout';

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
  /** Bras externe : le même humain promeut aussi les clubs non-Yuno. */
  external: ExternalMember | null;
};

export default function AgencyRoster() {
  const { agency } = useAgency();
  const { promoters, contracts, groups, externalMembers, loading, refetch } = useAgencyData(agency?.id ?? null);
  const { t, language } = useLanguage();
  const tt = (fr: string, en: string) => translate(language, fr, en);
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const filterClub = searchParams.get('club');

  const [inviteOpen, setInviteOpen] = useState(false);
  // Un promoteur peut bosser plusieurs clubs Yuno ET le bras externe : on coche,
  // on n'arbitre pas. Une invitation part par club coché (+ une externe).
  const [selectedContracts, setSelectedContracts] = useState<Set<string>>(new Set());
  const [inviteExternal, setInviteExternal] = useState(false);
  const [email, setEmail] = useState('');
  const [firstName, setFirstName] = useState('');
  const [lastName, setLastName] = useState('');
  const [ticketValue, setTicketValue] = useState('');
  const [ticketType, setTicketType] = useState<'fixed' | 'percentage'>('fixed');
  const [tableValue, setTableValue] = useState('');
  const [tableType, setTableType] = useState<'fixed' | 'percentage'>('fixed');
  const [sending, setSending] = useState(false);
  const [settling, setSettling] = useState<string | null>(null);
  const [selectedGroup, setSelectedGroup] = useState<string | null>(null);

  const activeContracts = contracts.filter(c => c.status === 'active');

  // Group promoters by user_id to show multi-club people as one card. Le bras
  // externe (affiliate_members) se rattache à la même carte par user_id ; les
  // personnes externes-uniquement ont leur propre carte.
  const grouped: PersonGroup[] = useMemo(() => {
    const byUser = new Map<string, AgencyPromoter[]>();
    for (const p of promoters) {
      if (!byUser.has(p.user_id)) byUser.set(p.user_id, []);
      byUser.get(p.user_id)!.push(p);
    }
    const externalByUser = new Map<string, ExternalMember>();
    for (const m of externalMembers) {
      if (m.user_id) externalByUser.set(m.user_id, m);
    }

    const cards = [...byUser.values()].map((records): PersonGroup => ({
      userId: records[0].user_id,
      name: promoterName(records[0]),
      profileImageUrl: records[0].profile_image_url,
      records,
      totalPending: records.reduce((s, r) => s + Number(r.pending_amount || 0), 0),
      totalPaid: records.reduce((s, r) => s + Number(r.total_paid || 0), 0),
      groupId: records[0].agency_group_id ?? null,
      isMultiClub: records.length > 1,
      external: externalByUser.get(records[0].user_id) ?? null,
    }));

    const yunoUserIds = new Set(cards.map(c => c.userId));
    const externalOnly = externalMembers
      .filter(m => m.user_id && !yunoUserIds.has(m.user_id))
      .map((m): PersonGroup => ({
        userId: m.user_id!,
        name: [m.first_name, m.last_name].filter(Boolean).join(' ').trim() || m.linktree_slug || 'Promoteur',
        profileImageUrl: null,
        records: [],
        totalPending: 0,
        totalPaid: 0,
        groupId: null,
        isMultiClub: false,
        external: m,
      }));

    return [...cards, ...externalOnly];
  }, [promoters, externalMembers]);

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

  const toggleContract = (id: string) => {
    setSelectedContracts(prev => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id); else next.add(id);
      return next;
    });
  };

  const handleInvite = async () => {
    const targets = activeContracts.filter(c => selectedContracts.has(c.id));
    if (!email.trim() || (targets.length === 0 && !inviteExternal)) {
      toast.error(tt('Email et au moins un club (Yuno ou externe) requis', 'Email and at least one club (Yuno or external) required'));
      return;
    }
    // Le bras externe crée un compte membre : il lui faut une identité complète.
    if (inviteExternal && (!firstName.trim() || !lastName.trim())) {
      toast.error(tt('Prénom et nom requis pour les clubs externes', 'First and last name required for external clubs'));
      return;
    }

    setSending(true);
    const failures: string[] = [];
    let sent = 0;

    // Une invitation par club Yuno coché — le même humain devient un
    // enregistrement promoteur par club (modèle multi-club existant).
    for (const contract of targets) {
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
      const res = data as { error?: string } | null;
      if (error || res?.error) {
        failures.push(`${contractScopeLabel(contract)} : ${res?.error || error?.message || tt('échec', 'failed')}`);
      } else {
        sent++;
      }
    }

    // Bras externe : le promoteur rejoint le linktree + liens tracés vers les
    // billetteries des clubs non-Yuno — cumulable avec les clubs Yuno.
    if (inviteExternal) {
      const { data, error } = await supabase.functions.invoke('invite-affiliate-member', {
        body: {
          email: email.trim().toLowerCase(),
          first_name: firstName.trim(),
          last_name: lastName.trim(),
          role: 'promoter',
        },
      });
      const res = data as { error?: string } | null;
      if (error || res?.error) {
        failures.push(`${tt('Clubs externes', 'External clubs')} : ${res?.error || error?.message || tt('échec', 'failed')}`);
      } else {
        sent++;
      }
    }

    setSending(false);
    if (failures.length > 0) {
      toast.error(failures.join(' — '));
    }
    if (sent > 0) {
      toast.success(sent > 1
        ? tt(`${sent} invitations envoyées`, `${sent} invitations sent`)
        : tt('Invitation envoyée', 'Invitation sent'));
      setEmail(''); setFirstName(''); setLastName(''); setTicketValue(''); setTableValue('');
      setSelectedContracts(new Set()); setInviteExternal(false); setInviteOpen(false);
      refetch();
    }
  };

  // Règlement en trois temps (comme les clubs) : ici on PRÉPARE le lot — IBAN,
  // référence et déclaration de virement vivent sur l'écran Finance.
  const handlePrepare = async (pg: PersonGroup) => {
    setSettling(pg.userId);
    let prepared = 0;
    try {
      for (const r of pg.records.filter(r => Number(r.pending_amount) > 0)) {
        const res = await preparePayout(r.id);
        if (res?.prepared) prepared++;
      }
    } catch (err) {
      setSettling(null);
      toast.error(t(payoutErrorKey(err)));
      return;
    }
    setSettling(null);
    if (prepared > 0) {
      toast.success(tt('Règlement préparé — IBAN et référence dans Finance', 'Settlement prepared — IBAN and reference in Finance'));
      navigate('/agency-app/finance');
    } else {
      toast.info(tt('Rien à régler', 'Nothing to settle'));
    }
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
        <PromoButton size="sm" onClick={() => setInviteOpen(v => !v)}>
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

      {inviteOpen && (
        <PromoCard>
          <SectionLabel>{tt('Nouveau promoteur', 'New promoter')}</SectionLabel>

          <div className="mt-3 space-y-3">
            <div>
              <FieldLabel>{tt('Email', 'Email')}</FieldLabel>
              <DarkInput value={email} onChange={setEmail} placeholder="promoteur@email.com" type="email" icon={Mail} />
            </div>
            <div>
              <FieldLabel>{inviteExternal ? tt('Prénom', 'First name') : tt('Prénom (optionnel)', 'First name (optional)')}</FieldLabel>
              <DarkInput value={firstName} onChange={setFirstName} placeholder={tt('Prénom', 'First name')} />
            </div>
            {inviteExternal && (
              <div>
                <FieldLabel>{tt('Nom de famille', 'Last name')}</FieldLabel>
                <DarkInput value={lastName} onChange={setLastName} placeholder={tt('Nom de famille', 'Last name')} />
              </div>
            )}

            {/* Où va-t-il vendre ? Plusieurs clubs Yuno ET les clubs externes,
                cumulables — un promoteur n'est pas en monopole. */}
            <div>
              <FieldLabel>{tt('Clubs (plusieurs choix possibles)', 'Clubs (multiple choices allowed)')}</FieldLabel>
              <div className="space-y-1.5">
                {activeContracts.length === 0 && (
                  <p style={{ color: T3, fontSize: 12 }}>
                    {tt(
                      "Aucun contrat club actif — signez un contrat pour recruter sur un club Yuno, ou invitez-le sur les clubs externes.",
                      'No active club contract — sign one to recruit on a Yuno club, or invite them on external clubs.'
                    )}
                  </p>
                )}
                {activeContracts.map(c => {
                  const checked = selectedContracts.has(c.id);
                  return (
                    <button
                      key={c.id}
                      onClick={() => toggleContract(c.id)}
                      className="flex items-center gap-3 w-full text-left"
                      style={{
                        padding: '8px 12px', borderRadius: 10, cursor: 'pointer',
                        background: checked ? 'rgba(232,25,44,0.08)' : INNER_BG,
                        border: `1px solid ${checked ? 'rgba(232,25,44,0.25)' : BORDER}`,
                      }}
                    >
                      <span
                        className="flex-none flex items-center justify-center"
                        style={{
                          width: 16, height: 16, borderRadius: 4,
                          background: checked ? RED : 'transparent',
                          border: `1px solid ${checked ? RED : 'rgba(255,255,255,0.25)'}`,
                        }}
                      >
                        {checked && <Check className="h-3 w-3" style={{ color: '#fff' }} />}
                      </span>
                      <Building2 className="h-3.5 w-3.5 flex-none" style={{ color: checked ? T1 : T3 }} />
                      <span style={{ color: checked ? T1 : T2, fontSize: 13 }}>{contractScopeLabel(c)}</span>
                    </button>
                  );
                })}
                <button
                  onClick={() => setInviteExternal(v => !v)}
                  className="flex items-center gap-3 w-full text-left"
                  style={{
                    padding: '8px 12px', borderRadius: 10, cursor: 'pointer',
                    background: inviteExternal ? 'rgba(232,25,44,0.08)' : INNER_BG,
                    border: `1px solid ${inviteExternal ? 'rgba(232,25,44,0.25)' : BORDER}`,
                  }}
                >
                  <span
                    className="flex-none flex items-center justify-center"
                    style={{
                      width: 16, height: 16, borderRadius: 4,
                      background: inviteExternal ? RED : 'transparent',
                      border: `1px solid ${inviteExternal ? RED : 'rgba(255,255,255,0.25)'}`,
                    }}
                  >
                    {inviteExternal && <Check className="h-3 w-3" style={{ color: '#fff' }} />}
                  </span>
                  <Globe className="h-3.5 w-3.5 flex-none" style={{ color: inviteExternal ? T1 : T3 }} />
                  <span style={{ color: inviteExternal ? T1 : T2, fontSize: 13 }}>
                    {tt('Clubs externes (linktree + liens tracés)', 'External clubs (linktree + tracked links)')}
                  </span>
                </button>
              </div>
            </div>

            {selectedContracts.size > 0 && (<>
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
            </>)}
            <PromoButton onClick={handleInvite} disabled={sending} full>
              {sending
                ? tt('Envoi…', 'Sending…')
                : (selectedContracts.size + (inviteExternal ? 1 : 0)) > 1
                  ? tt('Envoyer les invitations', 'Send invitations')
                  : tt("Envoyer l'invitation", 'Send invitation')}
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
                      {pg.external && (
                        <PromoPill tone="muted">
                          <Globe className="h-3 w-3 inline mr-0.5" />
                          {tt('Externe', 'External')}
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
                      {pg.external?.linktree_slug && (
                        <span style={{ color: T3, fontSize: 10.5 }}>
                          {pg.records.length > 0 ? ' / ' : ''}/promo/{pg.external.linktree_slug}
                        </span>
                      )}
                    </div>
                  </div>
                  <div className="text-right flex-none">
                    <p style={{ color: pg.totalPending > 0 ? POS : T3, fontSize: 14, fontWeight: 680 }}>
                      {eur(pg.totalPending)}
                    </p>
                    <p style={{ color: T3, fontSize: 10 }}>{tt('à reverser', 'to pay')}</p>
                  </div>
                  <button
                    onClick={() => navigate(pg.records.length > 0
                      ? `/agency-app/promoters/${pg.userId}`
                      : '/affiliate/suivi')}
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
                      onClick={() => handlePrepare(pg)}
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
