import { useState, useEffect } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { supabase } from '@/integrations/supabase/client';
import { useLanguage } from '@/contexts/LanguageContext';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { ArrowLeft, UserCircle, Shield, ShieldOff, Plus, Trash2, MapPin, Mail, Calendar, Star, ShoppingBag, Ticket, AlertTriangle, Building2, KeyRound, Ban, UserCheck, ShieldAlert, type LucideIcon } from 'lucide-react';
import { format } from 'date-fns';
import { toast } from 'sonner';

// ─── Yuno Design Tokens ───────────────────────────────────────────────────────
const RED        = '#E8192C';
const POS        = '#34D399';
const NEG        = '#FF5C63';
const T1         = 'rgba(255,255,255,0.96)';
const T2         = 'rgba(255,255,255,0.58)';
const T3         = 'rgba(255,255,255,0.36)';
const C_FAINT    = 'rgba(255,255,255,0.06)';
const BORDER     = 'rgba(255,255,255,0.085)';
const F_BORDER   = 'rgba(255,255,255,0.055)';
const INNER_BG   = 'rgba(255,255,255,0.032)';
const CARD_BG    = 'linear-gradient(180deg,rgba(255,255,255,.045) 0%,rgba(255,255,255,.008) 100%),#0a0a0c';
const CARD_SHADOW = '0 1px 0 rgba(255,255,255,.05) inset,0 18px 40px -28px rgba(0,0,0,.9)';

const cardStyle: React.CSSProperties = {
  background: CARD_BG, border: `1px solid ${BORDER}`, borderRadius: 18,
  boxShadow: CARD_SHADOW, padding: 22, overflow: 'hidden',
};

const thStyle: React.CSSProperties = { color: T3, fontSize: 11, fontWeight: 500, textTransform: 'uppercase', letterSpacing: '0.06em' };

const primaryBtnStyle: React.CSSProperties = {
  display: 'inline-flex', alignItems: 'center', gap: 6, padding: '8px 14px',
  borderRadius: 10, background: 'rgba(232,25,44,0.12)', border: '1px solid rgba(232,25,44,0.3)',
  color: RED, fontSize: 12.5, fontWeight: 600, cursor: 'pointer',
};

const dangerBtnStyle: React.CSSProperties = {
  display: 'inline-flex', alignItems: 'center', gap: 6, padding: '8px 14px',
  borderRadius: 10, background: 'rgba(255,92,99,0.12)', border: '1px solid rgba(255,92,99,0.3)',
  color: NEG, fontSize: 12.5, fontWeight: 600, cursor: 'pointer',
};

const secondaryBtnStyle: React.CSSProperties = {
  display: 'inline-flex', alignItems: 'center', gap: 6, padding: '8px 14px',
  borderRadius: 10, background: INNER_BG, border: `1px solid ${BORDER}`,
  color: T2, fontSize: 12.5, fontWeight: 560, cursor: 'pointer',
};

function SectionHeader({ icon: Icon, label, accent }: { icon: LucideIcon; label: string; accent?: boolean }) {
  return (
    <div className="flex items-center gap-2.5 mb-4">
      <div
        className="flex h-8 w-8 items-center justify-center rounded-xl flex-none"
        style={accent
          ? { background: 'rgba(232,25,44,0.1)', border: '1px solid rgba(232,25,44,0.2)' }
          : { background: C_FAINT, border: `1px solid ${BORDER}` }}
      >
        <Icon className="h-4 w-4" style={{ color: accent ? RED : T2 }} />
      </div>
      <h3 style={{ color: T1, fontSize: 15.5, fontWeight: 600, letterSpacing: '-0.01em', margin: 0 }}>{label}</h3>
    </div>
  );
}

const STAFF_ROLES = ['barman', 'bouncer', 'vip_host', 'cloakroom', 'manager'] as const;
const PLATFORM_ROLES = ['client', 'admin'] as const;
const AUTONOMOUS_ROLES = ['promoter', 'dj', 'organizer'] as const;
const OWNER_ROLE = 'owner';

interface PromoterProfile {
  id: string;
  venue_id: string | null;
  promo_code: string;
  is_active: boolean;
  venueName?: string;
}

const ROLE_META: Record<string, { label: string; description: string }> = {
  client: { label: 'Client', description: 'Utilisateur standard' },
  admin: { label: 'Super Admin', description: 'Accès total à la plateforme' },
  owner: { label: 'Propriétaire', description: 'Propriétaire d\'un établissement' },
  manager: { label: 'Manager', description: 'Gestion d\'un établissement' },
  barman: { label: 'Barman', description: 'Préparation des commandes' },
  bouncer: { label: 'Videur', description: 'Contrôle d\'entrée' },
  vip_host: { label: 'Hôte VIP', description: 'Gestion des tables VIP' },
  cloakroom: { label: 'Vestiaire', description: 'Gestion du vestiaire' },
  promoter: { label: 'Promoteur', description: 'Promotion d\'événements' },
  dj: { label: 'DJ', description: 'Sets musicaux' },
  organizer: { label: 'Organisateur', description: 'Organisation d\'événements' },
};

