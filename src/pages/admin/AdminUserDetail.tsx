import { useState, useEffect } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { supabase } from '@/integrations/supabase/client';
import { useLanguage } from '@/contexts/LanguageContext';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { ArrowLeft, UserCircle, Shield, ShieldOff, Plus, Trash2, MapPin, Mail, Calendar, Star, ShoppingBag, Ticket, AlertTriangle, Building2 } from 'lucide-react';
import { format } from 'date-fns';
import { toast } from 'sonner';

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
      supabase.from('profiles').select('id, email, first_name, last_name, city, venue_id, avatar_url, created_at, mfa_enabled').eq('id', userId!).single(),
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

    const meta = ROLE_META[role];
    toast.success(`Rôle "${meta?.label || role}" retiré`);
    loadUser();
  };

  const availableRoles = ALL_ROLES.filter(r => !roles.includes(r));
  const showVenueSelector = needsVenue(addingRole);

  if (loading) {
    return (
      <div className="flex items-center justify-center min-h-[50vh]">
        <div className="h-10 w-10 animate-spin rounded-full border-4 border-primary border-t-transparent" />
      </div>
    );
  }

  if (!profile) {
    return (
      <div className="p-6">
        <Button variant="ghost" onClick={() => navigate(-1)}><ArrowLeft className="h-4 w-4 mr-2" />Retour</Button>
        <p className="text-muted-foreground mt-4">Utilisateur introuvable.</p>
      </div>
    );
  }

  return (
    <div className="p-4 md:p-6 space-y-6 max-w-5xl">
      <div className="flex items-center gap-3">
        <Button variant="ghost" size="icon" onClick={() => navigate(-1)}><ArrowLeft className="h-5 w-5" /></Button>
        <h1 className="text-2xl font-bold text-foreground">Détail utilisateur</h1>
      </div>

      {/* Profile card */}
      <Card>
        <CardContent className="p-6">
          <div className="flex items-start gap-4">
            {profile.avatar_url ? (
              <img src={profile.avatar_url} alt="" className="h-16 w-16 rounded-full object-cover border-2 border-border" />
            ) : (
              <UserCircle className="h-16 w-16 text-muted-foreground" />
            )}
            <div className="flex-1 space-y-1">
              <h2 className="text-xl font-bold text-foreground">
                {`${profile.first_name || ''} ${profile.last_name || ''}`.trim() || 'Sans nom'}
              </h2>
              <div className="flex items-center gap-2 text-sm text-muted-foreground">
                <Mail className="h-3.5 w-3.5" /> {profile.email}
              </div>
              {profile.city && (
                <div className="flex items-center gap-2 text-sm text-muted-foreground">
                  <MapPin className="h-3.5 w-3.5" /> {profile.city}
                </div>
              )}
              <div className="flex items-center gap-2 text-sm text-muted-foreground">
                <Calendar className="h-3.5 w-3.5" /> Inscrit le {format(new Date(profile.created_at), 'dd/MM/yyyy')}
              </div>
              {venueName && (
                <div className="flex items-center gap-2 text-sm text-muted-foreground">
                  <Building2 className="h-3.5 w-3.5" />
                  Établissement rattaché : <span className="font-medium text-foreground">{venueName}</span>
                </div>
              )}
              <div className="flex items-center gap-2 text-sm">
                {profile.mfa_enabled ? (
                  <span className="flex items-center gap-1 text-primary"><Shield className="h-3.5 w-3.5" /> MFA activé</span>
                ) : (
                  <span className="flex items-center gap-1 text-muted-foreground"><ShieldOff className="h-3.5 w-3.5" /> MFA désactivé</span>
                )}
              </div>
            </div>
          </div>
        </CardContent>
      </Card>

      {/* Roles management */}
      <Card>
        <CardHeader>
          <CardTitle className="text-lg">Rôles</CardTitle>
        </CardHeader>
        <CardContent className="space-y-5">
          {/* Current roles */}
          <div className="flex flex-wrap gap-2">
            {roles.length === 0 && <span className="text-sm text-muted-foreground">Aucun rôle assigné</span>}
            {roles.map(role => {
              const meta = ROLE_META[role] || { label: role };
              return (
                <Badge key={role} variant="outline" className="gap-1.5 pr-1">
                  {meta.label}
                  <button
                    type="button"
                    onClick={(e) => { e.preventDefault(); e.stopPropagation(); handleRemoveRole(role); }}
                    className="ml-1 p-0.5 rounded hover:bg-destructive/20 text-destructive"
                  >
                    <Trash2 className="h-3 w-3" />
                  </button>
                </Badge>
              );
            })}
          </div>

          {/* Add role form */}
          {availableRoles.length > 0 && (
            <div className="border border-border rounded-lg p-4 space-y-3 bg-muted/30">
              <p className="text-sm font-medium text-foreground">Ajouter un rôle</p>

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
                        <span className="text-muted-foreground ml-2 text-xs">— {meta.description}</span>
                      </SelectItem>
                    );
                  })}
                </SelectContent>
              </Select>

              {showVenueSelector && (
                <div className="space-y-2">
                  <div className="flex items-center gap-2 text-sm text-muted-foreground">
                    <AlertTriangle className="h-4 w-4 shrink-0" />
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

              <Button size="sm" onClick={handleAddRole} disabled={!addingRole || (showVenueSelector && !selectedVenueId)}>
                <Plus className="h-4 w-4 mr-1" /> Ajouter
              </Button>
            </div>
          )}
        </CardContent>
      </Card>

      {/* Owner venue sync — shown when user has owner role */}
      {roles.includes(OWNER_ROLE) && (
        <Card>
          <CardHeader>
            <CardTitle className="text-lg flex items-center gap-2">
              <Building2 className="h-5 w-5 text-primary" /> Établissement propriétaire
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-3">
            {ownedVenue ? (
              <p className="text-sm text-muted-foreground">
                Actuellement lié à : <span className="font-semibold text-foreground">{ownedVenue.name}</span>
              </p>
            ) : (
              <p className="text-sm text-destructive font-medium">
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
              <Button
                size="sm"
                onClick={handleResyncOwner}
                disabled={!resyncVenueId || resyncing}
              >
                {resyncing ? 'Mise à jour…' : 'Synchroniser le lien propriétaire'}
              </Button>
            </div>
          </CardContent>
        </Card>
      )}

      {/* Promoter profiles — shown when user has promoter role */}
      {roles.includes('promoter') && (
        <Card>
          <CardHeader>
            <CardTitle className="text-lg flex items-center gap-2">
              <Star className="h-5 w-5 text-primary" /> Profils promoteur
            </CardTitle>
          </CardHeader>
          <CardContent>
            {promoterProfiles.length === 0 ? (
              <p className="text-sm text-destructive font-medium">
                ⚠ Aucun profil dans la table <code>promoters</code> — c'est pourquoi le dashboard promoteur est inaccessible.
                L'owner doit inviter cet utilisateur depuis son dashboard Promoteurs, ou utiliser le script SQL
                <code>migration-kit/12_DIAGNOSTIC_OWNER_PROMOTER_SYNC.sql</code> (correction B2).
              </p>
            ) : (
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Établissement</TableHead>
                    <TableHead>Code promo</TableHead>
                    <TableHead>Statut</TableHead>
                    <TableHead>Action</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {promoterProfiles.map(p => (
                    <TableRow key={p.id}>
                      <TableCell className="font-medium">{p.venueName || '(aucun)'}</TableCell>
                      <TableCell className="font-mono text-xs">{p.promo_code}</TableCell>
                      <TableCell>
                        {p.is_active
                          ? <Badge variant="outline" className="text-primary">Actif</Badge>
                          : <Badge variant="destructive">Inactif</Badge>
                        }
                      </TableCell>
                      <TableCell>
                        <Button
                          size="sm"
                          variant={p.is_active ? 'destructive' : 'outline'}
                          onClick={() => handleTogglePromoter(p.id, p.is_active)}
                          disabled={togglingPromoter === p.id}
                        >
                          {togglingPromoter === p.id
                            ? '…'
                            : p.is_active ? 'Désactiver' : 'Activer'}
                        </Button>
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            )}
          </CardContent>
        </Card>
      )}

      {/* Activity per venue */}
      {venueCustomers.length > 0 && (
        <Card>
          <CardHeader>
            <CardTitle className="text-lg">Activité par établissement</CardTitle>
          </CardHeader>
          <CardContent>
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Établissement</TableHead>
                  <TableHead><ShoppingBag className="h-4 w-4 inline mr-1" />Commandes</TableHead>
                  <TableHead><Ticket className="h-4 w-4 inline mr-1" />Billets</TableHead>
                  <TableHead>Tables</TableHead>
                  <TableHead>Dépensé</TableHead>
                  <TableHead>Dernière visite</TableHead>
                  <TableHead>Statut</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {venueCustomers.map(vc => (
                  <TableRow key={vc.id}>
                    <TableCell className="font-medium">{vc.venueName}</TableCell>
                    <TableCell>{vc.order_count ?? 0}</TableCell>
                    <TableCell>{vc.ticket_count ?? 0}</TableCell>
                    <TableCell>{vc.table_count ?? 0}</TableCell>
                    <TableCell>{(vc.total_spent ?? 0).toFixed(2)} €</TableCell>
                    <TableCell className="text-sm text-muted-foreground">
                      {vc.last_visit_at ? format(new Date(vc.last_visit_at), 'dd/MM/yyyy') : '—'}
                    </TableCell>
                    <TableCell>
                      {vc.is_banned ? (
                        <Badge variant="destructive">Banni</Badge>
                      ) : (
                        <Badge variant="outline" className="text-primary">Actif</Badge>
                      )}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </CardContent>
        </Card>
      )}

      {/* Loyalty */}
      {loyalty.length > 0 && (
        <Card>
          <CardHeader>
            <CardTitle className="text-lg flex items-center gap-2"><Star className="h-5 w-5 text-primary" /> Fidélité</CardTitle>
          </CardHeader>
          <CardContent>
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Établissement</TableHead>
                  <TableHead>Tier</TableHead>
                  <TableHead>Solde</TableHead>
                  <TableHead>Total gagné</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {loyalty.map(l => (
                  <TableRow key={l.id}>
                    <TableCell className="font-medium">{l.venueName}</TableCell>
                    <TableCell><Badge variant="outline">{l.tier || 'bronze'}</Badge></TableCell>
                    <TableCell className="font-bold text-primary">{l.current_balance ?? 0} pts</TableCell>
                    <TableCell>{l.total_points_earned ?? 0} pts</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </CardContent>
        </Card>
      )}
    </div>
  );
}
