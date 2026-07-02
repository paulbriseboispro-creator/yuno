import { useMemo, useState } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { useAgency } from '@/hooks/useAgency';
import { useAgencyData, promoterName } from '@/hooks/useAgencyData';
import { useLanguage } from '@/contexts/LanguageContext';
import { translate } from '@/i18n/orgTranslate';
import { toast } from 'sonner';
import { ArrowDownLeft, ArrowUpRight, TrendingUp, ChevronDown, ChevronUp, Wallet, Copy } from 'lucide-react';
import {
  PromoCard, StatTile, SectionLabel, PromoEmpty, PromoButton,
  T1, T2, T3, POS, WARN,
} from '@/components/promoter/promoter-ui';

const eur = (n: number) => `${(Number(n) || 0).toFixed(2)} €`;

export default function AgencyFinance() {
  const { agency } = useAgency();
  const { promoters, contracts, conversions, totals, loading, refetch } = useAgencyData(agency?.id ?? null);
  const { language } = useLanguage();
  const tt = (fr: string, en: string) => translate(language, fr, en);
  const [settling, setSettling] = useState<string | null>(null);
  const [settlingAll, setSettlingAll] = useState(false);
  const [expandedClub, setExpandedClub] = useState<string | null>(null);

  const venueName = (venueId: string | null, orgId: string | null) => {
    if (venueId) return contracts.find(c => c.venue_id === venueId)?.venues?.name || venueId;
    if (orgId) return tt('Organisateur', 'Organizer');
    return tt('Club', 'Club');
  };

  const receivables = useMemo(() => {
    const map = new Map<string, { amount: number; conversions: typeof conversions }>();
    for (const c of conversions) {
      if (c.club_status !== 'pending') continue;
      const key = c.venue_id || c.organizer_user_id || 'unknown';
      if (!map.has(key)) map.set(key, { amount: 0, conversions: [] });
      const entry = map.get(key)!;
      entry.amount += Number(c.gross_amount || 0);
      entry.conversions.push(c);
    }
    return [...map.entries()]
      .map(([key, { amount, conversions: convs }]) => ({
        key,
        amount,
        label: venueName(key === 'unknown' ? null : key, null),
        contact: contracts.find(c => c.venue_id === key || c.organizer_user_id === key),
        convs,
      }))
      .sort((a, b) => b.amount - a.amount);
  }, [conversions, contracts, language]);

  const payables = promoters
    .filter(p => Number(p.pending_amount) > 0)
    .sort((a, b) => Number(b.pending_amount) - Number(a.pending_amount));

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

  const handleSettleAll = async () => {
    if (payables.length === 0) return;
    setSettlingAll(true);
    let count = 0;
    for (const p of payables) {
      const { data } = await (supabase as any).rpc('settle_agency_promoter_payout', { p_promoter_id: p.id });
      if (data?.settled) count++;
    }
    setSettlingAll(false);
    toast.success(`${count} promoteur${count > 1 ? 's' : ''} ${tt('réglé(s)', 'settled')}`);
    refetch();
  };

  if (loading) {
    return <div className="py-16 text-center" style={{ color: T3, fontSize: 13 }}>{tt('Chargement…', 'Loading…')}</div>;
  }

  return (
    <div className="space-y-4">
      <div className="grid grid-cols-3 gap-3">
        <StatTile icon={ArrowDownLeft} value={eur(totals.receivableFromClubs)} label={tt('Dû par les clubs', 'Owed by clubs')} tone="pos" />
        <StatTile icon={ArrowUpRight} value={eur(totals.payableToPromoters)} label={tt('Dû aux promoteurs', 'Owed to promoters')} tone="warn" />
        <StatTile icon={TrendingUp} value={eur(totals.marginRealized)} label={tt('Marge agence', 'Agency margin')} />
      </div>

      {/* Receivables from clubs */}
      <SectionLabel>{tt('À recevoir des clubs', 'Receivable from clubs')}</SectionLabel>
      {receivables.length === 0 ? (
        <PromoEmpty
          icon={ArrowDownLeft}
          title={tt('Rien en attente', 'Nothing pending')}
          description={tt('Les clubs sont à jour de leurs règlements.', 'Clubs are settled up.')}
        />
      ) : (
        <div className="space-y-2">
          {receivables.map(r => (
            <PromoCard key={r.key} style={{ padding: 0, overflow: 'hidden' }}>
              <button
                onClick={() => setExpandedClub(expandedClub === r.key ? null : r.key)}
                className="w-full flex items-center justify-between"
                style={{ padding: '12px 14px', cursor: 'pointer', background: 'none', outline: 'none', textAlign: 'left' }}
              >
                <span style={{ color: T1, fontSize: 13.5, fontWeight: 600 }}>{r.label}</span>
                <div className="flex items-center gap-3">
                  <span style={{ color: POS, fontSize: 14, fontWeight: 680 }}>{eur(r.amount)}</span>
                  {expandedClub === r.key
                    ? <ChevronUp className="h-4 w-4" style={{ color: T3 }} />
                    : <ChevronDown className="h-4 w-4" style={{ color: T3 }} />
                  }
                </div>
              </button>
              {expandedClub === r.key && (
                <div style={{ borderTop: '1px solid rgba(255,255,255,0.05)', padding: '8px 14px 12px' }}>
                  <div className="space-y-1 mb-3">
                    {r.convs.slice(0, 10).map(c => (
                      <div key={c.id} className="flex justify-between" style={{ fontSize: 12 }}>
                        <span style={{ color: T3 }}>
                          {new Date(c.created_at).toLocaleDateString(language === 'fr' ? 'fr-FR' : 'en-GB', { day: '2-digit', month: 'short' })}
                        </span>
                        <span style={{ color: T2 }}>{eur(c.gross_amount)}</span>
                      </div>
                    ))}
                    {r.convs.length > 10 && (
                      <p style={{ color: T3, fontSize: 11 }}>
                        +{r.convs.length - 10} {tt('autres', 'more')}
                      </p>
                    )}
                  </div>
                  {r.contact?.contact_email || agency?.contact_email ? (
                    <button
                      onClick={() => {
                        const email = agency!.contact_email || '';
                        navigator.clipboard.writeText(email);
                        toast.success(tt('Email copié', 'Email copied'));
                      }}
                      style={{ color: T3, fontSize: 11, cursor: 'pointer', background: 'none', border: 'none', display: 'flex', alignItems: 'center', gap: 4 }}
                    >
                      <Copy className="h-3 w-3" />
                      {tt('Le club règle depuis son dashboard. Copier votre email de contact pour le relancer.', 'The club settles from their dashboard. Copy your contact email to remind them.')}
                    </button>
                  ) : (
                    <p style={{ color: T3, fontSize: 11 }}>
                      {tt('Le club règle l\'agence depuis son propre tableau de bord.', 'Clubs settle the agency from their own dashboard.')}
                    </p>
                  )}
                </div>
              )}
            </PromoCard>
          ))}
        </div>
      )}

      {/* Payables to promoters */}
      <div className="flex items-center justify-between">
        <SectionLabel>{tt('À reverser aux promoteurs', 'Payable to promoters')}</SectionLabel>
        {payables.length > 1 && (
          <PromoButton size="sm" variant="secondary" onClick={handleSettleAll} disabled={settlingAll}>
            <Wallet className="h-3.5 w-3.5" />
            {settlingAll ? tt('Règlement…', 'Settling…') : tt('Tout régler', 'Settle all')}
          </PromoButton>
        )}
      </div>
      {payables.length === 0 ? (
        <PromoEmpty
          icon={ArrowUpRight}
          title={tt('Rien à reverser', 'Nothing to pay out')}
          description={tt('Vos promoteurs sont à jour.', 'Your promoters are settled up.')}
        />
      ) : (
        <PromoCard style={{ padding: 8 }}>
          {payables.map((p, i) => (
            <div
              key={p.id}
              className="flex items-center gap-3"
              style={{ padding: '11px 8px', borderBottom: i < payables.length - 1 ? '1px solid rgba(255,255,255,0.05)' : undefined }}
            >
              <div className="min-w-0 flex-1">
                <p className="truncate" style={{ color: T1, fontSize: 13.5, fontWeight: 600 }}>{promoterName(p)}</p>
                <p className="truncate" style={{ color: T3, fontSize: 11 }}>
                  {p.venues?.name || tt('Multi-venue', 'Multi-venue')}
                </p>
              </div>
              <span style={{ color: WARN, fontSize: 14, fontWeight: 680, marginRight: 8 }}>
                {eur(p.pending_amount)}
              </span>
              <PromoButton
                size="sm"
                variant="secondary"
                onClick={() => handleSettle(p.id)}
                disabled={settling === p.id}
              >
                <Wallet className="h-3.5 w-3.5" />
                {settling === p.id ? tt('…', '…') : tt('Régler', 'Settle')}
              </PromoButton>
            </div>
          ))}
        </PromoCard>
      )}
    </div>
  );
}
