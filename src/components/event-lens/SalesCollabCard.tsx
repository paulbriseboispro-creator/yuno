/**
 * Rapport de soirée › « Qui a fait vendre ? » — soirée à plusieurs seulement.
 * Le résumé de ce que chaque partie (club, organisateur, co-hôtes) a amené :
 * la part du public en barre, puis une ligne par partie. Le détail (clics,
 * entrées, pas à pas) reste dans la page « Qui fait vendre ? » de la
 * collaboration : un lien y mène, on ne le recopie pas. Une attribution,
 * jamais un partage d'argent (celui-là vit dans le contrat et le décompte).
 */
import { Link } from 'react-router-dom';
import { ArrowRight } from 'lucide-react';
import { useLanguage } from '@/contexts/LanguageContext';
import { StackBar } from '@/components/analytics/kit';
import { KIT, pctFmt, useNumberFormat } from '@/components/analytics/kitFormat';
import { CardTitle, Question, ReportCard } from '@/components/event-report/ui';
import { attributionCoverage, peopleOf, shareOf, type PartyBreakdown } from '@/lib/collabPartyBreakdown';
import { PartyChip } from './PartyChip';

const PALETTE = [KIT.RED, 'rgb(var(--ink)/0.55)', '#F2B23C', '#38BDF8', '#A78BFA'];

export function SalesCollabCard({ breakdown, eventId, consolePrefix }: { breakdown: PartyBreakdown; eventId: string; consolePrefix: string }) {
  const { t } = useLanguage();
  const { n, eur, locale } = useNumberFormat();
  const coverage = attributionCoverage(breakdown);
  const detailHref = consolePrefix === '/owner' ? `/owner/collab/event/${eventId}/partners` : `/organizer-app/events/${eventId}/partners`;
  return (
    <>
      <Question id="er-parties" title={t('evl.sales.q.parties')} sub={t('evl.sales.q.partiesSub')} />
      <ReportCard>
        <CardTitle
          title={t('evl.sales.partiesTitle')}
          hint={t('evl.sales.hint.parties')}
          right={(
            <Link to={detailHref} className="inline-flex items-center gap-1.5 text-[12px] font-medium" style={{ color: KIT.T2 }}>
              {t('evl.sales.partiesDetail')} <ArrowRight className="h-3.5 w-3.5" aria-hidden />
            </Link>
          )}
        />
        {coverage.total > 0 && (
          <div className="mb-5">
            <StackBar
              format={n}
              parts={[
                ...breakdown.parties.map((p, i) => ({ key: p.party, label: p.name, value: peopleOf(p), color: PALETTE[i % PALETTE.length] })),
                { key: 'none', label: t('evl.sales.unattributed'), value: peopleOf(breakdown.unattributed), color: 'rgb(var(--ink)/0.16)' },
              ]}
            />
          </div>
        )}
        <ul className="divide-y" style={{ borderColor: 'rgb(var(--ink)/0.055)' }}>
          {breakdown.parties.map((p) => {
            const share = shareOf(p, breakdown.totals);
            return (
              <li key={p.party} className="flex flex-wrap items-center justify-between gap-x-6 gap-y-1 py-2.5" style={{ borderColor: 'rgb(var(--ink)/0.055)' }}>
                <PartyChip name={p.name} avatar={p.avatar_url} role={p.role} mine={p.mine} />
                <span className="flex items-baseline gap-4 tabular-nums" style={{ fontSize: 13 }}>
                  <span style={{ color: KIT.T1 }}>{t('evl.sales.partyPeople').replace('{n}', n(peopleOf(p)))}</span>
                  {share !== null && <span style={{ color: KIT.T3 }}>{pctFmt(share, locale)}</span>}
                  {breakdown.money && p.revenue != null && <span style={{ color: KIT.T1, fontWeight: 600 }}>{eur(p.revenue)}</span>}
                </span>
              </li>
            );
          })}
        </ul>
        {coverage.total > 0 && coverage.known < coverage.total && (
          <p className="mt-3" style={{ color: KIT.T3, fontSize: 11.5 }}>
            {t('evl.sales.coverage').replace('{known}', n(coverage.known)).replace('{total}', n(coverage.total))}
          </p>
        )}
      </ReportCard>
    </>
  );
}
