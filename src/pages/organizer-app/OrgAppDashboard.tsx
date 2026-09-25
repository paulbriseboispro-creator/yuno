import { useEffect, useState } from 'react';
import { eventReportHref } from '@/lib/analyticsNav';
import { Link } from 'react-router-dom';
import { supabase } from '@/integrations/supabase/client';
import { useActingOrganizer } from '@/hooks/useActingOrganizer';
import { useLanguage } from '@/contexts/LanguageContext';
import { translate } from '@/i18n/orgTranslate';
import { motion } from 'framer-motion';
import { Plus, AlertCircle, CreditCard, Sparkles } from 'lucide-react';
import { useOrganizerStripe } from '@/hooks/useOrganizerStripe';
import { OrgPendingProposals } from '@/components/organizer-app/OrgPendingProposals';
import { RecentNightsKpis } from '@/components/analytics/families/RecentNightsKpis';
import { UpcomingEventsBoard } from '@/components/events-sales/UpcomingEventsBoard';

// ─── Yuno Design Tokens (aligned with the Owner dashboard DA) ──────────────────
const RED       = '#E8192C';
const T1        = 'rgb(var(--ink)/var(--ink-a96,0.96))';
const T2        = 'rgb(var(--ink)/var(--ink-a58,0.58))';
const T3        = 'rgb(var(--ink)/var(--ink-a36,0.36))';
const BORDER    = 'rgb(var(--ink)/0.085)';
const INNER_BG  = 'rgb(var(--ink)/0.032)';


