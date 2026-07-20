/**
 * /staff/welcome — l'onboarding d'un compte staff, APRÈS le PIN.
 *
 * L'ancien RoleIntroGate posait un flag localStorage : une intro par APPAREIL.
 * Sur la tablette partagée de la porte, le deuxième videur ne la voyait
 * jamais. Ici le flag vit en base (profiles.staff_onboarded_at) : une intro
 * par PERSONNE, une seule fois, où qu'elle se connecte.
 *
 * Trois écrans, 60 secondes :
 *   1. Ton poste — ce que fait cet écran, dans ce club (slides du rôle).
 *   2. Comment on te reconnaît — photo + nom d'affichage. C'est LE moment où
 *      la personne accepte de mettre son visage, pas un réglage enterré.
 *   3. Prêt pour ta première soirée — et on entre dans l'app.
 */

import { useMemo, useRef, useState } from 'react';
import { Navigate, useNavigate } from 'react-router-dom';
import { motion, AnimatePresence } from 'framer-motion';
import { ArrowRight, Camera, Check, Loader2, Moon, Megaphone, Radio } from 'lucide-react';
import { toast } from 'sonner';
import { supabase } from '@/integrations/supabase/client';
import { useLanguage } from '@/contexts/LanguageContext';
import { translate } from '@/i18n/orgTranslate';
import { useStaffIdentity } from '@/hooks/useStaffIdentity';
import { compressImage } from '@/lib/compressImage';
import { ROLE_INTROS, type RoleIntroKey } from '@/components/onboarding/roleIntroContent';
import { roleTokens, staffInitials, STAFF_ROLE_DEFS, type StaffRole } from '@/lib/staffIdentity';

const T1     = 'rgba(255,255,255,0.96)';
const T2     = 'rgba(255,255,255,0.70)';
const T3     = 'rgba(255,255,255,0.48)';
const BORDER = 'rgba(255,255,255,0.085)';
const C_FAINT = 'rgba(255,255,255,0.04)';

/** Rôles terrain concernés par cet onboarding (le manager a le dashboard owner). */
const INTRO_KEY: Partial<Record<StaffRole, RoleIntroKey>> = {
  bouncer: 'bouncer',
  barman: 'barman',
  cloakroom: 'cloakroom',
  vip_host: 'viphost',
};

