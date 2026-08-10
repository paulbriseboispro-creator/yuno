import { useState, useEffect } from 'react';
import { Link } from 'react-router-dom';
import { motion } from 'framer-motion';
import {
  TrendingUp, Ticket, Euro, Wine, Wallet, Gift, Megaphone, Users, Crown, Zap,
  ArrowRight, ScanLine, ClipboardList,
} from 'lucide-react';
import { supabase } from '@/integrations/supabase/client';
import { useLanguage } from '@/contexts/LanguageContext';
import { translate } from '@/i18n/orgTranslate';
import { usePromoterData } from '@/contexts/PromoterDataContext';
import { PromoterPage, PromoHeading } from '@/components/promoter/promoter-app-shell';
import {
  PromoPCard, StatTile, PromoPill, PromoProgress,
  RED, POS, T1, T2, T3, BORDER, INNER_BG, CARD_SHADOW,
} from '@/components/promoter/promoter-ui';

export default function PromoterOverview() {
  const { t, language } = useLanguage();
  const tt = (fr: string, en: string, es?: string) => translate(language, fr, en, es);
  const { promoter, scopeName, stats, announcements, events, templateRules, teamInfo, canScan, hasGuestListAccess } = usePromoterData();

  // Mode soirée : une soirée de la portée est en cours → bandeau live pollé.
  const [liveEvent, setLiveEvent] = useState<{ id: string; title: string } | null>(null);
  const [liveStats, setLiveStats] = useState({ tickets: 0, revenue: 0, commission: 0, goal: 0, goalTarget: 0 });

  useEffect(() => {
    if (!events.length) { setLiveEvent(null); return; }
    const now = new Date();
    const active = events.find(e => new Date(e.start_at) <= now && new Date(e.end_at) >= now);
    setLiveEvent(active ? { id: active.id, title: active.title } : null);
  }, [events]);

  useEffect(() => {
    if (!liveEvent || !promoter) return;
    const poll = async () => {
      const { data: convs } = await supabase.from('promoter_conversions')
        .select('amount, commission, conversion_type')
        .eq('promoter_id', promoter.id)
        .eq('event_id', liveEvent.id);
      const tickets = convs?.filter(c => c.conversion_type === 'ticket' && (c.amount || 0) > 0).length || 0;
      const revenue = convs?.reduce((s, c) => s + (c.amount || 0), 0) || 0;
      const commission = convs?.reduce((s, c) => s + (c.commission || 0), 0) || 0;

      const { data: assignment } = await supabase.from('promoter_event_assignments')
        .select('goal_target')
        .eq('promoter_id', promoter.id)
        .eq('event_id', liveEvent.id)
        .maybeSingle();

      setLiveStats({
        tickets, revenue, commission,
        goal: assignment?.goal_target ? Math.min(100, (tickets / assignment.goal_target) * 100) : 0,
        goalTarget: assignment?.goal_target || 0,
      });
    };
    poll();
    const interval = setInterval(poll, 30000);
    return () => clearInterval(interval);
  }, [liveEvent, promoter?.id]); // eslint-disable-line react-hooks/exhaustive-deps

  if (!promoter) return null;

  const fmtEur = (n: number) => `${n.toFixed(2)}€`;
  const dateLocale = language === 'fr' ? 'fr-FR' : language === 'es' ? 'es-ES' : 'en-GB';

  return (
    <PromoterPage>
      <PromoHeading
        title={t('promoter.title')}
        subtitle={scopeName}
        right={<PromoPill tone="red" style={{ fontSize: 12, padding: '4px 10px' }}>@{promoter.promo_code}</PromoPill>}
      />

      {/* ── Bandeau live (mode soirée) ── */}
      {liveEvent && (
        <motion.div initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }}>
          <div
            className="relative overflow-hidden"
            style={{
              background: `radial-gradient(ellipse 70% 50% at 90% -20%, rgba(232,25,44,0.10) 0%, transparent 65%),
                linear-gradient(180deg,rgba(255,255,255,.03) 0%,rgba(255,255,255,.005) 100%),#0a0a0c`,
              border: '1px solid rgba(232,25,44,0.25)',
              borderRadius: 18,
              boxShadow: CARD_SHADOW,
            }}
          >
            <div className="pointer-events-none absolute -top-14 -right-14 w-52 h-52 rounded-full"
              style={{ background: 'rgba(232,25,44,0.10)', filter: 'blur(56px)' }} />
            <div className="relative p-[18px]">
              <div className="flex items-center gap-2 mb-3">
                <Zap className="h-4 w-4 shrink-0" style={{ color: RED }} />
                <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-[11px] font-semibold"
                  style={{ background: 'rgba(232,25,44,0.12)', border: '1px solid rgba(232,25,44,0.3)', color: RED }}>
                  <span className="relative flex h-1.5 w-1.5">
                    <span className="animate-ping absolute inline-flex h-full w-full rounded-full opacity-75" style={{ background: RED }} />
                    <span className="relative inline-flex rounded-full h-1.5 w-1.5" style={{ background: RED }} />
                  </span>
                  {t('promoter.liveNow')}
                </span>
                <span className="min-w-0 flex-1 truncate text-sm font-semibold" style={{ color: T1 }}>{liveEvent.title}</span>
              </div>
              <div className="grid grid-cols-3 gap-2 text-center sm:gap-3">
                <div className="min-w-0">
                  <p className="truncate text-xl font-bold tabular-nums sm:text-2xl" style={{ color: T1, letterSpacing: '-0.02em' }}>{liveStats.tickets}</p>
                  <p className="truncate text-xs" style={{ color: T3 }}>{t('promoter.liveTickets')}</p>
                </div>
                <div className="min-w-0">
                  <p className="truncate text-xl font-bold tabular-nums sm:text-2xl" style={{ color: T1, letterSpacing: '-0.02em' }}>{fmtEur(liveStats.revenue)}</p>
                  <p className="truncate text-xs" style={{ color: T3 }}>{t('promoter.liveRevenue')}</p>
                </div>
                <div className="min-w-0">
                  <p className="truncate text-xl font-bold tabular-nums sm:text-2xl" style={{ color: RED, letterSpacing: '-0.02em' }}>{fmtEur(liveStats.commission)}</p>
                  <p className="truncate text-xs" style={{ color: T3 }}>{t('promoter.liveCommission')}</p>
                </div>
              </div>
              {liveStats.goalTarget > 0 && (
                <div className="mt-3">
                  <div className="flex justify-between gap-2 text-xs mb-1.5" style={{ color: T3 }}>
                    <span className="min-w-0 truncate">{t('promoter.goalBar')}</span>
                    <span className="shrink-0 tabular-nums">{liveStats.tickets}/{liveStats.goalTarget}</span>
                  </div>
                  <PromoProgress value={liveStats.goal} />
                </div>
              )}
              {/* Outils de porte à un tap pendant la soirée */}
              {(canScan || hasGuestListAccess) && (
                <div className="grid gap-2 mt-3" style={{ gridTemplateColumns: canScan && hasGuestListAccess ? '1fr 1fr' : '1fr' }}>
                  {canScan && (
                    <Link
                      to="/promoter/scan"
                      className="flex items-center justify-center gap-2 rounded-xl px-3 py-2.5 text-sm font-semibold transition-opacity hover:opacity-90"
                      style={{ background: RED, color: '#fff', minHeight: 44 }}
                    >
                      <ScanLine className="h-4 w-4" />
                      {tt('Scanner', 'Scan', 'Escanear')}
                    </Link>
                  )}
                  {hasGuestListAccess && (
                    <Link
                      to="/promoter/guestlist"
                      className="flex items-center justify-center gap-2 rounded-xl px-3 py-2.5 text-sm font-semibold transition-colors hover:bg-white/[0.08]"
                      style={{ background: INNER_BG, border: `1px solid ${BORDER}`, color: T1, minHeight: 44 }}
                    >
                      <ClipboardList className="h-4 w-4" />
                      Guest list
                    </Link>
                  )}
                </div>
              )}
            </div>
          </div>
        </motion.div>
      )}

      {/* ── KPIs ── */}
      <motion.div initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.05 }}
        className="grid grid-cols-2 lg:grid-cols-4 gap-3">
        <StatTile icon={TrendingUp} value={stats.totalClicks} label={t('promoter.clicks')} />
        <StatTile icon={Ticket} value={stats.ticketsSold} label={t('promoter.ticketsSold')} />
        <StatTile icon={Wine} value={stats.tablesReserved} label={t('promoter.tablesReserved')} />
        <StatTile icon={Euro} value={fmtEur(stats.totalRevenue)} label={t('promoter.totalRevenue')} />
      </motion.div>

      {/* ── Portefeuille ── */}
      <motion.div initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.1 }}>
        <PromoPCard
          accent
          icon={<Wallet className="w-4 h-4" />}
          title={tt('Portefeuille', 'Wallet', 'Cartera')}
          sub={scopeName}
          right={
            <div className="text-right shrink-0">
              <p className="text-[11px]" style={{ color: T3 }}>{t('promoter.conversionRate')}</p>
              <p className="text-base font-semibold tabular-nums" style={{ color: T1 }}>{stats.conversionRate.toFixed(1)}%</p>
            </div>
          }
        >
          <div>
            <p className="text-xs" style={{ color: T3 }}>{tt('À recevoir', 'To receive', 'Por recibir')}</p>
            <p className="tabular-nums leading-none mt-1"
              style={{ color: RED, fontSize: 'clamp(26px,3vw,36px)', fontWeight: 640, letterSpacing: '-0.025em' }}>
              {fmtEur(stats.pendingCommission)}
            </p>
          </div>
          <div className="grid grid-cols-2 gap-3 mt-4 pt-3" style={{ borderTop: `1px solid ${BORDER}` }}>
            <div className="min-w-0">
              <p className="truncate text-sm font-semibold tabular-nums" style={{ color: T1 }}>{fmtEur(stats.totalCommission)}</p>
              <p className="truncate text-[11px]" style={{ color: T3 }}>{tt('Total généré', 'Total earned', 'Total generado')}</p>
            </div>
            <div className="min-w-0">
              <p className="truncate text-sm font-semibold tabular-nums" style={{ color: POS }}>{fmtEur(stats.paidCommission)}</p>
              <p className="truncate text-[11px]" style={{ color: T3 }}>{t('promoter.paid')}</p>
            </div>
          </div>
          <Link
            to="/promoter/payments"
            className="mt-4 flex items-center justify-between gap-2 rounded-xl px-3.5 py-2.5 text-sm font-medium transition-colors hover:bg-white/[0.06]"
            style={{ background: INNER_BG, border: `1px solid ${BORDER}`, color: T2 }}
          >
            {tt('Voir mes règlements', 'View my payouts', 'Ver mis pagos')}
            <ArrowRight className="h-4 w-4 flex-none" />
          </Link>
        </PromoPCard>
      </motion.div>

      {/* ── Règles de commission ── */}
      <motion.div initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.15 }}>
        <PromoPCard icon={<Gift className="w-4 h-4" />} title={t('promoter.commission')} sub={scopeName}>
          <div className="space-y-2 text-sm">
            {templateRules ? (
              <>
                {(!templateRules.tiers || templateRules.tiers.length === 0) && (
                  <>
                    {templateRules.ticket && (
                      <div className="flex justify-between gap-3">
                        <span className="min-w-0 truncate" style={{ color: T2 }}>{t('promoter.ticketsSold')}</span>
                        <span className="shrink-0 whitespace-nowrap font-medium tabular-nums" style={{ color: T1 }}>
                          {templateRules.ticket.type === 'percentage' ? `${templateRules.ticket.value}%` : `${templateRules.ticket.value}€`}
                        </span>
                      </div>
                    )}
                    {templateRules.table && (
                      <div className="flex justify-between gap-3">
                        <span className="min-w-0 truncate" style={{ color: T2 }}>{t('promoter.tablesReserved')}</span>
                        <span className="shrink-0 whitespace-nowrap font-medium tabular-nums" style={{ color: T1 }}>
                          {templateRules.table.type === 'percentage' ? `${templateRules.table.value}%` : `${templateRules.table.value}€`}
                        </span>
                      </div>
                    )}
                  </>
                )}
                {templateRules.tiers && templateRules.tiers.length > 0 && (
                  <div className="space-y-1.5">
                    <p className="text-xs font-medium" style={{ color: T3 }}>{tt('Paliers de récompenses', 'Reward tiers', 'Niveles de recompensa')} :</p>
                    {templateRules.tiers.map((tier, i) => {
                      const rewardLabel = tier.reward_type === 'none' ? tt('Pas de récompense', 'No reward', 'Sin recompensa')
                        : tier.reward_type === 'free_entry' ? tt('Entrée gratuite', 'Free entry', 'Entrada gratis')
                        : tier.reward_type === 'vip' ? tt('Table VIP', 'VIP table', 'Mesa VIP')
                        : tier.reward_type === 'drinks' ? tt('Boissons offertes', 'Free drinks', 'Bebidas gratis')
                        : tier.reward_type === 'money' ? `${tier.ticketValue || 0}€`
                        : tier.reward_type;
                      return (
                        <div key={i} className="flex items-center justify-between gap-3 text-xs">
                          <span className="min-w-0 truncate tabular-nums" style={{ color: T2 }}>
                            {tier.min}{tier.max ? `–${tier.max}` : '+'} {tt('ventes', 'sales', 'ventas')}
                          </span>
                          <PromoPill>{rewardLabel}</PromoPill>
                        </div>
                      );
                    })}
                  </div>
                )}
                {templateRules.customer_discount && (
                  <div className="pt-2" style={{ borderTop: `1px solid ${BORDER}` }}>
                    <p className="text-xs font-medium mb-1.5" style={{ color: T3 }}>{tt('Avantage client', 'Customer perk', 'Ventaja cliente')} :</p>
                    <div className="flex items-center justify-between gap-3 text-xs">
                      <span className="min-w-0 truncate" style={{ color: T2 }}>
                        {templateRules.customer_discount.label || tt('Réduction via votre lien', 'Discount via your link', 'Descuento con tu enlace')}
                      </span>
                      <PromoPill tone="red">
                        {templateRules.customer_discount.type === 'percentage'
                          ? `-${templateRules.customer_discount.value}%`
                          : `-${templateRules.customer_discount.value}€`}
                      </PromoPill>
                    </div>
                  </div>
                )}
              </>
            ) : (
              <>
                <div className="flex justify-between gap-3">
                  <span className="min-w-0 truncate" style={{ color: T2 }}>{t('promoter.ticketsSold')}</span>
                  <span className="shrink-0 whitespace-nowrap font-medium tabular-nums" style={{ color: T1 }}>
                    {promoter.ticket_commission_type === 'percentage'
                      ? `${promoter.ticket_commission_value}%`
                      : `${promoter.ticket_commission_value}€`}
                  </span>
                </div>
                <div className="flex justify-between gap-3">
                  <span className="min-w-0 truncate" style={{ color: T2 }}>{t('promoter.tablesReserved')}</span>
                  <span className="shrink-0 whitespace-nowrap font-medium tabular-nums" style={{ color: T1 }}>
                    {promoter.table_commission_type === 'percentage'
                      ? `${promoter.table_commission_value}%`
                      : `${promoter.table_commission_value}€`}
                  </span>
                </div>
              </>
            )}
          </div>
        </PromoPCard>
      </motion.div>

      {/* ── Équipe (résumé) ── */}
      {teamInfo && (
        <motion.div initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.2 }}>
          <PromoPCard
            icon={<Users className="w-4 h-4" />}
            title={teamInfo.name}
            sub={`${teamInfo.memberCount} ${tt('membres', 'members', 'miembros')}`}
            right={teamInfo.isLeader ? (
              <Link to="/promoter/team" className="text-[13px] font-medium inline-flex items-center gap-1 transition-colors hover:text-white" style={{ color: T3 }}>
                {tt('Classement', 'Leaderboard', 'Clasificación')}<ArrowRight className="h-3.5 w-3.5" />
              </Link>
            ) : undefined}
          >
            {teamInfo.leaderName && (
              <p className="text-xs flex items-center gap-1.5 truncate" style={{ color: T2 }}>
                <Crown className="h-3.5 w-3.5 shrink-0" style={{ color: RED }} />
                {tt("Chef d'équipe", 'Team leader', 'Jefe de equipo')} : {teamInfo.leaderName}
              </p>
            )}
          </PromoPCard>
        </motion.div>
      )}

      {/* ── Annonces ── */}
      {announcements.length > 0 && (
        <motion.div initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.25 }}>
          <PromoPCard icon={<Megaphone className="w-4 h-4" />} title={scopeName} sub={tt('Annonces', 'Announcements', 'Anuncios')}>
            <div className="space-y-2">
              {announcements.map((a, i) => (
                <motion.div
                  key={a.id}
                  initial={{ opacity: 0, x: -8 }}
                  animate={{ opacity: 1, x: 0 }}
                  transition={{ delay: i * 0.04 }}
                  className="rounded-xl px-3.5 py-3"
                  style={{ background: INNER_BG, border: `1px solid ${BORDER}` }}
                >
                  <p className="text-sm font-medium break-words" style={{ color: T1 }}>{a.title}</p>
                  <p className="text-xs mt-1 break-words" style={{ color: T2 }}>{a.content}</p>
                  <p className="text-[11px] mt-2 tabular-nums" style={{ color: T3 }}>
                    {new Date(a.created_at).toLocaleDateString(dateLocale)}
                  </p>
                </motion.div>
              ))}
            </div>
          </PromoPCard>
        </motion.div>
      )}
    </PromoterPage>
  );
}
