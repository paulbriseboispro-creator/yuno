import { useState } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { useAgency } from '@/hooks/useAgency';
import { useAgencyData, contractScopeLabel, AgencyContract } from '@/hooks/useAgencyData';
import { useLanguage } from '@/contexts/LanguageContext';
import { translate } from '@/i18n/orgTranslate';
import { toast } from 'sonner';
import { Building2, Plus, PenLine, Pause, Play, X, Clock } from 'lucide-react';
import {
  PromoCard, PromoButton, PromoEmpty, PromoPill, DarkInput, FieldLabel, SectionLabel,
  T1, T2, T3, RED, INNER_BG, BORDER,
} from '@/components/promoter/promoter-ui';

export default function AgencyClubs() {
  const { agency } = useAgency();
  const { contracts, loading, refetch } = useAgencyData(agency?.id ?? null);
  const { language } = useLanguage();
  const tt = (fr: string, en: string) => translate(language, fr, en);

  const [open, setOpen] = useState(false);
  const [clubId, setClubId] = useState('');
  const [marginType, setMarginType] = useState<'fixed' | 'percentage'>('fixed');
  const [marginValue, setMarginValue] = useState('');
  const [busy, setBusy] = useState(false);
  const [acting, setActing] = useState<string | null>(null);

  const statusPill = (c: AgencyContract) => {
    if (c.status === 'active') return <PromoPill tone="success">{tt('Actif', 'Active')}</PromoPill>;
    if (c.status === 'paused') return <PromoPill tone="warn">{tt('En pause', 'Paused')}</PromoPill>;
    if (c.status === 'ended' || c.status === 'cancelled') return <PromoPill tone="muted">{tt('Terminé', 'Ended')}</PromoPill>;
    return <PromoPill tone="warn">{tt('À signer', 'Pending')}</PromoPill>;
  };

  const marginLabel = (c: AgencyContract) => {
    if (!c.override_type || !Number(c.override_value)) return tt('Aucune marge', 'No margin');
    return c.override_type === 'percentage' ? `+${c.override_value}%` : `+${Number(c.override_value).toFixed(2)}€/vente`;
  };

  const propose = async () => {
    if (!clubId.trim()) { toast.error(tt('Identifiant du club requis', 'Club identifier required')); return; }
    setBusy(true);
    const { error } = await (supabase as any).rpc('create_agency_venue_contract', {
      p_agency_id: agency!.id,
      p_venue_id: clubId.trim(),
      p_organizer_user_id: null,
      p_override_type: Number(marginValue) > 0 ? marginType : null,
      p_override_value: Number(marginValue) || 0,
    });
    setBusy(false);
    if (error) { toast.error(error.message); return; }
    toast.success(tt('Proposition envoyée au club', 'Proposal sent to the club'));
    setClubId(''); setMarginValue(''); setOpen(false);
    refetch();
  };

  const sign = async (id: string) => {
    setActing(id);
    const { data, error } = await (supabase as any).rpc('sign_agency_venue_contract', { p_contract_id: id });
    setActing(null);
    if (error) { toast.error(error.message); return; }
    toast.success(data === 'active' ? tt('Contrat actif', 'Contract active') : tt('Signé — en attente du club', 'Signed — awaiting the club'));
    refetch();
  };

  const setStatus = async (id: string, status: string) => {
    setActing(id);
    const { error } = await (supabase as any).rpc('set_agency_contract_status', { p_contract_id: id, p_status: status });
    setActing(null);
    if (error) { toast.error(error.message); return; }
    refetch();
  };

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <SectionLabel>{tt('Clubs partenaires', 'Partner clubs')}</SectionLabel>
        <PromoButton size="sm" onClick={() => setOpen((v) => !v)}>
          <Plus className="h-4 w-4" /> {tt('Proposer', 'Propose')}
        </PromoButton>
      </div>

      {open && (
        <PromoCard>
          <SectionLabel>{tt('Proposer un contrat', 'Propose a contract')}</SectionLabel>
          <div className="mt-3 space-y-3">
            <div>
              <FieldLabel>{tt('Identifiant / slug du club', 'Club identifier / slug')}</FieldLabel>
              <DarkInput value={clubId} onChange={setClubId} placeholder={tt('ex. le-club-paris', 'e.g. le-club-paris')} />
            </div>
            <div>
              <FieldLabel>{tt('Votre marge par vente (payée par le club)', 'Your margin per sale (paid by the club)')}</FieldLabel>
              <div className="flex gap-2">
                <DarkInput value={marginValue} onChange={setMarginValue} placeholder="0" type="number" />
                <select
                  value={marginType}
                  onChange={(e) => setMarginType(e.target.value as 'fixed' | 'percentage')}
                  style={{ background: INNER_BG, border: `1px solid ${BORDER}`, borderRadius: 10, padding: '0 12px', color: T1, fontSize: 13 }}
                >
                  <option value="fixed" style={{ background: '#111' }}>€</option>
                  <option value="percentage" style={{ background: '#111' }}>%</option>
                </select>
              </div>
            </div>
            <PromoButton onClick={propose} disabled={busy} full>
              {busy ? tt('Envoi…', 'Sending…') : tt('Envoyer la proposition', 'Send proposal')}
            </PromoButton>
          </div>
        </PromoCard>
      )}

      {loading ? (
        <div className="py-10 text-center" style={{ color: T3, fontSize: 13 }}>{tt('Chargement…', 'Loading…')}</div>
      ) : contracts.length === 0 ? (
        <PromoEmpty icon={Building2} title={tt('Aucun club', 'No clubs')} description={tt('Proposez un contrat à un club ou attendez son invitation.', 'Propose a contract to a club or wait for its invitation.')} />
      ) : (
        <div className="space-y-2">
          {contracts.map((c) => {
            const awaitingAgency = c.status === 'pending_signatures' && !c.agency_signed_at;
            const awaitingClub = c.status === 'pending_signatures' && c.agency_signed_at && !c.club_signed_at;
            return (
              <PromoCard key={c.id} style={{ padding: 12 }}>
                <div className="flex items-center gap-3">
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-2">
                      <p className="truncate" style={{ color: T1, fontSize: 14, fontWeight: 640 }}>{contractScopeLabel(c)}</p>
                      {statusPill(c)}
                    </div>
                    <p style={{ color: T3, fontSize: 11.5, marginTop: 2 }}>{marginLabel(c)}</p>
                  </div>
                </div>
                <div className="mt-2 flex flex-wrap justify-end gap-2">
                  {awaitingAgency && (
                    <PromoButton size="sm" onClick={() => sign(c.id)} disabled={acting === c.id}>
                      <PenLine className="h-3.5 w-3.5" /> {tt('Signer', 'Sign')}
                    </PromoButton>
                  )}
                  {awaitingClub && (
                    <span className="flex items-center gap-1.5" style={{ color: T3, fontSize: 12 }}>
                      <Clock className="h-3.5 w-3.5" /> {tt('En attente du club', 'Awaiting the club')}
                    </span>
                  )}
                  {c.status === 'active' && (
                    <PromoButton size="sm" variant="ghost" onClick={() => setStatus(c.id, 'paused')} disabled={acting === c.id}>
                      <Pause className="h-3.5 w-3.5" /> {tt('Mettre en pause', 'Pause')}
                    </PromoButton>
                  )}
                  {c.status === 'paused' && (
                    <PromoButton size="sm" variant="secondary" onClick={() => setStatus(c.id, 'active')} disabled={acting === c.id}>
                      <Play className="h-3.5 w-3.5" /> {tt('Réactiver', 'Resume')}
                    </PromoButton>
                  )}
                  {(c.status === 'active' || c.status === 'paused') && (
                    <PromoButton size="sm" variant="danger" onClick={() => setStatus(c.id, 'ended')} disabled={acting === c.id}>
                      <X className="h-3.5 w-3.5" /> {tt('Terminer', 'End')}
                    </PromoButton>
                  )}
                </div>
              </PromoCard>
            );
          })}
        </div>
      )}
    </div>
  );
}
