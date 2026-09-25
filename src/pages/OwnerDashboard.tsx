import { AppHeader } from '@/components/app-header';
import { eventReportHref } from '@/lib/analyticsNav';
import { DashboardSkeleton } from '@/components/DashboardSkeleton';
import { useOwnerOnboarding } from '@/hooks/useOwnerOnboarding';
import { OnboardingSidebar } from '@/components/onboarding/OnboardingSidebar';
import {
  CalendarPlusIcon, ChevronRightIcon, CreditCard, Crown, Sparkles, Store, BarChart3Icon, QrCodeIcon, ZapIcon,
} from 'lucide-react';
import { Link } from 'react-router-dom';
import { useLanguage } from '@/contexts/LanguageContext';
import { useState } from 'react';
import { motion } from 'framer-motion';
import { useOwnerVenue } from '@/hooks/useOwnerVenue';
import { useStripeConnect } from '@/hooks/useStripeConnect';
import { useSubscriptionPlan } from '@/hooks/useSubscriptionPlan';
import { UpgradeModal } from '@/components/UpgradeModal';
import { NextBestActionsCard } from '@/components/owner/NextBestActionsCard';
import { UpcomingEventsBoard } from '@/components/events-sales/UpcomingEventsBoard';
import { RecentNightsKpis } from '@/components/analytics/families/RecentNightsKpis';
import { CollabActivateBanner } from '@/components/collab/CollabActivateBanner';
import { CollabWelcomeOverlay } from '@/components/collab/CollabWelcomeOverlay';
import { isCollabPlan } from '@/lib/planFeatures';
import type { FeatureKey } from '@/lib/planFeatures';
import { useHomeBanner } from '@/hooks/useHomeBanner';
import { HomeBannerBackdrop } from '@/components/home-banner/HomeBannerBackdrop';
import { HomeBannerEditButton } from '@/components/home-banner/HomeBannerEditButton';
import { HomeBannerEditor } from '@/components/home-banner/HomeBannerEditor';

// ─── Yuno Design Tokens ───────────────────────────────────────────────────────
const RED       = '#E8192C';
const POS       = 'var(--acc-34d399)';
const NEG       = 'var(--acc-ff5c63)';
const T1        = 'rgb(var(--ink)/var(--ink-a96,0.96))';
const T2        = 'rgb(var(--ink)/var(--ink-a58,0.58))';
const T3        = 'rgb(var(--ink)/var(--ink-a36,0.36))';
const C_FAINT   = 'rgb(var(--ink)/0.06)';
const BORDER    = 'rgb(var(--ink)/0.085)';
const F_BORDER  = 'rgb(var(--ink)/0.055)';
const TILE_BG   = 'rgb(var(--ink)/0.025)';
const CARD_BG   = 'linear-gradient(180deg,rgb(var(--sheen)/.045) 0%,rgb(var(--sheen)/.008) 100%),var(--sf-0a0a0c)';
const CARD_SHADOW = '0 1px 0 rgb(var(--sheen)/.05) inset,0 18px 40px -28px rgb(0 0 0/calc(.9*var(--pro-shadow-a)))';

// ─── Types ────────────────────────────────────────────────────────────────────

