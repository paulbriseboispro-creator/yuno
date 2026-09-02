import { useCallback, useEffect, useMemo, useState } from 'react';
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

/** Ligne cochable du sélecteur de clubs (Yuno et externes partagent le style). */
function CheckRow({ checked, onClick, icon: Icon, label, bold }: {
  checked: boolean;
  onClick: () => void;
  icon: typeof Building2;
  label: string;
  bold?: boolean;
}) {
  return (
    <button
      onClick={onClick}
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
      <Icon className="h-3.5 w-3.5 flex-none" style={{ color: checked ? T1 : T3 }} />
      <span style={{ color: checked ? T1 : T2, fontSize: 13, fontWeight: bold ? 640 : 400 }}>{label}</span>
    </button>
  );
}

/** Invitation envoyée mais pas encore acceptée (RPC dédiée — jamais le token). */
type PendingInvite = {
  kind: 'yuno' | 'external';
  invitation_id: string;
  email: string;
  first_name: string | null;
  last_name: string | null;
  member_role: string;
  scope_all: boolean;
  venue_count: number | null;
  venue_name: string | null;
  created_at: string;
  expires_at: string | null;
};

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
  const { promoters, contracts, groups, externalMembers, externalVenues, loading, refetch } = useAgencyData(agency?.id ?? null);
  const { t, language } = useLanguage();
  const tt = (fr: string, en: string) => translate(language, fr, en);
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const filterClub = searchParams.get('club');

  const [inviteOpen, setInviteOpen] = useState(false);
  // Un promoteur peut bosser plusieurs clubs Yuno ET des clubs externes : on
  // coche, on n'arbitre pas. Un seul email récapitulatif part, quel que soit
  // le nombre de clubs cochés.
  const [selectedContracts, setSelectedContracts] = useState<Set<string>>(new Set());
  // Bras externe : « tous les clubs » ou un périmètre précis de clubs externes.
  const [extAll, setExtAll] = useState(false);
  const [extVenues, setExtVenues] = useState<Set<string>>(new Set());
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

  // Invitations envoyées mais pas encore acceptées : sans cette liste, on
  // invitait puis on regardait « Aucun promoteur » en se demandant si
  // l'envoi avait marché.
  const [pendingInvites, setPendingInvites] = useState<PendingInvite[]>([]);
  const [revoking, setRevoking] = useState<string | null>(null);
  const loadInvites = useCallback(async () => {
    if (!agency?.id) { setPendingInvites([]); return; }
    const { data, error } = await (supabase as any).rpc('get_agency_pending_invitations', { p_agency_id: agency.id });
    if (!error) setPendingInvites((data as PendingInvite[] | null) ?? []);
  }, [agency?.id]);
  useEffect(() => { loadInvites(); }, [loadInvites]);

  // Une carte par email : le même humain peut porter des lignes Yuno ET une
  // ligne externe issues du même envoi.
  const inviteGroups = useMemo(() => {
    const byEmail = new Map<string, PendingInvite[]>();
    for (const inv of pendingInvites) {
      const k = inv.email.toLowerCase();
      if (!byEmail.has(k)) byEmail.set(k, []);
      byEmail.get(k)!.push(inv);
    }
    return [...byEmail.values()];
  }, [pendingInvites]);

  const handleRevoke = async (group: PendingInvite[]) => {
    setRevoking(group[0].email);
    try {
      for (const inv of group) {
        await (supabase as any).rpc('revoke_agency_invitation', { p_kind: inv.kind, p_invitation_id: inv.invitation_id });
      }
      toast.success(tt('Invitation révoquée', 'Invitation revoked'));
    } finally {
      setRevoking(null);
    }
    loadInvites();
  };

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

  const allYunoSelected = activeContracts.length > 0 && selectedContracts.size === activeContracts.length;
  const toggleAllYuno = () => {
    setSelectedContracts(allYunoSelected ? new Set() : new Set(activeContracts.map(c => c.id)));
  };

  const toggleExtVenue = (id: string) => {
    setExtAll(false);
    setExtVenues(prev => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id); else next.add(id);
      return next;
    });
  };
  const toggleExtAll = () => {
    setExtVenues(new Set());
    setExtAll(v => !v);
  };

  const externalSelected = extAll || extVenues.size > 0;

  const handleInvite = async () => {
    const targets = activeContracts.filter(c => selectedContracts.has(c.id));
    if (!email.trim() || (targets.length === 0 && !externalSelected)) {
      toast.error(tt('Email et au moins un club (Yuno ou externe) requis', 'Email and at least one club (Yuno or external) required'));
      return;
    }
    // Le bras externe crée un compte membre : il lui faut une identité complète.
    if (externalSelected && (!firstName.trim() || !lastName.trim())) {
      toast.error(tt('Prénom et nom requis pour les clubs externes', 'First and last name required for external clubs'));
      return;
    }

    setSending(true);
    let recapSent = false;

    // UN SEUL appel pour tous les clubs Yuno cochés → une ligne d'invitation
    // par club, mais UN email récapitulatif (clubs + rémunération + externe).
    // Le lien de l'email accepte tout le lot d'un geste.
    if (targets.length > 0) {
      const { data, error } = await supabase.functions.invoke('invite-promoter', {
        body: {
          email: email.trim(),
          first_name: firstName.trim() || undefined,
          last_name: lastName.trim() || undefined,
          agency_id: agency!.id,
          targets: targets.map(c => ({
            venue_id: c.venue_id ?? undefined,
            organizer_user_id: c.organizer_user_id ?? undefined,
          })),
          commission_config: {
            ticket_commission_type: ticketType,
            ticket_commission_value: Number(ticketValue) || 0,
            table_commission_type: tableType,
            table_commission_value: Number(tableValue) || 0,
          },
          external_recap: externalSelected
            ? {
              all: extAll,
              venue_names: extAll ? [] : externalVenues.filter(v => extVenues.has(v.id)).map(v => v.name),
            }
            : null,
        },
      });
      const res = data as { error?: string; email_sent?: boolean; all_already_linked?: boolean } | null;
      if (error || res?.error) {
        setSending(false);
        toast.error(res?.error || error?.message || tt("Échec de l'invitation", 'Invite failed'));
        return;
      }
      recapSent = !!res?.email_sent;
      if (res?.all_already_linked && !externalSelected) {
        setSending(false);
        toast.info(tt('Déjà promoteur sur tous ces clubs', 'Already a promoter on all these clubs'));
        return;
      }
    }

    // Bras externe : membre du linktree, limité aux clubs cochés (ou tous).
    // Son email est supprimé quand le récap l'a déjà annoncé — un seul email.
    if (externalSelected) {
      const { data, error } = await supabase.functions.invoke('invite-affiliate-member', {
        body: {
          email: email.trim().toLowerCase(),
          first_name: firstName.trim(),
          last_name: lastName.trim(),
          role: 'promoter',
          venue_ids: extAll ? null : [...extVenues],
          suppress_email: recapSent,
        },
      });
      const res = data as { error?: string } | null;
      if (error || res?.error) {
        setSending(false);
        toast.error(`${tt('Clubs externes', 'External clubs')} : ${res?.error || error?.message || tt('échec', 'failed')}`);
        return;
      }
    }

    setSending(false);
    toast.success(recapSent
      ? tt('Invitation envoyée — un seul email récapitulatif', 'Invitation sent — one recap email')
      : tt('Invitation envoyée', 'Invitation sent'));
    setEmail(''); setFirstName(''); setLastName(''); setTicketValue(''); setTableValue('');
    setSelectedContracts(new Set()); setExtAll(false); setExtVenues(new Set()); setInviteOpen(false);
    refetch();
    loadInvites();
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
              <FieldLabel>{externalSelected ? tt('Prénom', 'First name') : tt('Prénom (optionnel)', 'First name (optional)')}</FieldLabel>
              <DarkInput value={firstName} onChange={setFirstName} placeholder={tt('Prénom', 'First name')} />
            </div>
            {externalSelected && (
              <div>
                <FieldLabel>{tt('Nom de famille', 'Last name')}</FieldLabel>
                <DarkInput value={lastName} onChange={setLastName} placeholder={tt('Nom de famille', 'Last name')} />
              </div>
            )}

            {/* Où va-t-il vendre ? Plusieurs clubs Yuno ET des clubs externes,
                cumulables — un promoteur n'est pas en monopole. Quel que soit
                le nombre de clubs cochés : UN email récapitulatif, un lien. */}
            <div>
              <FieldLabel>{tt('Clubs Yuno (contrats)', 'Yuno clubs (contracts)')}</FieldLabel>
              <div className="space-y-1.5">
                {activeContracts.length === 0 && (
                  <p style={{ color: T3, fontSize: 12 }}>
                    {tt(
                      "Aucun contrat club actif — signez un contrat pour recruter sur un club Yuno, ou invitez-le sur les clubs externes.",
                      'No active club contract — sign one to recruit on a Yuno club, or invite them on external clubs.'
                    )}
                  </p>
                )}
                {activeContracts.length > 1 && (
                  <CheckRow
                    checked={allYunoSelected}
                    onClick={toggleAllYuno}
                    icon={Building2}
                    label={tt('Tous les clubs Yuno', 'All Yuno clubs')}
                    bold
                  />
                )}
                {activeContracts.map(c => (
                  <CheckRow
                    key={c.id}
                    checked={selectedContracts.has(c.id)}
                    onClick={() => toggleContract(c.id)}
                    icon={Building2}
                    label={contractScopeLabel(c)}
                  />
                ))}
              </div>
            </div>

            <div>
              <FieldLabel>{tt('Clubs externes', 'External clubs')}</FieldLabel>
              <div className="space-y-1.5">
                <CheckRow
                  checked={extAll}
                  onClick={toggleExtAll}
                  icon={Globe}
                  label={tt('Tous les clubs externes', 'All external clubs')}
                  bold
                />
                {externalVenues.map(v => (
                  <CheckRow
                    key={v.id}
                    checked={extAll || extVenues.has(v.id)}
                    onClick={() => toggleExtVenue(v.id)}
                    icon={Globe}
                    label={v.name}
                  />
                ))}
              </div>
              <p style={{ color: T3, fontSize: 11, marginTop: 6 }}>
                {tt(
                  'Un seul linktree par promoteur : ses soirées Yuno et externes y vivent ensemble.',
                  'One linktree per promoter: their Yuno and external events live on it together.'
                )}
              </p>
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
              {sending ? tt('Envoi…', 'Sending…') : tt("Envoyer l'invitation", 'Send invitation')}
            </PromoButton>
          </div>
        </PromoCard>
      )}

      {inviteGroups.length > 0 && (
        <div className="space-y-2">
          <SectionLabel>{tt('Invitations en attente', 'Pending invitations')}</SectionLabel>
          {inviteGroups.map(group => {
            const inv = group[0];
            const name = [inv.first_name, inv.last_name].filter(Boolean).join(' ').trim();
            const scopeBits: string[] = [];
            const yunoRows = group.filter(g => g.kind === 'yuno');
            if (yunoRows.length > 0) {
              scopeBits.push(yunoRows.map(r => r.venue_name || tt('Organisateur', 'Organizer')).join(', '));
            }
            const ext = group.find(g => g.kind === 'external');
            if (ext) {
              scopeBits.push(ext.scope_all
                ? tt('Tous les clubs externes', 'All external clubs')
                : `${ext.venue_count} ${tt('clubs externes', 'external clubs')}`);
            }
            const expiresAt = group.reduce<string | null>((min, g) =>
              g.expires_at && (!min || g.expires_at < min) ? g.expires_at : min, null);
            return (
              <PromoCard key={inv.email} style={{ padding: 12 }}>
                <div className="flex items-center gap-3">
                  <span
                    className="flex-none flex items-center justify-center"
                    style={{ width: 42, height: 42, borderRadius: '50%', background: INNER_BG, border: `1px solid ${BORDER}` }}
                  >
                    <Mail className="h-4 w-4" style={{ color: T3 }} />
                  </span>
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-2 flex-wrap">
                      <p className="truncate" style={{ color: T1, fontSize: 14, fontWeight: 640 }}>{name || inv.email}</p>
                      <PromoPill tone="warn">{tt('En attente', 'Pending')}</PromoPill>
                    </div>
                    <p className="truncate" style={{ color: T3, fontSize: 12 }}>{inv.email}</p>
                    {scopeBits.length > 0 && (
                      <p className="truncate" style={{ color: T3, fontSize: 11 }}>{scopeBits.join(' · ')}</p>
                    )}
                  </div>
                  <div className="flex-none text-right space-y-1">
                    {expiresAt && (
                      <p style={{ color: T3, fontSize: 11 }}>
                        {tt('Expire le', 'Expires')} {new Date(expiresAt).toLocaleDateString(language)}
                      </p>
                    )}
                    <button
                      onClick={() => handleRevoke(group)}
                      disabled={revoking === inv.email}
                      style={{ color: T3, fontSize: 12, textDecoration: 'underline', textUnderlineOffset: 3, cursor: 'pointer', background: 'none', border: 'none', padding: 0 }}
                    >
                      {revoking === inv.email ? tt('Révocation…', 'Revoking…') : tt('Révoquer', 'Revoke')}
                    </button>
                  </div>
                </div>
              </PromoCard>
            );
          })}
        </div>
      )}

      {loading ? (
        <div className="py-10 text-center" style={{ color: T3, fontSize: 13 }}>{tt('Chargement…', 'Loading…')}</div>
      ) : filtered.length === 0 ? (
        // Une invitation en attente au-dessus = l'équipe arrive : l'état vide
        // « Invitez votre premier promoteur » serait un contresens.
        inviteGroups.length === 0 ? (
          <PromoEmpty
            icon={Users}
            title={tt('Aucun promoteur', 'No promoters')}
            description={tt('Invitez votre premier promoteur.', 'Invite your first promoter.')}
          />
        ) : null
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
