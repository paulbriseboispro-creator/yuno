import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Shield, Crown, Briefcase, Megaphone, Music, Wine, UserCheck, Loader2, Shirt, Building2, ChevronRight, Link2, Users } from 'lucide-react';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { useLanguage } from '@/contexts/LanguageContext';
import { StaffPinDialog } from '@/components/StaffPinDialog';
import { hasValidStaffSession, storeStaffSession } from '@/components/RequireStaffSession';
import { clearPinSession } from '@/components/RequirePinSession';
import { supabase } from '@/integrations/supabase/client';

/**
 * Une organisation servie comme membre d'équipe (admin / éditeur / scanner).
 * La personne n'est pas organisatrice : son profil reste celui d'un client,
 * c'est `org_members` qui lui ouvre l'app de l'organisation.
 */
export interface OrgTeamCard {
  organizerUserId: string;
  organizationName: string | null;
  role: 'admin' | 'editor' | 'scanner';
}

interface RoleCard {
  show: boolean;
  icon: typeof Shield;
  label: string;
  path: string;
  role: string;
  color: string;
  bg: string;
  security?: 'mfa' | 'pin';
  /** Remplace la ligne de sécurité : le rôle tenu dans l'organisation. */
  sublabel?: string;
  /** Carte d'équipe : l'organisation à ouvrir. */
  organizerUserId?: string;
}

interface RoleAccessCardsProps {
  isAdmin: boolean;
  isOwner: boolean;
  isManager: boolean;
  isPromoter: boolean;
  isDJ: boolean;
  isBarman: boolean;
  isBouncer: boolean;
  isVipHost: boolean;
  isCloakroom: boolean;
  isOrganizer: boolean;
  isAgency: boolean;
  isAffiliate: boolean;
  isAffiliatePromoter: boolean;
  /** Organisations dont la personne est membre d'équipe accepté. */
  orgMemberships?: OrgTeamCard[];
  /** Appelé avant d'ouvrir l'app d'une organisation : c'est elle qu'on veut voir. */
  onPickOrganization?: (organizerUserId: string) => void;
}

type StaffRole = 'barman' | 'bouncer' | 'manager' | 'vip_host' | 'cloakroom';
type PinRole = 'dj' | 'promoter' | 'organizer';

