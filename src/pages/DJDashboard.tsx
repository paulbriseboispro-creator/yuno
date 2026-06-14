import { useState, useEffect, useMemo } from 'react';
import { format } from 'date-fns';
import { fr, enUS, es } from 'date-fns/locale';
import { Music, Calendar, Euro, Clock, TrendingUp, Save, MapPin, Home, KeyRound } from 'lucide-react';
import { Instagram } from '@/components/icons/Instagram';
import { ChangePinFlow } from '@/components/ChangePinFlow';
import { ProfilePhotoUpload } from '@/components/ProfilePhotoUpload';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Badge } from '@/components/ui/badge';
import { Textarea } from '@/components/ui/textarea';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { DJCalendar } from '@/components/dj/DJCalendar';
import { VenueSelector } from '@/components/VenueSelector';
import { useLanguage } from '@/contexts/LanguageContext';
import { useAuth } from '@/hooks/useAuth';
import { supabase } from '@/integrations/supabase/client';
import { toast } from 'sonner';
import { useNavigate } from 'react-router-dom';
import {
  AreaChart,
  Area,
  XAxis,
  YAxis,
  Tooltip,
  ResponsiveContainer,
} from 'recharts';

const YUNO_MUSIC_GENRES = [
  'House', 'Techno', 'Rap / Hip-Hop', 'Afro / Shatta',
  'Reggaeton / Latino', 'Commercial / Hits', 'Electro / EDM', 'Open Format',
];

interface DJ {
  id: string;
  user_id: string;
  venue_id: string;
  first_name: string;
  last_name: string;
  stage_name?: string;
  whatsapp_number?: string;
  instagram_url?: string;
  tiktok_url?: string;
  music_genres: string[];
  bio?: string;
  profile_image_url?: string;
  is_active: boolean;
  pending_amount: number;
  total_paid: number;
  venue?: { id: string; name: string; logo_url?: string };
}

interface DJSet {
  id: string;
  dj_id: string;
  event_id?: string;
  venue_id: string;
  title?: string;
  start_time: string;
  end_time: string;
  music_genre?: string;
  notes?: string;
  fee: number;
  fee_paid: boolean;
  event?: { title: string };
  venue?: { name: string; address?: string };
}

interface DJPayment {
  id: string;
  amount: number;
  description?: string;
  paid_at: string;
}

const STORAGE_KEY = 'dj_selected_venue';

