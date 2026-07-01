import { useCallback, useEffect, useMemo, useState } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { usePromoterScope } from '@/hooks/usePromoterScope';
import { getScopeFilter, scopeReady } from '@/lib/promoterScopeHelpers';
import { useLanguage } from '@/contexts/LanguageContext';
import { translate } from '@/i18n/orgTranslate';
import { toast } from 'sonner';
import { Building2, PenLine, Wallet, Clock } from 'lucide-react';
import {
  PromoPage, PromoHeader, PromoCard, PromoButton, PromoEmpty, PromoPill, SectionLabel,
  T1, T2, T3, POS,
} from '@/components/promoter/promoter-ui';

const eur = (n: number) => `${(Number(n) || 0).toFixed(2)} €`;

type Contract = {
  id: string;
  agency_id: string;
  status: string;
  override_type: string | null;
  override_value: number;
  agency_signed_at: string | null;
  club_signed_at: string | null;
  agencies?: { name: string } | null;
};

/**
 * Club/organizer view of partner promoter agencies: accept & sign incoming
 * contracts, see what's owed to each agency, and settle (club → agency ledger).
 * Scope-aware (venue owner/manager OR organizer) via usePromoterScope.
 */
export default function OwnerAgencies() {
  const scope = usePromoterScope();
  const { language } = useLanguage();
  const tt = (fr: string, en: string) => translate(language, fr, en);

  const [contracts, setContracts] = useState<Contract[]>([]);
  const [owedByAgency, setOwedByAgency] = useState<Record<string, number>>({});
  const [loading, setLoading] = useState(true);
  const [acting, setActing] = useState<string | null>(null);

  const refetch = useCallback(async () => {
    if (!scopeReady(scope)) return;
    setLoading(true);
    const f = getScopeFilter(scope);
    const db = supabase as any;
    const [cRes, convRes] = await Promise.all([
      db.from('agency_venue_contracts').select('*, agencies(name)').eq(f.column, f.value).order('created_at', { ascending: false }),
      db.from('agency_conversions').select('agency_id, gross_amount, club_status').eq(f.column, f.value).eq('club_status', 'pending'),
    ]);
    setContracts((cRes.data as Contract[]) ?? []);
    const owed: Record<string, number> = {};
    for (const c of (convRes.data ?? []) as any[]) {
      owed[c.agency_id] = (owed[c.agency_id] || 0) + Number(c.gross_amount || 0);
    }
    setOwedByAgency(owed);
    setLoading(false);
  }, [scope]);

  useEffect(() => { refetch(); }, [refetch]);

  const marginLabel = (c: Contract) => {
    if (!c.override_type || !Number(c.override_value)) return tt('Aucune marge agence', 'No agency margin');
    return c.override_type === 'percentage' ? `+${c.override_value}%` : `+${Number(c.override_value).toFixed(2)}€/vente`;
  };

  const sign = async (id: string) => {
    setActing(id);
    const { data, error } = await (supabase as any).rpc('sign_agency_venue_contract', { p_contract_id: id });
    setActing(null);
    if (error) { toast.error(error.message); return; }
    toast.success(data === 'active' ? tt('Contrat actif', 'Contract active') : tt('Signé', 'Signed'));
    refetch();
  };

  const settle = async (agencyId: string) => {
    const f = getScopeFilter(scope);
    setActing(agencyId);
    const { data, error } = await (supabase as any).rpc('settle_club_to_agency', {
      p_agency_id: agencyId,
      p_venue_id: scope.kind === 'venue' ? f.value : null,
      p_organizer_user_id: scope.kind === 'organizer' ? f.value : null,
    });
    setActing(null);
    if (error) { toast.error(error.message); return; }
    if (data?.settled) toast.success(tt('Réglé', 'Settled') + ` — ${eur(data.amount)}`);
    else toast.info(tt('Rien à régler', 'Nothing to settle'));
    refetch();
  };

  return (
    <PromoPage>
      <PromoHeader title={tt('Agences partenaires', 'Partner agencies')} subtitle={tt('Agences de promoteurs qui travaillent avec vous', 'Promoter agencies working with you')} />
      {loading ? (
        <div className="py-16 text-center" style={{ color: T3, fontSize: 13 }}>{tt('Chargement…', 'Loading…')}</div>
      ) : contracts.length === 0 ? (
        <PromoEmpty icon={Building2} title={tt('Aucune agence', 'No agencies')} description={tt('Les propositions de contrat des agences apparaîtront ici.', 'Agency contract proposals will appear here.')} />
      ) : (
        <div className="space-y-2">
          {contracts.map((c) => {
            const awaitingClub = c.status === 'pending_signatures' && !c.club_signed_at;
            const awaitingAgency = c.status === 'pending_signatures' && c.club_signed_at && !c.agency_signed_at;
            const owed = owedByAgency[c.agency_id] || 0;
            return (
              <PromoCard key={c.id} style={{ padding: 12 }}>
                <div className="flex items-center gap-3">
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-2">
                      <p className="truncate" style={{ color: T1, fontSize: 14, fontWeight: 640 }}>{c.agencies?.name || tt('Agence', 'Agency')}</p>
                      {c.status === 'active' && <PromoPill tone="success">{tt('Actif', 'Active')}</PromoPill>}
                      {c.status === 'paused' && <PromoPill tone="warn">{tt('En pause', 'Paused')}</PromoPill>}
                      {awaitingClub && <PromoPill tone="warn">{tt('À accepter', 'To accept')}</PromoPill>}
                      {(c.status === 'ended' || c.status === 'cancelled') && <PromoPill tone="muted">{tt('Terminé', 'Ended')}</PromoPill>}
                    </div>
                    <p style={{ color: T3, fontSize: 11.5, marginTop: 2 }}>{marginLabel(c)}</p>
                  </div>
                  {c.status === 'active' && (
                    <div className="text-right flex-none">
                      <p style={{ color: owed > 0 ? POS : T3, fontSize: 14, fontWeight: 680 }}>{eur(owed)}</p>
                      <p style={{ color: T3, fontSize: 10 }}>{tt('à régler', 'to settle')}</p>
                    </div>
                  )}
                </div>
                <div className="mt-2 flex flex-wrap justify-end gap-2">
                  {awaitingClub && (
                    <PromoButton size="sm" onClick={() => sign(c.id)} disabled={acting === c.id}>
                      <PenLine className="h-3.5 w-3.5" /> {tt('Accepter & signer', 'Accept & sign')}
                    </PromoButton>
                  )}
                  {awaitingAgency && (
                    <span className="flex items-center gap-1.5" style={{ color: T3, fontSize: 12 }}>
                      <Clock className="h-3.5 w-3.5" /> {tt('En attente de l\'agence', 'Awaiting the agency')}
                    </span>
                  )}
                  {c.status === 'active' && owed > 0 && (
                    <PromoButton size="sm" variant="secondary" onClick={() => settle(c.agency_id)} disabled={acting === c.agency_id}>
                      <Wallet className="h-3.5 w-3.5" /> {tt(`Régler ${eur(owed)}`, `Settle ${eur(owed)}`)}
                    </PromoButton>
                  )}
                </div>
              </PromoCard>
            );
          })}
        </div>
      )}
    </PromoPage>
  );
}