export default function OrgAppDashboard() {
  const { organizerId, organizationName, organizationLogoUrl, can } = useActingOrganizer();
  const { language } = useLanguage();
  const { canSell, status: stripeStatus, loading: stripeLoading } = useOrganizerStripe(organizerId);

  const [orgCover, setOrgCover] = useState<string | null>(null);
  const [orgCity, setOrgCity] = useState<string | null>(null);

  const tt = (frTxt: string, en: string, es?: string) => translate(language, frTxt, en, es);

  useEffect(() => {
    if (!organizerId) return;
    (async () => {
      // Identité de l'organisation (couverture + ville) pour le bandeau.
      const [{ data: prof }, { data: orgProf }] = await Promise.all([
        supabase.from('profiles').select('city').eq('id', organizerId).maybeSingle(),
        supabase.from('organizer_profiles').select('cover_url').eq('user_id', organizerId).maybeSingle(),
      ]);
      setOrgCity(prof?.city ?? null);
      setOrgCover((orgProf as { cover_url?: string | null } | null)?.cover_url ?? null);
    })();
  }, [organizerId]);

  const orgName = organizationName || 'Yuno';
  const orgLogo = organizationLogoUrl;

  return (
    <div className="px-4 pb-12">
      {/* ─── Org Hero ──────────────────────────────────────────────────────────── */}
      <motion.div
        initial={{ opacity: 0, y: -8 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.45, ease: [0.22, 1, 0.36, 1] }}
        className="relative -mx-4 overflow-hidden"
        style={{ height: 240, borderRadius: '0 0 22px 22px' }}
        // Bannière cinéma (photo + voile) : sombre dans les deux thèmes.
        data-theme-island="dark"
      >
        {orgCover ? (
          <img
            src={orgCover}
            alt={orgName}
            className="absolute inset-0 h-full w-full object-cover object-center"
            style={{ filter: 'brightness(0.5) saturate(1.3)' }}
          />
        ) : (
          <>
            <div
              className="absolute inset-0"
              style={{
                background: `radial-gradient(ellipse 90% 70% at 80% -10%, rgba(232,25,44,0.24) 0%, transparent 58%),
                             radial-gradient(ellipse 70% 55% at 5% 110%, rgba(232,25,44,0.14) 0%, transparent 52%),
                             linear-gradient(155deg, #130508 0%, var(--sf-0a0a0c) 50%, #0c0a12 100%)`,
              }}
            />
            <div className="pointer-events-none absolute -top-24 -right-24 h-80 w-80 rounded-full" style={{ background: 'rgba(232,25,44,0.16)', filter: 'blur(80px)' }} />
            <div className="pointer-events-none absolute -bottom-28 left-2 h-64 w-64 rounded-full" style={{ background: 'rgba(232,25,44,0.09)', filter: 'blur(72px)' }} />
          </>
        )}

        <div
          className="absolute inset-0"
          style={{
            background: orgCover
              ? 'linear-gradient(to top, rgba(0,0,0,0.97) 0%, rgba(0,0,0,0.52) 38%, rgba(0,0,0,0.04) 100%)'
              : 'linear-gradient(to top, rgba(0,0,0,0.72) 0%, rgba(0,0,0,0.18) 65%, transparent 100%)',
          }}
        />

        <div className="relative flex h-full flex-col justify-end px-5 pb-5">
          <div className="flex items-end justify-between gap-3">
            {/* Identity */}
            <div className="flex min-w-0 items-end gap-3.5">
              {orgLogo ? (
                <img
                  src={orgLogo}
                  alt=""
                  className="h-[58px] w-[58px] flex-shrink-0 rounded-2xl object-cover"
                  style={{ border: '1.5px solid rgb(var(--ink)/0.18)', boxShadow: '0 0 0 1px rgba(0,0,0,0.55), 0 10px 32px -6px rgba(0,0,0,0.95)' }}
                />
              ) : (
                <div
                  className="flex h-[58px] w-[58px] flex-shrink-0 items-center justify-center rounded-2xl"
                  style={{ background: 'linear-gradient(135deg, rgba(232,25,44,0.22) 0%, rgba(232,25,44,0.06) 100%)', border: '1.5px solid rgba(232,25,44,0.32)', boxShadow: '0 0 0 1px rgba(0,0,0,0.55), 0 10px 32px -6px rgba(0,0,0,0.95)' }}
                >
                  <Sparkles className="h-6 w-6" style={{ color: RED }} />
                </div>
              )}
              <div className="min-w-0 pb-0.5">
                <div className="truncate" style={{ color: T1, fontSize: 23, fontWeight: 700, lineHeight: 1.15, letterSpacing: '-0.5px', textShadow: '0 2px 20px rgba(0,0,0,0.95)' }}>
                  {orgName}
                </div>
                <div style={{ color: T3, fontSize: 13, fontWeight: 500, marginTop: 4 }}>
                  {orgCity ? orgCity : tt('Organisateur', 'Organizer')}
                </div>
              </div>
            </div>

          </div>
        </div>
      </motion.div>

      <div className="mt-4 space-y-4">
        {/* Title row + CTA */}
        <div className="flex items-center justify-between gap-3">
          <div>
            <h1 style={{ color: T1, fontSize: 16, fontWeight: 600, letterSpacing: '-0.01em' }}>{tt('Accueil', 'Home', 'Inicio')}</h1>
            <p style={{ color: T3, fontSize: 12, marginTop: 2 }}>{tt("Tes soirées en un coup d'œil : les dernières, puis celles qui arrivent.", 'Your nights at a glance: the last ones, then the ones coming up.', 'Tus noches de un vistazo: las últimas y las que vienen.')}</p>
          </div>
          <Link
            to="/organizer-app/events?create=1"
            className="inline-flex items-center gap-2 rounded-xl px-4 py-2 text-[13px] font-semibold transition-all duration-150"
            style={{ background: RED, color: '#fff', boxShadow: `0 0 20px -6px ${RED}88` }}
          >
            <Plus className="h-4 w-4" />
            <span className="hidden sm:inline">{tt('Créer un événement', 'Create event')}</span>
          </Link>
        </div>

        {/* Stripe alert */}
        {can.manageOrganization && !stripeLoading && !canSell && (
          <div className="flex items-start gap-3 rounded-xl px-4 py-3" style={{ background: 'rgba(232,25,44,0.06)', border: '1px solid rgba(232,25,44,0.22)' }}>
            <AlertCircle className="mt-0.5 h-5 w-5 flex-shrink-0" style={{ color: RED }} />
            <div className="flex-1 min-w-0">
              <p style={{ color: T1, fontSize: 13, fontWeight: 560 }}>{tt('Activez les paiements pour vendre', 'Activate payments to start selling')}</p>
              <p style={{ color: T3, fontSize: 11.5, marginTop: 2 }}>
                {stripeStatus === 'pending'
                  ? tt('Onboarding Stripe incomplet.', 'Stripe onboarding incomplete.')
                  : tt('Vos soirées et vos guest lists vivent en ligne sans Stripe. Billets, tables et boissons demandent un compte connecté.', 'Your events and guest lists go live without Stripe. Tickets, tables and drinks need a connected account.')}
              </p>
            </div>
            <Link
              to="/organizer-app/payments"
              className="inline-flex flex-shrink-0 items-center gap-1.5 rounded-lg px-3 py-1.5 text-[12px] font-medium transition-all duration-150"
              style={{ background: INNER_BG, border: `1px solid ${BORDER}`, color: T2 }}
            >
              <CreditCard className="h-3.5 w-3.5" />
              {tt('Configurer', 'Configure')}
            </Link>
          </div>
        )}

        {/* ─── Pending co-event proposals (awaiting my acceptance) ──────────────── */}
        <OrgPendingProposals />

        {/* Les chiffres des dernières soirées : MÊME source que Ventes. La
            RPC ne rend l'argent qu'à qui peut le voir, et refuse un scanner. */}
        {organizerId && can.viewInsights && (
          <RecentNightsKpis organizerUserId={organizerId} salesHref="/organizer-app/analytics?tab=sales&view=overview" />
        )}

        {/* ─── Vos prochaines soirées — J-N, CA du jour, jauges ─────────────── */}
        {organizerId && (
          <UpcomingEventsBoard
            scope={{ organizerUserId: organizerId }}
            statsHref={(id) => (can.viewInsights ? eventReportHref('/organizer-app/analytics', id) : `/organizer-app/events/${id}`)}
            allHref="/organizer-app/events"
            liveHref={(id) => (can.editEvents ? `/organizer-app/events/${id}/live` : null)}
            emptyCta={can.editEvents ? { label: tt('Créer un événement', 'Create event', 'Crear un evento'), href: '/organizer-app/events?create=1' } : undefined}
          />
        )}

      </div>
    </div>
  );
}
