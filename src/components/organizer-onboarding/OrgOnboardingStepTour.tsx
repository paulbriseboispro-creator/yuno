import { useState } from 'react';
import { useLanguage } from '@/contexts/LanguageContext';
import { translate } from '@/i18n/orgTranslate';
import { Button } from '@/components/ui/button';
import { motion, AnimatePresence } from 'framer-motion';
import {
  LayoutDashboard, Ticket, ScanLine, BarChart3, Handshake, Rocket,
  ArrowLeft, ArrowRight, Sparkles, CheckCircle2, Loader2,
} from 'lucide-react';
import { cn } from '@/lib/utils';

interface Props {
  onComplete: () => void | Promise<void>;
}

export function OrgOnboardingStepTour({ onComplete }: Props) {
  const { language } = useLanguage();
  const tt = (fr: string, en: string, es?: string) => translate(language, fr, en, es);
  const [slide, setSlide] = useState(0);
  const [finishing, setFinishing] = useState(false);

  const slides = [
    {
      icon: LayoutDashboard,
      title: tt('Mission Control', 'Mission Control'),
      desc: tt(
        "Votre tableau de bord temps réel : ventes, check-ins, prochain événement, KPI 30 jours, top soirées.",
        'Your real-time dashboard: sales, check-ins, next event, 30-day KPIs, top events.'
      ),
      color: 'from-blue-500/20 to-blue-500/5',
    },
    {
      icon: Ticket,
      title: tt('Billetterie flexible', 'Flexible ticketing')
      ,
      desc: tt(
        "Tarifs simples, vagues progressives ou créneaux horaires. Listes privées et codes promoteurs inclus.",
        'Simple prices, progressive waves or time slots. Private lists and promoter codes included.'
      ),
      color: 'from-primary/20 to-primary/5',
    },
    {
      icon: ScanLine,
      title: tt('Check-in à la porte', 'Door check-in'),
      desc: tt(
        "Scannez les QR codes en mode hors-ligne, statistiques en temps réel, gestion des refus.",
        'Scan QR codes offline, real-time stats, rejection handling.'
      ),
      color: 'from-emerald-500/20 to-emerald-500/5',
    },
    {
      icon: BarChart3,
      title: tt('Analyses avancées', 'Advanced analytics'),
      desc: tt(
        "Vélocité de vente, ratio demande/offre, hype score, segments clients, exports CSV/PDF.",
        'Sales velocity, demand ratio, hype score, customer segments, CSV/PDF exports.'
      ),
      color: 'from-purple-500/20 to-purple-500/5',
    },
    {
      icon: Handshake,
      title: tt('Écosystème nightlife', 'Nightlife ecosystem'),
      desc: tt(
        "Partenariats avec clubs, DJs, équipe, promoteurs. Splits de revenus automatisés.",
        'Partnerships with clubs, DJs, team, promoters. Automated revenue splits.'
      ),
      color: 'from-amber-500/20 to-amber-500/5',
    },
  ];

  const isLast = slide === slides.length - 1;
  const current = slides[slide];

  return (
    <div className="space-y-6 max-w-xl">
      <div>
        <h2 className="text-2xl font-bold flex items-center gap-2">
          <Sparkles className="h-6 w-6 text-primary" />
          {tt("Découvrez Yuno", 'Discover Yuno')}
        </h2>
        <p className="text-sm text-muted-foreground mt-1">
          {tt(
            "Une visite éclair des fonctionnalités clés avant de plonger.",
            'A quick tour of the key features before diving in.'
          )}
        </p>
      </div>

      <div className="relative rounded-2xl border border-white/[0.06] bg-white/[0.02] overflow-hidden min-h-[280px]">
        <AnimatePresence mode="wait">
          <motion.div
            key={slide}
            initial={{ opacity: 0, x: 20 }}
            animate={{ opacity: 1, x: 0 }}
            exit={{ opacity: 0, x: -20 }}
            transition={{ duration: 0.25 }}
            className="p-6 sm:p-8"
          >
            <div className={cn('h-16 w-16 rounded-2xl bg-gradient-to-br border border-white/10 flex items-center justify-center mb-4', current.color)}>
              <current.icon className="h-8 w-8 text-foreground" />
            </div>
            <h3 className="text-xl font-bold">{current.title}</h3>
            <p className="text-sm text-muted-foreground mt-2 leading-relaxed">{current.desc}</p>
          </motion.div>
        </AnimatePresence>

        <div className="flex items-center justify-between px-6 pb-5">
          <div className="flex gap-1.5">
            {slides.map((_, i) => (
              <button
                key={i}
                onClick={() => setSlide(i)}
                className={cn(
                  'h-1.5 rounded-full transition-all',
                  i === slide ? 'w-6 bg-primary' : 'w-1.5 bg-muted-foreground/30'
                )}
                aria-label={`slide ${i + 1}`}
              />
            ))}
          </div>
          <div className="flex gap-2">
            <Button variant="outline" size="sm" disabled={slide === 0} onClick={() => setSlide(s => s - 1)}>
              <ArrowLeft className="h-4 w-4" />
            </Button>
            {!isLast ? (
              <Button size="sm" onClick={() => setSlide(s => s + 1)}>
                {tt('Suivant', 'Next')}
                <ArrowRight className="h-4 w-4 ml-1" />
              </Button>
            ) : (
              <Button
                size="sm"
                disabled={finishing}
                onClick={async () => {
                  // Mark step 7 complete. Once all steps are done, the parent
                  // onboarding page performs a hard redirect to /organizer-app
                  // (see OrgAppOnboarding) so the route guard re-reads the fresh
                  // onboarding_completed flag instead of bouncing us back here.
                  setFinishing(true);
                  await onComplete();
                }}
              >
                {finishing ? (
                  <Loader2 className="h-4 w-4 mr-1.5 animate-spin" />
                ) : (
                  <Rocket className="h-4 w-4 mr-1.5" />
                )}
                {tt("C'est parti", "Let's go")}
              </Button>
            )}
          </div>
        </div>
      </div>

      <div className="rounded-xl bg-emerald-500/5 border border-emerald-500/20 p-4 flex items-start gap-3">
        <CheckCircle2 className="h-5 w-5 text-emerald-400 shrink-0 mt-0.5" />
        <div>
          <p className="text-sm font-medium">{tt('Vous êtes prêt 🎉', "You're ready 🎉")}</p>
          <p className="text-xs text-muted-foreground mt-0.5">
            {tt(
              "Vous pouvez revenir à cet onboarding à tout moment depuis vos réglages.",
              'You can come back to this onboarding anytime from your settings.'
            )}
          </p>
        </div>
      </div>
    </div>
  );
}
