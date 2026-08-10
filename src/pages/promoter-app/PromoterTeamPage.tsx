import { motion } from 'framer-motion';
import { Users, Crown } from 'lucide-react';
import { useLanguage } from '@/contexts/LanguageContext';
import { translate } from '@/i18n/orgTranslate';
import { usePromoterData } from '@/contexts/PromoterDataContext';
import { PromoterPage, PromoHeading } from '@/components/promoter/promoter-app-shell';
import {
  PromoPCard, PromoPill, PromoEmpty, StatTile,
  RED, T1, T2, T3, BORDER, INNER_BG,
} from '@/components/promoter/promoter-ui';

export default function PromoterTeamPage() {
  const { language } = useLanguage();
  const tt = (fr: string, en: string, es?: string) => translate(language, fr, en, es);
  const { promoter, teamInfo, teamMembers } = usePromoterData();

  if (!promoter) return null;

  if (!teamInfo) {
    return (
      <PromoterPage maxWidth={860}>
        <PromoHeading title={tt('Équipe', 'Team', 'Equipo')} />
        <PromoEmpty
          icon={Users}
          title={tt('Pas d’équipe', 'No team', 'Sin equipo')}
          description={tt('Tu ne fais partie d’aucune équipe pour cette portée.', 'You are not part of a team for this scope.', 'No formas parte de ningún equipo en este ámbito.')}
        />
      </PromoterPage>
    );
  }

  const totals = teamMembers.reduce(
    (acc, m) => ({ sales: acc.sales + m.conversions, revenue: acc.revenue + m.revenue, commission: acc.commission + m.commission }),
    { sales: 0, revenue: 0, commission: 0 },
  );

  return (
    <PromoterPage maxWidth={860}>
      <PromoHeading
        title={teamInfo.name}
        subtitle={`${teamInfo.memberCount} ${tt('membres', 'members', 'miembros')}`}
        right={teamInfo.isLeader ? (
          <PromoPill tone="red" style={{ fontSize: 12, padding: '4px 10px' }}>
            <Crown className="h-3 w-3 inline mr-1 -mt-0.5" />
            {tt("Chef d'équipe", 'Team leader', 'Jefe de equipo')}
          </PromoPill>
        ) : undefined}
      />

      {!teamInfo.isLeader ? (
        <PromoPCard icon={<Users className="w-4 h-4" />} title={teamInfo.name} sub={`${teamInfo.memberCount} ${tt('membres', 'members', 'miembros')}`}>
          {teamInfo.leaderName && (
            <p className="text-sm flex items-center gap-1.5 truncate" style={{ color: T2 }}>
              <Crown className="h-4 w-4 shrink-0" style={{ color: RED }} />
              {tt("Chef d'équipe", 'Team leader', 'Jefe de equipo')} : {teamInfo.leaderName}
            </p>
          )}
        </PromoPCard>
      ) : (
        <>
          <motion.div initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }}
            className="grid grid-cols-3 gap-3">
            <StatTile value={totals.sales} label={tt('Ventes', 'Sales', 'Ventas')} />
            <StatTile value={`${totals.revenue.toFixed(0)}€`} label={tt('CA total', 'Total revenue', 'Ingresos totales')} />
            <StatTile value={`${totals.commission.toFixed(0)}€`} label={tt('Commission', 'Commission', 'Comisión')} accent />
          </motion.div>

          <motion.div initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.05 }}>
            <PromoPCard icon={<Users className="w-4 h-4" />} title={tt('Classement', 'Leaderboard', 'Clasificación')} sub={tt('Performance de ton équipe', 'Your team’s performance', 'El rendimiento de tu equipo')}>
              <div className="space-y-2">
                {teamMembers.map((m, idx) => (
                  <motion.div
                    key={m.id}
                    initial={{ opacity: 0, x: -8 }}
                    animate={{ opacity: 1, x: 0 }}
                    transition={{ delay: Math.min(idx * 0.04, 0.3) }}
                    className="rounded-xl px-3.5 py-3"
                    style={{ background: INNER_BG, border: `1px solid ${BORDER}` }}
                  >
                    <div className="flex items-center gap-2 mb-2">
                      <span className="shrink-0 text-xs font-bold tabular-nums" style={{ color: idx === 0 ? RED : T3 }}>
                        {String(idx + 1).padStart(2, '0')}
                      </span>
                      <span className="min-w-0 flex-1 truncate text-sm font-medium" style={{ color: T1 }}>{m.label}</span>
                      {m.id === promoter.id && (
                        <PromoPill tone="red">
                          <Crown className="h-2.5 w-2.5 inline mr-0.5 -mt-0.5" />
                          {tt('Toi', 'You', 'Tú')}
                        </PromoPill>
                      )}
                    </div>
                    <div className="grid grid-cols-4 gap-2 text-center">
                      <div className="min-w-0">
                        <p className="truncate text-xs font-bold tabular-nums" style={{ color: T1 }}>{m.clicks}</p>
                        <p className="truncate text-[9px]" style={{ color: T3 }}>{tt('Clics', 'Clicks', 'Clics')}</p>
                      </div>
                      <div className="min-w-0">
                        <p className="truncate text-xs font-bold tabular-nums" style={{ color: T1 }}>{m.conversions}</p>
                        <p className="truncate text-[9px]" style={{ color: T3 }}>{tt('Ventes', 'Sales', 'Ventas')}</p>
                      </div>
                      <div className="min-w-0">
                        <p className="truncate text-xs font-bold tabular-nums" style={{ color: T1 }}>{m.revenue.toFixed(0)}€</p>
                        <p className="truncate text-[9px]" style={{ color: T3 }}>CA</p>
                      </div>
                      <div className="min-w-0">
                        <p className="truncate text-xs font-bold tabular-nums" style={{ color: RED }}>{m.commission.toFixed(0)}€</p>
                        <p className="truncate text-[9px]" style={{ color: T3 }}>Comm.</p>
                      </div>
                    </div>
                  </motion.div>
                ))}
              </div>
            </PromoPCard>
          </motion.div>
        </>
      )}
    </PromoterPage>
  );
}
