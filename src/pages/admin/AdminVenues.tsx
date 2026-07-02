import { useState, useEffect } from 'react';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from '@/components/ui/dialog';
import { supabase } from '@/integrations/supabase/client';
import { useLanguage } from '@/contexts/LanguageContext';
import { Plus, Edit2, Trash2, User, Building2, ExternalLink, Mail, Loader2, Eye, EyeOff } from 'lucide-react';
import { toast } from 'sonner';
import { motion } from 'framer-motion';
import { GenerateOnboardingLinkButton } from '@/components/onboarding/GenerateOnboardingLinkButton';

// ─── Yuno Design Tokens ───────────────────────────────────────────────────────
const RED        = '#E8192C';
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

const inputStyle: React.CSSProperties = {
  background: INNER_BG, border: `1px solid ${BORDER}`, borderRadius: 10,
  color: T1, fontSize: 13, padding: '9px 12px', width: '100%', outline: 'none',
};

const labelStyle: React.CSSProperties = { color: T2, fontSize: 12.5, fontWeight: 560, display: 'block', marginBottom: 6 };

const primaryBtnStyle: React.CSSProperties = {
  display: 'inline-flex', alignItems: 'center', justifyContent: 'center', gap: 6, padding: '9px 16px',
  borderRadius: 10, background: RED, border: `1px solid ${RED}`,
  color: '#fff', fontSize: 13, fontWeight: 600, cursor: 'pointer',
};

const secondaryBtnStyle: React.CSSProperties = {
  display: 'inline-flex', alignItems: 'center', justifyContent: 'center', gap: 6, padding: '9px 14px',
  borderRadius: 10, background: INNER_BG, border: `1px solid ${BORDER}`,
  color: T2, fontSize: 12.5, fontWeight: 560, cursor: 'pointer',
};

const dangerBtnStyle: React.CSSProperties = {
  display: 'inline-flex', alignItems: 'center', justifyContent: 'center', gap: 6, padding: '9px 16px',
  borderRadius: 10, background: 'rgba(255,92,99,0.14)', border: '1px solid rgba(255,92,99,0.35)',
  color: NEG, fontSize: 13, fontWeight: 600, cursor: 'pointer',
};

