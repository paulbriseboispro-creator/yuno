import { useState, useEffect } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from '@/components/ui/dialog';
import { supabase } from '@/integrations/supabase/client';
import { useLanguage } from '@/contexts/LanguageContext';
import { Plus, Edit2, Trash2, User, Building2, ExternalLink, Mail, Loader2, Eye, EyeOff } from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { toast } from 'sonner';
import { motion } from 'framer-motion';

interface Venue {
  id: string;
  name: string;
  city: string;
  address: string | null;
  latitude: number | null;
  longitude: number | null;
  owner_id: string | null;
  is_hidden: boolean;
  owner_email?: string;
  pending_owner_email?: string;
  pending_owner_expires_at?: string;
  pending_owner_token?: string;
}

export default function AdminVenues() {
  const { t } = useLanguage();
  const [venues, setVenues] = useState<Venue[]>([]);
  const [loading, setLoading] = useState(true);
  const [dialogOpen, setDialogOpen] = useState(false);
  const [editingVenue, setEditingVenue] = useState<Venue | null>(null);
  const [inviting, setInviting] = useState(false);
  const [geocoding, setGeocoding] = useState(false);
  const [formData, setFormData] = useState({
    id: '', name: '', city: '', address: '', latitude: '', longitude: '', owner_email: '',
  });
  const [deleteTarget, setDeleteTarget] = useState<Venue | null>(null);
  const [deleteConfirmName, setDeleteConfirmName] = useState('');

  const geocodeAddress = async (addr: string): Promise<{ lat: number; lng: number } | null> => {
    if (!addr || addr.length < 5) return null;
    setGeocoding(true);
    try {
      const { data, error } = await supabase.functions.invoke('geocode-address', { body: { address: addr } });
      if (error) throw error;
      if (data?.latitude && data?.longitude) return { lat: data.latitude, lng: data.longitude };
    } catch (error) {
      console.error('Geocoding error:', error);
    } finally {
      setGeocoding(false);
    }
    return null;
  };

  useEffect(() => { fetchData(); }, []);

  const fetchData = async () => {
    try {
      const { data: venuesData, error: venuesError } = await supabase.from('venues').select('*').order('name');
      if (venuesError) throw venuesError;

      if (venuesData) {
        const venueIds = venuesData.map((v) => v.id);
        const ownerIds = venuesData.filter((v) => v.owner_id).map((v) => v.owner_id);

        const profilesPromise = (ownerIds.length > 0
          ? supabase.from('profiles').select('id, email').in('id', ownerIds)
          : Promise.resolve({ data: [] } as any)) as any;

        const invitesPromise = (venueIds.length > 0
          ? supabase.from('owner_invitations').select('venue_id, email, token, expires_at, created_at')
              .in('venue_id', venueIds).is('accepted_at', null).gt('expires_at', new Date().toISOString())
              .order('created_at', { ascending: false })
          : Promise.resolve({ data: [] } as any)) as any;

        const [profilesRes, invitesRes] = await Promise.all([profilesPromise, invitesPromise]);
        const profiles = (profilesRes?.data ?? []) as Array<{ id: string; email: string }>;
        const invites = (invitesRes?.data ?? []) as Array<{ venue_id: string; email: string; token?: string; expires_at: string }>;

        const inviteByVenue = new Map<string, { email: string; expires_at: string; token?: string }>();
        invites.forEach((inv) => { if (!inviteByVenue.has(inv.venue_id)) inviteByVenue.set(inv.venue_id, inv); });

        setVenues(venuesData.map((v) => {
          const ownerEmail = v.owner_id ? profiles.find((p) => p.id === v.owner_id)?.email : undefined;
          const pending = inviteByVenue.get(v.id);
          return { ...v, owner_email: ownerEmail, pending_owner_email: !ownerEmail ? pending?.email : undefined, pending_owner_expires_at: !ownerEmail ? pending?.expires_at : undefined, pending_owner_token: !ownerEmail ? pending?.token : undefined };
        }));
      }
    } catch (error) {
      console.error('Error fetching data:', error);
      toast.error(t('adminVenues.loadError'));
    } finally {
      setLoading(false);
    }
  };

  const openCreateDialog = () => {
    setEditingVenue(null);
    setFormData({ id: '', name: '', city: '', address: '', latitude: '', longitude: '', owner_email: '' });
    setDialogOpen(true);
  };

  const openEditDialog = (venue: Venue) => {
    setEditingVenue(venue);
    setFormData({ id: venue.id, name: venue.name, city: venue.city, address: venue.address || '', latitude: venue.latitude?.toString() || '', longitude: venue.longitude?.toString() || '', owner_email: venue.owner_email || venue.pending_owner_email || '' });
    setDialogOpen(true);
  };

  const handleSave = async () => {
    if (!formData.name || !formData.city) { toast.error(t('adminVenues.nameAndCityRequired')); return; }
    if (!editingVenue && !formData.id) { toast.error(t('adminVenues.idRequired')); return; }

    try {
      const venueId = editingVenue ? editingVenue.id : formData.id.toLowerCase().replace(/\s+/g, '-');
      let lat = formData.latitude ? parseFloat(formData.latitude) : null;
      let lng = formData.longitude ? parseFloat(formData.longitude) : null;
      
      if (formData.address && (!lat || !lng)) {
        const coords = await geocodeAddress(formData.address);
        if (coords) { lat = coords.lat; lng = coords.lng; setFormData(prev => ({ ...prev, latitude: coords.lat.toString(), longitude: coords.lng.toString() })); }
      }

      if (editingVenue) {
        const { error } = await supabase.from('venues').update({ name: formData.name, city: formData.city, address: formData.address || null, latitude: lat, longitude: lng }).eq('id', editingVenue.id);
        if (error) throw error;
        toast.success(lat && lng ? t('adminVenues.clubUpdatedGPS') : t('adminVenues.clubUpdated'));
      } else {
        const { error } = await supabase.from('venues').insert({ id: venueId, name: formData.name, city: formData.city, address: formData.address || null, latitude: lat, longitude: lng });
        if (error) throw error;
        toast.success(lat && lng ? t('adminVenues.clubCreatedGPS') : t('adminVenues.clubCreated'));
      }

      if (formData.owner_email) await inviteOwnerToEmail(venueId, formData.name, formData.owner_email);
      setDialogOpen(false);
      fetchData();
    } catch (error: any) {
      console.error('Error saving venue:', error);
      toast.error(error.message || t('adminVenues.saveError'));
    }
  };

  const inviteOwnerToEmail = async (venueId: string, venueName: string, ownerEmail: string) => {
    const email = ownerEmail.trim();
    if (!email) return;
    setInviting(true);
    try {
      const { data, error } = await supabase.functions.invoke('invite-owner', { body: { email, venue_id: venueId, venue_name: venueName } });
      if (error) throw error;
      if (data.user_exists) {
        toast.success(t('adminVenues.assignedOwner').replace('{email}', email));
      } else {
        toast.success(t('adminVenues.inviteSent').replace('{email}', email));
      }
    } catch (error: any) {
      const msg = String(error?.message || '');
      if (msg.toLowerCase().includes('verify a domain') || msg.toLowerCase().includes('testing emails')) {
        toast.error(t('adminVenues.emailRejected'));
      } else {
        toast.error(msg || t('adminVenues.saveError'));
      }
    } finally {
      setInviting(false);
    }
  };

  const copyInviteLink = async (token: string) => {
    try {
      const url = `${window.location.origin}/auth?invite=${encodeURIComponent(token)}`;
      await navigator.clipboard.writeText(url);
      toast.success(t('adminVenues.inviteCopied'));
    } catch {
      toast.error(t('adminVenues.copyFailed'));
    }
  };

  const [deleting, setDeleting] = useState(false);

  const handleDelete = async () => {
    if (!deleteTarget) return;
    setDeleting(true);
    try {
      const { error } = await supabase.rpc('admin_delete_venue', { _venue_id: deleteTarget.id });
      if (error) throw error;
      toast.success(t('adminVenues.clubDeleted'));
      setDeleteTarget(null);
      setDeleteConfirmName('');
      fetchData();
    } catch (error: any) {
      console.error('Delete venue error:', error);
      toast.error(error.message || t('adminVenues.deleteError'));
    } finally {
      setDeleting(false);
    }
  };

  const toggleVenueVisibility = async (venueId: string, currentlyHidden: boolean) => {
    try {
      const { error } = await supabase.from('venues').update({ is_hidden: !currentlyHidden }).eq('id', venueId);
      if (error) throw error;
      toast.success(currentlyHidden ? t('adminVenues.visibleAll') : t('adminVenues.hiddenPublic'));
      fetchData();
    } catch (error: any) {
      toast.error(error.message || t('adminVenues.visibilityError'));
    }
  };

  if (loading) {
    return <div className="flex min-h-screen items-center justify-center"><div className="h-12 w-12 animate-spin rounded-full border-4 border-primary border-t-transparent" /></div>;
  }

  return (
    <div className="p-4 sm:p-6 space-y-6">
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
        <div>
          <h1 className="text-2xl sm:text-3xl font-bold">{t('adminVenues.title')}</h1>
          <p className="text-muted-foreground">{t('adminVenues.clubCount').replace('{count}', String(venues.length))}</p>
        </div>
        <Button onClick={openCreateDialog} className="w-full sm:w-auto"><Plus className="h-4 w-4 mr-2" />{t('adminVenues.newClub')}</Button>
      </div>

      <div className="grid gap-4 grid-cols-1 sm:grid-cols-2 xl:grid-cols-3">
        {venues.map((venue, index) => (
          <motion.div key={venue.id} initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: index * 0.05 }}>
            <Card className={`overflow-hidden ${venue.is_hidden ? 'opacity-60 border-dashed' : ''}`}>
              {/* Header row: icon + name + city | action icons */}
              <div className="flex items-center gap-3 p-4 pb-0">
                <div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl bg-primary/15">
                  <Building2 className="h-5 w-5 text-primary" />
                </div>
                <div className="flex-1 min-w-0">
                  <h3 className="font-semibold text-base leading-tight truncate">{venue.name}</h3>
                  <p className="text-xs text-muted-foreground">{venue.city}</p>
                </div>
                <div className="flex items-center gap-0.5 shrink-0">
                  <Button variant="ghost" size="icon" className="h-8 w-8" onClick={() => toggleVenueVisibility(venue.id, venue.is_hidden)} title={venue.is_hidden ? t('adminVenues.makeVisible') : t('adminVenues.hideFromPublic')}>
                    {venue.is_hidden ? <Eye className="h-4 w-4 text-muted-foreground" /> : <EyeOff className="h-4 w-4 text-muted-foreground" />}
                  </Button>
                  <Button variant="ghost" size="icon" className="h-8 w-8" onClick={() => openEditDialog(venue)}>
                    <Edit2 className="h-4 w-4" />
                  </Button>
                  <Button variant="ghost" size="icon" className="h-8 w-8" onClick={() => { setDeleteTarget(venue); setDeleteConfirmName(''); }}>
                    <Trash2 className="h-4 w-4 text-destructive" />
                  </Button>
                </div>
              </div>

              {/* Hidden badge */}
              {venue.is_hidden && (
                <div className="px-4 pt-2">
                  <Badge variant="secondary" className="text-[10px]"><EyeOff className="h-3 w-3 mr-1" />{t('adminVenues.hidden')}</Badge>
                </div>
              )}

              {/* Info rows */}
              <CardContent className="p-4 pt-3 space-y-2.5">
                <div className="flex items-center gap-2 text-xs text-muted-foreground">
                  <span>ID:</span>
                  <code className="bg-muted px-1.5 py-0.5 rounded text-foreground text-xs">{venue.id}</code>
                </div>

                {venue.address && (
                  <p className="text-xs text-muted-foreground truncate">{venue.address}</p>
                )}

                <div className="flex items-center gap-2 text-xs">
                  <User className="h-3.5 w-3.5 text-muted-foreground shrink-0" />
                  {venue.owner_email ? (
                    <span className="text-foreground truncate">{venue.owner_email}</span>
                  ) : venue.pending_owner_email ? (
                    <span className="text-muted-foreground truncate">{t('adminVenues.pendingInvite').replace('{email}', venue.pending_owner_email)}</span>
                  ) : (
                    <span className="text-muted-foreground">{t('adminVenues.noOwner')}</span>
                  )}
                </div>

                {venue.pending_owner_email && venue.pending_owner_token && (
                  <div className="flex gap-2">
                    <Button variant="outline" size="sm" className="flex-1 h-8 text-xs" onClick={() => copyInviteLink(venue.pending_owner_token!)}>{t('adminVenues.copyLink')}</Button>
                    <Button variant="outline" size="sm" className="flex-1 h-8 text-xs" disabled={inviting} onClick={() => inviteOwnerToEmail(venue.id, venue.name, venue.pending_owner_email!)}>{t('adminVenues.resend')}</Button>
                  </div>
                )}

                <Button variant="outline" size="sm" className="w-full h-8 text-xs" asChild>
                  <a href={`/club/${venue.id}`} target="_blank" rel="noopener noreferrer"><ExternalLink className="h-3.5 w-3.5 mr-1.5" />{t('adminVenues.viewPage')}</a>
                </Button>
              </CardContent>
            </Card>
          </motion.div>
        ))}
      </div>

      <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>{editingVenue ? t('adminVenues.editClub') : t('adminVenues.newClubTitle')}</DialogTitle>
            <DialogDescription>{editingVenue ? t('adminVenues.editClubDesc') : t('adminVenues.newClubDesc')}</DialogDescription>
          </DialogHeader>
          <div className="space-y-4">
            {!editingVenue && (
              <div>
                <Label htmlFor="id">{t('adminVenues.slugLabel')}</Label>
                <Input id="id" value={formData.id} onChange={(e) => setFormData({ ...formData, id: e.target.value })} placeholder="pampa" />
                <p className="text-xs text-muted-foreground mt-1">{t('adminVenues.urlWillBe').replace('{slug}', formData.id || 'slug')}</p>
              </div>
            )}
            <div>
              <Label htmlFor="name">{t('adminVenues.clubName')}</Label>
              <Input id="name" value={formData.name} onChange={(e) => setFormData({ ...formData, name: e.target.value })} placeholder="Le Pampa" />
            </div>
            <div>
              <Label htmlFor="city">{t('adminVenues.city')}</Label>
              <Input id="city" value={formData.city} onChange={(e) => setFormData({ ...formData, city: e.target.value })} placeholder="Paris" />
            </div>
            <div>
              <Label htmlFor="address">{t('adminVenues.addressOptional')}</Label>
              <Input id="address" value={formData.address} onChange={(e) => setFormData({ ...formData, address: e.target.value })} placeholder="123 rue Example" />
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <Label htmlFor="latitude">{t('adminVenues.latitude')}</Label>
                <Input id="latitude" type="number" step="any" value={formData.latitude} onChange={(e) => setFormData({ ...formData, latitude: e.target.value })} placeholder="48.8566" />
              </div>
              <div>
                <Label htmlFor="longitude">{t('adminVenues.longitude')}</Label>
                <Input id="longitude" type="number" step="any" value={formData.longitude} onChange={(e) => setFormData({ ...formData, longitude: e.target.value })} placeholder="2.3522" />
              </div>
              <p className="col-span-2 text-xs text-muted-foreground">{t('adminVenues.gpsHint')}</p>
            </div>
            <div className="border-t pt-4">
              <Label htmlFor="owner_email" className="flex items-center gap-2"><Mail className="h-4 w-4" />{t('adminVenues.ownerEmail')}</Label>
              <Input id="owner_email" type="email" value={formData.owner_email} onChange={(e) => setFormData({ ...formData, owner_email: e.target.value })} placeholder="owner@example.com" className="mt-1" />
              <p className="text-xs text-muted-foreground mt-1">
                {editingVenue?.owner_email ? t('adminVenues.currentOwner').replace('{email}', editingVenue.owner_email) : t('adminVenues.inviteHint')}
              </p>
            </div>
            <div className="flex gap-2 pt-4">
              <Button variant="outline" onClick={() => setDialogOpen(false)} className="flex-1">{t('adminVenues.cancel')}</Button>
              <Button onClick={handleSave} className="flex-1" disabled={inviting || geocoding}>
                {inviting || geocoding ? (<><Loader2 className="h-4 w-4 mr-2 animate-spin" />{geocoding ? t('adminVenues.geocoding') : t('adminVenues.sending')}</>) : (editingVenue ? t('adminVenues.save') : t('adminVenues.create'))}
              </Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>

      {/* Delete confirmation dialog */}
      <Dialog open={!!deleteTarget} onOpenChange={(open) => { if (!open) { setDeleteTarget(null); setDeleteConfirmName(''); } }}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle className="text-destructive">{t('adminVenues.deleteTitle').replace('{name}', deleteTarget?.name || '')}</DialogTitle>
            <DialogDescription>{t('adminVenues.deleteWarning')}</DialogDescription>
          </DialogHeader>
          <div className="space-y-4">
            <p className="text-sm text-muted-foreground">{t('adminVenues.deleteTypeName').replace('{name}', deleteTarget?.name || '')}</p>
            <Input
              value={deleteConfirmName}
              onChange={(e) => setDeleteConfirmName(e.target.value)}
              placeholder={deleteTarget?.name || ''}
              autoComplete="off"
            />
            <div className="flex gap-2">
              <Button variant="outline" onClick={() => { setDeleteTarget(null); setDeleteConfirmName(''); }} className="flex-1">{t('adminVenues.cancel')}</Button>
              <Button
                variant="destructive"
                onClick={handleDelete}
                disabled={deleteConfirmName !== deleteTarget?.name || deleting}
                className="flex-1"
              >
                {deleting ? <><Loader2 className="h-4 w-4 mr-2 animate-spin" />{t('adminVenues.deleting') || 'Suppression...'}</> : <><Trash2 className="h-4 w-4 mr-2" />{t('adminVenues.confirmDeleteBtn')}</>}
              </Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}
