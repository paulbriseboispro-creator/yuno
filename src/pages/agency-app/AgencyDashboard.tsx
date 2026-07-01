import { useMemo } from 'react';
import { useAgency } from '@/hooks/useAgency';
import { useAgencyData, promoterName, AgencyPromoter } from '@/hooks/useAgencyData';
import { useLanguage } from '@/contexts/LanguageContext';
import { translate } from '@/i18n/orgTranslate';
import { Wallet, TrendingUp, Users, Building2, ArrowDownLeft, ArrowUpRight, Trophy } from 'lucide-react';
import {
  PromoCard, StatTile, SectionLabel, PromoEmpty, PromoAvatar, PromoPill,
  T1, T2, T3, RED, POS, WARN,
} from '@/components/promoter/promoter-ui';

const eur = (n: number) => `${(Number(n) || 0).toFixed(2)} €`;

export default function AgencyDashboard() {
  const { agency } = useAgency();
  const { promoters, conversions, totals, loading } = useAgencyData(agency?.id ?? null);
  const { language } = useLanguage();
  const tt = (fr: string, en: string) => translate(language, fr, en);

  // Leaderboard: promoters ranked by gross generated (from agency_conversions).
  const leaderboard = useMemo(() => {
    const byPromoter = new Map<string, number>();
    for (const c of conversions) {
      if (!c.promoter_id) continue;
      byPromoter.set(c.promoter_id, (byPromoter.get(c.promoter_id) || 0) + Number(c.gross_amount || 0));
    }
    return promoters
      .map((p) => ({ p, gross: byPromoter.get(p.id) || 0 }))
      .sort((a, b) => b.gross - a.gross)
      .slice(0, 6);
  }, [promoters, conversions]);

  if (loading) {
    return <div className="py-16 text-center" style={{ color: T3, fontSize: 13 }}>{tt('Chargement…', 'Loading…')}</div>;
  }

  return (
    <div className="space-y-4">
      {/* Money strip */}
      <div className="grid grid-cols-2 gap-3">
        <PromoCard>
          <div className="flex items-center gap-2" style={{ color: T3, fontSize: 11, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.06em' }}>
            <ArrowDownLeft className="h-3.5 w-3.5" style={{ color: POS }} />
            {tt('À recevoir des clubs', 'Owed by clubs')}
          </div>
          <p style={{ color: POS, fontSize: 26, fontWeight: 740, letterSpacing: '-0.02em', marginTop: 6 }}>{eur(totals.receivableFromClubs)}</p>
        </PromoCard>
        <PromoCard>
          <div className="flex items-center gap-2" style={{ color: T3, fontSize: 11, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.06em' }}>
            <ArrowUpRight className="h-3.5 w-3.5" style={{ color: WARN }} />
            {tt('À reverser aux promoteurs', 'Owed to promoters')}
          </div>
          <p style={{ color: WARN, fontSize: 26, fontWeight: 740, letterSpacing: '-0.02em', marginTop: 6 }}>{eur(totals.payableToPromoters)}</p>
        </PromoCard>
      </div>

      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        <StatTile icon={TrendingUp} value={eur(totals.marginRealized)} label={tt('Marge agence', 'Agency margin')} tone="pos" />
        <StatTile icon={Wallet} value={eur(totals.grossLifetime)} label={tt('Volume total', 'Total volume')} />
        <StatTile icon={Users} value={totals.rosterCount} label={tt('Promoteurs', 'Promoters')} />
        <StatTile icon={Building2} value={totals.activeClubs} label={tt('Clubs actifs', 'Active clubs')} />
      </div>

      {/* Leaderboard */}
      <SectionLabel>{tt('Classement promoteurs', 'Promoter leaderboard')}</SectionLabel>
      {leaderboard.length === 0 || leaderboard.every((l) => l.gross === 0) ? (
        <PromoEmpty
          icon={Trophy}
          title={tt('Pas encore de ventes', 'No sales yet')}
          description={tt('Les performances de vos promoteurs apparaîtront ici.', "Your promoters' performance will show up here.")}
        />
      ) : (
        <PromoCard style={{ padding: 8 }}>
          {leaderboard.map(({ p, gross }, i) => (
            <div key={p.id} className="flex items-center gap-3" style={{ padding: '10px 8px', borderBottom: i < leaderboard.length - 1 ? '1px solid rgba(255,255,255,0.05)' : undefined }}>
              <span style={{ color: i === 0 ? RED : T3, fontSize: 13, fontWeight: 700, width: 18, textAlign: 'center' }}>{i + 1}</span>
              <PromoAvatar src={p.profile_image_url} fallback={promoterName(p).slice(0, 1)} size={34} />
              <div className="min-w-0 flex-1">
                <p className="truncate" style={{ color: T1, fontSize: 13.5, fontWeight: 600 }}>{promoterName(p)}</p>
                <p className="truncate" style={{ color: T3, fontSize: 11 }}>{p.venues?.name || tt('Multi-club', 'Multi-venue')}</p>
              </div>
              <span style={{ color: T1, fontSize: 13.5, fontWeight: 680 }}>{eur(gross)}</span>
            </div>
          ))}
        </PromoCard>
      )}
    </div>
  );
}
