import { useEffect, useState } from 'react';
import { createPortal } from 'react-dom';
import { Sparkles, Eye, ShieldCheck, TrendingUp, ArrowRight, X } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { supabase } from '@/integrations/supabase/client';
import { useSubscriptionPlan } from '@/hooks/useSubscriptionPlan';
import { isCollabPlan } from '@/lib/planFeatures';
import { useLanguage } from '@/contexts/LanguageContext';
import { translate } from '@/i18n/orgTranslate';

const seenKey = (venueId: string) => `yuno_collab_welcome_seen_${venueId}`;

interface Props {
  venueId: string | null;
  venueName?: string;
}

/**
 * One-time welcome shown the FIRST time a club on the auto-granted "collab" plan
 * lands in the owner area. A brand-new partnered club used to be dropped straight
 * into a dense dashboard with zero context — this is the missing "why am I here?"
 * moment. Frames the three things the club gains, then steps out of the way.
 *
 * Self-gating: only renders for a collab-plan venue that hasn't dismissed it yet
 * (localStorage, per venue). Fetches the inviting organizer's name for a personal
 * touch, but degrades gracefully to a generic label.
 */
export function CollabWelcomeOverlay({ venueId, venueName }: Props) {
  const { plan, loading } = useSubscriptionPlan();
  const { language } = useLanguage();
  const tt = (fr: string, en: string, es?: string) => translate(language, fr, en, es);
  const [open, setOpen] = useState(false);
  const [orgName, setOrgName] = useState<string | null>(null);

  useEffect(() => {
    if (loading || !venueId || !isCollabPlan(plan)) return;
    if (typeof window === 'undefined') return;
    if (localStorage.getItem(seenKey(venueId))) return;
    setOpen(true);
  }, [loading, venueId, plan]);

  useEffect(() => {
    if (!open || !venueId) return;
    let cancelled = false;
    (async () => {
      const { data: p } = await supabase
        .from('venue_organizer_partnerships')
        .select('organizer_user_id')
        .eq('venue_id', venueId)
        .eq('status', 'active')
        .order('accepted_at', { ascending: false })
        .limit(1)
        .maybeSingle();
      if (cancelled || !p?.organizer_user_id) return;
      const { data: prof } = await supabase
        .from('organizer_profiles' as any)
        .select('display_name')
        .eq('user_id', p.organizer_user_id)
        .maybeSingle();
      if (!cancelled) setOrgName((prof as any)?.display_name ?? null);
    })();
    return () => { cancelled = true; };
  }, [open, venueId]);

  if (!open || !venueId) return null;

  const dismiss = () => {
    localStorage.setItem(seenKey(venueId), '1');
    setOpen(false);
  };

  const inviter = orgName ?? tt('Votre organisateur partenaire', 'Your partner organizer', 'Tu organizador asociado');

  const promises = [
    {
      icon: Eye,
      title: tt('Vous voyez qui vient', 'See who shows up', 'Mira quién viene'),
      sub: tt("Âge, ville, fidèles vs nouveaux — sur chaque soirée.", "Age, city, regulars vs newcomers, for every night.", 'Edad, ciudad, fieles vs nuevos, en cada noche.'),
    },
    {
      icon: ShieldCheck,
      title: tt('Votre part est garantie', 'Your cut is guaranteed', 'Tu parte está garantizada'),
      sub: tt('Un contrat signé verrouille le partage. Yuno fait les maths.', 'A signed contract locks the split. Yuno does the math.', 'Un contrato firmado fija el reparto. Yuno hace los cálculos.'),
    },
    {
      icon: TrendingUp,
      title: tt('Vous mesurez le succès réel', 'Measure the real result', 'Mide el resultado real'),
      sub: tt('Revenu net, verdict de soirée, ce qui a marché.', 'Net revenue, night verdict, what worked.', 'Ingreso neto, veredicto de la noche, qué funcionó.'),
    },
  ];

  return createPortal(
    <div
      className="fixed inset-0 z-[120] flex items-center justify-center p-4"
      style={{ background: 'rgba(0,0,0,0.78)', backdropFilter: 'blur(8px)' }}
      onClick={dismiss}
    >
      <div
        className="relative w-full max-w-md rounded-3xl overflow-hidden"
        style={{
          background: 'linear-gradient(180deg,rgba(255,255,255,.05),rgba(255,255,255,.01)),#0a0a0c',
          border: '1px solid rgba(255,255,255,0.1)',
          boxShadow: '0 30px 80px -20px rgba(0,0,0,0.9)',
        }}
        onClick={(e) => e.stopPropagation()}
      >
        <button
          onClick={dismiss}
          className="absolute right-3 top-3 z-10 h-8 w-8 inline-flex items-center justify-center rounded-full text-white/50 hover:text-white hover:bg-white/10 transition-colors"
          aria-label={tt('Fermer', 'Close', 'Cerrar')}
        >
          <X className="h-4 w-4" />
        </button>
        <div className="absolute -right-16 -top-16 h-48 w-48 rounded-full" style={{ background: 'rgba(232,25,44,0.25)', filter: 'blur(60px)' }} />
        <div className="relative p-7 sm:p-8">
          <div className="flex h-12 w-12 items-center justify-center rounded-2xl mb-5" style={{ background: 'rgba(232,25,44,0.15)', border: '1px solid rgba(232,25,44,0.3)' }}>
            <Sparkles className="h-6 w-6" style={{ color: '#E8192C' }} />
          </div>
          <h2 className="text-2xl font-bold leading-tight text-white">
            {tt('Bienvenue sur Yuno', 'Welcome to Yuno', 'Bienvenido a Yuno')}{venueName ? `, ${venueName}` : ''}.
          </h2>
          <p className="mt-2 text-sm text-white/60">
            {tt(
              `${inviter} vous a invité à co-piloter une soirée sur Yuno. Voici ce que vous y gagnez.`,
              `${inviter} invited you to co-run a night on Yuno. Here is what you get.`,
              `${inviter} te invitó a co-dirigir una noche en Yuno. Esto es lo que ganas.`,
            )}
          </p>
          <div className="mt-6 space-y-3">
            {promises.map((p, i) => (
              <div key={i} className="flex items-start gap-3 rounded-2xl p-3" style={{ background: 'rgba(255,255,255,0.03)', border: '1px solid rgba(255,255,255,0.07)' }}>
                <div className="flex h-9 w-9 flex-none items-center justify-center rounded-xl" style={{ background: 'rgba(255,255,255,0.05)' }}>
                  <p.icon className="h-4 w-4" style={{ color: '#E8192C' }} />
                </div>
                <div className="min-w-0">
                  <p className="text-sm font-semibold text-white">{p.title}</p>
                  <p className="text-xs text-white/50 mt-0.5">{p.sub}</p>
                </div>
              </div>
            ))}
          </div>
          <Button onClick={dismiss} className="mt-7 w-full" size="lg">
            {tt('Découvrir mon espace', 'Explore my space', 'Descubrir mi espacio')}
            <ArrowRight className="ml-1.5 h-4 w-4" />
          </Button>
        </div>
      </div>
    </div>,
    document.body,
  );
}