export default function DJDashboard() {
  const { user, loading: authLoading } = useAuth();
  const { language, t } = useLanguage();
  const navigate = useNavigate();
  const dateLocale = language === 'fr' ? fr : language === 'es' ? es : enUS;

  // Multi-venue support
  const [allDJProfiles, setAllDJProfiles] = useState<DJ[]>([]);
  const [selectedVenueId, setSelectedVenueId] = useState<string>('');
  
  const [sets, setSets] = useState<DJSet[]>([]);
  const [payments, setPayments] = useState<DJPayment[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);

  const [editForm, setEditForm] = useState({
    firstName: '',
    lastName: '',
    stageName: '',
    genres: '',
    whatsapp: '',
    instagram: '',
    tiktok: '',
    bio: '',
    soundcloud: '',
    spotify: '',
    youtube: '',
    city: '',
    country: '',
    description: '',
  });

  const [isProfileIncomplete, setIsProfileIncomplete] = useState(false);
  const [showChangePinFlow, setShowChangePinFlow] = useState(false);

  // Get current DJ profile based on selected venue
  const dj = useMemo(() => {
    return allDJProfiles.find(p => p.venue_id === selectedVenueId) || null;
  }, [allDJProfiles, selectedVenueId]);

  // Get venues list for selector
  const venues = useMemo(() => {
    return allDJProfiles
      .filter(p => p.venue)
      .map(p => ({
        id: p.venue_id,
        name: p.venue!.name,
        logo_url: p.venue!.logo_url,
      }));
  }, [allDJProfiles]);

  const labels = {
    title: t('dj.title'),
    planning: t('dj.mySchedule'),
    profile: t('dj.myProfile'),
    payments: t('dj.myPayments'),
    upcomingSets: t('dj.upcomingSets'),
    noSets: t('dj.noSets'),
    pending: t('dj.pending'),
    totalPaid: t('dj.totalReceived'),
    save: t('dj.save'),
    venue: t('dj.venue'),
  };

  useEffect(() => {
    if (!authLoading && !user) {
      navigate('/auth');
      return;
    }
    if (user) {
      fetchAllDJProfiles();
    }
  }, [user, authLoading]);

  // When DJ profile changes, update form and fetch related data
  useEffect(() => {
    if (dj) {
      const incomplete = !dj.first_name || !dj.last_name;
      setIsProfileIncomplete(incomplete);
      
      setEditForm({
        firstName: dj.first_name || '',
        lastName: dj.last_name || '',
        stageName: dj.stage_name || '',
        genres: (dj.music_genres || []).join(', '),
        whatsapp: dj.whatsapp_number || '',
        instagram: dj.instagram_url || '',
        tiktok: dj.tiktok_url || '',
        bio: dj.bio || '',
        soundcloud: (dj as any).soundcloud_url || '',
        spotify: (dj as any).spotify_url || '',
        youtube: (dj as any).youtube_url || '',
        city: (dj as any).city || '',
        country: (dj as any).country || '',
        description: (dj as any).description || '',
      });

      fetchSets(dj.id);
      fetchPayments(dj.id);
      
      // Persist selection
      localStorage.setItem(STORAGE_KEY, dj.venue_id);
    }
  }, [dj]);

  const fetchAllDJProfiles = async () => {
    if (!user) return;

    try {
      const { data, error } = await supabase
        .from('djs')
        .select('*, venue:venues(id, name, logo_url)')
        .eq('user_id', user.id);

      if (error) throw error;

      if (!data || data.length === 0) {
        toast.error(t('dj.profileNotFound'));
        navigate('/');
        return;
      }

      setAllDJProfiles(data);
      
      // Restore last selected venue or default to first
      const savedVenueId = localStorage.getItem(STORAGE_KEY);
      const validSavedVenue = data.find(p => p.venue_id === savedVenueId);
      
      setSelectedVenueId(validSavedVenue ? savedVenueId! : data[0].venue_id);
    } catch (error) {
      console.error('Error fetching DJ profiles:', error);
      toast.error(t('dj.loadingError'));
    } finally {
      setLoading(false);
    }
  };

  const fetchSets = async (djId: string) => {
    try {
      const { data, error } = await supabase
        .from('dj_sets')
        .select('*, event:events(title), venue:venues(name, address)')
        .eq('dj_id', djId)
        .order('start_time', { ascending: true });

      if (error) throw error;
      setSets(data || []);
    } catch (error) {
      console.error('Error fetching sets:', error);
    }
  };

  const fetchPayments = async (djId: string) => {
    try {
      const { data, error } = await supabase
        .from('dj_payments')
        .select('*')
        .eq('dj_id', djId)
        .order('paid_at', { ascending: false });

      if (error) throw error;
      setPayments(data || []);
    } catch (error) {
      console.error('Error fetching payments:', error);
    }
  };

  const handleSave = async () => {
    if (!dj) return;
    
    if (!editForm.firstName || !editForm.lastName) {
      toast.error(t('dj.firstLastRequired'));
      return;
    }
    
    setSaving(true);

    try {
      const { error } = await supabase
        .from('djs')
        .update({
          first_name: editForm.firstName,
          last_name: editForm.lastName,
          stage_name: editForm.stageName || null,
          music_genres: editForm.genres ? editForm.genres.split(',').map(g => g.trim()).filter(Boolean) : [],
          whatsapp_number: editForm.whatsapp || null,
          instagram_url: editForm.instagram || null,
          tiktok_url: editForm.tiktok || null,
          bio: editForm.bio || null,
          soundcloud_url: editForm.soundcloud || null,
          spotify_url: editForm.spotify || null,
          youtube_url: editForm.youtube || null,
          city: editForm.city || null,
          country: editForm.country || null,
          description: editForm.description || null,
          is_active: true,
        })
        .eq('id', dj.id);

      if (error) throw error;
      toast.success(t('dj.profileUpdated'));
      setIsProfileIncomplete(false);
      fetchAllDJProfiles();
    } catch (error) {
      console.error('Error saving:', error);
      toast.error(t('dj.saveError'));
    } finally {
      setSaving(false);
    }
  };

  const handleVenueChange = (venueId: string) => {
    setSelectedVenueId(venueId);
  };

  const upcomingSets = sets.filter(s => new Date(s.start_time) >= new Date());
  
  // Calculate pending amount from actual unpaid sets (not stored value)
  const calculatedPendingAmount = useMemo(() => {
    return sets.filter(s => !s.fee_paid && s.fee > 0).reduce((sum, s) => sum + s.fee, 0);
  }, [sets]);
  
  // Calculate total paid from actual payments
  const calculatedTotalPaid = useMemo(() => {
    return payments.reduce((sum, p) => sum + p.amount, 0);
  }, [payments]);

  const chartData = useMemo(() => {
    const grouped: Record<string, number> = {};
    payments.forEach(p => {
      const month = format(new Date(p.paid_at), 'MMM yyyy', { locale: dateLocale });
      grouped[month] = (grouped[month] || 0) + p.amount;
    });
    return Object.entries(grouped).map(([month, amount]) => ({ month, amount })).reverse();
  }, [payments, dateLocale]);

  if (authLoading || loading) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-background">
        <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-primary" />
      </div>
    );
  }

  if (!dj) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-background">
        <p className="text-muted-foreground">DJ profile not found</p>
      </div>
    );
  }

  return (
    <div className="min-h-screen dashboard-gradient-bg pb-24">
      {/* Header */}
      <header className="sticky top-0 z-40 border-b border-border/30 bg-surface/60 backdrop-blur-xl" style={{ paddingTop: 'env(safe-area-inset-top, 0px)' }}>
        <div className="mx-auto flex h-14 max-w-4xl items-center justify-between px-4">
          <div className="flex items-center gap-3">
            <Button variant="ghost" size="icon" onClick={() => navigate('/')} className="shrink-0 h-8 w-8">
              <Home className="h-4 w-4" />
            </Button>
            {dj.profile_image_url ? (
              <img src={dj.profile_image_url} alt="" className="w-9 h-9 rounded-full object-cover ring-1 ring-border/50" />
            ) : (
              <div className="w-9 h-9 rounded-full bg-primary/20 flex items-center justify-center">
                <Music className="h-4 w-4 text-primary" />
              </div>
            )}
            <div>
              <h1 className="text-sm font-semibold">{dj.stage_name || `${dj.first_name} ${dj.last_name}`}</h1>
              {venues.length <= 1 && dj.venue && (
                <p className="text-[10px] text-muted-foreground">{dj.venue.name}</p>
              )}
            </div>
          </div>
          <div className="flex items-center gap-2">
            <VenueSelector venues={venues} selectedVenueId={selectedVenueId} onSelect={handleVenueChange} />
            {dj.instagram_url && (
              <a href={dj.instagram_url} target="_blank" rel="noopener noreferrer" className="text-muted-foreground hover:text-primary">
                <Instagram className="h-4 w-4" />
              </a>
            )}
          </div>
        </div>
      </header>

      <div className="mx-auto max-w-4xl p-4">
        {/* Summary cards */}
        <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mb-6">
          <div className="owner-stat">
            <div className="flex items-center gap-2 text-muted-foreground mb-1">
              <Calendar className="h-3.5 w-3.5 text-primary" />
              <span className="text-[10px]">{labels.upcomingSets}</span>
            </div>
            <p className="text-xl font-bold metric-value">{upcomingSets.length}</p>
          </div>
          <div className="owner-stat">
            <div className="flex items-center gap-2 text-muted-foreground mb-1">
              <Clock className="h-3.5 w-3.5 text-primary" />
              <span className="text-[10px]">{t('dj.totalSets')}</span>
            </div>
            <p className="text-xl font-bold metric-value">{sets.length}</p>
          </div>
          <div className="owner-stat">
            <div className="flex items-center gap-2 text-muted-foreground mb-1">
              <Euro className="h-3.5 w-3.5 text-orange-500" />
              <span className="text-[10px]">{labels.pending}</span>
            </div>
            <p className="text-xl font-bold metric-value text-orange-500">{calculatedPendingAmount} €</p>
          </div>
          <div className="owner-stat">
            <div className="flex items-center gap-2 text-muted-foreground mb-1">
              <TrendingUp className="h-3.5 w-3.5 text-emerald-500" />
              <span className="text-[10px]">{labels.totalPaid}</span>
            </div>
            <p className="text-xl font-bold metric-value text-emerald-500">{calculatedTotalPaid} €</p>
          </div>
        </div>

        <Tabs defaultValue={isProfileIncomplete ? "profile" : "planning"}>
          <TabsList className="owner-tabs mb-4">
            <TabsTrigger value="planning" className="text-xs">{labels.planning}</TabsTrigger>
            <TabsTrigger value="payments" className="text-xs">{labels.payments}</TabsTrigger>
            <TabsTrigger value="profile" className="text-xs">
              {labels.profile}
              {isProfileIncomplete && <span className="ml-1 text-orange-500">•</span>}
            </TabsTrigger>
          </TabsList>

          <TabsContent value="planning">
            <div className="space-y-4">
              <DJCalendar
                sets={sets.map(s => ({ ...s, dj: { first_name: dj.first_name, last_name: dj.last_name, stage_name: dj.stage_name } }))}
                showDJNames={false}
              />

              <div className="owner-card p-4">
                <h3 className="font-semibold mb-4">{labels.upcomingSets}</h3>
                {upcomingSets.length === 0 ? (
                  <p className="text-muted-foreground text-sm">{labels.noSets}</p>
                ) : (
                  <div className="space-y-2">
                    {upcomingSets.map(set => (
                      <div key={set.id} className="owner-list-item space-y-2">
                        <div className="flex items-center justify-between">
                          <p className="font-medium">{set.event?.title || format(new Date(set.start_time), 'EEEE d MMMM', { locale: dateLocale })}</p>
                          {set.fee > 0 && (
                            <Badge variant={set.fee_paid ? "default" : "secondary"}>
                              {set.fee} € {set.fee_paid ? `(${t('dj.paid')})` : ''}
                            </Badge>
                          )}
                        </div>
                        <div className="flex items-center gap-2 text-sm text-muted-foreground">
                          <Clock className="h-3 w-3" />
                          {format(new Date(set.start_time), 'HH:mm')} - {format(new Date(set.end_time), 'HH:mm')}
                          {set.music_genre && ` • ${set.music_genre}`}
                        </div>
                        {set.venue?.address && (
                          <div className="flex items-center gap-2 text-sm text-muted-foreground">
                            <MapPin className="h-3 w-3" />
                            {set.venue.address}
                          </div>
                        )}
                        {set.notes && (
                          <p className="text-xs text-muted-foreground italic">{set.notes}</p>
                        )}
                      </div>
                    ))}
                  </div>
                )}
              </div>
            </div>
          </TabsContent>

          <TabsContent value="payments">
            <div className="space-y-4">
              {chartData.length > 0 && (
                <div className="owner-card p-4">
                  <h3 className="font-semibold mb-4">{t('dj.monthlyEarnings')}</h3>
                  <ResponsiveContainer width="100%" height={200}>
                    <AreaChart data={chartData}>
                      <defs>
                        <linearGradient id="earningsGradient" x1="0" y1="0" x2="0" y2="1">
                          <stop offset="5%" stopColor="hsl(var(--primary))" stopOpacity={0.3} />
                          <stop offset="95%" stopColor="hsl(var(--primary))" stopOpacity={0} />
                        </linearGradient>
                      </defs>
                      <XAxis dataKey="month" tick={{ fill: 'hsl(var(--muted-foreground))', fontSize: 10 }} />
                      <YAxis tick={{ fill: 'hsl(var(--muted-foreground))', fontSize: 10 }} />
                      <Tooltip />
                      <Area type="monotone" dataKey="amount" stroke="hsl(var(--primary))" fill="url(#earningsGradient)" />
                    </AreaChart>
                  </ResponsiveContainer>
                </div>
              )}

              {/* Per-set fee breakdown */}
              {sets.filter(s => s.fee > 0).length > 0 && (
                <div className="owner-card p-4">
                  <h3 className="font-semibold mb-4">{language === 'fr' ? 'Détail par set' : 'Per-set breakdown'}</h3>
                  <div className="space-y-2">
                    {sets.filter(s => s.fee > 0).sort((a, b) => new Date(b.start_time).getTime() - new Date(a.start_time).getTime()).map(set => (
                      <div key={set.id} className="owner-list-item flex items-center justify-between">
                        <div>
                          <p className="font-medium text-sm">{set.title || set.event?.title || (language === 'fr' ? 'Set' : 'Set')}</p>
                          <p className="text-xs text-muted-foreground">
                            {format(new Date(set.start_time), 'dd MMM yyyy', { locale: dateLocale })}
                            {set.venue && ` • ${set.venue.name}`}
                          </p>
                        </div>
                        <div className="text-right">
                          <span className={`font-bold text-sm ${set.fee_paid ? 'text-green-500' : 'text-amber-500'}`}>
                            {set.fee}€
                          </span>
                          <p className="text-[10px] text-muted-foreground">
                            {set.fee_paid ? (language === 'fr' ? 'Payé' : 'Paid') : (language === 'fr' ? 'En attente' : 'Pending')}
                          </p>
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              )}

              <div className="owner-card p-4">
                <h3 className="font-semibold mb-4">{t('dj.paymentHistory')}</h3>
                {payments.length === 0 ? (
                  <p className="text-muted-foreground text-sm">{t('dj.noPayments')}</p>
                ) : (
                  <div className="space-y-2">
                    {payments.map(payment => (
                      <div key={payment.id} className="owner-list-item flex items-center justify-between">
                        <div>
                          <p className="font-medium">{payment.description || 'Paiement'}</p>
                          <p className="text-sm text-muted-foreground">
                            {format(new Date(payment.paid_at), 'dd MMMM yyyy', { locale: dateLocale })}
                          </p>
                        </div>
                        <span className="font-bold text-green-500">+{payment.amount} €</span>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            </div>
          </TabsContent>

          <TabsContent value="profile">
            {showChangePinFlow ? (
              <ChangePinFlow onClose={() => setShowChangePinFlow(false)} hasExistingPin={true} />
            ) : (
            <div className="owner-card p-6 space-y-6">
              {/* Change PIN button */}
              <div className="flex items-center justify-between p-4 rounded-xl bg-white/[0.03] border border-white/[0.06]">
                <div className="flex items-center gap-3">
                  <div className="p-2 rounded-lg bg-primary/10">
                    <KeyRound className="h-5 w-5 text-primary" />
                  </div>
                  <div>
                    <p className="font-medium text-sm">Code PIN</p>
                    <p className="text-xs text-muted-foreground">Modifier ton code de sécurité</p>
                  </div>
                </div>
                <Button variant="outline" size="sm" onClick={() => setShowChangePinFlow(true)}>
                  Modifier
                </Button>
              </div>
              {/* Cover image */}
              <div>
                <Label className="text-sm mb-2 block">{t('dj.coverImage')}</Label>
                <div className="relative aspect-video rounded-xl overflow-hidden bg-card border border-border">
                  {(dj as any).cover_image_url ? (
                    <img src={(dj as any).cover_image_url} alt="" className="w-full h-full object-cover" />
                  ) : (
                    <div className="w-full h-full bg-gradient-to-br from-primary/20 to-background flex items-center justify-center">
                      <span className="text-muted-foreground text-sm">{t('dj.noCover')}</span>
                    </div>
                  )}
                  <input
                    id="cover-upload"
                    type="file"
                    accept="image/*"
                    className="hidden"
                    onChange={async (e) => {
                      const file = e.target.files?.[0];
                      if (!file) return;
                      const fileExt = file.name.split('.').pop();
                      const filePath = `dj-covers/${dj.id}-${Date.now()}.${fileExt}`;
                      const { error: uploadError } = await supabase.storage.from('profile-photos').upload(filePath, file);
                      if (uploadError) { toast.error('Upload error'); return; }
                      const { data: { publicUrl } } = supabase.storage.from('profile-photos').getPublicUrl(filePath);
                      await supabase.from('djs').update({ cover_image_url: publicUrl }).eq('id', dj.id);
                      fetchAllDJProfiles();
                    }}
                  />
                  <Button
                    variant="secondary"
                    size="sm"
                    className="absolute bottom-2 right-2"
                    onClick={() => document.getElementById('cover-upload')?.click()}
                  >
                    {t('dj.change')}
                  </Button>
                </div>
              </div>

              {/* Profile photo + name */}
              <div className="flex items-start gap-4">
                <ProfilePhotoUpload
                  currentImageUrl={dj.profile_image_url}
                  onUpload={async (url) => {
                    const { error } = await supabase
                      .from('djs')
                      .update({ profile_image_url: url })
                      .eq('id', dj.id);
                    if (!error) {
                      fetchAllDJProfiles();
                    }
                  }}
                  size="lg"
                  fallback={dj.stage_name?.[0] || dj.first_name?.[0] || 'DJ'}
                />
                <div>
                  <h2 className="text-xl font-bold">{dj.stage_name || `${dj.first_name} ${dj.last_name}`}</h2>
                  <p className="text-muted-foreground">{dj.first_name} {dj.last_name}</p>
                  {(dj as any).slug && (
                    <p className="text-xs text-primary mt-1">yuno.app/dj/{(dj as any).slug}</p>
                  )}
                  <div className="flex flex-wrap gap-1 mt-2">
                    {dj.music_genres.map((genre, i) => (
                      <Badge key={i} variant="secondary" className="text-xs">{genre}</Badge>
                    ))}
                  </div>
                </div>
              </div>

              <div className="space-y-4">
                {isProfileIncomplete && (
                  <div className="p-4 bg-orange-500/10 border border-orange-500/30 rounded-lg text-sm text-orange-500">
                    {t('dj.completeProfile')}
                  </div>
                )}
                
                <div className="grid grid-cols-2 gap-4">
                  <div>
                    <Label>{t('dj.firstName')} *</Label>
                    <Input
                      value={editForm.firstName}
                      onChange={(e) => setEditForm({ ...editForm, firstName: e.target.value })}
                    />
                  </div>
                  <div>
                    <Label>{t('dj.lastName')} *</Label>
                    <Input
                      value={editForm.lastName}
                      onChange={(e) => setEditForm({ ...editForm, lastName: e.target.value })}
                    />
                  </div>
                </div>

                <div>
                  <Label>{t('dj.stageName')}</Label>
                  <Input
                    value={editForm.stageName}
                    onChange={(e) => setEditForm({ ...editForm, stageName: e.target.value })}
                  />
                </div>

                <div>
                  <Label>{t('dj.musicGenres')} <span className="text-xs text-muted-foreground">(max 3)</span></Label>
                  <div className="flex flex-wrap gap-2 mt-2">
                    {YUNO_MUSIC_GENRES.map(genre => {
                      const selected = editForm.genres.split(',').map(g => g.trim()).filter(Boolean).includes(genre);
                      const currentGenres = editForm.genres.split(',').map(g => g.trim()).filter(Boolean);
                      const atMax = currentGenres.length >= 3 && !selected;
                      return (
                        <button
                          key={genre}
                          type="button"
                          disabled={atMax}
                          onClick={() => {
                            if (selected) {
                              setEditForm({ ...editForm, genres: currentGenres.filter(g => g !== genre).join(', ') });
                            } else {
                              setEditForm({ ...editForm, genres: [...currentGenres, genre].join(', ') });
                            }
                          }}
                          className={`px-3 py-1.5 rounded-full text-xs font-medium border transition-colors ${
                            selected
                              ? 'bg-primary text-primary-foreground border-primary'
                              : atMax
                                ? 'bg-muted/30 text-muted-foreground border-border opacity-50 cursor-not-allowed'
                                : 'bg-muted/30 text-foreground border-border hover:border-primary/50'
                          }`}
                        >
                          {genre}
                        </button>
                      );
                    })}
                  </div>
                </div>

                <div className="grid grid-cols-2 gap-4">
                  <div>
                    <Label>WhatsApp</Label>
                    <Input
                      value={editForm.whatsapp}
                      onChange={(e) => setEditForm({ ...editForm, whatsapp: e.target.value })}
                      placeholder="+33 6 12 34 56 78"
                    />
                  </div>
                  <div>
                    <Label>Instagram</Label>
                    <Input
                      value={editForm.instagram}
                      onChange={(e) => setEditForm({ ...editForm, instagram: e.target.value })}
                      placeholder="https://instagram.com/..."
                    />
                  </div>
                </div>

                <div>
                  <Label>TikTok</Label>
                  <Input
                    value={editForm.tiktok}
                    onChange={(e) => setEditForm({ ...editForm, tiktok: e.target.value })}
                    placeholder="https://tiktok.com/@..."
                  />
                </div>

                <div className="grid grid-cols-2 gap-4">
                  <div>
                    <Label>SoundCloud</Label>
                    <Input
                      value={editForm.soundcloud}
                      onChange={(e) => setEditForm({ ...editForm, soundcloud: e.target.value })}
                      placeholder="https://soundcloud.com/..."
                    />
                  </div>
                  <div>
                    <Label>Spotify</Label>
                    <Input
                      value={editForm.spotify}
                      onChange={(e) => setEditForm({ ...editForm, spotify: e.target.value })}
                      placeholder="https://open.spotify.com/..."
                    />
                  </div>
                </div>

                <div>
                  <Label>YouTube</Label>
                  <Input
                    value={editForm.youtube}
                    onChange={(e) => setEditForm({ ...editForm, youtube: e.target.value })}
                    placeholder="https://youtube.com/@..."
                  />
                </div>

                <div className="grid grid-cols-2 gap-4">
                  <div>
                    <Label>{t('dj.city')}</Label>
                    <Input
                      value={editForm.city}
                      onChange={(e) => setEditForm({ ...editForm, city: e.target.value })}
                      placeholder="Paris"
                    />
                  </div>
                  <div>
                    <Label>{t('dj.country')}</Label>
                    <Input
                      value={editForm.country}
                      onChange={(e) => setEditForm({ ...editForm, country: e.target.value })}
                      placeholder="France"
                    />
                  </div>
                </div>

                <div>
                  <Label>{t('dj.publicDescription')}</Label>
                  <Textarea
                    value={editForm.description}
                    onChange={(e) => setEditForm({ ...editForm, description: e.target.value.slice(0, 1000) })}
                    rows={4}
                    maxLength={1000}
                    placeholder={t('dj.publicDescPlaceholder')}
                  />
                  <p className="text-xs text-muted-foreground mt-1">{editForm.description.length}/1000</p>
                </div>

                <div>
                  <Label>{t('dj.bioInternal')}</Label>
                  <Textarea
                    value={editForm.bio}
                    onChange={(e) => setEditForm({ ...editForm, bio: e.target.value })}
                    rows={4}
                    placeholder={t('dj.bioPlaceholder')}
                  />
                </div>

                <Button onClick={handleSave} disabled={saving} className="w-full">
                  {saving ? (
                    <span className="flex items-center gap-2">
                      <div className="h-4 w-4 animate-spin rounded-full border-2 border-current border-t-transparent" />
                      {t('dj.saving')}
                    </span>
                  ) : (
                    <span className="flex items-center gap-2">
                      <Save className="h-4 w-4" />
                      {labels.save}
                    </span>
                  )}
                </Button>
              </div>
            </div>
            )}
          </TabsContent>
        </Tabs>
      </div>
    </div>
  );
}
