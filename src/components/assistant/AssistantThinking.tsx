import { useEffect, useState } from 'react';
import { motion, useReducedMotion } from 'framer-motion';
import { useLanguage } from '@/contexts/LanguageContext';
import { AnimatedOrb } from '@/components/ui/AnimatedOrb';

/**
 * L'attente avant la première lettre.
 *
 * Trois points qui rebondissent ne disent rien. Ici l'orbe de la page d'accueil
 * revient en petit — même signature visuelle, donc l'app reste la même app — et
 * une ligne d'état défile derrière un reflet qui balaie. Les phases sont
 * honnêtes : la fonction cherche vraiment dans le catalogue avant de répondre.
 */
export function AssistantThinking() {
  const { t } = useLanguage();
  const reduce = useReducedMotion();
  const phases = [t('assistant.think1'), t('assistant.think2'), t('assistant.think3')];
  const [phase, setPhase] = useState(0);

  useEffect(() => {
    if (reduce) return;
    const id = setInterval(() => setPhase((p) => (p + 1) % phases.length), 2200);
    return () => clearInterval(id);
  }, [reduce, phases.length]);

  return (
    <motion.div
      initial={{ opacity: 0, y: 8 }}
      animate={{ opacity: 1, y: 0 }}
      exit={{ opacity: 0, y: -8 }}
      transition={{ duration: 0.28, ease: [0.16, 1, 0.3, 1] }}
      className="flex items-center gap-2.5 px-2"
      role="status"
      aria-live="polite"
    >
      <AnimatedOrb intensity="searching" size={30} />
      <div className="relative overflow-hidden">
        <motion.p
          key={phase}
          initial={reduce ? false : { opacity: 0, y: 6 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.3, ease: [0.16, 1, 0.3, 1] }}
          className="text-[13px]"
          style={{ color: 'rgba(255,255,255,0.45)' }}
        >
          {phases[phase]}
        </motion.p>
        {!reduce && (
          <motion.span
            aria-hidden="true"
            className="pointer-events-none absolute inset-0"
            style={{
              background:
                'linear-gradient(100deg, transparent 20%, rgba(255,255,255,0.42) 50%, transparent 80%)',
              mixBlendMode: 'overlay',
            }}
            animate={{ x: ['-120%', '220%'] }}
            transition={{ duration: 1.9, repeat: Infinity, ease: 'linear' }}
          />
        )}
      </div>
    </motion.div>
  );
}