export default function StaffOnboarding() {
  const { t, language } = useLanguage();
  const navigate = useNavigate();
  const { identity, loading, refresh } = useStaffIdentity();
  const fileRef = useRef<HTMLInputElement>(null);

  const [step, setStep] = useState(0);
  const [displayName, setDisplayName] = useState<string | null>(null);
  const [avatarUrl, setAvatarUrl] = useState<string | null>(null);
  const [uploading, setUploading] = useState(false);
  const [finishing, setFinishing] = useState(false);

  const role = identity?.role ?? null;
  const introKey = role ? INTRO_KEY[role] : undefined;
  const tokens = roleTokens(role);
  const tt = (l: [string, string, string]) => translate(language, l[0], l[1], l[2]);

  const name = displayName ?? identity?.displayName ?? identity?.firstName ?? '';
  const shownAvatar = avatarUrl ?? identity?.avatarUrl ?? null;

  const dashboardPath = role ? STAFF_ROLE_DEFS[role].path : '/';

  const intro = useMemo(() => (introKey ? ROLE_INTROS[introKey] : null), [introKey]);

  if (loading) {
    return (
      <div className="flex min-h-[100dvh] items-center justify-center" style={{ background: '#000' }}>
        <Loader2 className="h-6 w-6 animate-spin" style={{ color: T3 }} />
      </div>
    );
  }

  // Déjà onboardé, ou pas un rôle terrain : direction le dashboard.
  if (!identity || !role || !intro || identity.staffOnboardedAt) {
    return <Navigate to={dashboardPath} replace />;
  }

  const handleAvatarPick = async (file: File) => {
    setUploading(true);
    try {
      const compressed = await compressImage(file, 512, 0.85);
      const path = `${identity.userId}/avatar.jpg`;
      const { error: upErr } = await supabase.storage
        .from('staff-avatars')
        .upload(path, compressed, { upsert: true, contentType: 'image/jpeg' });
      if (upErr) throw upErr;
      const { data: pub } = supabase.storage.from('staff-avatars').getPublicUrl(path);
      const url = `${pub.publicUrl}?v=${Date.now()}`;
      const { error: profErr } = await supabase
        .from('profiles')
        .update({ staff_avatar_url: url })
        .eq('id', identity.userId);
      if (profErr) throw profErr;
      setAvatarUrl(url);
    } catch {
      toast.error(t('staffme.photoError'));
    } finally {
      setUploading(false);
    }
  };

  const finish = async () => {
    setFinishing(true);
    try {
      const updates: { staff_onboarded_at: string; staff_display_name?: string | null } = {
        staff_onboarded_at: new Date().toISOString(),
      };
      const trimmed = (displayName ?? '').trim();
      if (displayName !== null) updates.staff_display_name = trimmed || null;

      const { error } = await supabase.from('profiles').update(updates).eq('id', identity.userId);
      if (error) throw error;

      refresh();
      navigate(dashboardPath, { replace: true });
    } catch {
      toast.error(t('staffme.saveError'));
      setFinishing(false);
    }
  };

  const RoleIcon = STAFF_ROLE_DEFS[role].icon;

  return (
    <div
      className="flex min-h-[100dvh] flex-col"
      style={{
        background: '#000',
        paddingTop: 'calc(env(safe-area-inset-top, 0px) + 24px)',
        paddingBottom: 'calc(env(safe-area-inset-bottom, 0px) + 24px)',
      }}
    >
      <div
        className="pointer-events-none fixed inset-0"
        style={{ background: `radial-gradient(120% 55% at 50% -8%, ${tokens.glow}, transparent 60%)` }}
      />

      <div className="relative mx-auto flex w-full max-w-md flex-1 flex-col px-6">
        {/* Progression */}
        <div className="mb-6 flex gap-1.5">
          {[0, 1, 2].map((i) => (
            <div
              key={i}
              className="h-1 flex-1 rounded-full transition-colors"
              style={{ background: i <= step ? tokens.solid : 'rgba(255,255,255,0.10)' }}
            />
          ))}
        </div>

        <AnimatePresence mode="wait">
          {step === 0 && (
            <motion.div
              key="role"
              initial={{ opacity: 0, x: 24 }}
              animate={{ opacity: 1, x: 0 }}
              exit={{ opacity: 0, x: -24 }}
              className="flex flex-1 flex-col"
            >
              <div
                className="mb-4 flex h-12 w-12 items-center justify-center rounded-2xl"
                style={{ background: tokens.soft, border: `1px solid ${tokens.ring}` }}
              >
                <RoleIcon className="h-6 w-6" style={{ color: tokens.solid }} />
              </div>
              <h1 style={{ color: T1, fontSize: 26, fontWeight: 700, letterSpacing: '-0.03em', lineHeight: 1.15 }}>
                {tt(intro.title)}
              </h1>
              <p style={{ color: T2, fontSize: 13.5, marginTop: 6 }}>
                {[identity.venueName, t(STAFF_ROLE_DEFS[role].labelKey)].filter(Boolean).join(' · ')}
              </p>

              <div className="mt-7 space-y-3">
                {intro.slides.map((slide, i) => {
                  const SlideIcon = slide.icon;
                  return (
                    <motion.div
                      key={i}
                      initial={{ opacity: 0, y: 12 }}
                      animate={{ opacity: 1, y: 0 }}
                      transition={{ delay: 0.15 + i * 0.1 }}
                      className="flex items-start gap-3 rounded-2xl p-4"
                      style={{ background: C_FAINT, border: `1px solid ${BORDER}` }}
                    >
                      <div
                        className="flex h-9 w-9 flex-none items-center justify-center rounded-xl"
                        style={{ background: tokens.soft, border: `1px solid ${tokens.ring}` }}
                      >
                        <SlideIcon className="h-4 w-4" style={{ color: tokens.solid }} />
                      </div>
                      <div className="min-w-0">
                        <p style={{ color: T1, fontSize: 14, fontWeight: 600 }}>{tt(slide.title)}</p>
                        <p style={{ color: T2, fontSize: 12.5, lineHeight: 1.5, marginTop: 2 }}>{tt(slide.desc)}</p>
                      </div>
                    </motion.div>
                  );
                })}
              </div>

              <div className="flex-1" />
              <button
                type="button"
                onClick={() => setStep(1)}
                className="mt-8 flex w-full items-center justify-center gap-2 rounded-2xl py-4 font-semibold transition-transform active:scale-[0.99]"
                style={{ background: tokens.solid, color: '#000', fontSize: 15 }}
              >
                {t('staffwelcome.next')}
                <ArrowRight className="h-4.5 w-4.5" />
              </button>
            </motion.div>
          )}

          {step === 1 && (
            <motion.div
              key="identity"
              initial={{ opacity: 0, x: 24 }}
              animate={{ opacity: 1, x: 0 }}
              exit={{ opacity: 0, x: -24 }}
              className="flex flex-1 flex-col"
            >
              <h1 style={{ color: T1, fontSize: 26, fontWeight: 700, letterSpacing: '-0.03em', lineHeight: 1.15 }}>
                {t('staffwelcome.photoTitle')}
              </h1>
              <p style={{ color: T2, fontSize: 13.5, marginTop: 6, lineHeight: 1.5 }}>
                {t('staffwelcome.photoDesc')}
              </p>

              <div className="mt-8 flex flex-col items-center">
                <button
                  type="button"
                  onClick={() => fileRef.current?.click()}
                  disabled={uploading}
                  className="relative transition-transform active:scale-95"
                  aria-label={t('staffme.changePhoto')}
                >
                  <div
                    className="flex h-28 w-28 items-center justify-center overflow-hidden rounded-3xl"
                    style={{ background: tokens.soft, border: `1px solid ${tokens.ring}` }}
                  >
                    {shownAvatar ? (
                      <img src={shownAvatar} alt="" className="h-full w-full object-cover" />
                    ) : name ? (
                      <span style={{ color: tokens.solid, fontSize: 32, fontWeight: 700 }}>{staffInitials(name)}</span>
                    ) : (
                      <Camera className="h-8 w-8" style={{ color: tokens.solid }} />
                    )}
                  </div>
                  <div
                    className="absolute -bottom-1.5 -right-1.5 flex h-9 w-9 items-center justify-center rounded-full"
                    style={{ background: tokens.solid, color: '#000' }}
                  >
                    {uploading ? <Loader2 className="h-4 w-4 animate-spin" /> : <Camera className="h-4 w-4" />}
                  </div>
                </button>
                <input
                  ref={fileRef}
                  type="file"
                  accept="image/*"
                  className="hidden"
                  onChange={(e) => {
                    const file = e.target.files?.[0];
                    if (file) handleAvatarPick(file);
                    e.target.value = '';
                  }}
                />
              </div>

              <div className="mt-8">
                <label className="mb-1 block" style={{ color: T2, fontSize: 12 }}>{t('staffme.field.name')}</label>
                <input
                  value={name}
                  onChange={(e) => setDisplayName(e.target.value.slice(0, 40))}
                  placeholder={identity.firstName ?? t('staffme.field.namePlaceholder')}
                  className="w-full rounded-xl px-3 py-3 outline-none"
                  style={{ background: C_FAINT, border: `1px solid ${BORDER}`, color: T1, fontSize: 15 }}
                />
                <p style={{ color: T3, fontSize: 10.5, marginTop: 5 }}>{t('staffme.field.nameHint')}</p>
              </div>

              <div className="flex-1" />
              <button
                type="button"
                onClick={() => setStep(2)}
                className="mt-8 flex w-full items-center justify-center gap-2 rounded-2xl py-4 font-semibold transition-transform active:scale-[0.99]"
                style={{ background: tokens.solid, color: '#000', fontSize: 15 }}
              >
                {t('staffwelcome.next')}
                <ArrowRight className="h-4.5 w-4.5" />
              </button>
            </motion.div>
          )}

          {step === 2 && (
            <motion.div
              key="ready"
              initial={{ opacity: 0, x: 24 }}
              animate={{ opacity: 1, x: 0 }}
              exit={{ opacity: 0, x: -24 }}
              className="flex flex-1 flex-col"
            >
              <h1 style={{ color: T1, fontSize: 26, fontWeight: 700, letterSpacing: '-0.03em', lineHeight: 1.15 }}>
                {t('staffwelcome.readyTitle')}
              </h1>
              <p style={{ color: T2, fontSize: 13.5, marginTop: 6, lineHeight: 1.5 }}>
                {t('staffwelcome.readyDesc')}
              </p>

              <div className="mt-7 space-y-3">
                {[
                  { icon: Megaphone, key: 'staffwelcome.point.brief' },
                  { icon: Moon, key: 'staffwelcome.point.night' },
                  { icon: Radio, key: 'staffwelcome.point.calls' },
                ].map(({ icon: Icon, key }, i) => (
                  <motion.div
                    key={key}
                    initial={{ opacity: 0, y: 12 }}
                    animate={{ opacity: 1, y: 0 }}
                    transition={{ delay: 0.15 + i * 0.1 }}
                    className="flex items-center gap-3 rounded-2xl p-4"
                    style={{ background: C_FAINT, border: `1px solid ${BORDER}` }}
                  >
                    <div
                      className="flex h-9 w-9 flex-none items-center justify-center rounded-xl"
                      style={{ background: tokens.soft, border: `1px solid ${tokens.ring}` }}
                    >
                      <Icon className="h-4 w-4" style={{ color: tokens.solid }} />
                    </div>
                    <p style={{ color: T2, fontSize: 13, lineHeight: 1.45 }}>{t(key)}</p>
                  </motion.div>
                ))}
              </div>

              <div className="flex-1" />
              <button
                type="button"
                onClick={finish}
                disabled={finishing}
                className="mt-8 flex w-full items-center justify-center gap-2 rounded-2xl py-4 font-semibold transition-transform active:scale-[0.99]"
                style={{ background: tokens.solid, color: '#000', fontSize: 15 }}
              >
                {finishing ? <Loader2 className="h-4.5 w-4.5 animate-spin" /> : <Check className="h-4.5 w-4.5" />}
                {t('staffwelcome.finish')}
              </button>
            </motion.div>
          )}
        </AnimatePresence>
      </div>
    </div>
  );
}
