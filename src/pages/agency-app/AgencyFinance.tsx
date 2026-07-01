import { useMemo } from 'react';
import { useAgency } from '@/hooks/useAgency';
import { useAgencyData, promoterName } from '@/hooks/useAgencyData';
import { useLanguage } from '@/contexts/LanguageContext';
import { translate } from '@/i18n/orgTranslate';
import { ArrowDownLeft, ArrowUpRight, TrendingUp } from 'lucide-react';
import {
  PromoCard, StatTile, SectionLabel, PromoEmpty, PromoPill,
  T1, T3, POS, WARN,
} from '@/components/promoter/promoter-ui';

const eur = (n: number) => `${(Number(n) || 0).toFixed(2)} €`;

export default function AgencyFinance() {
  const { agency } = useAgency();
  const { promoters, contracts, conversions, totals, loading } = useAgencyData(agency?.id ?? null);
  const { language } = useLanguage();
  const tt = (fr: string, en: string) => translate(language, fr, en);

  const venueName = (venueId: string | null, orgId: string | null) => {
    if (venueId) return contracts.find((c) => c.venue_id === venueId)?.venues?.name || venueId;
    if (orgId) return tt('Organisateur', 'Organizer');
    return tt('Club', 'Club');
  };

  // Receivable grouped by club (gross pending, i.e. not yet settled by the club).
  const receivables = useMemo(() => {
    const map = new Map<string, number>();
    for (const c of conversions) {
      if (c.club_status !== 'pending') continue;
      const key = c.venue_id || c.organizer_user_id || 'unknown';
      map.set(key, (map.get(key) || 0) + Number(c.gross_amount || 0));
    }
    return [...map.entries()]
      .map(([key, amount]) => ({ key, amount, label: venueName(key, null) }))
      .sort((a, b) => b.amount - a.amount);
  }, [conversions, contracts, language]);

  const payables = promoters.filter((p) => Number(p.pending_amount) > 0).sort((a, b) => Number(b.pending_amount) - Number(a.pending_amount));

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
        <PromoEmpty icon={ArrowDownLeft} title={tt('Rien en attente', 'Nothing pending')} description={tt('Les clubs sont à jour de leurs règlements.', 'Clubs are settled up.')} />
      ) : (
        <PromoCard style={{ padding: 8 }}>
          {receivables.map((r, i) => (
            <div key={r.key} className="flex items-center justify-between" style={{ padding: '11px 8px', borderBottom: i < receivables.length - 1 ? '1px solid rgba(255,255,255,0.05)' : undefined }}>
              <span className="truncate" style={{ color: T1, fontSize: 13.5, fontWeight: 600 }}>{r.label}</span>
              <span style={{ color: POS, fontSize: 14, fontWeight: 680 }}>{eur(r.amount)}</span>
            </div>
          ))}
          <p style={{ color: T3, fontSize: 11, padding: '8px 8px 2px' }}>
            {tt('Le club règle l\'agence depuis son propre tableau de bord.', 'Clubs settle the agency from their own dashboard.')}
          </p>
        </PromoCard>
      )}

      {/* Payables to promoters */}
      <SectionLabel>{tt('À reverser aux promoteurs', 'Payable to promoters')}</SectionLabel>
      {payables.length === 0 ? (
        <PromoEmpty icon={ArrowUpRight} title={tt('Rien à reverser', 'Nothing to pay out')} description={tt('Vos promoteurs sont à jour.', 'Your promoters are settled up.')} />
      ) : (
        <PromoCard style={{ padding: 8 }}>
          {payables.map((p, i) => (
            <div key={p.id} className="flex items-center justify-between" style={{ padding: '11px 8px', borderBottom: i < payables.length - 1 ? '1px solid rgba(255,255,255,0.05)' : undefined }}>
              <div className="min-w-0">
                <p className="truncate" style={{ color: T1, fontSize: 13.5, fontWeight: 600 }}>{promoterName(p)}</p>
                <p className="truncate" style={{ color: T3, fontSize: 11 }}>{p.venues?.name || tt('Multi-club', 'Multi-venue')}</p>
              </div>
              <span style={{ color: WARN, fontSize: 14, fontWeight: 680 }}>{eur(p.pending_amount)}</span>
            </div>
          ))}
          <p style={{ color: T3, fontSize: 11, padding: '8px 8px 2px' }}>
            {tt('Réglez vos promoteurs depuis l\'onglet Promoteurs.', 'Settle your promoters from the Promoters tab.')}
          </p>
        </PromoCard>
      )}
    </div>
  );
}
