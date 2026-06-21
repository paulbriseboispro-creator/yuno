import { useState, useEffect, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import { motion, AnimatePresence } from 'framer-motion';
import {
  Rocket, ArrowLeft, ArrowRight, Check, User, Music, Link2, Sparkles, Loader2,
} from 'lucide-react';
import { toast } from 'sonner';
import { useAuth } from '@/hooks/useAuth';
import { useLanguage } from '@/contexts/LanguageContext';
import { makeDjT } from '@/i18n/djTranslate';
import { supabase } from '@/integrations/supabase/client';
import {
  RED, POS, T1, T2, T3, C_FAINT, INNER_BG, BORDER, CARD_BG, CARD_SHADOW, DJSpinner,
} from '@/components/dj/dj-ui';
import { djOnboardingDoneKey } from '@/lib/djOnboarding';

const GENRE_PRESETS = [
  'House', 'Techno', 'Hip-Hop', 'Afro', 'Amapiano', 'Latin',
  'Reggaeton', 'Disco', 'R&B', 'EDM', 'Funk', 'Pop',
];

const TOTAL = 5;

interface FormState {
  first_name: string; last_name: string; stage_name: string;
  music_genres: string[]; city: string; country: string;
  instagram_url: string; soundcloud_url: string; spotify_url: string;
  tiktok_url: string; youtube_url: string; whatsapp_number: string;
}

const EMPTY: FormState = {
  first_name: '', last_name: '', stage_name: '',
  music_genres: [], city: '', country: '',
  instagram_url: '', soundcloud_url: '', spotify_url: '',
  tiktok_url: '', youtube_url: '', whatsapp_number: '',
};

function Field({ label, value, onChange, placeholder }: {
  label: string; value: string; onChange: (v: string) => void; placeholder?: string;
}) {
  return (
    <div>
      <label className="block text-[12.5px] font-medium mb-1.5" style={{ color: T2 }}>{label}</label>
      <input value={value} onChange={e => onChange(e.target.value)} placeholder={placeholder}
        className="w-full rounded-xl px-3.5 py-2.5 text-sm outline-none"
        style={{ background: INNER_BG, border: `1px solid ${BORDER}`, color: T1 }} />
    </div>
  );
}

export default function DJOnboarding() {
  const navigate = useNavigate();
  const { user } = useAuth();
  const { language } = useLanguage();
  const tt = makeDjT(language);

  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [step, setStep] = useState(1);
  const [form, setForm] = useState<FormState>(EMPTY);

  const set = <K extends keyof FormState>(k: K, v: FormState[K]) =>
    setForm(prev => ({ ...prev, [k]: v }));

  // Prefill from any existing profile row (the DJ may be partway done already).
  useEffect(() => {
    if (!user) return;
    (async () => {
      const { data } = await supabase
        .from('djs')
        .select('first_name,last_name,stage_name,music_genres,city,country,instagram_url,soundcloud_url,spotify_url,tiktok_url,youtube_url,whatsapp_number')
        .eq('user_id', user.id)
        .limit(1)
        .maybeSingle();
      if (data) {
        setForm({
          first_name: data.first_name || '', last_name: data.last_name || '',
          stage_name: data.stage_name || '', music_genres: data.music_genres || [],
          city: data.city || '', country: data.country || '',
          instagram_url: data.instagram_url || '', soundcloud_url: data.soundcloud_url || '',
          spotify_url: data.spotify_url || '', tiktok_url: data.tiktok_url || '',
          youtube_url: data.youtube_url || '', whatsapp_number: data.whatsapp_number || '',
        });
      }
      setLoading(false);
    })();
  }, [user]);

  const toggleGenre = (g: string) => {
    setForm(prev => {
      if (prev.music_genres.includes(g)) return { ...prev, music_genres: prev.music_genres.filter(x => x !== g) };
      if (prev.music_genres.length >= 3) return prev;
      return { ...prev, music_genres: [...prev.music_genres, g] };
    });
  };

  const finishAndExit = useCallback(() => {
    if (user) localStorage.setItem(djOnboardingDoneKey(user.id), '1');
    // Hard navigate so the dashboard re-reads the freshly-written profile.
    window.location.assign('/dj');
  }, [user]);

  const save = async () => {
    if (!user) return;
    setSaving(true);
    // Sync across every roster row for this user (one DJ, many venues/orgs).
    const { error } = await supabase
      .from('djs')
      .update({
        first_name: form.first_name.trim(),
        last_name: form.last_name.trim(),
        stage_name: form.stage_name.trim() || null,
        music_genres: form.music_genres,
        city: form.city.trim() || null,
        country: form.country.trim() || null,
        instagram_url: form.instagram_url.trim() || null,
        soundcloud_url: form.soundcloud_url.trim() || null,
        spotify_url: form.spotify_url.trim() || null,
        tiktok_url: form.tiktok_url.trim() || null,
        youtube_url: form.youtube_url.trim() || null,
        whatsapp_number: form.whatsapp_number.trim() || null,
        updated_at: new Date().toISOString(),
      })
      .eq('user_id', user.id);
    setSaving(false);
    if (error) { toast.error(tt('Échec de l\'enregistrement', 'Save failed', 'Error al guardar')); return; }
    finishAndExit();
  };

  const skip = () => finishAndExit();

  if (loading || !user) return <DJSpinner />;

  const canProceedIdentity = form.first_name.trim() && form.last_name.trim();
  const progress = Math.round(((step - 1) / TOTAL) * 100);

  const STEP_META = [
    { icon: Rocket, title: tt('Bienvenue sur Yuno', 'Welcome to Yuno', 'Bienvenido a Yuno') },
    { icon: User, title: tt('Qui es-tu ?', 'Who are you?', '¿Quién eres?') },
    { icon: Music, title: tt('Ton son', 'Your sound', 'Tu sonido') },
    { icon: Link2, title: tt('Tes liens', 'Your links', 'Tus enlaces') },
    { icon: Sparkles, title: tt('Tout est prêt', "You're all set", 'Todo listo') },
  ];
  const Icon = STEP_META[step - 1].icon;

  return (
    <div className="min-h-[100dvh] flex flex-col" style={{ background: '#000', paddingTop: 'env(safe-area-inset-top, 0px)' }}>
      <div className="fixed inset-0 pointer-events-none z-0"
        style={{ background: 'radial-gradient(120% 60% at 50% -10%,rgba(232,25,44,.05),transparent 55%)' }} />

      {/* Header */}
      <div className="sticky top-0 z-30 flex items-center gap-3 px-4 py-3 backdrop-blur-xl"
        style={{ background: 'rgba(10,10,12,0.82)', borderBottom: `1px solid ${BORDER}`, paddingTop: 'calc(0.75rem + env(safe-area-inset-top, 0px))' }}>
        <button onClick={() => (step > 1 ? setStep(step - 1) : navigate('/dj'))}
          className="flex items-center justify-center w-8 h-8 rounded-lg transition-colors hover:bg-white/[0.05]" style={{ color: T2 }}>
          <ArrowLeft className="w-[18px] h-[18px]" />
        </button>
        <div className="flex-1 min-w-0">
          <h1 className="truncate" style={{ color: T1, fontSize: 14, fontWeight: 640, letterSpacing: '-0.01em', margin: 0 }}>
            {tt('Configuration de ton profil DJ', 'Set up your DJ profile', 'Configura tu perfil de DJ')}
          </h1>
          <p className="tabular-nums" style={{ color: T3, fontSize: 11.5, marginTop: 1 }}>
            {progress}% · {tt('Étape', 'Step', 'Paso')} {step}/{TOTAL}
          </p>
        </div>
        <button onClick={skip} className="text-[12.5px] font-medium transition-colors hover:text-white" style={{ color: T3 }}>
          {tt('Plus tard', 'Later', 'Más tarde')}
        </button>
      </div>

      {/* Progress track */}
      <div className="w-full relative z-10" style={{ height: 2, background: C_FAINT }}>
        <div className="h-full transition-all duration-500"
          style={{ width: `${progress}%`, background: RED, boxShadow: `0 0 12px -2px ${RED}` }} />
      </div>

      {/* Content */}
      <main className="relative z-10 flex-1 p-4 sm:p-6 pb-28">
        <div className="max-w-xl mx-auto w-full">
          <AnimatePresence mode="wait">
            <motion.div key={step}
              initial={{ opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -8 }}
              transition={{ duration: 0.2 }}
              className="overflow-hidden"
              style={{ background: CARD_BG, border: `1px solid ${BORDER}`, borderRadius: 18, boxShadow: CARD_SHADOW, padding: 24 }}>

              <div className="flex items-center gap-3 mb-5">
                <div className="w-10 h-10 flex items-center justify-center rounded-xl flex-none"
                  style={{ background: 'rgba(232,25,44,0.1)', border: '1px solid rgba(232,25,44,0.2)', color: RED }}>
                  <Icon className="w-5 h-5" />
                </div>
                <h2 style={{ color: T1, fontSize: 19, fontWeight: 680, letterSpacing: '-0.02em', margin: 0 }}>
                  {STEP_META[step - 1].title}
                </h2>
              </div>

              {/* Step 1 — Welcome */}
              {step === 1 && (
                <div className="space-y-3">
                  <p className="text-[14px] leading-relaxed" style={{ color: T2 }}>
                    {tt(
                      "Ton tableau de bord DJ réunit tout au même endroit : ton planning tous clubs confondus, tes cachets, tes statistiques de carrière et ton press kit partageable.",
                      'Your DJ dashboard brings everything together: your schedule across all clubs, your fees, your career analytics and your shareable press kit.',
                      'Tu panel de DJ lo reúne todo: tu agenda de todos los clubs, tus cachés, tus estadísticas de carrera y tu press kit para compartir.',
                    )}
                  </p>
                  <p className="text-[14px] leading-relaxed" style={{ color: T2 }}>
                    {tt('Deux minutes pour configurer ton profil et tu es prêt.', 'Two minutes to set up your profile and you are ready.', 'Dos minutos para configurar tu perfil y listo.')}
                  </p>
                </div>
              )}

              {/* Step 2 — Identity */}
              {step === 2 && (
                <div className="space-y-4">
                  <div className="grid grid-cols-2 gap-3">
                    <Field label={tt('Prénom', 'First name', 'Nombre') + ' *'} value={form.first_name} onChange={v => set('first_name', v)} />
                    <Field label={tt('Nom', 'Last name', 'Apellido') + ' *'} value={form.last_name} onChange={v => set('last_name', v)} />
                  </div>
                  <Field label={tt('Nom de scène', 'Stage name', 'Nombre artístico')} value={form.stage_name}
                    onChange={v => set('stage_name', v)} placeholder={tt('ex. DJ Méduse', 'e.g. DJ Medusa', 'ej. DJ Medusa')} />
                </div>
              )}

              {/* Step 3 — Sound */}
              {step === 3 && (
                <div className="space-y-4">
                  <div>
                    <label className="block text-[12.5px] font-medium mb-2" style={{ color: T2 }}>
                      {tt('Tes styles', 'Your genres', 'Tus estilos')} <span style={{ color: T3 }}>({form.music_genres.length}/3)</span>
                    </label>
                    <div className="flex flex-wrap gap-2">
                      {GENRE_PRESETS.map(g => {
                        const active = form.music_genres.includes(g);
                        return (
                          <button key={g} onClick={() => toggleGenre(g)}
                            className="px-3 py-1.5 rounded-full text-xs font-medium transition-all"
                            style={active
                              ? { background: 'rgba(232,25,44,0.12)', border: '1px solid rgba(232,25,44,0.35)', color: RED }
                              : { background: INNER_BG, border: `1px solid ${BORDER}`, color: T2 }}>
                            {g}
                          </button>
                        );
                      })}
                    </div>
                  </div>
                  <div className="grid grid-cols-2 gap-3">
                    <Field label={tt('Ville', 'City', 'Ciudad')} value={form.city} onChange={v => set('city', v)} />
                    <Field label={tt('Pays', 'Country', 'País')} value={form.country} onChange={v => set('country', v)} />
                  </div>
                </div>
              )}

              {/* Step 4 — Links */}
              {step === 4 && (
                <div className="space-y-3">
                  <p className="text-[13px]" style={{ color: T3 }}>
                    {tt('Optionnel — mais ça rend ton press kit irrésistible.', 'Optional — but it makes your press kit irresistible.', 'Opcional, pero hace tu press kit irresistible.')}
                  </p>
                  <Field label="Instagram" value={form.instagram_url} onChange={v => set('instagram_url', v)} placeholder="instagram.com/…" />
                  <Field label="SoundCloud" value={form.soundcloud_url} onChange={v => set('soundcloud_url', v)} placeholder="soundcloud.com/…" />
                  <Field label="Spotify" value={form.spotify_url} onChange={v => set('spotify_url', v)} placeholder="open.spotify.com/…" />
                  <Field label="WhatsApp" value={form.whatsapp_number} onChange={v => set('whatsapp_number', v)} placeholder="+33…" />
                </div>
              )}

              {/* Step 5 — Done */}
              {step === 5 && (
                <div className="space-y-4">
                  <div className="flex items-center justify-center py-2">
                    <div className="w-16 h-16 flex items-center justify-center rounded-full"
                      style={{ background: 'rgba(52,211,153,0.12)', border: '1px solid rgba(52,211,153,0.3)', color: POS }}>
                      <Check className="w-8 h-8" />
                    </div>
                  </div>
                  <p className="text-[14px] leading-relaxed text-center" style={{ color: T2 }}>
                    {tt(
                      'Ton profil est prêt. Tu peux maintenant suivre ton planning, tes cachets et partager ton press kit.',
                      'Your profile is ready. You can now track your schedule, your fees and share your press kit.',
                      'Tu perfil está listo. Ahora puedes seguir tu agenda, tus cachés y compartir tu press kit.',
                    )}
                  </p>
                </div>
              )}
            </motion.div>
          </AnimatePresence>
        </div>
      </main>

      {/* Footer nav */}
      <div className="sticky bottom-0 z-30 px-4 py-3 backdrop-blur-xl"
        style={{ background: 'rgba(10,10,12,0.82)', borderTop: `1px solid ${BORDER}`, paddingBottom: 'calc(0.75rem + env(safe-area-inset-bottom, 0px))' }}>
        <div className="max-w-xl mx-auto flex items-center gap-3">
          {step < TOTAL ? (
            <button
              onClick={() => setStep(step + 1)}
              disabled={step === 2 && !canProceedIdentity}
              className="flex-1 inline-flex items-center justify-center gap-2 rounded-xl py-3 text-sm font-semibold transition-opacity disabled:opacity-40"
              style={{ background: RED, color: '#fff' }}>
              {tt('Continuer', 'Continue', 'Continuar')} <ArrowRight className="w-4 h-4" />
            </button>
          ) : (
            <button onClick={save} disabled={saving}
              className="flex-1 inline-flex items-center justify-center gap-2 rounded-xl py-3 text-sm font-semibold transition-opacity disabled:opacity-50"
              style={{ background: RED, color: '#fff' }}>
              {saving ? <Loader2 className="w-4 h-4 animate-spin" /> : <Check className="w-4 h-4" />}
              {tt('Accéder au dashboard', 'Enter dashboard', 'Entrar al panel')}
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
