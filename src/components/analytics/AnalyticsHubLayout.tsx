import { ReactNode } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { Activity, Globe, Target, Users } from 'lucide-react';
import { useLanguage } from '@/contexts/LanguageContext';

export type AnalyticsPillar = 'pulse' | 'acquisition' | 'behavior' | 'audience';

interface Props {
  active: AnalyticsPillar;
  onChange: (p: AnalyticsPillar) => void;
  children: ReactNode;
}

export function AnalyticsHubLayout({ active, onChange, children }: Props) {
  const { language } = useLanguage();
  const tt = (fr: string, en: string) => (language === 'fr' ? fr : en);

  const pillars: { key: AnalyticsPillar; label: string; icon: any; description: string }[] = [
    { key: 'pulse', label: tt('Pulse', 'Pulse'), icon: Activity, description: tt('Activité en temps réel', 'Real-time activity') },
    { key: 'acquisition', label: tt('Acquisition', 'Acquisition'), icon: Globe, description: tt('Sources & campagnes', 'Sources & campaigns') },
    { key: 'behavior', label: tt('Comportement', 'Behavior'), icon: Target, description: tt('Funnel & engagement', 'Funnel & engagement') },
    { key: 'audience', label: tt('Audience', 'Audience'), icon: Users, description: tt('Segments & tiers', 'Segments & tiers') },
  ];

  return (
    <div className="grid lg:grid-cols-[220px,1fr] gap-4">
      {/* Rail nav — sticky desktop, horizontal scroll mobile */}
      <aside className="lg:sticky lg:top-4 lg:self-start">
        <div className="lg:hidden -mx-4 px-4 overflow-x-auto pb-2">
          <div className="flex gap-2 w-max">
            {pillars.map(p => (
              <PillarButton key={p.key} pillar={p} active={active === p.key} onClick={() => onChange(p.key)} compact />
            ))}
          </div>
        </div>
        <nav className="hidden lg:flex flex-col gap-1.5 p-2 rounded-2xl" style={{ border: '1px solid rgba(255,255,255,0.085)', background: 'rgba(255,255,255,0.02)' }}>
          {pillars.map(p => (
            <PillarButton key={p.key} pillar={p} active={active === p.key} onClick={() => onChange(p.key)} />
          ))}
        </nav>
      </aside>

      <main className="min-w-0">
        <AnimatePresence mode="wait">
          <motion.div
            key={active}
            initial={{ opacity: 0, y: 8 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -4 }}
            transition={{ duration: 0.2 }}
          >
            {children}
          </motion.div>
        </AnimatePresence>
      </main>
    </div>
  );
}

function PillarButton({ pillar, active, onClick, compact }: { pillar: any; active: boolean; onClick: () => void; compact?: boolean }) {
  const Icon = pillar.icon;
  return (
    <button
      onClick={onClick}
      className={`group relative flex items-center gap-2.5 rounded-xl transition-all whitespace-nowrap cursor-pointer ${compact ? 'px-3 py-2' : 'p-3 w-full text-left'}`}
      style={active
        ? { background: 'rgba(232,25,44,0.09)', border: '1px solid rgba(232,25,44,0.22)', boxShadow: '0 1px 0 rgba(255,255,255,.04) inset' }
        : { border: '1px solid transparent' }}
    >
      <Icon
        className="h-4 w-4 transition-colors"
        style={{ color: active ? '#E8192C' : 'rgba(255,255,255,0.35)' }}
      />
      <div className="flex-1 min-w-0">
        <div className="text-sm font-semibold" style={{ color: active ? 'rgba(255,255,255,0.96)' : 'rgba(255,255,255,0.5)' }}>
          {pillar.label}
        </div>
        {!compact && (
          <div className="text-[10px] truncate" style={{ color: 'rgba(255,255,255,0.28)' }}>
            {pillar.description}
          </div>
        )}
      </div>
      {active && !compact && (
        <div className="w-1 h-5 rounded-full" style={{ background: '#E8192C', opacity: 0.8 }} />
      )}
    </button>
  );
}
