import { useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { motion, useReducedMotion } from 'framer-motion';
import { Martini, ShieldCheck, Shirt, Crown, Megaphone, Disc3, LogOut, Bell, Loader2, ChevronRight, ArrowRight, Monitor, Moon, Ticket, Users } from 'lucide-react';
import { supabase } from '@/integrations/supabase/client';
import { useAuth } from '@/hooks/useAuth';
import { useStaffIdentity } from '@/hooks/useStaffIdentity';
import { useStaffNightPulse } from '@/hooks/useStaffNightPulse';
import { greetingKey, staffInitials } from '@/lib/staffIdentity';
import { useLanguage } from '@/contexts/LanguageContext';
import { usePushNotifications } from '@/hooks/usePushNotifications';
import { clearStaffSession } from '@/components/RequireStaffSession';
import { OfflinePill, useNetworkStatus } from '@/components/pro/OfflinePill';
import { LanguageSelector } from '@/components/LanguageSelector';
import { openExternal } from '@/lib/native';
import { haptics } from '@/lib/haptics';
import { transitions } from '@/lib/motion';
import { toast } from 'sonner';

// ─── Yuno Design Tokens (docs/DESIGN_SYSTEM.md) ──────────────────────────────
// Fond pur noir, accent rouge UNIQUE (#E8192C), vert POS pour le direct,
// hiérarchie par opacité. Pas de shadcn Card, pas d'emoji.
const RED = '#E8192C';
const POS = '#34D399';
const T1 = 'rgba(255,255,255,0.96)';
const T2 = 'rgba(255,255,255,0.58)';
const T3 = 'rgba(255,255,255,0.40)';
const BORDER = 'rgba(255,255,255,0.085)';
const TILE_BG = 'rgba(255,255,255,0.025)';
const CARD_BG = 'linear-gradient(180deg,rgba(255,255,255,.045) 0%,rgba(255,255,255,.008) 100%),#0a0a0c';
const CARD_SHADOW = '0 1px 0 rgba(255,255,255,.05) inset,0 18px 40px -28px rgba(0,0,0,.9)';
// Accent rouge décliné
const RED_SOFT = 'rgba(232,25,44,0.10)';
const RED_RING = 'rgba(232,25,44,0.24)';
const RED_GLOW = 'rgba(232,25,44,0.14)';

type StaffRole = 'barman' | 'bouncer' | 'cloakroom' | 'vip_host' | 'promoter' | 'dj';

const ROLE_CONFIG: Record<StaffRole, { path: string; icon: typeof Martini; labelKey: string; descKey: string }> = {
  barman:    { path: '/barman',    icon: Martini,     labelKey: 'proapp.role.barman',    descKey: 'proapp.roleDesc.barman' },
  bouncer:   { path: '/bouncer',   icon: ShieldCheck, labelKey: 'proapp.role.bouncer',   descKey: 'proapp.roleDesc.bouncer' },
  cloakroom: { path: '/cloakroom', icon: Shirt,       labelKey: 'proapp.role.cloakroom', descKey: 'proapp.roleDesc.cloakroom' },
  vip_host:  { path: '/vip-host',  icon: Crown,       labelKey: 'proapp.role.vipHost',   descKey: 'proapp.roleDesc.vipHost' },
  promoter:  { path: '/promoter',  icon: Megaphone,   labelKey: 'proapp.role.promoter',  descKey: 'proapp.roleDesc.promoter' },
  dj:        { path: '/dj',        icon: Disc3,       labelKey: 'proapp.role.dj',        descKey: 'proapp.roleDesc.dj' },
};

/** Rôles pro dont le dashboard reste sur le web (desktop). */
const WEB_ONLY_ROLES = new Set(['owner', 'manager', 'organizer', 'affiliate_owner', 'affiliate_member']);
const WEB_BASE_URL = import.meta.env.VITE_APP_BASE_URL || 'https://yunoapp.eu';
const LOCALE_TAG: Record<string, string> = { fr: 'fr-FR', es: 'es-ES', en: 'en-GB' };

/** Petite tuile chiffrée — un pilier attendu ce soir. */
function StatTile({ icon: Icon, label, value }: { icon: typeof Crown; label: string; value: number | string }) {
  return (
    <div className="rounded-xl p-3" style={{ background: TILE_BG, border: `1px solid ${BORDER}` }}>
      <Icon className="h-4 w-4" style={{ color: RED }} />
      <p className="tabular-nums" style={{ color: T1, fontSize: 21, fontWeight: 680, lineHeight: 1.1, marginTop: 8 }}>{value}</p>
      <p className="truncate" style={{ color: T3, fontSize: 10.5, marginTop: 2 }}>{label}</p>
    </div>
  );
}

/**
 * Accueil de l'app « Yuno Pro » : la belle page d'accueil du membre du staff.
 *
 * On l'accueille par son nom, sa photo, la marque Yuno (rouge), et un aperçu de
 * SA soirée — l'événement du soir et les attendus des trois piliers (tables,
 * billets, invités). Entrer dans son espace est un geste volontaire (« prendre
 * son poste »). Les gardes existants (RequireRole + RequireStaffSession / PIN)
 * prennent le relais sur chaque route métier.
 */
export default function ProHome() {
  const navigate = useNavigate();
  const { t, language } = useLanguage();
  const { user, loading: authLoading } = useAuth();
  const { identity, loading: identityLoading } = useStaffIdentity();
  const { pulse, loading: pulseLoading } = useStaffNightPulse(identity?.venueId ?? null);
  const online = useNetworkStatus();
  const reduced = useReducedMotion();
  const { isSupported, isSubscribed, permission, subscribe, ready: pushReady } = usePushNotifications();

  const [roles, setRoles] = useState<string[] | null>(null);

  // Session requise : l'app pro est réservée au staff connecté.
  useEffect(() => {
    if (!authLoading && !user) {
      navigate('/auth?redirect=' + encodeURIComponent('/pro'), { replace: true });
    }
  }, [authLoading, user, navigate]);

  // Autorisation push demandée dès l'entrée : sans token, aucune alerte n'arrive
  // sur un téléphone verrouillé — l'intérêt même de l'app. Refus → silencieux.
  const pushAsked = useRef(false);
  useEffect(() => {
    if (!pushReady || !isSupported || !user || pushAsked.current) return;
    if (isSubscribed || permission !== 'default') return;
    pushAsked.current = true;
    subscribe().catch(() => { /* refusé — silencieux */ });
  }, [pushReady, isSupported, user, isSubscribed, permission, subscribe]);

  useEffect(() => {
    if (!user) return;
    supabase
      .from('user_roles')
      .select('role')
      .eq('user_id', user.id)
      .then(({ data }) => setRoles((data || []).map((r: { role: string }) => r.role)));
  }, [user]);

  const staffRoles = useMemo(
    () => (roles || []).filter((r): r is StaffRole => r in ROLE_CONFIG),
    [roles],
  );
  const webOnlyRoles = useMemo(() => (roles || []).filter((r) => WEB_ONLY_ROLES.has(r)), [roles]);

  const name = identity?.name ?? '';
  // Salutation figée au montage : l'écran peut rester ouvert, on ne veut pas
  // qu'un re-render la fasse basculer en plein service.
  const greeting = useMemo(() => t(greetingKey()), [t]);
  const roleLabelForSub = identity?.title?.trim()
    || (staffRoles.length === 1 ? t(ROLE_CONFIG[staffRoles[0]].labelKey) : null);
  const contextLine = [roleLabelForSub, identity?.venueName].filter(Boolean).join(' · ');

  const localeTag = LOCALE_TAG[language];
  const dateLabel = useMemo(
    () => new Date().toLocaleDateString(localeTag, { weekday: 'short', day: 'numeric', month: 'short' }),
    [localeTag],
  );
  const ev = pulse?.event ?? null;
  const eventTime = ev
    ? new Date(ev.start_at).toLocaleTimeString(localeTag, { hour: '2-digit', minute: '2-digit' })
    : null;
  const isLive = useMemo(() => {
    if (!ev) return false;
    const now = Date.now();
    return now >= new Date(ev.start_at).getTime() && now <= new Date(ev.end_at).getTime();
  }, [ev]);

  const handleLogout = async () => {
    clearStaffSession();
    const { purgeAllOfflineData } = await import('@/lib/offline/db');
    await purgeAllOfflineData();
    await supabase.auth.signOut();
    navigate('/auth?redirect=' + encodeURIComponent('/pro'), { replace: true });
  };

  const handleEnablePush = async () => {
    try {
      await subscribe();
      haptics.success();
      toast.success(t('proapp.pushEnabled'));
    } catch {
      /* refusé — silencieux */
    }
  };

  // Révélation en cascade (courbes Yuno). Sous reduced-motion : opacité seule.
  const rise = (delay: number) => ({
    initial: { opacity: 0, y: reduced ? 0 : 12 },
    animate: { opacity: 1, y: 0 },
    transition: { ...transitions.reveal, delay },
  });

  if (authLoading || roles === null || identityLoading) {
    return (
      <div className="min-h-screen flex items-center justify-center" style={{ background: '#000' }}>
        <Loader2 className="h-6 w-6 animate-spin" style={{ color: T3 }} />
      </div>
    );
  }

  return (
    <div className="min-h-screen pb-10" style={{ background: '#000', paddingTop: 'calc(env(safe-area-inset-top, 0px) + 18px)' }}>
      {/* Halo de marque Yuno — rouge, subtil */}
      <div className="fixed inset-0 pointer-events-none z-0"
        style={{ background: `radial-gradient(130% 50% at 50% -8%, ${RED_GLOW}, transparent 55%)` }} />

      <div className="relative z-10 mx-auto max-w-md px-5">
        {/* Chrome : marque, état réseau, langue */}
        <div className="flex items-center justify-between gap-3">
          <p className="font-mono uppercase" style={{ fontSize: 10.5, letterSpacing: '0.18em', color: RED, fontWeight: 700 }}>
            YUNO&nbsp;PRO
          </p>
          <div className="flex items-center gap-2">
            <OfflinePill label={online ? t('proapp.chrome.online') : t('proapp.chrome.offline')} />
            <LanguageSelector />
          </div>
        </div>

        {/* Accueil personnalisé — tap = Mon compte (photo, nom, langue, PIN) */}
        <motion.button
          {...rise(0.04)}
          onClick={() => { haptics.selection(); navigate('/staff/me'); }}
          className="mt-7 w-full text-left"
          aria-label={t('proapp.account')}
        >
          <div className="flex items-start justify-between gap-3">
            <div className="relative">
              <div className="absolute -inset-2 rounded-full" style={{ background: RED_GLOW, filter: 'blur(24px)' }} />
              <motion.div
                initial={{ opacity: 0, scale: reduced ? 1 : 0.82 }}
                animate={{ opacity: 1, scale: 1 }}
                transition={{ ...transitions.smooth, delay: 0.02 }}
                className="relative flex h-[62px] w-[62px] items-center justify-center overflow-hidden rounded-2xl"
                style={{ background: `linear-gradient(180deg, ${RED_SOFT}, rgba(255,255,255,.01)),#0a0a0c`, border: `1px solid ${RED_RING}` }}
              >
                {identity?.avatarUrl ? (
                  <img src={identity.avatarUrl} alt="" className="h-full w-full object-cover" loading="lazy" />
                ) : name ? (
                  <span style={{ color: T1, fontSize: 21, fontWeight: 700, letterSpacing: '0.01em' }}>
                    {staffInitials(name)}
                  </span>
                ) : (
                  <Crown className="h-6 w-6" style={{ color: RED }} />
                )}
              </motion.div>
            </div>

            <span
              className="mt-1 inline-flex items-center gap-1 rounded-full px-2.5 py-1"
              style={{ border: `1px solid ${BORDER}`, background: TILE_BG }}
            >
              <span style={{ color: T2, fontSize: 11, fontWeight: 600 }}>{t('proapp.account')}</span>
              <ChevronRight className="h-3.5 w-3.5" style={{ color: T3 }} />
            </span>
          </div>

          <motion.p {...rise(0.1)} className="mt-4" style={{ color: T3, fontSize: 14 }}>
            {name ? `${greeting},` : t('proapp.title')}
          </motion.p>
          <motion.h1 {...rise(0.16)} style={{ color: T1, fontSize: 30, fontWeight: 700, letterSpacing: '-0.03em', lineHeight: 1.1, marginTop: 2 }}>
            {name || identity?.venueName || t('proapp.title')}
          </motion.h1>
          {contextLine && (
            <motion.p {...rise(0.22)} className="mt-1.5" style={{ color: T3, fontSize: 13 }}>
              {contextLine}
            </motion.p>
          )}
        </motion.button>

        {/* CE SOIR — l'aperçu de la soirée : événement + attendus des 3 piliers */}
        {identity?.venueId && (
          <motion.section
            {...rise(0.26)}
            className="mt-6 overflow-hidden rounded-[18px] p-4"
            style={{ background: CARD_BG, border: `1px solid ${BORDER}`, boxShadow: CARD_SHADOW }}
          >
            <div className="flex items-center justify-between gap-2">
              <div className="flex items-center gap-1.5">
                <Moon className="h-3.5 w-3.5" style={{ color: RED }} />
                <span style={{ color: T3, fontSize: 10.5, fontWeight: 700, letterSpacing: '0.09em', textTransform: 'uppercase' }}>
                  {t('proapp.tonight')}
                </span>
              </div>
              <div className="flex items-center gap-2">
                {isLive && (
                  <span className="inline-flex items-center gap-1.5 rounded-full px-2 py-0.5" style={{ background: 'rgba(52,211,153,0.12)', border: '1px solid rgba(52,211,153,0.28)' }}>
                    <span className="h-1.5 w-1.5 rounded-full animate-pulse" style={{ background: POS }} />
                    <span style={{ color: POS, fontSize: 9.5, fontWeight: 700, letterSpacing: '0.06em', textTransform: 'uppercase' }}>{t('proapp.live')}</span>
                  </span>
                )}
                <span className="capitalize" style={{ color: T3, fontSize: 11.5 }}>{dateLabel}</span>
              </div>
            </div>

            {pulseLoading && !pulse ? (
              <div className="mt-3.5 grid grid-cols-3 gap-2">
                {[0, 1, 2].map((k) => (
                  <div key={k} className="h-[74px] rounded-xl animate-pulse" style={{ background: TILE_BG, border: `1px solid ${BORDER}` }} />
                ))}
              </div>
            ) : ev ? (
              <>
                <p className="mt-3 truncate" style={{ color: T1, fontSize: 17, fontWeight: 680, letterSpacing: '-0.01em' }}>{ev.title}</p>
                {(eventTime || identity?.venueName) && (
                  <p className="mt-0.5 truncate" style={{ color: T3, fontSize: 12 }}>{[eventTime, identity?.venueName].filter(Boolean).join(' · ')}</p>
                )}
                <div className="mt-3.5 grid grid-cols-3 gap-2">
                  <StatTile icon={Crown} label={t('staffnight.vipTables')} value={pulse!.expected.vip_tables} />
                  <StatTile icon={Ticket} label={t('staffnight.presold')} value={pulse!.expected.tickets_sold} />
                  <StatTile icon={Users} label={t('staffnight.guestlist')} value={pulse!.expected.guest_list} />
                </div>
              </>
            ) : (
              <div className="mt-3 flex items-center gap-3 rounded-xl p-3" style={{ background: TILE_BG, border: `1px solid ${BORDER}` }}>
                <span className="flex h-9 w-9 flex-none items-center justify-center rounded-lg" style={{ background: RED_SOFT, border: `1px solid ${RED_RING}` }}>
                  <Moon className="h-4 w-4" style={{ color: RED }} />
                </span>
                <div className="min-w-0">
                  <p style={{ color: T2, fontSize: 13, fontWeight: 600 }}>{t('proapp.noEventTonight')}</p>
                  <p className="mt-0.5" style={{ color: T3, fontSize: 11.5, lineHeight: 1.4 }}>{t('proapp.noEventHint')}</p>
                </div>
              </div>
            )}

            {/* La consigne du patron, si elle existe */}
            {pulse?.brief && (
              <div className="mt-3 rounded-xl p-3.5" style={{ background: RED_SOFT, border: `1px solid ${RED_RING}` }}>
                <div className="mb-1.5 flex items-center gap-1.5">
                  <Megaphone className="h-3.5 w-3.5" style={{ color: RED }} />
                  <span style={{ color: RED, fontSize: 10, fontWeight: 700, letterSpacing: '0.06em', textTransform: 'uppercase' }}>{t('staffnight.brief')}</span>
                </div>
                <p style={{ color: T1, fontSize: 13, lineHeight: 1.5, whiteSpace: 'pre-wrap' }}>{pulse.brief.body}</p>
              </div>
            )}
          </motion.section>
        )}

        {/* Entrée dans l'espace de travail — geste volontaire */}
        <div className="mt-4 space-y-2.5">
          {/* Un seul poste : grande carte d'entrée, action primaire rouge */}
          {staffRoles.length === 1 && (() => {
            const cfg = ROLE_CONFIG[staffRoles[0]];
            const Icon = cfg.icon;
            return (
              <motion.button
                {...rise(0.32)}
                onClick={() => { haptics.selection(); navigate(cfg.path); }}
                className="w-full flex items-center gap-4 rounded-3xl p-5 text-left active:scale-[0.99] transition-transform"
                style={{
                  background: `linear-gradient(180deg, ${RED_GLOW}, rgba(232,25,44,0.015)),#0a0a0c`,
                  border: `1px solid ${RED_RING}`,
                  boxShadow: '0 1px 0 rgba(255,255,255,.05) inset,0 22px 46px -26px rgba(232,25,44,.55)',
                }}
              >
                <span className="flex h-14 w-14 items-center justify-center rounded-2xl flex-none" style={{ background: RED_SOFT, border: `1px solid ${RED_RING}` }}>
                  <Icon className="h-6 w-6" style={{ color: RED }} />
                </span>
                <span className="flex-1 min-w-0">
                  <span className="block font-mono uppercase" style={{ fontSize: 10, letterSpacing: '0.14em', color: RED, fontWeight: 700 }}>
                    {t('proapp.enter')}
                  </span>
                  <span className="block" style={{ color: T1, fontSize: 18, fontWeight: 680, letterSpacing: '-0.01em', marginTop: 2 }}>{t(cfg.labelKey)}</span>
                  <span className="block truncate" style={{ color: T3, fontSize: 12.5, marginTop: 2 }}>{t(cfg.descKey)}</span>
                </span>
                <ArrowRight className="h-5 w-5 flex-none" style={{ color: RED }} />
              </motion.button>
            );
          })()}

          {/* Plusieurs postes : le choix */}
          {staffRoles.length > 1 && (
            <>
              <motion.p {...rise(0.3)} style={{ color: T3, fontSize: 11, fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.07em', marginBottom: 2 }}>
                {t('proapp.chooseRole')}
              </motion.p>
              {staffRoles.map((role, i) => {
                const cfg = ROLE_CONFIG[role];
                const Icon = cfg.icon;
                return (
                  <motion.button
                    key={role}
                    {...rise(0.34 + i * 0.05)}
                    onClick={() => { haptics.selection(); navigate(cfg.path); }}
                    className="w-full flex items-center gap-3.5 rounded-2xl p-4 text-left active:scale-[0.99] transition-transform"
                    style={{ background: CARD_BG, border: `1px solid ${BORDER}`, boxShadow: CARD_SHADOW }}
                  >
                    <span className="flex h-11 w-11 items-center justify-center rounded-xl flex-none" style={{ background: RED_SOFT, border: `1px solid ${RED_RING}` }}>
                      <Icon className="h-5 w-5" style={{ color: RED }} />
                    </span>
                    <span className="flex-1 min-w-0">
                      <span className="block" style={{ color: T1, fontSize: 15, fontWeight: 600 }}>{t(cfg.labelKey)}</span>
                      <span className="block truncate" style={{ color: T3, fontSize: 12, marginTop: 1 }}>{t(cfg.descKey)}</span>
                    </span>
                    <ChevronRight className="h-4 w-4 flex-none" style={{ color: T3 }} />
                  </motion.button>
                );
              })}
            </>
          )}

          {/* Aucun poste rattaché — et rien à ouvrir sur le web non plus */}
          {staffRoles.length === 0 && webOnlyRoles.length === 0 && (
            <motion.div {...rise(0.32)} className="rounded-2xl p-5 text-center" style={{ background: TILE_BG, border: `1px solid ${BORDER}` }}>
              <p style={{ color: T2, fontSize: 13, lineHeight: 1.5 }}>{t('proapp.noRole')}</p>
            </motion.div>
          )}

          {/* Rôles gérés sur le web */}
          {webOnlyRoles.length > 0 && (
            <motion.button
              {...rise(0.38)}
              onClick={() => openExternal(WEB_BASE_URL)}
              className="w-full flex items-center gap-3.5 rounded-2xl p-4 text-left active:scale-[0.99] transition-transform"
              style={{ background: TILE_BG, border: `1px dashed ${BORDER}` }}
            >
              <span className="flex h-11 w-11 items-center justify-center rounded-xl flex-none" style={{ background: 'rgba(255,255,255,0.05)', border: `1px solid ${BORDER}` }}>
                <Monitor className="h-5 w-5" style={{ color: T2 }} />
              </span>
              <span className="flex-1 min-w-0">
                <span className="block" style={{ color: T2, fontSize: 14, fontWeight: 600 }}>{t('proapp.webOnlyTitle')}</span>
                <span className="block" style={{ color: T3, fontSize: 12, marginTop: 1 }}>{t('proapp.webOnlyCard')}</span>
              </span>
              <ChevronRight className="h-4 w-4 flex-none" style={{ color: T3 }} />
            </motion.button>
          )}
        </div>

        {/* Push staff */}
        {pushReady && !isSubscribed && permission !== 'denied' && (
          <motion.button
            {...rise(0.44)}
            onClick={handleEnablePush}
            className="mt-4 w-full flex items-center gap-3 rounded-2xl p-4 text-left active:scale-[0.99] transition-transform"
            style={{ background: RED_SOFT, border: `1px solid ${RED_RING}` }}
          >
            <Bell className="h-4 w-4 flex-none" style={{ color: RED }} />
            <span className="flex-1" style={{ color: T2, fontSize: 13 }}>{t('proapp.pushPrompt')}</span>
          </motion.button>
        )}

        {/* Déconnexion — indispensable sur une tablette partagée */}
        <motion.button
          {...rise(0.48)}
          onClick={handleLogout}
          className="mt-4 w-full inline-flex items-center justify-center gap-2 rounded-xl py-3 text-[13px] font-medium active:opacity-70"
          style={{ color: T3, border: `1px solid ${BORDER}` }}
        >
          <LogOut className="h-3.5 w-3.5" />
          {t('proapp.logout')}
        </motion.button>

        {/* Signature de marque — ferme la composition */}
        <motion.div {...rise(0.54)} className="mt-9 flex flex-col items-center gap-2">
          <span className="h-px w-8" style={{ background: BORDER }} />
          <p className="font-mono uppercase" style={{ color: T3, fontSize: 10, letterSpacing: '0.14em' }}>
            {t('proapp.tagline')}
          </p>
        </motion.div>
      </div>
    </div>
  );
}
