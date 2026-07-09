import { useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { motion } from 'framer-motion';
import { Martini, ShieldCheck, Shirt, Crown, Megaphone, LogOut, Bell, Loader2, ChevronRight, Monitor } from 'lucide-react';
import { supabase } from '@/integrations/supabase/client';
import { useAuth } from '@/hooks/useAuth';
import { useStaffVenue } from '@/hooks/useStaffVenue';
import { useLanguage } from '@/contexts/LanguageContext';
import { usePushNotifications } from '@/hooks/usePushNotifications';
import { clearStaffSession } from '@/components/RequireStaffSession';
import { OfflinePill, useNetworkStatus } from '@/components/pro/OfflinePill';
import { openExternal } from '@/lib/native';
import { haptics } from '@/lib/haptics';
import { transitions } from '@/lib/motion';
import { toast } from 'sonner';

// ─── Yuno Design Tokens (pro dashboard) ──────────────────────────────────────
const RED = '#E8192C';
const T1 = 'rgba(255,255,255,0.96)';
const T2 = 'rgba(255,255,255,0.58)';
const T3 = 'rgba(255,255,255,0.36)';
const BORDER = 'rgba(255,255,255,0.085)';
const TILE_BG = 'rgba(255,255,255,0.025)';
const CARD_BG = 'linear-gradient(180deg,rgba(255,255,255,.045) 0%,rgba(255,255,255,.008) 100%),#0a0a0c';
const CARD_SHADOW = '0 1px 0 rgba(255,255,255,.05) inset,0 18px 40px -28px rgba(0,0,0,.9)';

type StaffRole = 'barman' | 'bouncer' | 'cloakroom' | 'vip_host' | 'promoter';

const ROLE_CONFIG: Record<StaffRole, { path: string; icon: typeof Martini; labelKey: string; descKey: string }> = {
  barman: { path: '/barman', icon: Martini, labelKey: 'proapp.role.barman', descKey: 'proapp.roleDesc.barman' },
  bouncer: { path: '/bouncer', icon: ShieldCheck, labelKey: 'proapp.role.bouncer', descKey: 'proapp.roleDesc.bouncer' },
  cloakroom: { path: '/cloakroom', icon: Shirt, labelKey: 'proapp.role.cloakroom', descKey: 'proapp.roleDesc.cloakroom' },
  vip_host: { path: '/vip-host', icon: Crown, labelKey: 'proapp.role.vipHost', descKey: 'proapp.roleDesc.vipHost' },
  promoter: { path: '/promoter', icon: Megaphone, labelKey: 'proapp.role.promoter', descKey: 'proapp.roleDesc.promoter' },
};

/** Rôles pro dont le dashboard reste sur le web (desktop). */
const WEB_ONLY_ROLES = new Set(['owner', 'manager', 'organizer', 'dj', 'affiliate_owner', 'affiliate_member']);

const WEB_BASE_URL = import.meta.env.VITE_APP_BASE_URL || 'https://yunoapp.eu';

/**
 * Accueil de l'app « Yuno Pro » : sélecteur de rôle staff/promoteur.
 * Les guards existants (RequireRole + RequireStaffSession / PIN) prennent le
 * relais sur chaque route métier — cette page ne fait que router.
 */
export default function ProHome() {
  const navigate = useNavigate();
  const { t } = useLanguage();
  const { user, loading: authLoading } = useAuth();
  const { venueName } = useStaffVenue();
  const online = useNetworkStatus();
  const { isSubscribed, permission, subscribe, ready: pushReady } = usePushNotifications();

  const [roles, setRoles] = useState<string[] | null>(null);

  // Session requise : l'app pro est réservée au staff connecté.
  useEffect(() => {
    if (!authLoading && !user) {
      navigate('/auth?redirect=' + encodeURIComponent('/pro'), { replace: true });
    }
  }, [authLoading, user, navigate]);

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

  // Un seul rôle métier → entrer directement (avec un court feedback visuel).
  const [autoNavigating, setAutoNavigating] = useState(false);
  useEffect(() => {
    if (roles === null) return;
    if (staffRoles.length === 1 && webOnlyRoles.length === 0) {
      setAutoNavigating(true);
      const timer = setTimeout(() => navigate(ROLE_CONFIG[staffRoles[0]].path), 400);
      return () => clearTimeout(timer);
    }
  }, [roles, staffRoles, webOnlyRoles, navigate]);

  const handleLogout = async () => {
    clearStaffSession();
    // Purge des données offline (manifestes = PII) au départ du staff.
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

  if (authLoading || roles === null) {
    return (
      <div className="min-h-screen flex items-center justify-center" style={{ background: '#000' }}>
        <Loader2 className="h-6 w-6 animate-spin" style={{ color: T3 }} />
      </div>
    );
  }

  return (
    <div className="min-h-screen pb-12" style={{ background: '#000', paddingTop: 'calc(env(safe-area-inset-top, 0px) + 20px)' }}>
      <div className="fixed inset-0 pointer-events-none z-0"
        style={{ background: 'radial-gradient(120% 60% at 50% -10%,rgba(232,25,44,.06),transparent 55%)' }} />

      <div className="relative z-10 mx-auto max-w-md px-5 space-y-6">
        {/* Header */}
        <div className="flex items-center justify-between gap-3">
          <div className="min-w-0">
            <p className="font-mono uppercase" style={{ fontSize: 10, letterSpacing: '0.16em', color: RED, fontWeight: 700 }}>
              YUNO PRO
            </p>
            <h1 className="truncate" style={{ color: T1, fontSize: 24, fontWeight: 700, letterSpacing: '-0.02em', marginTop: 2 }}>
              {venueName || t('proapp.title')}
            </h1>
          </div>
          <OfflinePill label={online ? t('proapp.chrome.online') : t('proapp.chrome.offline')} />
        </div>

        {autoNavigating && staffRoles.length === 1 ? (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            className="flex items-center gap-3 rounded-2xl p-4"
            style={{ background: CARD_BG, border: `1px solid ${BORDER}`, boxShadow: CARD_SHADOW }}
          >
            <Loader2 className="h-4 w-4 animate-spin" style={{ color: RED }} />
            <p style={{ color: T2, fontSize: 13 }}>
              {t('proapp.opening').replace('{role}', t(ROLE_CONFIG[staffRoles[0]].labelKey))}
            </p>
          </motion.div>
        ) : (
          <>
            {/* Sélecteur de rôle */}
            <div>
              <p style={{ color: T3, fontSize: 11, fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.07em', marginBottom: 10 }}>
                {t('proapp.chooseRole')}
              </p>
              <div className="space-y-2.5">
                {staffRoles.map((role, i) => {
                  const cfg = ROLE_CONFIG[role];
                  const Icon = cfg.icon;
                  return (
                    <motion.button
                      key={role}
                      initial={{ opacity: 0, y: 10 }}
                      animate={{ opacity: 1, y: 0 }}
                      transition={{ ...transitions.pop, delay: i * 0.05 }}
                      onClick={() => { haptics.selection(); navigate(cfg.path); }}
                      className="w-full flex items-center gap-3.5 rounded-2xl p-4 text-left active:scale-[0.99] transition-transform"
                      style={{ background: CARD_BG, border: `1px solid ${BORDER}`, boxShadow: CARD_SHADOW }}
                    >
                      <span
                        className="flex h-11 w-11 items-center justify-center rounded-xl flex-none"
                        style={{ background: 'rgba(232,25,44,0.1)', border: '1px solid rgba(232,25,44,0.2)' }}
                      >
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

                {staffRoles.length === 0 && (
                  <div className="rounded-2xl p-5 text-center" style={{ background: TILE_BG, border: `1px solid ${BORDER}` }}>
                    <p style={{ color: T2, fontSize: 13, lineHeight: 1.5 }}>{t('proapp.noRole')}</p>
                  </div>
                )}

                {webOnlyRoles.length > 0 && (
                  <button
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
                  </button>
                )}
              </div>
            </div>

            {/* Push staff */}
            {pushReady && !isSubscribed && permission !== 'denied' && (
              <button
                onClick={handleEnablePush}
                className="w-full flex items-center gap-3 rounded-2xl p-4 text-left active:scale-[0.99] transition-transform"
                style={{ background: 'rgba(232,25,44,0.06)', border: '1px solid rgba(232,25,44,0.2)' }}
              >
                <Bell className="h-4 w-4 flex-none" style={{ color: RED }} />
                <span className="flex-1" style={{ color: T2, fontSize: 13 }}>{t('proapp.pushPrompt')}</span>
              </button>
            )}

            {/* Logout */}
            <button
              onClick={handleLogout}
              className="w-full inline-flex items-center justify-center gap-2 rounded-xl py-3 text-[13px] font-medium active:opacity-70"
              style={{ color: T3, border: `1px solid ${BORDER}` }}
            >
              <LogOut className="h-3.5 w-3.5" />
              {t('proapp.logout')}
            </button>
          </>
        )}
      </div>
    </div>
  );
}