// ─── Page ─────────────────────────────────────────────────────────────────────
export default function OwnerDashboard() {
  const { t } = useLanguage();
  const { venueId, venue, loading: venueLoading } = useOwnerVenue();
  const { banner: homeBanner, loaded: bannerLoaded, setBanner: setHomeBanner } = useHomeBanner(venueId ? { kind: 'venue', id: venueId } : null);
  const [bannerEditorOpen, setBannerEditorOpen] = useState(false);
  useStripeConnect(venueId);
  const { plan: currentPlan, isTrial, daysRemaining, status: subStatus, loading: planLoading } = useSubscriptionPlan();
  const { isComplete: onboardingComplete, loading: onbLoading, currentStep, stepStatuses } = useOwnerOnboarding(venueId);
  const [upgradeFeature, setUpgradeFeature] = useState<FeatureKey | null>(null);

  if (venueLoading) return <DashboardSkeleton />;

  if (!venueId) {
    return (
      <div style={{ padding: '16px 24px', minHeight: '100vh', background: 'var(--sf-000000)' }}>
        <AppHeader />
        <div className="flex h-[60vh] items-center justify-center">
          <p style={{ color: T3 }}>{t('owner.noVenueAssigned')}</p>
        </div>
      </div>
    );
  }

  return (
    <div style={{ padding: '16px', minHeight: '100vh', background: 'var(--sf-000000)' }}>
      <AppHeader />
      <UpgradeModal
        open={upgradeFeature !== null}
        onOpenChange={(o) => !o && setUpgradeFeature(null)}
        feature={upgradeFeature || 'vip_tables'}
      />

      <div className="space-y-4 pb-10">

        {/* ─── Venue Hero ───────────────────────────────────────────────────────── */}
        {venue && (
          <motion.div
            initial={{ opacity: 0, y: -8 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.45, ease: [0.22, 1, 0.36, 1] }}
            className="relative -mx-4 -mt-4 overflow-hidden"
            style={{ height: 256, borderRadius: '0 0 26px 26px' }}
            // Bannière cinéma (photo + voile) : sombre dans les deux thèmes.
            data-theme-island="dark"
          >

            {/* ── Fond : bannière d'accueil (pas la couverture publique) ── */}
            <HomeBannerBackdrop banner={homeBanner} alt={venue.name} />
            {bannerLoaded && (
              <HomeBannerEditButton hasBanner={!!homeBanner} onClick={() => setBannerEditorOpen(true)} />
            )}

            {/* ── Layer 3 : contenu ──────────────────────────────────────── */}
            <div className="relative flex h-full flex-col justify-end gap-0 px-4 pb-5">

              {/* Venue identity */}
              <div className="flex items-end justify-between gap-3">

                {/* Logo + nom + ville */}
                <div className="flex items-end gap-3.5 min-w-0">
                  {venue.logoUrl ? (
                    <img
                      src={venue.logoUrl}
                      alt=""
                      className="h-[58px] w-[58px] rounded-2xl object-cover flex-shrink-0"
                      style={{
                        border: '1.5px solid rgb(var(--ink)/0.18)',
                        boxShadow: '0 0 0 1px rgba(0,0,0,0.55), 0 10px 32px -6px rgba(0,0,0,0.95)',
                      }}
                    />
                  ) : (
                    <div
                      className="flex h-[58px] w-[58px] items-center justify-center rounded-2xl flex-shrink-0"
                      style={{
                        background: 'linear-gradient(135deg, rgba(232,25,44,0.22) 0%, rgba(232,25,44,0.06) 100%)',
                        border: '1.5px solid rgba(232,25,44,0.32)',
                        boxShadow: '0 0 0 1px rgba(0,0,0,0.55), 0 10px 32px -6px rgba(0,0,0,0.95)',
                      }}
                    >
                      <Store className="h-6 w-6" style={{ color: RED }} />
                    </div>
                  )}

                  <div className="min-w-0 pb-0.5">
                    <div
                      className="truncate"
                      style={{
                        color: T1,
                        fontSize: 23,
                        fontWeight: 700,
                        lineHeight: 1.15,
                        letterSpacing: '-0.5px',
                        textShadow: '0 2px 20px rgba(0,0,0,0.95)',
                      }}
                    >
                      {venue.name}
                    </div>
                    {venue.city && (
                      <div
                        style={{
                          color: T3,
                          fontSize: 13,
                          fontWeight: 500,
                          marginTop: 4,
                          letterSpacing: '0.1px',
                        }}
                      >
                        {venue.city}
                      </div>
                    )}
                  </div>
                </div>

              </div>
            </div>
          </motion.div>
        )}

        {venue && venueId && (
          <HomeBannerEditor
            open={bannerEditorOpen}
            onOpenChange={setBannerEditorOpen}
            scope={{ kind: 'venue', id: venueId }}
            current={homeBanner}
            identity={{ name: venue.name, subtitle: venue.city, logoUrl: venue.logoUrl }}
            publicCover={venue.coverUrl ? { url: venue.coverUrl } : null}
            onSaved={setHomeBanner}
          />
        )}

        {/* Onboarding */}
        {!onbLoading && !onboardingComplete && (
          <OnboardingSidebar currentStep={currentStep} stepStatuses={stepStatuses} />
        )}

        {/* Plan banners */}
        {isTrial && daysRemaining !== null && (
          <Link to="/owner/billing" className="block" style={{ textDecoration: 'none' }}>
            <div className="flex items-center justify-between gap-3 rounded-xl px-4 py-3" style={{ background: 'rgba(52,211,153,0.06)', border: '1px solid rgba(52,211,153,0.22)' }}>
              <div className="flex items-center gap-3">
                <Sparkles className="h-4 w-4" style={{ color: POS }} />
                <span style={{ color: T1, fontSize: 13.5, fontWeight: 560 }}>{t('plan.trialActive').replace('{days}', String(daysRemaining))}</span>
              </div>
              <span style={{ color: T3, fontSize: 11.5 }}>{t('plan.billing')} →</span>
            </div>
          </Link>
        )}
        {subStatus === 'past_due' && (
          <Link to="/owner/billing" className="block" style={{ textDecoration: 'none' }}>
            <div className="flex items-center justify-between gap-3 rounded-xl px-4 py-3" style={{ background: 'rgba(255,92,99,0.06)', border: '1px solid rgba(255,92,99,0.22)' }}>
              <div className="flex items-center gap-3">
                <CreditCard className="h-4 w-4" style={{ color: NEG }} />
                <span style={{ color: T1, fontSize: 13.5, fontWeight: 560 }}>{t('plan.paymentPending')}</span>
              </div>
              <span style={{ color: T3, fontSize: 11.5 }}>{t('plan.resolvePayment')} →</span>
            </div>
          </Link>
        )}
        {!planLoading && isCollabPlan(currentPlan) && <CollabActivateBanner />}
        <CollabWelcomeOverlay venueId={venueId} venueName={venue?.name} />
        {currentPlan === 'core' && !planLoading && (
          <Link to="/owner/billing" className="block" style={{ textDecoration: 'none' }}>
            <div className="flex items-center justify-between gap-3 rounded-xl px-4 py-3" style={{ background: 'rgba(232,25,44,0.06)', border: '1px solid rgba(232,25,44,0.22)' }}>
              <div className="flex items-center gap-3">
                <Crown className="h-4 w-4" style={{ color: RED }} />
                <div>
                  <span style={{ color: T1, fontSize: 13.5, fontWeight: 560, display: 'block' }}>{t('plan.coreBanner')}</span>
                  <span style={{ color: T3, fontSize: 11 }}>{t('plan.upgradeFullExperience')}</span>
                </div>
              </div>
              <span style={{ color: RED, fontSize: 12, fontWeight: 600 }}>{t('plan.upgrade')} →</span>
            </div>
          </Link>
        )}

        {/* ─── À faire aujourd'hui (next-best-action IA) ─── */}
        <NextBestActionsCard />

        {/* Les chiffres des dernières soirées : MÊME source que Ventes. */}
        <RecentNightsKpis venueId={venueId} salesHref="/owner/analytics?tab=sales&view=overview" />

        {/* Vos prochaines soirées — J-N, CA du jour, jauges */}
        <UpcomingEventsBoard
          scope={{ venueId }}
          statsHref={(id) => eventReportHref('/owner/analytics', id)}
          allHref="/owner/events"
          liveHref={() => '/owner/live'}
          emptyCta={{ label: t('owner.dash.createEvent'), href: '/owner/events' }}
        />

        <YunoQuickActions t={t} />
      </div>
    </div>
  );
}

