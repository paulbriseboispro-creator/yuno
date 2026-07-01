import { useState } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { useAgency } from '@/hooks/useAgency';
import { useAgencyData, promoterName, contractScopeLabel, AgencyContract } from '@/hooks/useAgencyData';
import { useLanguage } from '@/contexts/LanguageContext';
import { translate } from '@/i18n/orgTranslate';
import { toast } from 'sonner';
import { UserPlus, Users, Mail, Wallet } from 'lucide-react';
import {
  PromoCard, PromoButton, PromoEmpty, PromoAvatar, PromoPill, DarkInput, FieldLabel, SectionLabel,
  T1, T2, T3, RED, POS, INNER_BG, BORDER,
} from '@/components/promoter/promoter-ui';

const eur = (n: number) => `${(Number(n) || 0).toFixed(2)} €`;

export default function AgencyRoster() {
  const { agency } = useAgency();
  const { promoters, contracts, loading, refetch } = useAgencyData(agency?.id ?? null);
  const { language } = useLanguage();
  const tt = (fr: string, en: string) => translate(language, fr, en);

  const [inviteOpen, setInviteOpen] = useState(false);
  const [email, setEmail] = useState('');
  const [firstName, setFirstName] = useState('');
  const [contractId, setContractId] = useState('');
  const [ticketValue, setTicketValue] = useState('');
  const [ticketType, setTicketType] = useState<'fixed' | 'percentage'>('fixed');
  const [sending, setSending] = useState(false);
  const [settling, setSettling] = useState<string | null>(null);

  const activeContracts = contracts.filter((c) => c.status === 'active');

  const handleInvite = async () => {
    const contract = activeContracts.find((c) => c.id === contractId);
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
          table_commission_type: ticketType,
          table_commission_value: Number(ticketValue) || 0,
        },
      },
    });
    setSending(false);
    if (error || (data as any)?.error) {
      toast.error((data as any)?.error || error?.message || tt('Échec de l\'invitation', 'Invite failed'));
      return;
    }
    toast.success(tt('Invitation envoyée', 'Invitation sent'));
    setEmail(''); setFirstName(''); setTicketValue(''); setInviteOpen(false);
    refetch();
  };

  const handleSettle = async (promoterId: string) => {
    setSettling(promoterId);
    const { data, error } = await (supabase as any).rpc('settle_agency_promoter_payout', { p_promoter_id: promoterId });
    setSettling(null);
    if (error) { toast.error(error.message); return; }
    if (data?.settled) toast.success(tt('Réglé', 'Settled') + ` — ${eur(data.amount)}`);
    else toast.info(tt('Rien à régler', 'Nothing to settle'));
    refetch();
  };

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <SectionLabel>{tt('Mes promoteurs', 'My promoters')}</SectionLabel>
        <PromoButton size="sm" onClick={() => setInviteOpen((v) => !v)} disabled={activeContracts.length === 0}>
          <UserPlus className="h-4 w-4" /> {tt('Inviter', 'Invite')}
        </PromoButton>
      </div>

      {activeContracts.length === 0 && (
        <p style={{ color: T3, fontSize: 12 }}>
          {tt('Signez d\'abord un contrat actif avec un club pour recruter des promoteurs.', 'Sign an active contract with a club first to recruit promoters.')}
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
                onChange={(e) => setContractId(e.target.value)}
                className="w-full outline-none"
                style={{ background: INNER_BG, border: `1px solid ${BORDER}`, borderRadius: 10, padding: '9px 12px', color: T1, fontSize: 13.5 }}
              >
                <option value="" style={{ background: '#111' }}>{tt('Choisir un club…', 'Choose a club…')}</option>
                {activeContracts.map((c) => (
                  <option key={c.id} value={c.id} style={{ background: '#111' }}>{contractScopeLabel(c)}</option>
                ))}
              </select>
            </div>
            <div>
              <FieldLabel>{tt('Commission promoteur (net qu\'il touche)', 'Promoter commission (net they earn)')}</FieldLabel>
              <div className="flex gap-2">
                <DarkInput value={ticketValue} onChange={setTicketValue} placeholder="0" type="number" />
                <select
                  value={ticketType}
                  onChange={(e) => setTicketType(e.target.value as 'fixed' | 'percentage')}
                  style={{ background: INNER_BG, border: `1px solid ${BORDER}`, borderRadius: 10, padding: '0 12px', color: T1, fontSize: 13 }}
                >
                  <option value="fixed" style={{ background: '#111' }}>€</option>
                  <option value="percentage" style={{ background: '#111' }}>%</option>
                </select>
              </div>
            </div>
            <PromoButton onClick={handleInvite} disabled={sending} full>
              {sending ? tt('Envoi…', 'Sending…') : tt('Envoyer l\'invitation', 'Send invitation')}
            </PromoButton>
          </div>
        </PromoCard>
      )}

      {loading ? (
        <div className="py-10 text-center" style={{ color: T3, fontSize: 13 }}>{tt('Chargement…', 'Loading…')}</div>
      ) : promoters.length === 0 ? (
        <PromoEmpty icon={Users} title={tt('Aucun promoteur', 'No promoters')} description={tt('Invitez votre premier promoteur.', 'Invite your first promoter.')} />
      ) : (
        <div className="space-y-2">
          {promoters.map((p) => (
            <PromoCard key={p.id} style={{ padding: 12 }}>
              <div className="flex items-center gap-3">
                <PromoAvatar src={p.profile_image_url} fallback={promoterName(p).slice(0, 1)} size={40} />
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-2">
                    <p className="truncate" style={{ color: T1, fontSize: 14, fontWeight: 640 }}>{promoterName(p)}</p>
                    {!p.is_active && <PromoPill tone="muted">{tt('Inactif', 'Inactive')}</PromoPill>}
                  </div>
                  <p className="truncate" style={{ color: T3, fontSize: 11.5 }}>
                    {(p.venues?.name || tt('Multi-club', 'Multi-venue'))} · {p.promo_code}
                  </p>
                </div>
                <div className="text-right flex-none">
                  <p style={{ color: Number(p.pending_amount) > 0 ? POS : T3, fontSize: 14, fontWeight: 680 }}>{eur(p.pending_amount)}</p>
                  <p style={{ color: T3, fontSize: 10 }}>{tt('à reverser', 'to pay')}</p>
                </div>
              </div>
              {Number(p.pending_amount) > 0 && (
                <div className="mt-2 flex justify-end">
                  <PromoButton size="sm" variant="secondary" onClick={() => handleSettle(p.id)} disabled={settling === p.id}>
                    <Wallet className="h-3.5 w-3.5" /> {settling === p.id ? tt('Règlement…', 'Settling…') : tt(`Reverser ${eur(p.pending_amount)}`, `Pay ${eur(p.pending_amount)}`)}
                  </PromoButton>
                </div>
              )}
            </PromoCard>
          ))}
        </div>
      )}
    </div>
  );
}
