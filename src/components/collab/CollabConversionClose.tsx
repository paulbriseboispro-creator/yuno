import { Link } from 'react-router-dom';
import { Sparkles, ArrowRight, Check } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { useSubscriptionPlan } from '@/hooks/useSubscriptionPlan';
import { isCollabPlan } from '@/lib/planFeatures';
import { useLanguage } from '@/contexts/LanguageContext';
import { translate } from '@/i18n/orgTranslate';

type Phase = 'before' | 'live' | 'after';

interface Props {
  venueName?: string;
  phase: Phase;
}

/**
 * Conversion close for the collab vitrine — shown only to clubs on the free
 * "collab" plan. Fires right after the value sections (money, audience, verdict),
 * at the exact moment the club is most impressed. Frames the locked surface
 * (own events, full analytics, staff/CRM, exports) as ASPIRATION, not restriction,
 * and routes to billing with a club-named CTA instead of a generic upsell.
 */
export function CollabConversionClose({ venueName, phase }: Props) {
  const { plan } = useSubscriptionPlan();
  const { language } = useLanguage();
  const tt = (fr: string, en: string, es?: string) => translate(language, fr, en, es);
  if (!isCollabPlan(plan)) return null;

  const aspirations = [
    tt('Vos propres soirées, billets et tables', 'Your own nights, tickets and tables', 'Tus propias noches, entradas y mesas'),
    tt('Analytics audience sur CHAQUE événement', 'Audience analytics on EVERY event', 'Analytics de público en CADA evento'),
    tt('Votre staff, vos promoteurs, votre CRM', 'Your staff, promoters and CRM', 'Tu staff, promotores y CRM'),
    tt('Export de vos données (CSV / PDF)', 'Export your data (CSV / PDF)', 'Exporta tus datos (CSV / PDF)'),
  ];

  const hook = phase === 'after'
    ? tt(
        "Vous venez de voir tout ça sur une soirée que vous n'avez même pas créée.",
        "You just saw all of this on a night you didn't even create.",
        'Acabas de ver todo esto en una noche que ni siquiera creaste.',
      )
    : tt(
        'Tout ce que vous voyez ici tourne déjà sur Yuno, sans que vous ayez rien installé.',
        'Everything you see here already runs on Yuno, with nothing to set up.',
        'Todo lo que ves aquí ya funciona en Yuno, sin que instales nada.',
      );

  return (
    <div
      className="relative overflow-hidden rounded-3xl p-6 sm:p-8"
      style={{
        background: 'linear-gradient(135deg,rgba(232,25,44,0.14),rgba(232,25,44,0.03) 55%,transparent)',
        border: '1px solid rgba(232,25,44,0.28)',
      }}
    >
      <div className="absolute -right-12 -top-12 h-44 w-44 rounded-full" style={{ background: 'rgba(232,25,44,0.22)', filter: 'blur(60px)' }} />
      <div className="relative">
        <div className="flex items-center gap-2 text-xs font-semibold uppercase tracking-wide" style={{ color: '#E8192C' }}>
          <Sparkles className="h-4 w-4" /> {tt("Et si c'était VOTRE Yuno ?", 'What if this was YOUR Yuno?', '¿Y si esto fuera TU Yuno?')}
        </div>
        <h3 className="mt-3 text-xl sm:text-2xl font-bold leading-tight text-foreground max-w-2xl">
          {hook}{' '}
          <span className="text-muted-foreground font-semibold">
            {tt('Imaginez sur toutes vos soirées.', 'Imagine it on all your nights.', 'Imagínalo en todas tus noches.')}
          </span>
        </h3>
        <div className="mt-5 grid grid-cols-1 sm:grid-cols-2 gap-2.5 max-w-xl">
          {aspirations.map((a, i) => (
            <div key={i} className="flex items-center gap-2.5 text-sm text-foreground/90">
              <span className="flex h-5 w-5 flex-none items-center justify-center rounded-full" style={{ background: 'rgba(232,25,44,0.16)' }}>
                <Check className="h-3 w-3" style={{ color: '#E8192C' }} />
              </span>
              {a}
            </div>
          ))}
        </div>
        <Button asChild size="lg" className="mt-6">
          <Link to="/owner/billing">
            {venueName
              ? tt(`Activer Yuno pour ${venueName}`, `Activate Yuno for ${venueName}`, `Activa Yuno para ${venueName}`)
              : tt('Activer Yuno pour mon club', 'Activate Yuno for my club', 'Activa Yuno para mi club')}
            <ArrowRight className="ml-1.5 h-4 w-4" />
          </Link>
        </Button>
        <p className="mt-3 text-xs text-muted-foreground">
          {tt(
            'La création de cette soirée reste gérée par votre organisateur partenaire.',
            'Creating this night stays handled by your partner organizer.',
            'La creación de esta noche la gestiona tu organizador asociado.',
          )}
        </p>
      </div>
    </div>
  );
}