const ALL_ROLES = [...PLATFORM_ROLES, OWNER_ROLE, ...STAFF_ROLES, ...AUTONOMOUS_ROLES] as const;

function needsVenue(role: string): boolean {
  return (STAFF_ROLES as readonly string[]).includes(role) || role === OWNER_ROLE;
}

export default function AdminUserDetail() {
  const { userId } = useParams<{ userId: string }>();
  const navigate = useNavigate();
  const { t } = useLanguage();
  const [profile, setProfile] = useState<any>(null);
  const [roles, setRoles] = useState<string[]>([]);
  const [venueCustomers, setVenueCustomers] = useState<any[]>([]);
  const [loyalty, setLoyalty] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [addingRole, setAddingRole] = useState('');
  const [selectedVenueId, setSelectedVenueId] = useState('');
  const [venues, setVenues] = useState<{ id: string; name: string }[]>([]);
  const [venueName, setVenueName] = useState('');
  const [ownedVenue, setOwnedVenue] = useState<{ id: string; name: string } | null>(null);
  const [resyncVenueId, setResyncVenueId] = useState('');
  const [resyncing, setResyncing] = useState(false);
  const [promoterProfiles, setPromoterProfiles] = useState<PromoterProfile[]>([]);
  const [togglingPromoter, setTogglingPromoter] = useState<string | null>(null);
  const [securityBusy, setSecurityBusy] = useState(false);

  useEffect(() => {
    if (userId) {
      loadUser();
      loadOwnedVenue();
      loadPromoterProfiles();
    }
    loadVenues();
  }, [userId]);

  // Pre-select venue when profile loads
  useEffect(() => {
    if (profile?.venue_id && !selectedVenueId) {
      setSelectedVenueId(profile.venue_id);
    }
  }, [profile]);

  const loadVenues = async () => {
    const { data } = await supabase.from('venues').select('id, name').order('name');
    setVenues(data || []);
  };

  const loadOwnedVenue = async () => {
    if (!userId) return;
    const { data } = await supabase
      .from('venues')
      .select('id, name')
      .eq('owner_id', userId)
      .maybeSingle();
    setOwnedVenue(data || null);
    if (data) setResyncVenueId(data.id);
  };

  const loadPromoterProfiles = async () => {
    if (!userId) return;
    const { data } = await supabase
      .from('promoters')
      .select('id, venue_id, promo_code, is_active')
      .eq('user_id', userId)
      .order('is_active', { ascending: false });
    if (!data || data.length === 0) { setPromoterProfiles([]); return; }
    const venueIds = [...new Set(data.map(p => p.venue_id).filter(Boolean))] as string[];
    let venueMap: Record<string, string> = {};
    if (venueIds.length > 0) {
      const { data: vData } = await supabase.from('venues').select('id, name').in('id', venueIds);
      venueMap = Object.fromEntries((vData || []).map(v => [v.id, v.name]));
    }
    setPromoterProfiles(data.map(p => ({ ...p, venueName: p.venue_id ? venueMap[p.venue_id] : undefined })));
  };

  const handleResetMfa = async () => {
    if (!userId) return;
    if (!confirm(
      `Réinitialiser la double authentification de ${profile?.email || 'cet utilisateur'} ?\n\n` +
      `Utile si le pro est verrouillé hors de son compte (téléphone perdu). Il devra ` +
      `ré-enrôler une nouvelle app à la prochaine connexion. Action tracée.`
    )) return;
    setSecurityBusy(true);
    try {
      const { error } = await supabase.rpc('admin_reset_user_mfa', { _user_id: userId });
      if (error) throw error;
      toast.success('MFA réinitialisé — le pro pourra se reconnecter et ré-enrôler.');
      await loadUser();
    } catch (err: any) {
      toast.error(err.message || 'Erreur');
    } finally {
      setSecurityBusy(false);
    }
  };

  const handleResetPassword = async () => {
    if (!userId) return;
    if (!confirm(
      `Envoyer un lien de réinitialisation de mot de passe à ${profile?.email || 'cet utilisateur'} ?`
    )) return;
    setSecurityBusy(true);
    try {
      const { data, error } = await supabase.functions.invoke('admin-account-recovery', {
        body: { action: 'reset-password', userId },
      });
      if (error) throw error;
      if (data && data.success === false) throw new Error(data.error || 'Échec');
      toast.success('Email de réinitialisation envoyé.');
    } catch (err: any) {
      toast.error(err.message || 'Erreur');
    } finally {
      setSecurityBusy(false);
    }
  };

  const handleToggleSuspend = async () => {
    if (!userId) return;
    const currentlySuspended = !!profile?.is_suspended;
    let reason: string | null = null;
    if (!currentlySuspended) {
      if (!confirm(
        `Suspendre le compte ${profile?.email || ''} ?\n\n` +
        `L'utilisateur perdra l'accès aux dashboards pro. Réversible. Action tracée.`
      )) return;
      reason = window.prompt('Raison de la suspension (journal d\'audit) :', '') ?? '';
    } else {
      if (!confirm(`Réactiver le compte ${profile?.email || ''} ?`)) return;
    }
    setSecurityBusy(true);
    try {
      const { error } = await supabase.rpc('admin_set_user_suspended', {
        _user_id: userId,
        _suspended: !currentlySuspended,
        _reason: reason || null,
      });
      if (error) throw error;
      toast.success(currentlySuspended ? 'Compte réactivé' : 'Compte suspendu');
      await loadUser();
    } catch (err: any) {
      toast.error(err.message || 'Erreur');
    } finally {
      setSecurityBusy(false);
    }
  };

  const handleResyncOwner = async () => {
    if (!userId || !resyncVenueId) return;
    setResyncing(true);
    try {
      // Clear previous ownership for this user
      await supabase.from('venues').update({ owner_id: null }).eq('owner_id', userId).neq('id', resyncVenueId);
      const { error } = await supabase.from('venues').update({ owner_id: userId }).eq('id', resyncVenueId);
      if (error) throw error;
      toast.success('Lien propriétaire mis à jour');
      await loadOwnedVenue();
    } catch (err: any) {
      toast.error(err.message || 'Erreur lors de la mise à jour');
    } finally {
      setResyncing(false);
    }
  };

  const handleTogglePromoter = async (promoterId: string, currentActive: boolean) => {
    setTogglingPromoter(promoterId);
    try {
      const { error } = await supabase
        .from('promoters')
        .update({ is_active: !currentActive })
        .eq('id', promoterId);
      if (error) throw error;
      toast.success(currentActive ? 'Promoteur désactivé' : 'Promoteur activé');
      await loadPromoterProfiles();
    } catch (err: any) {
      toast.error(err.message || 'Erreur');
    } finally {
      setTogglingPromoter(null);
    }
  };

  const loadUser = async () => {
    setLoading(true);
    const [profileRes, rolesRes, vcRes, loyaltyRes] = await Promise.all([
      supabase.from('profiles').select('id, email, first_name, last_name, city, venue_id, avatar_url, created_at, mfa_enabled, is_suspended, suspension_reason').eq('id', userId!).single(),
      supabase.from('user_roles').select('id, role, created_at').eq('user_id', userId!),
      supabase.from('venue_customers').select('id, venue_id, email, order_count, ticket_count, table_count, total_spent, last_visit_at, is_banned, favorite_drink_category').eq('user_id', userId!),
      supabase.from('customer_loyalty').select('id, venue_id, current_balance, total_points_earned, tier').eq('user_id', userId!),
    ]);

    setProfile(profileRes.data);
    setRoles((rolesRes.data || []).map(r => r.role as string));

    const vcData = vcRes.data || [];
    const loyData = loyaltyRes.data || [];
    const allVenueIds = [...new Set([
      ...(vcData.map(vc => vc.venue_id)),
      ...(loyData.map(l => l.venue_id)),
      ...(profileRes.data?.venue_id ? [profileRes.data.venue_id] : []),
    ])];

    if (allVenueIds.length > 0) {
      const { data: venuesList } = await supabase.from('venues').select('id, name').in('id', allVenueIds);
      const venueMap = Object.fromEntries((venuesList || []).map(v => [v.id, v.name]));
      setVenueCustomers(vcData.map(vc => ({ ...vc, venueName: venueMap[vc.venue_id] || vc.venue_id })));
      setLoyalty(loyData.map(l => ({ ...l, venueName: venueMap[l.venue_id] || l.venue_id })));
      if (profileRes.data?.venue_id) setVenueName(venueMap[profileRes.data.venue_id] || '');
    } else {
      setVenueCustomers(vcData);
      setLoyalty(loyData);
    }

    setLoading(false);
  };

  const handleAddRole = async () => {
    if (!addingRole || !userId) return;

    const requiresVenue = needsVenue(addingRole);
    if (requiresVenue && !selectedVenueId) {
      toast.error('Veuillez sélectionner un établissement pour ce rôle.');
      return;
    }

    // Garde-fou escalade de privilège : confirmation explicite pour le rôle admin.
    if (addingRole === 'admin' && !confirm(
      `Donner le rôle SUPER ADMIN à ${profile?.email || 'cet utilisateur'} ?\n\n` +
      `Ce rôle donne un accès TOTAL à la plateforme (remboursements, suppression, ` +
      `suspension de comptes). Action tracée dans le journal d'audit. Confirmer ?`
    )) return;

    const { error: roleInsertError } = await supabase
      .from('user_roles')
      .insert({ user_id: userId, role: addingRole as any, email: profile?.email });

    if (roleInsertError) {
      toast.error(roleInsertError.message);
      return;
    }

    if ((STAFF_ROLES as readonly string[]).includes(addingRole)) {
      const { error: profileLinkError } = await supabase
        .from('profiles')
        .update({ venue_id: selectedVenueId })
        .eq('id', userId);

      if (profileLinkError) {
        await supabase.from('user_roles').delete().eq('user_id', userId).eq('role', addingRole as any);
        toast.error(`Rôle ajouté puis annulé : liaison club impossible (${profileLinkError.message}).`);
        return;
      }
    }

    if (addingRole === OWNER_ROLE) {
      const { error: ownerLinkError } = await supabase
        .from('venues')
        .update({ owner_id: userId })
        .eq('id', selectedVenueId);

      if (ownerLinkError) {
        await supabase.from('user_roles').delete().eq('user_id', userId).eq('role', addingRole as any);
        toast.error(`Rôle ajouté puis annulé : liaison propriétaire impossible (${ownerLinkError.message}).`);
        return;
      }
    }

    // Journal d'audit (priorité au rôle admin = escalade de privilège)
    await supabase.rpc('admin_log_action', {
      _action: addingRole === 'admin' ? 'role_admin_granted' : 'role_granted',
      _entity_type: 'profile',
      _entity_id: userId,
      _metadata: { role: addingRole, venue_id: needsVenue(addingRole) ? selectedVenueId : null },
    });

    const meta = ROLE_META[addingRole];
    toast.success(`Rôle "${meta?.label || addingRole}" ajouté`);
    setAddingRole('');
    loadUser();
  };

  const handleRemoveRole = async (role: string) => {
    if (!userId) return;
    if (role === 'admin' && !confirm('Retirer le rôle admin ? Cette action est critique.')) return;

    const { error } = await supabase.from('user_roles').delete().eq('user_id', userId).eq('role', role as any);
    if (error) {
      toast.error(error.message);
      return;
    }

    // If removing a staff role, check if user still has any staff role
    if ((STAFF_ROLES as readonly string[]).includes(role)) {
      const remainingStaff = roles.filter(r => r !== role && (STAFF_ROLES as readonly string[]).includes(r));
      if (remainingStaff.length === 0) {
        await supabase.from('profiles').update({ venue_id: null }).eq('id', userId);
      }
    }

    // If removing owner, unlink from venue
    if (role === OWNER_ROLE && profile?.venue_id) {
      // Don't unlink — venue.owner_id stays. Admin can reassign.
    }

    await supabase.rpc('admin_log_action', {
      _action: role === 'admin' ? 'role_admin_revoked' : 'role_revoked',
      _entity_type: 'profile',
      _entity_id: userId,
      _metadata: { role },
    });

    const meta = ROLE_META[role];
    toast.success(`Rôle "${meta?.label || role}" retiré`);
    loadUser();
  };

  const availableRoles = ALL_ROLES.filter(r => !roles.includes(r));
  const showVenueSelector = needsVenue(addingRole);

  if (loading) {
    return (
      <div className="flex min-h-screen items-center justify-center" style={{ background: '#000' }}>
        <div className="h-10 w-10 animate-spin rounded-full border-2" style={{ borderColor: `${BORDER} ${BORDER} ${BORDER} ${RED}` }} />
      </div>
    );
  }

  if (!profile) {
    return (
      <div className="min-h-screen" style={{ background: '#000' }}>
        <div className="mx-auto max-w-[1340px] px-4 sm:px-6 py-6">
          <button
            onClick={() => navigate(-1)}
            className="inline-flex items-center gap-2 px-3 py-2 rounded-lg cursor-pointer transition-colors"
            style={{ background: 'rgba(255,255,255,0.04)', border: `1px solid ${F_BORDER}`, color: T3, fontSize: 13 }}
          >
            <ArrowLeft className="h-4 w-4" />Retour
          </button>
          <p className="mt-4" style={{ color: T3, fontSize: 13 }}>Utilisateur introuvable.</p>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen" style={{ background: '#000' }}>
      <div className="mx-auto max-w-[1340px] px-4 sm:px-6 py-6 space-y-6">
        {/* Header */}
        <div className="flex items-center gap-3">
          <button
            onClick={() => navigate(-1)}
            className="flex h-9 w-9 items-center justify-center rounded-lg flex-none cursor-pointer transition-colors"
            style={{ background: 'rgba(255,255,255,0.04)', border: `1px solid ${F_BORDER}`, color: T3 }}
          >
            <ArrowLeft className="h-4 w-4" />
          </button>
          <h1 style={{ color: T1, fontSize: 'clamp(22px,3vw,28px)', fontWeight: 700, letterSpacing: '-0.025em', lineHeight: 1.1 }}>Détail utilisateur</h1>
        </div>

        {/* Profile card */}
        <div style={cardStyle}>
          <div className="flex items-start gap-4">
            {profile.avatar_url ? (
              <img src={profile.avatar_url} alt="" className="h-16 w-16 rounded-full object-cover" style={{ border: `1px solid ${BORDER}` }} />
            ) : (
              <div className="flex h-16 w-16 items-center justify-center rounded-full flex-none" style={{ background: C_FAINT, border: `1px solid ${BORDER}` }}>
                <UserCircle className="h-9 w-9" style={{ color: T3 }} />
              </div>
            )}
            <div className="flex-1 space-y-1.5 min-w-0">
              <h2 style={{ color: T1, fontSize: 20, fontWeight: 700, letterSpacing: '-0.02em' }}>
                {`${profile.first_name || ''} ${profile.last_name || ''}`.trim() || 'Sans nom'}
              </h2>
              <div className="flex items-center gap-2" style={{ fontSize: 13, color: T2 }}>
                <Mail className="h-3.5 w-3.5" style={{ color: T3 }} /> {profile.email}
              </div>
              {profile.city && (
                <div className="flex items-center gap-2" style={{ fontSize: 13, color: T2 }}>
                  <MapPin className="h-3.5 w-3.5" style={{ color: T3 }} /> {profile.city}
                </div>
              )}
              <div className="flex items-center gap-2" style={{ fontSize: 13, color: T2 }}>
                <Calendar className="h-3.5 w-3.5" style={{ color: T3 }} /> Inscrit le {format(new Date(profile.created_at), 'dd/MM/yyyy')}
              </div>
              {venueName && (
                <div className="flex items-center gap-2" style={{ fontSize: 13, color: T2 }}>
                  <Building2 className="h-3.5 w-3.5" style={{ color: T3 }} />
                  Établissement rattaché : <span style={{ fontWeight: 600, color: T1 }}>{venueName}</span>
                </div>
              )}
              <div className="flex items-center gap-2" style={{ fontSize: 13 }}>
                {profile.mfa_enabled ? (
                  <span className="flex items-center gap-1" style={{ color: POS }}><Shield className="h-3.5 w-3.5" /> MFA activé</span>
                ) : (
                  <span className="flex items-center gap-1" style={{ color: T3 }}><ShieldOff className="h-3.5 w-3.5" /> MFA désactivé</span>
                )}
              </div>
            </div>
          </div>
        </div>

        {/* Roles management */}
        <div style={cardStyle}>
          <SectionHeader icon={Shield} label="Rôles" />
          <div className="space-y-5">
            {/* Current roles */}
            <div className="flex flex-wrap gap-2">
              {roles.length === 0 && <span style={{ fontSize: 13, color: T3 }}>Aucun rôle assigné</span>}
              {roles.map(role => {
                const meta = ROLE_META[role] || { label: role };
                return (
                  <span
                    key={role}
                    className="inline-flex items-center gap-1.5 pl-2.5 pr-1 py-1 rounded-full"
                    style={{ background: C_FAINT, border: `1px solid ${BORDER}`, color: T1, fontSize: 12, fontWeight: 600 }}
                  >
                    {meta.label}
                    <button
                      type="button"
                      onClick={(e) => { e.preventDefault(); e.stopPropagation(); handleRemoveRole(role); }}
                      className="ml-0.5 p-0.5 rounded-full cursor-pointer transition-colors"
                      style={{ color: NEG }}
                    >
                      <Trash2 className="h-3 w-3" />
                    </button>
                  </span>
                );
              })}
            </div>

            {/* Add role form */}
            {availableRoles.length > 0 && (
              <div className="rounded-xl p-4 space-y-3" style={{ background: INNER_BG, border: `1px solid ${BORDER}` }}>
                <p style={{ fontSize: 13, fontWeight: 600, color: T1 }}>Ajouter un rôle</p>

                <Select value={addingRole} onValueChange={(v) => { setAddingRole(v); if (!needsVenue(v)) setSelectedVenueId(''); else if (profile?.venue_id) setSelectedVenueId(profile.venue_id); }}>
                  <SelectTrigger className="w-full md:w-64">
                    <SelectValue placeholder="Sélectionner un rôle…" />
                  </SelectTrigger>
                  <SelectContent>
                    {availableRoles.map(r => {
                      const meta = ROLE_META[r] || { label: r, description: '' };
                      return (
                        <SelectItem key={r} value={r}>
                          <span className="font-medium">{meta.label}</span>
                          <span className="ml-2 text-xs" style={{ color: T3 }}>— {meta.description}</span>
                        </SelectItem>
                      );
                    })}
                  </SelectContent>
                </Select>

                {showVenueSelector && (
                  <div className="space-y-2">
                    <div className="flex items-center gap-2" style={{ fontSize: 13, color: T2 }}>
                      <AlertTriangle className="h-4 w-4 shrink-0" style={{ color: RED }} />
                      <span>
                        {addingRole === OWNER_ROLE
                          ? 'Ce rôle sera lié comme propriétaire de l\'établissement sélectionné.'
                          : 'Ce rôle nécessite un établissement de rattachement.'}
                      </span>
                    </div>
                    <Select value={selectedVenueId} onValueChange={setSelectedVenueId}>
                      <SelectTrigger className="w-full md:w-64">
                        <SelectValue placeholder="Sélectionner un établissement…" />
                      </SelectTrigger>
                      <SelectContent>
                        {venues.map(v => (
                          <SelectItem key={v.id} value={v.id}>{v.name}</SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>
                )}

                <button
                  onClick={handleAddRole}
                  disabled={!addingRole || (showVenueSelector && !selectedVenueId)}
                  style={{ ...primaryBtnStyle, opacity: (!addingRole || (showVenueSelector && !selectedVenueId)) ? 0.5 : 1 }}
                >
                  <Plus className="h-4 w-4" /> Ajouter
                </button>
              </div>
            )}
          </div>
        </div>

        {/* Sécurité & accès — recovery pro + suspension plateforme */}
        <div style={cardStyle}>
          <SectionHeader icon={ShieldAlert} label="Sécurité & accès" accent />
          {profile?.is_suspended && (
            <div className="flex items-start gap-2 mb-4 rounded-xl p-3" style={{ background: 'rgba(255,92,99,0.08)', border: '1px solid rgba(255,92,99,0.3)' }}>
              <Ban className="h-4 w-4 mt-0.5 shrink-0" style={{ color: NEG }} />
              <div style={{ fontSize: 13, color: T1 }}>
                <span style={{ fontWeight: 600, color: NEG }}>Compte suspendu.</span>{' '}
                {profile.suspension_reason ? <span style={{ color: T2 }}>Motif : {profile.suspension_reason}</span> : <span style={{ color: T3 }}>Aucun motif renseigné.</span>}
              </div>
            </div>
          )}
          <div className="flex flex-wrap gap-2.5">
            <button
              onClick={handleResetMfa}
              disabled={securityBusy}
              style={{ ...secondaryBtnStyle, opacity: securityBusy ? 0.5 : 1 }}
            >
              <KeyRound className="h-4 w-4" /> Réinitialiser le MFA
            </button>
            <button
              onClick={handleResetPassword}
              disabled={securityBusy}
              style={{ ...secondaryBtnStyle, opacity: securityBusy ? 0.5 : 1 }}
            >
              <Mail className="h-4 w-4" /> Réinitialiser le mot de passe
            </button>
            <button
              onClick={handleToggleSuspend}
              disabled={securityBusy || roles.includes('admin')}
              title={roles.includes('admin') ? 'Impossible de suspendre un admin' : undefined}
              style={{
                ...(profile?.is_suspended ? primaryBtnStyle : dangerBtnStyle),
                opacity: (securityBusy || roles.includes('admin')) ? 0.5 : 1,
              }}
            >
              {profile?.is_suspended ? <><UserCheck className="h-4 w-4" /> Réactiver le compte</> : <><Ban className="h-4 w-4" /> Suspendre le compte</>}
            </button>
          </div>
          <p style={{ fontSize: 12, color: T3, marginTop: 12, lineHeight: 1.5 }}>
            <strong style={{ color: T2 }}>Reset MFA</strong> : débloque un pro verrouillé (téléphone perdu) ; il ré-enrôle à la prochaine connexion.
            <br />
            <strong style={{ color: T2 }}>Reset mot de passe</strong> : envoie un lien de réinitialisation au pro.
            <br />
            <strong style={{ color: T2 }}>Suspension</strong> : coupe l'accès aux dashboards pro (effet à la prochaine navigation).
          </p>
        </div>

        {/* Owner venue sync — shown when user has owner role */}
        {roles.includes(OWNER_ROLE) && (
          <div style={cardStyle}>
            <SectionHeader icon={Building2} label="Établissement propriétaire" accent />
            <div className="space-y-3">
              {ownedVenue ? (
                <p style={{ fontSize: 13, color: T2 }}>
                  Actuellement lié à : <span style={{ fontWeight: 600, color: T1 }}>{ownedVenue.name}</span>
                </p>
              ) : (
                <p style={{ fontSize: 13, color: NEG, fontWeight: 600 }}>
                  ⚠ Aucun établissement lié — c'est pourquoi l'owner voit l'erreur "Aucun établissement assigné".
                </p>
              )}
              <div className="flex flex-col sm:flex-row gap-2 items-start sm:items-center">
                <Select value={resyncVenueId} onValueChange={setResyncVenueId}>
                  <SelectTrigger className="w-full sm:w-72">
                    <SelectValue placeholder="Sélectionner l'établissement à lier…" />
                  </SelectTrigger>
                  <SelectContent>
                    {venues.map(v => (
                      <SelectItem key={v.id} value={v.id}>{v.name}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                <button
                  onClick={handleResyncOwner}
                  disabled={!resyncVenueId || resyncing}
                  style={{ ...primaryBtnStyle, opacity: (!resyncVenueId || resyncing) ? 0.5 : 1 }}
                >
                  {resyncing ? 'Mise à jour…' : 'Synchroniser le lien propriétaire'}
                </button>
              </div>
            </div>
          </div>
        )}

        {/* Promoter profiles — shown when user has promoter role */}
        {roles.includes('promoter') && (
          <div style={cardStyle}>
            <SectionHeader icon={Star} label="Profils promoteur" accent />
            {promoterProfiles.length === 0 ? (
              <p style={{ fontSize: 13, color: NEG, fontWeight: 600, lineHeight: 1.6 }}>
                ⚠ Aucun profil dans la table <code style={{ background: C_FAINT, padding: '1px 5px', borderRadius: 4, color: T1 }}>promoters</code> — c'est pourquoi le dashboard promoteur est inaccessible.
                L'owner doit inviter cet utilisateur depuis son dashboard Promoteurs, ou utiliser le script SQL
                <code style={{ background: C_FAINT, padding: '1px 5px', borderRadius: 4, color: T1 }}>migration-kit/12_DIAGNOSTIC_OWNER_PROMOTER_SYNC.sql</code> (correction B2).
              </p>
            ) : (
              <div className="overflow-x-auto -mx-1">
                <table className="w-full text-[13px]">
                  <thead>
                    <tr style={{ borderBottom: `1px solid ${F_BORDER}` }}>
                      <th className="px-2 py-2.5 text-left font-medium" style={thStyle}>Établissement</th>
                      <th className="px-2 py-2.5 text-left font-medium" style={thStyle}>Code promo</th>
                      <th className="px-2 py-2.5 text-left font-medium" style={thStyle}>Statut</th>
                      <th className="px-2 py-2.5 text-left font-medium" style={thStyle}>Action</th>
                    </tr>
                  </thead>
                  <tbody>
                    {promoterProfiles.map((p, i) => (
                      <tr key={p.id} style={{ borderBottom: i < promoterProfiles.length - 1 ? `1px solid ${F_BORDER}` : 'none' }}>
                        <td className="px-2 py-3" style={{ color: T1, fontWeight: 600 }}>{p.venueName || '(aucun)'}</td>
                        <td className="px-2 py-3 font-mono text-xs" style={{ color: T2 }}>{p.promo_code}</td>
                        <td className="px-2 py-3">
                          {p.is_active
                            ? <span className="inline-flex items-center px-2 py-0.5 rounded-full" style={{ background: 'rgba(52,211,153,0.1)', border: '1px solid rgba(52,211,153,0.25)', color: POS, fontSize: 11, fontWeight: 600 }}>Actif</span>
                            : <span className="inline-flex items-center px-2 py-0.5 rounded-full" style={{ background: 'rgba(255,92,99,0.1)', border: '1px solid rgba(255,92,99,0.3)', color: NEG, fontSize: 11, fontWeight: 600 }}>Inactif</span>}
                        </td>
                        <td className="px-2 py-3">
                          <button
                            onClick={() => handleTogglePromoter(p.id, p.is_active)}
                            disabled={togglingPromoter === p.id}
                            style={{ ...(p.is_active ? dangerBtnStyle : secondaryBtnStyle), padding: '6px 12px', opacity: togglingPromoter === p.id ? 0.5 : 1 }}
                          >
                            {togglingPromoter === p.id
                              ? '…'
                              : p.is_active ? 'Désactiver' : 'Activer'}
                          </button>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        )}

        {/* Activity per venue */}
        {venueCustomers.length > 0 && (
          <div style={cardStyle}>
            <SectionHeader icon={ShoppingBag} label="Activité par établissement" />
            <div className="overflow-x-auto -mx-1">
              <table className="w-full text-[13px]">
                <thead>
                  <tr style={{ borderBottom: `1px solid ${F_BORDER}` }}>
                    <th className="px-2 py-2.5 text-left font-medium" style={thStyle}>Établissement</th>
                    <th className="px-2 py-2.5 text-left font-medium" style={thStyle}><ShoppingBag className="h-4 w-4 inline mr-1" />Commandes</th>
                    <th className="px-2 py-2.5 text-left font-medium" style={thStyle}><Ticket className="h-4 w-4 inline mr-1" />Billets</th>
                    <th className="px-2 py-2.5 text-left font-medium" style={thStyle}>Tables</th>
                    <th className="px-2 py-2.5 text-left font-medium" style={thStyle}>Dépensé</th>
                    <th className="px-2 py-2.5 text-left font-medium" style={thStyle}>Dernière visite</th>
                    <th className="px-2 py-2.5 text-left font-medium" style={thStyle}>Statut</th>
                  </tr>
                </thead>
                <tbody>
                  {venueCustomers.map((vc, i) => (
                    <tr key={vc.id} style={{ borderBottom: i < venueCustomers.length - 1 ? `1px solid ${F_BORDER}` : 'none' }}>
                      <td className="px-2 py-3" style={{ color: T1, fontWeight: 600 }}>{vc.venueName}</td>
                      <td className="px-2 py-3 tabular-nums" style={{ color: T2 }}>{vc.order_count ?? 0}</td>
                      <td className="px-2 py-3 tabular-nums" style={{ color: T2 }}>{vc.ticket_count ?? 0}</td>
                      <td className="px-2 py-3 tabular-nums" style={{ color: T2 }}>{vc.table_count ?? 0}</td>
                      <td className="px-2 py-3 tabular-nums" style={{ color: T1 }}>{(vc.total_spent ?? 0).toFixed(2)} €</td>
                      <td className="px-2 py-3" style={{ color: T2 }}>
                        {vc.last_visit_at ? format(new Date(vc.last_visit_at), 'dd/MM/yyyy') : '—'}
                      </td>
                      <td className="px-2 py-3">
                        {vc.is_banned ? (
                          <span className="inline-flex items-center px-2 py-0.5 rounded-full" style={{ background: 'rgba(255,92,99,0.1)', border: '1px solid rgba(255,92,99,0.3)', color: NEG, fontSize: 11, fontWeight: 600 }}>Banni</span>
                        ) : (
                          <span className="inline-flex items-center px-2 py-0.5 rounded-full" style={{ background: 'rgba(52,211,153,0.1)', border: '1px solid rgba(52,211,153,0.25)', color: POS, fontSize: 11, fontWeight: 600 }}>Actif</span>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        )}

        {/* Loyalty */}
        {loyalty.length > 0 && (
          <div style={cardStyle}>
            <SectionHeader icon={Star} label="Fidélité" accent />
            <div className="overflow-x-auto -mx-1">
              <table className="w-full text-[13px]">
                <thead>
                  <tr style={{ borderBottom: `1px solid ${F_BORDER}` }}>
                    <th className="px-2 py-2.5 text-left font-medium" style={thStyle}>Établissement</th>
                    <th className="px-2 py-2.5 text-left font-medium" style={thStyle}>Tier</th>
                    <th className="px-2 py-2.5 text-left font-medium" style={thStyle}>Solde</th>
                    <th className="px-2 py-2.5 text-left font-medium" style={thStyle}>Total gagné</th>
                  </tr>
                </thead>
                <tbody>
                  {loyalty.map((l, i) => (
                    <tr key={l.id} style={{ borderBottom: i < loyalty.length - 1 ? `1px solid ${F_BORDER}` : 'none' }}>
                      <td className="px-2 py-3" style={{ color: T1, fontWeight: 600 }}>{l.venueName}</td>
                      <td className="px-2 py-3"><span className="inline-flex items-center px-2 py-0.5 rounded-full" style={{ background: C_FAINT, border: `1px solid ${BORDER}`, color: T1, fontSize: 11, fontWeight: 600 }}>{l.tier || 'bronze'}</span></td>
                      <td className="px-2 py-3 tabular-nums" style={{ color: RED, fontWeight: 700 }}>{l.current_balance ?? 0} pts</td>
                      <td className="px-2 py-3 tabular-nums" style={{ color: T2 }}>{l.total_points_earned ?? 0} pts</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