const iconBtnStyle: React.CSSProperties = {
  display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
  height: 32, width: 32, borderRadius: 8, background: 'transparent',
  border: '1px solid transparent', cursor: 'pointer',
};

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
    return (
      <div className="flex min-h-screen items-center justify-center" style={{ background: '#000' }}>
        <div className="h-12 w-12 animate-spin rounded-full border-2" style={{ borderColor: `${BORDER} ${BORDER} ${BORDER} ${RED}` }} />
      </div>
    );
  }

  return (
    <div className="min-h-screen" style={{ background: '#000' }}>
      <div className="mx-auto max-w-[1340px] px-4 sm:px-6 py-6 space-y-6">
        {/* Header */}
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
          <div>
            <h1 style={{ color: T1, fontSize: 'clamp(22px,3vw,28px)', fontWeight: 700, letterSpacing: '-0.025em', lineHeight: 1.1 }}>{t('adminVenues.title')}</h1>
            <p style={{ color: T3, fontSize: 13, marginTop: 4 }}>{t('adminVenues.clubCount').replace('{count}', String(venues.length))}</p>
          </div>
          <button onClick={openCreateDialog} style={primaryBtnStyle} className="w-full sm:w-auto">
            <Plus className="h-4 w-4" />{t('adminVenues.newClub')}
          </button>
        </div>

        <div className="grid gap-4 grid-cols-1 sm:grid-cols-2 xl:grid-cols-3">
          {venues.map((venue, index) => (
            <motion.div key={venue.id} initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: index * 0.05 }}>
              <div
                style={{
                  background: CARD_BG,
                  border: `1px solid ${venue.is_hidden ? F_BORDER : BORDER}`,
                  borderStyle: venue.is_hidden ? 'dashed' : 'solid',
                  borderRadius: 18,
                  boxShadow: CARD_SHADOW,
                  overflow: 'hidden',
                  opacity: venue.is_hidden ? 0.6 : 1,
                }}
              >
                {/* Header row: icon + name + city | action icons */}
                <div className="flex items-center gap-3 p-4 pb-0">
                  <div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl" style={{ background: 'rgba(232,25,44,0.1)', border: '1px solid rgba(232,25,44,0.2)' }}>
                    <Building2 className="h-5 w-5" style={{ color: RED }} />
                  </div>
                  <div className="flex-1 min-w-0">
                    <h3 className="truncate" style={{ color: T1, fontSize: 15.5, fontWeight: 600, lineHeight: 1.2, letterSpacing: '-0.01em' }}>{venue.name}</h3>
                    <p style={{ color: T3, fontSize: 11.5, marginTop: 2 }}>{venue.city}</p>
                  </div>
                  <div className="flex items-center gap-0.5 shrink-0">
                    <button style={iconBtnStyle} className="cursor-pointer" onClick={() => toggleVenueVisibility(venue.id, venue.is_hidden)} title={venue.is_hidden ? t('adminVenues.makeVisible') : t('adminVenues.hideFromPublic')}>
                      {venue.is_hidden ? <Eye className="h-4 w-4" style={{ color: T3 }} /> : <EyeOff className="h-4 w-4" style={{ color: T3 }} />}
                    </button>
                    <button style={iconBtnStyle} className="cursor-pointer" onClick={() => openEditDialog(venue)}>
                      <Edit2 className="h-4 w-4" style={{ color: T2 }} />
                    </button>
                    <button style={iconBtnStyle} className="cursor-pointer" onClick={() => { setDeleteTarget(venue); setDeleteConfirmName(''); }}>
                      <Trash2 className="h-4 w-4" style={{ color: NEG }} />
                    </button>
                  </div>
                </div>

                {/* Hidden badge */}
                {venue.is_hidden && (
                  <div className="px-4 pt-2">
                    <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full" style={{ background: C_FAINT, border: `1px solid ${BORDER}`, color: T2, fontSize: 10, fontWeight: 600 }}>
                      <EyeOff className="h-3 w-3" />{t('adminVenues.hidden')}
                    </span>
                  </div>
                )}

                {/* Info rows */}
                <div className="p-4 pt-3 space-y-2.5">
                  <div className="flex items-center gap-2" style={{ fontSize: 12, color: T3 }}>
                    <span>ID:</span>
                    <code style={{ background: C_FAINT, padding: '2px 6px', borderRadius: 5, color: T1, fontSize: 12 }}>{venue.id}</code>
                  </div>

                  {venue.address && (
                    <p className="truncate" style={{ fontSize: 12, color: T3 }}>{venue.address}</p>
                  )}

                  <div className="flex items-center gap-2" style={{ fontSize: 12 }}>
                    <User className="h-3.5 w-3.5 shrink-0" style={{ color: T3 }} />
                    {venue.owner_email ? (
                      <span className="truncate" style={{ color: T1 }}>{venue.owner_email}</span>
                    ) : venue.pending_owner_email ? (
                      <span className="truncate" style={{ color: T3 }}>{t('adminVenues.pendingInvite').replace('{email}', venue.pending_owner_email)}</span>
                    ) : (
                      <span style={{ color: T3 }}>{t('adminVenues.noOwner')}</span>
                    )}
                  </div>

                  {venue.pending_owner_email && venue.pending_owner_token && (
                    <div className="flex gap-2">
                      <button style={{ ...secondaryBtnStyle, flex: 1, padding: '7px 10px', fontSize: 12 }} onClick={() => copyInviteLink(venue.pending_owner_token!)}>{t('adminVenues.copyLink')}</button>
                      <button style={{ ...secondaryBtnStyle, flex: 1, padding: '7px 10px', fontSize: 12, opacity: inviting ? 0.5 : 1 }} disabled={inviting} onClick={() => inviteOwnerToEmail(venue.id, venue.name, venue.pending_owner_email!)}>{t('adminVenues.resend')}</button>
                    </div>
                  )}

                  {!venue.owner_email && (
                    <GenerateOnboardingLinkButton
                      roles={['owner']}
                      venueId={venue.id}
                      buttonLabel={t('adminVenues.ownerLink')}
                      variant="outline"
                      size="sm"
                      className="w-full"
                    />
                  )}

                  <a href={`/club/${venue.id}`} target="_blank" rel="noopener noreferrer" style={{ ...secondaryBtnStyle, width: '100%', padding: '7px 10px', fontSize: 12, textDecoration: 'none' }}>
                    <ExternalLink className="h-3.5 w-3.5" />{t('adminVenues.viewPage')}
                  </a>
                </div>
              </div>
            </motion.div>
          ))}
        </div>

        <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
          <DialogContent className="max-w-md border-0" style={{ background: CARD_BG, border: `1px solid ${BORDER}`, boxShadow: CARD_SHADOW }}>
            <DialogHeader>
              <DialogTitle style={{ color: T1 }}>{editingVenue ? t('adminVenues.editClub') : t('adminVenues.newClubTitle')}</DialogTitle>
              <DialogDescription style={{ color: T3 }}>{editingVenue ? t('adminVenues.editClubDesc') : t('adminVenues.newClubDesc')}</DialogDescription>
            </DialogHeader>
            <div className="space-y-4">
              {!editingVenue && (
                <div>
                  <label htmlFor="id" style={labelStyle}>{t('adminVenues.slugLabel')}</label>
                  <input id="id" value={formData.id} onChange={(e) => setFormData({ ...formData, id: e.target.value })} placeholder="pampa" style={inputStyle} />
                  <p style={{ fontSize: 12, color: T3, marginTop: 4 }}>{t('adminVenues.urlWillBe').replace('{slug}', formData.id || 'slug')}</p>
                </div>
              )}
              <div>
                <label htmlFor="name" style={labelStyle}>{t('adminVenues.clubName')}</label>
                <input id="name" value={formData.name} onChange={(e) => setFormData({ ...formData, name: e.target.value })} placeholder="Le Pampa" style={inputStyle} />
              </div>
              <div>
                <label htmlFor="city" style={labelStyle}>{t('adminVenues.city')}</label>
                <input id="city" value={formData.city} onChange={(e) => setFormData({ ...formData, city: e.target.value })} placeholder="Paris" style={inputStyle} />
              </div>
              <div>
                <label htmlFor="address" style={labelStyle}>{t('adminVenues.addressOptional')}</label>
                <input id="address" value={formData.address} onChange={(e) => setFormData({ ...formData, address: e.target.value })} placeholder="123 rue Example" style={inputStyle} />
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label htmlFor="latitude" style={labelStyle}>{t('adminVenues.latitude')}</label>
                  <input id="latitude" type="number" step="any" value={formData.latitude} onChange={(e) => setFormData({ ...formData, latitude: e.target.value })} placeholder="48.8566" style={inputStyle} />
                </div>
                <div>
                  <label htmlFor="longitude" style={labelStyle}>{t('adminVenues.longitude')}</label>
                  <input id="longitude" type="number" step="any" value={formData.longitude} onChange={(e) => setFormData({ ...formData, longitude: e.target.value })} placeholder="2.3522" style={inputStyle} />
                </div>
                <p className="col-span-2" style={{ fontSize: 12, color: T3 }}>{t('adminVenues.gpsHint')}</p>
              </div>
              <div className="pt-4" style={{ borderTop: `1px solid ${F_BORDER}` }}>
                <label htmlFor="owner_email" className="flex items-center gap-2" style={labelStyle}><Mail className="h-4 w-4" style={{ color: RED }} />{t('adminVenues.ownerEmail')}</label>
                <input id="owner_email" type="email" value={formData.owner_email} onChange={(e) => setFormData({ ...formData, owner_email: e.target.value })} placeholder="owner@example.com" style={{ ...inputStyle, marginTop: 4 }} />
                <p style={{ fontSize: 12, color: T3, marginTop: 4 }}>
                  {editingVenue?.owner_email ? t('adminVenues.currentOwner').replace('{email}', editingVenue.owner_email) : t('adminVenues.inviteHint')}
                </p>
              </div>
              <div className="flex gap-2 pt-4">
                <button onClick={() => setDialogOpen(false)} style={{ ...secondaryBtnStyle, flex: 1 }}>{t('adminVenues.cancel')}</button>
                <button onClick={handleSave} style={{ ...primaryBtnStyle, flex: 1, opacity: (inviting || geocoding) ? 0.6 : 1 }} disabled={inviting || geocoding}>
                  {inviting || geocoding ? (<><Loader2 className="h-4 w-4 animate-spin" />{geocoding ? t('adminVenues.geocoding') : t('adminVenues.sending')}</>) : (editingVenue ? t('adminVenues.save') : t('adminVenues.create'))}
                </button>
              </div>
            </div>
          </DialogContent>
        </Dialog>

        {/* Delete confirmation dialog */}
        <Dialog open={!!deleteTarget} onOpenChange={(open) => { if (!open) { setDeleteTarget(null); setDeleteConfirmName(''); } }}>
          <DialogContent className="max-w-md border-0" style={{ background: CARD_BG, border: `1px solid ${BORDER}`, boxShadow: CARD_SHADOW }}>
            <DialogHeader>
              <DialogTitle style={{ color: NEG }}>{t('adminVenues.deleteTitle').replace('{name}', deleteTarget?.name || '')}</DialogTitle>
              <DialogDescription style={{ color: T3 }}>{t('adminVenues.deleteWarning')}</DialogDescription>
            </DialogHeader>
            <div className="space-y-4">
              <p style={{ fontSize: 13, color: T2 }}>{t('adminVenues.deleteTypeName').replace('{name}', deleteTarget?.name || '')}</p>
              <input
                value={deleteConfirmName}
                onChange={(e) => setDeleteConfirmName(e.target.value)}
                placeholder={deleteTarget?.name || ''}
                autoComplete="off"
                style={inputStyle}
              />
              <div className="flex gap-2">
                <button onClick={() => { setDeleteTarget(null); setDeleteConfirmName(''); }} style={{ ...secondaryBtnStyle, flex: 1 }}>{t('adminVenues.cancel')}</button>
                <button
                  onClick={handleDelete}
                  disabled={deleteConfirmName !== deleteTarget?.name || deleting}
                  style={{ ...dangerBtnStyle, flex: 1, opacity: (deleteConfirmName !== deleteTarget?.name || deleting) ? 0.5 : 1 }}
                >
                  {deleting ? <><Loader2 className="h-4 w-4 animate-spin" />{t('adminVenues.deleting') || 'Suppression...'}</> : <><Trash2 className="h-4 w-4" />{t('adminVenues.confirmDeleteBtn')}</>}
                </button>
              </div>
            </div>
          </DialogContent>
        </Dialog>
      </div>
    </div>
  );
}