export function RoleAccessCards({
  isAdmin,
  isOwner,
  isManager,
  isPromoter,
  isDJ,
  isBarman,
  isBouncer,
  isVipHost,
  isCloakroom,
  isOrganizer,
  isAgency,
  isAffiliate,
  isAffiliatePromoter,
  orgMemberships = [],
  onPickOrganization,
}: RoleAccessCardsProps) {
  const { t } = useLanguage();
  const navigate = useNavigate();
  const [showPinDialog, setShowPinDialog] = useState(false);
  const [showMFASetupPrompt, setShowMFASetupPrompt] = useState(false);
  const [pendingNavigation, setPendingNavigation] = useState<{ path: string; role: StaffRole } | null>(null);
  const [staffVenueId, setStaffVenueId] = useState<string | null>(null);
  const [checkingMFA, setCheckingMFA] = useState(false);

  const staffRoles: StaffRole[] = ['barman', 'bouncer', 'manager', 'vip_host', 'cloakroom'];
  const pinRoles: PinRole[] = ['dj', 'promoter', 'organizer'];

  const handleRoleClick = async (path: string, role: string, organizerUserId?: string) => {
    // Membre d'équipe : on retient l'organisation visée AVANT d'entrer, sinon
    // une personne qui en sert deux atterrit sur la première de la liste.
    if (role === 'org_member') {
      if (organizerUserId) onPickOrganization?.(organizerUserId);
      navigate(path);
      return;
    }

    if (role === 'owner') {
      setCheckingMFA(true);
      try {
        const { data: { user } } = await supabase.auth.getUser();
        if (user) {
          const { data: profile } = await supabase
            .from('profiles')
            .select('mfa_enabled')
            .eq('id', user.id)
            .single();
          
          if (!profile?.mfa_enabled) {
            setShowMFASetupPrompt(true);
            setCheckingMFA(false);
            return;
          }
        }
      } catch (error) {
        console.error('Error checking MFA status:', error);
      }
      setCheckingMFA(false);
      navigate(path);
      return;
    }

    // PIN-based roles (dj, promoter, organizer) - just navigate, RequirePinSession handles it
    if (pinRoles.includes(role as PinRole)) {
      navigate(path);
      return;
    }

    // affiliate_member: navigate directly, RequirePinSession in AffiliateRoute handles it
    if (role === 'affiliate_member') {
      navigate(path);
      return;
    }

    if (!staffRoles.includes(role as StaffRole)) {
      navigate(path);
      return;
    }

    const staffRole = role as StaffRole;
    
    if (hasValidStaffSession([staffRole])) {
      navigate(path);
      return;
    }

    try {
      const { data: { user } } = await supabase.auth.getUser();
      if (user) {
        const { data: profile } = await supabase
          .from('profiles')
          .select('venue_id')
          .eq('id', user.id)
          .single();
        
        if (profile?.venue_id) {
          setStaffVenueId(profile.venue_id);
        }
      }
    } catch (error) {
      console.error('Error fetching venue:', error);
    }

    setPendingNavigation({ path, role: staffRole });
    setShowPinDialog(true);
  };

  const handlePinVerified = (venueId: string, role: string) => {
    storeStaffSession(venueId, role);
    setShowPinDialog(false);
    
    if (pendingNavigation) {
      navigate(pendingNavigation.path);
      setPendingNavigation(null);
    }
  };

  const handlePinCancel = () => {
    setShowPinDialog(false);
    setPendingNavigation(null);
  };

  const handleMFASetupConfirm = () => {
    setShowMFASetupPrompt(false);
    navigate('/mfa-setup');
  };

  // DA publique : rouge = accent systémique, amber = rareté (owner/vip), reste neutre éditorial
  const ACCENT = '#E8192C';
  const ACCENT_BG = 'rgba(232,25,44,0.10)';
  const RARE = '#F0A742';
  const RARE_BG = 'rgba(240,167,66,0.10)';
  const NEUTRAL = '#E5E5E5';
  const NEUTRAL_BG = 'rgba(255,255,255,0.05)';

  // security : hint du niveau d'accès affiché sur la carte — 'mfa' (owner)
  // ou 'pin' (rôles staff / PIN). L'utilisateur sait à quoi s'attendre au tap.
  const roles: RoleCard[] = [
    { show: isAdmin, icon: Shield, label: t('profile.adminDashboard'), path: '/admin', role: 'admin', color: ACCENT, bg: ACCENT_BG, security: 'mfa' as const },
    { show: isOwner, icon: Crown, label: t('profile.ownerDashboard'), path: '/owner', role: 'owner', color: RARE, bg: RARE_BG, security: 'mfa' as const },
    { show: isManager, icon: Briefcase, label: t('profile.managerDashboard'), path: '/manager', role: 'manager', color: NEUTRAL, bg: NEUTRAL_BG, security: 'pin' as const },
    { show: isPromoter, icon: Megaphone, label: t('profile.promoterDashboard'), path: '/promoter', role: 'promoter', color: NEUTRAL, bg: NEUTRAL_BG, security: 'pin' as const },
    { show: isDJ, icon: Music, label: t('profile.djDashboard'), path: '/dj', role: 'dj', color: NEUTRAL, bg: NEUTRAL_BG, security: 'pin' as const },
    { show: isBarman, icon: Wine, label: t('profile.barmanDashboard'), path: '/barman', role: 'barman', color: NEUTRAL, bg: NEUTRAL_BG, security: 'pin' as const },
    { show: isBouncer, icon: UserCheck, label: t('profile.bouncerDashboard'), path: '/bouncer', role: 'bouncer', color: NEUTRAL, bg: NEUTRAL_BG, security: 'pin' as const },
    { show: isVipHost, icon: Crown, label: t('profile.vipHostDashboard'), path: '/vip-host', role: 'vip_host', color: RARE, bg: RARE_BG, security: 'pin' as const },
    { show: isCloakroom, icon: Shirt, label: t('profile.cloakroomDashboard'), path: '/cloakroom', role: 'cloakroom', color: NEUTRAL, bg: NEUTRAL_BG, security: 'pin' as const },
    { show: isOrganizer, icon: Building2, label: t('profile.organizerDashboard'), path: '/organizer-app', role: 'organizer', color: NEUTRAL, bg: NEUTRAL_BG, security: 'pin' as const },
    // Équipe d'un organisateur : une carte PAR organisation servie, nommée, avec
    // le rôle tenu. C'est ce qui manquait au profil d'une personne invitée —
    // l'invitation acceptée n'était visible nulle part, alors que l'app
    // l'attendait déjà.
    ...orgMemberships.map((m): RoleCard => ({
      show: true,
      icon: Users,
      label: t('profile.orgTeamDashboard').replace('{org}', m.organizationName || t('profile.organizerDashboard')),
      // Le scanner n'a que la porte : on l'y mène directement, le tableau de
      // bord n'a rien pour lui.
      path: m.role === 'scanner' ? '/organizer-app/checkin' : '/organizer-app',
      role: 'org_member',
      color: NEUTRAL,
      bg: NEUTRAL_BG,
      sublabel: t(`acceptOrg.role.${m.role}`),
      organizerUserId: m.organizerUserId,
    })),
    // Fusion agence↔affilié : le chef d'agence a UNE Console unifiée (/agency-app,
    // sa sidebar couvre déjà les clubs externes/soirées). On expose l'entrée
    // « Agence » et on masque l'ancienne carte « Affilié » redondante — /affiliate
    // redirige de toute façon un admin vers /agency-app.
    { show: isAgency, icon: Building2, label: t('profile.agencyDashboard'), path: '/agency-app', role: 'agency', color: NEUTRAL, bg: NEUTRAL_BG, security: undefined },
    { show: isAffiliate && !isAgency, icon: Link2, label: t('profile.affiliateDashboard'), path: '/affiliate', role: 'affiliate', color: NEUTRAL, bg: NEUTRAL_BG, security: undefined },
    { show: isAffiliatePromoter, icon: Megaphone, label: t('profile.affiliatePromoterDashboard') || 'Espace Promoteur', path: '/affiliate/promoteur', role: 'affiliate_member', color: NEUTRAL, bg: NEUTRAL_BG, security: 'pin' as const },
  ];

  const visibleRoles = roles.filter(r => r.show);
  if (visibleRoles.length === 0) return null;

  return (
    <>
      <div className="space-y-2">
        {visibleRoles.map((role, index) => {
          const Icon = role.icon;
          return (
            <button
              key={index}
              className="w-full flex items-center gap-3 p-3.5 transition-all active:scale-[0.98] cursor-pointer hover:brightness-110"
              style={{ background: '#141414', border: '1px solid rgba(255,255,255,0.08)', borderRadius: 4 }}
              onClick={() => handleRoleClick(role.path, role.role, role.organizerUserId)}
            >
              <div className="flex items-center justify-center h-9 w-9 shrink-0" style={{ background: role.bg, borderRadius: 3 }}>
                <Icon className="h-[18px] w-[18px]" style={{ color: role.color }} />
              </div>
              <span className="flex-1 text-left">
                <span className="block font-mono uppercase" style={{ fontSize: '11px', letterSpacing: '0.06em', color: '#E5E5E5' }}>{role.label}</span>
                {(role.sublabel || role.security) && (
                  <span className="block font-mono uppercase" style={{ fontSize: '9px', letterSpacing: '0.08em', color: '#5A5A5E', marginTop: 2 }}>
                    {role.sublabel ?? (role.security === 'mfa' ? t('profile.securityMfa') : t('profile.securityPin'))}
                  </span>
                )}
              </span>
              <ChevronRight className="h-4 w-4" style={{ color: '#5A5A5E' }} />
            </button>
          );
        })}
      </div>

      {showPinDialog && pendingNavigation && (
        <StaffPinDialog
          open={showPinDialog}
          onVerified={handlePinVerified}
          onCancel={handlePinCancel}
          venueId={staffVenueId}
          allowedRoles={[pendingNavigation.role]}
        />
      )}

      <Dialog open={showMFASetupPrompt} onOpenChange={setShowMFASetupPrompt}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <Shield className="h-5 w-5 text-primary" />
              {t('mfa.setupRequired')}
            </DialogTitle>
            <DialogDescription>
              {t('mfa.ownerMustSetup')}
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-4 pt-4">
            <p className="text-sm text-muted-foreground">
              {t('mfa.setupInstructions')}
            </p>
            <div className="flex gap-2">
              <Button variant="outline" onClick={() => setShowMFASetupPrompt(false)} className="flex-1">
                {t('common.cancel')}
              </Button>
              <Button onClick={handleMFASetupConfirm} className="flex-1">
                {t('mfa.setupNow')}
              </Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>

      {checkingMFA && (
        <div className="fixed inset-0 bg-background/80 flex items-center justify-center z-50">
          <Loader2 className="h-8 w-8 animate-spin text-primary" />
        </div>
      )}
    </>
  );
}
