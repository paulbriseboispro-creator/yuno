import { useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { Check } from 'lucide-react';
import { supabase } from '@/integrations/supabase/client';
import { useLanguage } from '@/contexts/LanguageContext';
// Libellés RÉELS des events (MUSIC_GENRES) — matchent events.music_genres.
import { MUSIC_GENRES as GENRES } from '@/lib/musicGenres';
import { Wordmark } from '@/components/brand/Wordmark';

// Quiz de goût d'onboarding — esthétique éditoriale (DESIGN_SYSTEM_PUBLIC) :
// noir #0A0A0A, Space Grotesk uppercase, JetBrains Mono trackée, tranchant,
// rouge #E8192C. 4 questions courtes, skippable. Alimente le « cerveau unique » :
// genres (libellés RÉELS des events) + 3 signaux comportementaux (fréquence,
// budget, billets/tables) embeddés dans le même espace que les events.

type Tri = [string, string, string]; // [fr, en, es]
type Option = { value: string; emoji?: string; label: Tri; desc?: Tri };
type Question = { id: string; type: 'multi' | 'single'; max?: number; title: Tri; sub: Tri; options: Option[] };


const QUESTIONS: Question[] = [
  {
    id: 'genres', type: 'multi', max: 4,
    title: ['Tes sons', 'Your sound', 'Tu sonido'],
    sub: ['Choisis jusqu’à 4 genres', 'Pick up to 4 genres', 'Elige hasta 4 géneros'],
    options: GENRES.map((g) => ({ value: g, label: [g, g, g] as Tri })),
  },
  {
    id: 'frequency', type: 'single',
    title: ['Tu sors', 'You go out', 'Sales'],
    sub: ['Combien de fois par semaine ?', 'How often per week?', '¿Cuántas veces por semana?'],
    options: [
      { value: 'low',    emoji: '🌙', label: ['De temps en temps', 'Once in a while', 'De vez en cuando'], desc: ['1 soir ou moins', 'One night or less', 'Una noche o menos'] },
      { value: 'weekly', emoji: '🗓️', label: ['Chaque semaine', 'Every week', 'Cada semana'],             desc: ['1 à 2 soirs', '1 to 2 nights', '1 a 2 noches'] },
      { value: 'often',  emoji: '🔥', label: ['Souvent', 'Often', 'A menudo'],                             desc: ['3 à 4 soirs', '3 to 4 nights', '3 a 4 noches'] },
      { value: 'always', emoji: '⚡', label: ['Non-stop', 'Non-stop', 'Sin parar'],                        desc: ['Presque tous les soirs', 'Almost every night', 'Casi cada noche'] },
    ],
  },
  {
    id: 'budget', type: 'single',
    title: ['Ton budget', 'Your budget', 'Tu presupuesto'],
    sub: ['Par soirée, en moyenne', 'Per night, on average', 'Por noche, de media'],
    options: [
      { value: 'budget', emoji: '🪙', label: ['Petit budget', 'On a budget', 'Ajustado'],  desc: ['Moins de 30€', 'Under 30€', 'Menos de 30€'] },
      { value: 'mid',    emoji: '💶', label: ['Raisonnable', 'Reasonable', 'Razonable'],    desc: ['30 à 70€', '30 to 70€', '30 a 70€'] },
      { value: 'high',   emoji: '💳', label: ['Confort', 'Comfortable', 'Cómodo'],          desc: ['70 à 150€', '70 to 150€', '70 a 150€'] },
      { value: 'vip',    emoji: '💎', label: ['VIP', 'VIP', 'VIP'],                          desc: ['150€ et plus', '150€ and up', '150€ o más'] },
    ],
  },
  {
    id: 'booking_pref', type: 'single',
    title: ['Ton style', 'Your style', 'Tu estilo'],
    sub: ['Plutôt billets ou tables ?', 'Tickets or tables?', '¿Entradas o mesas?'],
    options: [
      { value: 'tickets', emoji: '🎟️', label: ['Billets', 'Tickets', 'Entradas'],       desc: ['J’entre et je danse', 'Get in and dance', 'Entro y bailo'] },
      { value: 'tables',  emoji: '🍾', label: ['Tables VIP', 'VIP tables', 'Mesas VIP'], desc: ['Bouteilles, carré VIP', 'Bottles, VIP area', 'Botellas, zona VIP'] },
      { value: 'both',    emoji: '🔀', label: ['Les deux', 'Both', 'Ambos'],             desc: ['Ça dépend du soir', 'Depends on the night', 'Según la noche'] },
    ],
  },
];

const RED = '#E8192C';

export function OnboardingTasteQuiz({ userId, onDone }: { userId: string; onDone: () => void }) {
  const { language } = useLanguage();
  const tr = (t: Tri) => (language === 'fr' ? t[0] : language === 'es' ? t[2] : t[1]);

  const [stepIdx, setStepIdx] = useState(0);
  const [answers, setAnswers] = useState<Record<string, string[]>>({});
  const [saving, setSaving] = useState(false);

  const q = QUESTIONS[stepIdx];
  const sel = answers[q.id] || [];
  const isLast = stepIdx === QUESTIONS.length - 1;
  const canNext = q.type === 'multi' ? sel.length > 0 : sel.length === 1;

  const toggle = (value: string) => {
    if (q.type === 'single') {
      setAnswers((a) => ({ ...a, [q.id]: [value] }));
      return;
    }
    const cur = answers[q.id] || [];
    const max = q.max || 4;
    if (cur.includes(value)) setAnswers((a) => ({ ...a, [q.id]: cur.filter((v) => v !== value) }));
    else if (cur.length < max) setAnswers((a) => ({ ...a, [q.id]: [...cur, value] }));
  };

  const persist = async (final: Record<string, string[]>) => {
    setSaving(true);
    try {
      await supabase.from('user_taste_profiles').upsert(
        {
          user_id: userId,
          genres: final.genres || [],
          frequency: final.frequency?.[0] || null,
          budget: final.budget?.[0] || null,
          booking_pref: final.booking_pref?.[0] || null,
          // Colonnes héritées NOT NULL (schéma d'origine) — non lues par le moteur.
          music_style: (final.genres || []).join(','),
          drink_preference: '', vibe_preference: '', crowd_size: '', night_type: '', energy: null,
        } as never,
        { onConflict: 'user_id' },
      );
    } catch {
      /* best-effort : on ne bloque jamais l'onboarding sur une erreur de sauvegarde */
    }
    onDone();
  };

  const next = () => {
    if (!canNext) return;
    if (isLast) persist(answers);
    else setStepIdx(stepIdx + 1);
  };

  const chip = (active: boolean): React.CSSProperties => ({
    fontFamily: "'JetBrains Mono', monospace",
    fontSize: '11px', fontWeight: 700, letterSpacing: '0.06em', textTransform: 'uppercase',
    color: active ? '#fff' : '#E5E5E5',
    background: active ? 'rgba(232,25,44,0.14)' : 'rgba(255,255,255,0.05)',
    border: `1px solid ${active ? RED : 'rgba(255,255,255,0.12)'}`,
    borderRadius: 3, padding: '13px 10px', textAlign: 'center', cursor: 'pointer',
    transition: 'transform 120ms cubic-bezier(0.16,1,0.3,1), background 150ms, border-color 150ms',
  });

  return (
    <motion.div
      initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
      className="fixed inset-0 z-[210] flex flex-col" style={{ background: '#0A0A0A' }}
    >
      {/* Header */}
      <div className="flex items-center justify-between px-5"
           style={{ paddingTop: 'max(18px, env(safe-area-inset-top))', paddingBottom: 14 }}>
        <Wordmark height={16} tone="red" />
        <button onClick={() => persist(answers)} disabled={saving}
          className="font-mono" style={{ fontSize: 11, letterSpacing: '0.10em', textTransform: 'uppercase', color: '#9A9A9A', background: 'none', border: 'none', cursor: 'pointer' }}>
          {tr(['Passer', 'Skip', 'Saltar'])}
        </button>
      </div>

      {/* Progress */}
      <div className="px-5" style={{ marginBottom: 4 }}>
        <div style={{ height: 2, background: 'rgba(255,255,255,0.07)', borderRadius: 1, overflow: 'hidden' }}>
          <motion.div animate={{ width: `${((stepIdx + 1) / QUESTIONS.length) * 100}%` }} transition={{ duration: 0.3 }}
            style={{ height: '100%', background: RED }} />
        </div>
      </div>

      <div className="flex-1 overflow-y-auto px-5" style={{ maxWidth: 768, margin: '0 auto', width: '100%' }}>
        <p className="font-mono" style={{ fontSize: 10.5, letterSpacing: '0.16em', textTransform: 'uppercase', color: '#5A5A5E', margin: '10px 0 18px' }}>
          {tr(['PERSONNALISE TON YUNO', 'MAKE YUNO YOURS', 'HAZ TUYO YUNO'])} · {String(stepIdx + 1).padStart(2, '0')} / {String(QUESTIONS.length).padStart(2, '0')}
        </p>

        <AnimatePresence mode="wait">
          <motion.div key={stepIdx}
            initial={{ opacity: 0, x: 18 }} animate={{ opacity: 1, x: 0 }} exit={{ opacity: 0, x: -18 }}
            transition={{ duration: 0.22 }}>

            <h1 className="font-display text-white uppercase"
                style={{ fontSize: 'clamp(34px, 9vw, 56px)', fontWeight: 700, letterSpacing: '-0.03em', lineHeight: 0.92 }}>
              {tr(q.title)}
            </h1>
            <p className="font-mono" style={{ fontSize: 11, letterSpacing: '0.05em', color: '#9A9A9A', margin: '12px 0 22px' }}>
              {tr(q.sub)}{q.type === 'multi' ? ` · ${sel.length}/${q.max}` : ''}
            </p>

            {q.type === 'multi' ? (
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 9 }}>
                {q.options.map((o) => {
                  const active = sel.includes(o.value);
                  return (
                    <button key={o.value} onClick={() => toggle(o.value)} style={chip(active)}
                      onMouseDown={(e) => (e.currentTarget.style.transform = 'scale(0.97)')}
                      onMouseUp={(e) => (e.currentTarget.style.transform = '')}
                      onMouseLeave={(e) => (e.currentTarget.style.transform = '')}>
                      {tr(o.label)}
                    </button>
                  );
                })}
              </div>
            ) : (
              <div style={{ display: 'flex', flexDirection: 'column', gap: 9 }}>
                {q.options.map((o) => {
                  const active = sel.includes(o.value);
                  return (
                    <button key={o.value} onClick={() => toggle(o.value)}
                      style={{
                        display: 'flex', alignItems: 'center', gap: 14, textAlign: 'left',
                        background: active ? 'rgba(232,25,44,0.10)' : '#141414',
                        border: `1px solid ${active ? RED : 'rgba(255,255,255,0.08)'}`,
                        borderRadius: 4, padding: '15px 16px', cursor: 'pointer',
                        transition: 'transform 120ms cubic-bezier(0.16,1,0.3,1), border-color 150ms',
                      }}
                      onMouseDown={(e) => (e.currentTarget.style.transform = 'scale(0.98)')}
                      onMouseUp={(e) => (e.currentTarget.style.transform = '')}
                      onMouseLeave={(e) => (e.currentTarget.style.transform = '')}>
                      <span style={{ fontSize: 26, lineHeight: 1 }}>{o.emoji}</span>
                      <span style={{ flex: 1 }}>
                        <span className="font-display font-bold text-white uppercase" style={{ display: 'block', fontSize: 17, letterSpacing: '-0.01em' }}>
                          {tr(o.label)}
                        </span>
                        {o.desc && (
                          <span className="font-mono" style={{ fontSize: 10.5, letterSpacing: '0.04em', color: '#9A9A9A', textTransform: 'uppercase' }}>
                            {tr(o.desc)}
                          </span>
                        )}
                      </span>
                      {active && (
                        <span style={{ width: 20, height: 20, borderRadius: 999, background: RED, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                          <Check className="h-3 w-3 text-white" />
                        </span>
                      )}
                    </button>
                  );
                })}
              </div>
            )}
          </motion.div>
        </AnimatePresence>
      </div>

      {/* Footer CTA */}
      <div className="px-5" style={{ maxWidth: 768, margin: '0 auto', width: '100%', paddingBottom: 'max(20px, env(safe-area-inset-bottom))', paddingTop: 12 }}>
        <p className="font-mono" style={{ fontSize: 10, letterSpacing: '0.06em', color: '#5A5A5E', textTransform: 'uppercase', margin: '0 0 12px', textAlign: 'center' }}>
          {tr(['3 soirées faites pour toi, chaque semaine', '3 nights made for you, every week', '3 fiestas para ti, cada semana'])}
        </p>
        <button
          onClick={next} disabled={!canNext || saving}
          className="font-mono font-bold uppercase w-full"
          style={{
            height: 50, background: canNext ? RED : 'rgba(255,255,255,0.08)',
            color: canNext ? '#fff' : '#5A5A5E', border: 'none', borderRadius: 3,
            fontSize: 12, letterSpacing: '0.12em', cursor: canNext ? 'pointer' : 'default',
            transition: 'transform 150ms cubic-bezier(0.23,1,0.32,1)',
          }}
          onMouseDown={(e) => canNext && (e.currentTarget.style.transform = 'scale(0.98)')}
          onMouseUp={(e) => (e.currentTarget.style.transform = '')}
          onMouseLeave={(e) => (e.currentTarget.style.transform = '')}>
          {isLast ? tr(['C’est parti', 'Let’s go', 'Vamos']) : tr(['Suivant', 'Next', 'Siguiente'])}
        </button>
      </div>
    </motion.div>
  );
}