// ─── Stat card ────────────────────────────────────────────────────────────────
function YunoQuickActions({ t }: { t: (k: string) => string }) {
  const actions = [
    { title: t('owner.dash.createEvent'), description: t('owner.dash.createEventDesc'), to: '/owner/events', Icon: CalendarPlusIcon },
    { title: t('owner.dash.startLiveNight'), description: t('owner.dash.startLiveNightDesc'), to: '/owner/live', Icon: ZapIcon },
    { title: t('owner.dash.scanTickets'), description: t('owner.dash.scanTicketsDesc'), to: '/owner/staff', Icon: QrCodeIcon },
    { title: t('owner.dash.viewAnalyticsAction'), description: t('owner.dash.viewAnalyticsActionDesc'), to: '/owner/analytics', Icon: BarChart3Icon },
  ];

  return (
    <div style={{ background: CARD_BG, border: `1px solid ${BORDER}`, borderRadius: 18, boxShadow: CARD_SHADOW, padding: '20px 22px', overflow: 'hidden', height: '100%' }}>
      <h3 style={{ color: T1, fontSize: 15.5, fontWeight: 600, letterSpacing: '-0.01em', marginBottom: 4 }}>
        {t('owner.dash.quickActions')}
      </h3>
      <p style={{ color: T3, fontSize: 11.5, marginBottom: 14 }}>
        {t('owner.dash.quickActionsSub')}
      </p>

      {/* Pleine largeur : les quatre raccourcis côte à côte sur grand écran. */}
      <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-4">
        {actions.map((a) => (
          <Link
            key={a.to}
            to={a.to}
            className="flex items-center gap-3 rounded-xl cursor-pointer transition-all duration-150"
            style={{ padding: '10px 12px', textDecoration: 'none', background: TILE_BG, border: `1px solid ${F_BORDER}` }}
          >
            <div className="flex-none h-8 w-8 flex items-center justify-center rounded-lg"
              style={{ background: C_FAINT, border: `1px solid ${F_BORDER}` }}>
              <a.Icon className="h-4 w-4" style={{ color: T2 }} />
            </div>
            <div className="flex-1 min-w-0">
              <p style={{ color: T1, fontSize: 13, fontWeight: 560 }}>{a.title}</p>
              <p className="truncate" style={{ color: T3, fontSize: 11, marginTop: 1 }}>{a.description}</p>
            </div>
            <ChevronRightIcon className="h-4 w-4 flex-none" style={{ color: T3 }} />
          </Link>
        ))}
      </div>
    </div>
  );
}
