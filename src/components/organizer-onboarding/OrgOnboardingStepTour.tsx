import { useState } from 'react';
import { useLanguage } from '@/contexts/LanguageContext';
import { translate } from '@/i18n/orgTranslate';
import { motion, AnimatePresence } from 'framer-motion';
import {
  LayoutDashboard, Ticket, ScanLine, BarChart3, Handshake, Rocket,
  ArrowLeft, ArrowRight, Sparkles, Check, type LucideIcon,
} from 'lucide-react';
import { StepHeader, PrimaryButton, GhostButton, InnerCard, DoneRow, RED, T1, T2, T3, C_FAINT } from '@/components/onboarding/onboardingUI';

interface Props {
  onComplete: () => void | Promise<void>;
}

export function OrgOnboardingStepTour({ onComplete }: Props) {
  const { language } = useLanguage();
  const tt = (fr: string, en: string, es?: string) => translate(language, fr, en, es);
  const [slide, setSlide] = useState(0);
  const [finishing, setFinishing] = useState(false);

  const slides: { icon: LucideIcon; title: string; desc: string }[] = [
    {
      icon: LayoutDashboard,
      title: tt('Mission Control', 'Mission Control', 'Mission Control'),
      desc: tt('Votre tableau de bord temps réel : ventes, check-ins, prochain événement, KPI 30 jours.', 'Your real-time dashboard: sales, check-ins, next event, 30-day KPIs.', 'Tu panel de control en tiempo real: ventas, check-ins, próximo evento, KPIs de 30 días.'),
    },
    {
      icon: Ticket,
      title: tt('Billetterie flexible', 'Flexible ticketing', 'Ticketing flexible'),
      desc: tt('Tarifs simples, vagues progressives ou créneaux. Listes privées et codes promoteurs inclus.', 'Simple prices, progressive waves or time slots. Private lists and promoter codes included.', 'Precios simples, oleadas progresivas o franjas horarias. Listas privadas y códigos de promotor incluidos.'),
    },
    {
      icon: ScanLine,
      title: tt('Check-in à la porte', 'Door check-in', 'Check-in en la puerta'),
      desc: tt('Scannez les QR codes hors-ligne, statistiques en temps réel, gestion des refus.', 'Scan QR codes offline, real-time stats, rejection handling.', 'Escanea los códigos QR sin conexión, estadísticas en tiempo real, gestión de rechazos.'),
    },
    {
      icon: BarChart3,
      title: tt('Analyses avancées', 'Advanced analytics', 'Analíticas avanzadas'),
      desc: tt('Vélocité de vente, ratio demande/offre, hype score, segments clients, exports.', 'Sales velocity, demand ratio, hype score, customer segments, exports.', 'Velocidad de venta, ratio demanda/oferta, hype score, segmentos de clientes, exportaciones.'),
    },
    {
      icon: Handshake,
      title: tt('Écosystème nightlife', 'Nightlife ecosystem', 'Ecosistema nightlife'),
      desc: tt('Partenariats avec clubs, DJs, équipe, promoteurs. Splits de revenus automatisés.', 'Partnerships with clubs, DJs, team, promoters. Automated revenue splits.', 'Colaboraciones con clubs, DJs, equipo, promotores. Reparto de ingresos automatizado.'),
    },
  ];

  const isLast = slide === slides.length - 1;
  const current = slides[slide];
  const Icon = current.icon;

  return (
    <div className="space-y-6">
      <StepHeader
        icon={Sparkles}
        accent
        title={tt('Découvrez Yuno', 'Discover Yuno', 'Descubre Yuno')}
        subtitle={tt('Une visite éclair des fonctionnalités clés avant de plonger.', 'A quick tour of the key features before diving in.', 'Un recorrido rápido por las funciones clave antes de empezar.')}
      />

      <InnerCard style={{ padding: 0, overflow: 'hidden', minHeight: 240 }}>
        <AnimatePresence mode="wait">
          <motion.div
            key={slide}
            initial={{ opacity: 0, x: 16 }}
            animate={{ opacity: 1, x: 0 }}
            exit={{ opacity: 0, x: -16 }}
            transition={{ duration: 0.22 }}
            className="p-6"
          >
            <div className="w-14 h-14 rounded-2xl flex items-center justify-center mb-4" style={{ background: 'rgba(232,25,44,0.1)', border: '1px solid rgba(232,25,44,0.2)' }}>
              <Icon className="w-7 h-7" style={{ color: RED }} />
            </div>
            <h3 style={{ color: T1, fontSize: 18, fontWeight: 660, letterSpacing: '-0.01em' }}>{current.title}</h3>
            <p style={{ color: T2, fontSize: 13.5, marginTop: 8, lineHeight: 1.55 }}>{current.desc}</p>
          </motion.div>
        </AnimatePresence>

        <div className="flex items-center justify-between px-6 pb-5">
          <div className="flex gap-1.5">
            {slides.map((_, i) => (
              <button
                key={i}
                onClick={() => setSlide(i)}
                className="rounded-full transition-all cursor-pointer"
                style={{ height: 6, width: i === slide ? 22 : 6, background: i === slide ? RED : C_FAINT }}
                aria-label={`slide ${i + 1}`}
              />
            ))}
          </div>
          <div className="flex gap-2">
            <GhostButton disabled={slide === 0} onClick={() => setSlide(s => s - 1)} style={{ padding: '8px 12px' }}>
              <ArrowLeft className="w-4 h-4" />
            </GhostButton>
            {!isLast ? (
              <PrimaryButton icon={ArrowRight} onClick={() => setSlide(s => s + 1)} style={{ padding: '8px 14px' }}>
                {tt('Suivant', 'Next', 'Siguiente')}
              </PrimaryButton>
            ) : (
              <PrimaryButton
                icon={Rocket}
                loading={finishing}
                onClick={async () => { setFinishing(true); await onComplete(); }}
                style={{ padding: '8px 14px' }}
              >
                {tt("C'est parti", "Let's go", "Vamos")}
              </PrimaryButton>
            )}
          </div>
        </div>
      </InnerCard>

      <DoneRow>
        <Check className="w-5 h-5 flex-none" style={{ color: '#34D399' }} />
        <div>
          <p style={{ color: T1, fontSize: 13.5, fontWeight: 600 }}>{tt('Vous êtes prêt', "You're ready", "Estás listo")}</p>
          <p style={{ color: T3, fontSize: 12, marginTop: 1 }}>{tt('Revenez à cet onboarding à tout moment depuis vos réglages.', 'Come back to this onboarding anytime from your settings.', 'Vuelve a este onboarding cuando quieras desde tus ajustes.')}</p>
        </div>
      </DoneRow>
    </div>
  );
}
