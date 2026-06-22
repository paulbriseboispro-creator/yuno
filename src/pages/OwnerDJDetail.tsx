import { useState, useEffect, useMemo } from 'react';
import { OwnerPageSkeleton } from '@/components/DashboardSkeleton';
import { useParams, useNavigate } from 'react-router-dom';
import { format } from 'date-fns';
import { fr, enUS, es } from 'date-fns/locale';
import { Music, Phone, Save, Plus, Calendar, Euro, TrendingUp, Clock, Trash2, Check, ShieldCheck, FileSignature, CreditCard, Loader2, Ban } from 'lucide-react';
import { Instagram } from '@/components/icons/Instagram';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Badge } from '@/components/ui/badge';
import { Textarea } from '@/components/ui/textarea';
import { Switch } from '@/components/ui/switch';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from '@/components/ui/dialog';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { OwnerHeader } from '@/components/OwnerHeader';
import { DJCalendar } from '@/components/dj/DJCalendar';
import { useVenueContext } from '@/hooks/useVenueContext';
import { useLanguage } from '@/contexts/LanguageContext';
import { useDashboardMode } from '@/contexts/DashboardModeContext';
import { supabase } from '@/integrations/supabase/client';
import { toast } from 'sonner';

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
  fee_paid_at?: string;
  event?: { title: string };
}

interface DJPayment {
  id: string;
  dj_id: string;
  dj_set_id?: string;
  amount: number;
  description?: string;
  paid_at: string;
}

interface DJBookingContract {
  id: string;
  dj_set_id: string;
  dj_id: string;
  dj_user_id: string;
  status: 'draft' | 'pending_dj_setup' | 'pending_signatures' | 'pending_payment'
        | 'funds_held' | 'released' | 'cancelled' | 'refunded';
  cachet_cents: number;
  acompte_cents: number;
  stripe_fee_cents: number;
  cancellation_policy: 'acompte_to_dj' | 'full_refund';
  club_signed_at: string | null;
  dj_signed_at: string | null;
  acompte_released_at: string | null;
  released_at: string | null;
  dj_set?: { start_time: string; event?: { title: string } | null } | null;
}

interface Event {
  id: string;
  title: string;
  start_at: string;
}

export default function OwnerDJDetail() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const { venueId } = useVenueContext();
  const { t, language } = useLanguage();
  const { basePath } = useDashboardMode();
  const dateLocale = language === 'fr' ? fr : language === 'es' ? es : enUS;

  const [dj, setDJ] = useState<DJ | null>(null);
  const [sets, setSets] = useState<DJSet[]>([]);
  const [payments, setPayments] = useState<DJPayment[]>([]);
  const [events, setEvents] = useState<Event[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);

  const [editForm, setEditForm] = useState({
    firstName: '',
    lastName: '',
    stageName: '',
    whatsapp: '',
    instagram: '',
    tiktok: '',
    genres: '',
    bio: '',
    isActive: true,
  });

  const [showSetDialog, setShowSetDialog] = useState(false);
  const [newSet, setNewSet] = useState({
    eventId: '',
    startTime: '',
    endTime: '',
    genre: '',
    fee: 0,
    notes: '',
    secured: false,
    acompte: 0,
    cancellationPolicy: 'acompte_to_dj' as 'acompte_to_dj' | 'full_refund',
  });

  // Secured-payment contracts for this DJ. The table isn't in the generated Supabase
  // types until the migration is pushed, so we use a bound-this cast (same pattern as
  // DJDataContext) for both reads and the new RPCs.
  const [contracts, setContracts] = useState<DJBookingContract[]>([]);
  const [actingId, setActingId] = useState<string | null>(null);

  // Inline trilingual helper for the new secured-booking strings — keeps them out of
  // the 1.5MB i18n/data.ts (same rationale as the DJ app's makeDjT convention).
  const st = (frTxt: string, en: string, esTxt: string) =>
    language === 'fr' ? frTxt : language === 'es' ? esTxt : en;

  useEffect(() => {
    if (id && venueId) {
      fetchDJ();
      fetchSets();
      fetchPayments();
      fetchEvents();
      fetchContracts();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id, venueId]);

  // Returning from the Stripe checkout for a secured cachet.
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const booking = params.get('booking');
    if (booking === 'paid') {
      toast.success(st('Cachet sécurisé chez Yuno. Il sera versé au DJ après la prestation.', 'Fee secured at Yuno. It will be paid to the DJ after the gig.', 'Caché asegurado en Yuno. Se pagará al DJ tras la actuación.'));
      fetchContracts();
      window.history.replaceState({}, '', window.location.pathname);
    } else if (booking === 'cancelled') {
      toast.info(st('Paiement annulé', 'Payment cancelled', 'Pago cancelado'));
      window.history.replaceState({}, '', window.location.pathname);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const fetchDJ = async () => {
    try {
      const { data, error } = await supabase
        .from('djs')
        .select('*')
        .eq('id', id)
        .single();

      if (error) throw error;
      setDJ(data);
      setEditForm({
        firstName: data.first_name,
        lastName: data.last_name,
        stageName: data.stage_name || '',
        whatsapp: data.whatsapp_number || '',
        instagram: data.instagram_url || '',
        tiktok: data.tiktok_url || '',
        genres: data.music_genres.join(', '),
        bio: data.bio || '',
        isActive: data.is_active,
      });
    } catch (error) {
      console.error('Error fetching DJ:', error);
      toast.error(t('ownerDj.loadError'));
    } finally {
      setLoading(false);
    }
  };

  const fetchSets = async () => {
    try {
      const { data, error } = await supabase
        .from('dj_sets')
        .select('*, event:events(title)')
        .eq('dj_id', id)
        .order('start_time', { ascending: true });

      if (error) throw error;
      setSets(data || []);
    } catch (error) {
      console.error('Error fetching sets:', error);
    }
  };

  const fetchPayments = async () => {
    try {
      const { data, error } = await supabase
        .from('dj_payments')
        .select('*')
        .eq('dj_id', id)
        .order('paid_at', { ascending: false });

      if (error) throw error;
      setPayments(data || []);
    } catch (error) {
      console.error('Error fetching payments:', error);
    }
  };

  const fetchEvents = async () => {
    if (!venueId) return;
    try {
      const { data, error } = await supabase
        .from('events')
        .select('id, title, start_at')
        .eq('venue_id', venueId)
        .gte('start_at', new Date().toISOString())
        .order('start_at', { ascending: true });

      if (error) throw error;
      setEvents(data || []);
    } catch (error) {
      console.error('Error fetching events:', error);
    }
  };

  const handleSave = async () => {
    if (!dj) return;
    setSaving(true);

    try {
      const { error } = await supabase
        .from('djs')
        .update({
          first_name: editForm.firstName,
          last_name: editForm.lastName,
          stage_name: editForm.stageName || null,
          whatsapp_number: editForm.whatsapp || null,
          instagram_url: editForm.instagram || null,
          tiktok_url: editForm.tiktok || null,
          music_genres: editForm.genres.split(',').map(g => g.trim()).filter(Boolean),
          bio: editForm.bio || null,
          is_active: editForm.isActive,
        })
        .eq('id', dj.id);

      if (error) throw error;
      toast.success(t('ownerDj.profileUpdated'));
      fetchDJ();
    } catch (error) {
      console.error('Error saving:', error);
      toast.error(t('ownerDj.saveError'));
    } finally {
      setSaving(false);
    }
  };

  const handleCreateSet = async () => {
    if (!dj || !venueId || !newSet.startTime || !newSet.endTime || !newSet.eventId) {
      toast.error(t('ownerDj.selectEventFillTimes'));
      return;
    }
    if (newSet.secured && (!newSet.fee || newSet.fee <= 0)) {
      toast.error(st('Renseigne un cachet pour sécuriser le paiement.', 'Enter a fee to secure the payment.', 'Indica un caché para asegurar el pago.'));
      return;
    }

    try {
      const { data: created, error } = await supabase.from('dj_sets').insert({
        dj_id: dj.id,
        venue_id: venueId,
        event_id: newSet.eventId,
        start_time: newSet.startTime,
        end_time: newSet.endTime,
        music_genre: newSet.genre || null,
        fee: newSet.fee || 0,
        notes: newSet.notes || null,
      }).select('id').single();

      if (error) throw error;

      await supabase.from('djs').update({
        pending_amount: dj.pending_amount + newSet.fee,
      }).eq('id', dj.id);

      // Optional secured-payment contract (escrow + digital contract via Yuno).
      if (newSet.secured && created?.id) {
        const rpcAny = supabase.rpc.bind(supabase) as unknown as (
          fn: string, args?: Record<string, unknown>,
        ) => Promise<{ data: unknown; error: { message: string } | null }>;
        const { error: cErr } = await rpcAny('create_dj_booking_contract', {
          p_dj_set_id: created.id,
          p_cachet_cents: Math.round(newSet.fee * 100),
          p_acompte_cents: Math.round((newSet.acompte || 0) * 100),
          p_cancellation_policy: newSet.cancellationPolicy,
        });
        if (cErr) {
          toast.error(st('Set créé, mais le contrat sécurisé a échoué : ', 'Set created, but the secured contract failed: ', 'Set creado, pero el contrato falló: ') + cErr.message);
        } else {
          toast.success(st('Set créé + contrat sécurisé envoyé', 'Set created + secured contract sent', 'Set creado + contrato enviado'));
        }
      } else {
        toast.success(t('ownerDj.setCreated'));
      }

      setShowSetDialog(false);
      setNewSet({ eventId: '', startTime: '', endTime: '', genre: '', fee: 0, notes: '', secured: false, acompte: 0, cancellationPolicy: 'acompte_to_dj' });
      fetchSets();
      fetchDJ();
      fetchContracts();
    } catch (error) {
      console.error('Error creating set:', error);
      toast.error(t('ownerDj.createError'));
    }
  };

  const fetchContracts = async () => {
    try {
      const fromAny = supabase.from.bind(supabase) as unknown as (table: string) => {
        select: (cols: string) => {
          eq: (col: string, val: string) => {
            order: (col: string, opts: { ascending: boolean }) => Promise<{ data: unknown; error: unknown }>;
          };
        };
      };
      const { data, error } = await fromAny('dj_booking_contracts')
        .select('*, dj_set:dj_sets(start_time, event:events(title))')
        .eq('dj_id', id!)
        .order('created_at', { ascending: false });
      if (error) throw error;
      setContracts((data as DJBookingContract[]) || []);
    } catch (error) {
      console.error('Error fetching contracts:', error);
    }
  };

  const rpcContract = (fn: string, args: Record<string, unknown>) => {
    const rpcAny = supabase.rpc.bind(supabase) as unknown as (
      f: string, a?: Record<string, unknown>,
    ) => Promise<{ data: unknown; error: { message: string } | null }>;
    return rpcAny(fn, args);
  };

  const handleSignContract = async (c: DJBookingContract) => {
    setActingId(c.id);
    try {
      const { error } = await rpcContract('sign_dj_booking_contract', {
        p_contract_id: c.id, p_ip: null, p_user_agent: navigator.userAgent.slice(0, 300),
      });
      if (error) throw new Error(error.message);
      toast.success(st('Contrat signé', 'Contract signed', 'Contrato firmado'));
      fetchContracts();
    } catch (e) {
      toast.error(st('Erreur de signature', 'Signing error', 'Error de firma') + (e instanceof Error ? ` : ${e.message}` : ''));
    } finally { setActingId(null); }
  };

  const handlePayContract = async (c: DJBookingContract) => {
    setActingId(c.id);
    try {
      const { data, error } = await supabase.functions.invoke('stripe-connect', {
        body: {
          action: 'dj_booking_checkout',
          contractId: c.id,
          successUrl: `${window.location.origin}${basePath}/djs/${id}?booking=paid`,
          cancelUrl: `${window.location.origin}${basePath}/djs/${id}?booking=cancelled`,
        },
      });
      if (error) throw error;
      if (data?.url) window.location.href = data.url;
      else throw new Error(data?.error || 'no url');
    } catch (e) {
      toast.error(st('Impossible de lancer le paiement', 'Could not start payment', 'No se pudo iniciar el pago'));
      setActingId(null);
    }
  };

  const handleReleaseContract = async (c: DJBookingContract) => {
    setActingId(c.id);
    try {
      const { data, error } = await supabase.functions.invoke('stripe-connect', {
        body: { action: 'dj_booking_release', contractId: c.id },
      });
      if (error) throw error;
      if (data?.success) toast.success(st('Cachet versé au DJ', 'Fee released to the DJ', 'Caché pagado al DJ'));
      else toast.error(st('Libération impossible', 'Release failed', 'Liberación fallida') + (data?.reason ? ` (${data.reason})` : ''));
      fetchContracts();
    } catch (e) {
      toast.error(st('Erreur lors de la libération', 'Release error', 'Error al liberar'));
    } finally { setActingId(null); }
  };

  const handleCancelContract = async (c: DJBookingContract) => {
    setActingId(c.id);
    try {
      if (c.status === 'funds_held') {
        // Post-funding cancel → refund the held balance to the club via Stripe.
        const { data, error } = await supabase.functions.invoke('stripe-connect', {
          body: { action: 'dj_booking_cancel', contractId: c.id },
        });
        if (error) throw error;
        if (data?.success) toast.success(st('Remboursé au club', 'Refunded to the club', 'Reembolsado al club'));
        else toast.error(st('Remboursement impossible', 'Refund failed', 'Reembolso fallido'));
      } else {
        const { error } = await rpcContract('cancel_dj_booking_contract', { p_contract_id: c.id });
        if (error) throw new Error(error.message);
        toast.success(st('Contrat annulé', 'Contract cancelled', 'Contrato cancelado'));
      }
      fetchContracts();
    } catch (e) {
      toast.error(st('Erreur lors de l\'annulation', 'Cancellation error', 'Error al cancelar'));
    } finally { setActingId(null); }
  };

  const handleMarkSetAsPaid = async (set: DJSet) => {
    if (!dj) return;

    try {
      await supabase.from('dj_sets').update({
        fee_paid: true,
        fee_paid_at: new Date().toISOString(),
      }).eq('id', set.id);

      await supabase.from('dj_payments').insert({
        dj_id: dj.id,
        dj_set_id: set.id,
        amount: set.fee,
        description: set.event?.title || `Set ${format(new Date(set.start_time), 'dd/MM/yyyy')}`,
      });

      await supabase.from('djs').update({
        pending_amount: Math.max(0, dj.pending_amount - set.fee),
        total_paid: dj.total_paid + set.fee,
      }).eq('id', dj.id);

      toast.success(t('ownerDj.paymentRecorded'));
      fetchSets();
      fetchPayments();
      fetchDJ();
    } catch (error) {
      console.error('Error marking as paid:', error);
      toast.error(t('ownerDj.error'));
    }
  };

  const handleDeleteSet = async (setId: string) => {
    const setToDelete = sets.find(s => s.id === setId);
    if (!setToDelete || !dj) return;

    try {
      await supabase.from('dj_sets').delete().eq('id', setId);
      
      if (!setToDelete.fee_paid) {
        await supabase.from('djs').update({
          pending_amount: Math.max(0, dj.pending_amount - setToDelete.fee),
        }).eq('id', dj.id);
      }

      toast.success(t('ownerDj.setDeleted'));
      fetchSets();
      fetchDJ();
    } catch (error) {
      console.error('Error deleting set:', error);
      toast.error(t('ownerDj.error'));
    }
  };

  const upcomingSets = sets.filter(s => new Date(s.start_time) >= new Date());
  const pendingSets = sets.filter(s => !s.fee_paid && s.fee > 0);
  
  const calculatedPendingAmount = useMemo(() => {
    return sets.filter(s => !s.fee_paid && s.fee > 0).reduce((sum, s) => sum + s.fee, 0);
  }, [sets]);
  
  const calculatedTotalPaid = useMemo(() => {
    return payments.reduce((sum, p) => sum + p.amount, 0);
  }, [payments]);

  if (loading) return <OwnerPageSkeleton />;

  if (!dj) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-background">
        <p className="text-muted-foreground">DJ not found</p>
      </div>
    );
  }

  return (
    <div className="min-h-screen dashboard-gradient-bg pb-24">
      <OwnerHeader 
        title={dj.stage_name || `${dj.first_name} ${dj.last_name}`} 
        backTo={`${basePath}/djs`}
      />

      <div className="mx-auto max-w-4xl p-4">
        {/* Summary cards */}
        <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mb-6">
          <Card className="p-4">
            <div className="flex items-center gap-2 text-muted-foreground mb-1">
              <Calendar className="h-4 w-4" />
              <span className="text-xs">{t('ownerDj.upcomingSets')}</span>
            </div>
            <p className="text-2xl font-bold">{upcomingSets.length}</p>
          </Card>
          <Card className="p-4">
            <div className="flex items-center gap-2 text-muted-foreground mb-1">
              <Clock className="h-4 w-4" />
              <span className="text-xs">{t('ownerDj.pending')}</span>
            </div>
            <p className="text-2xl font-bold text-orange-500">{pendingSets.length}</p>
          </Card>
          <Card className="p-4">
            <div className="flex items-center gap-2 text-muted-foreground mb-1">
              <Euro className="h-4 w-4" />
              <span className="text-xs">{t('ownerDj.pending')}</span>
            </div>
            <p className="text-2xl font-bold text-orange-500">{calculatedPendingAmount} €</p>
          </Card>
          <Card className="p-4">
            <div className="flex items-center gap-2 text-muted-foreground mb-1">
              <TrendingUp className="h-4 w-4" />
              <span className="text-xs">{t('ownerDj.totalPaid')}</span>
            </div>
            <p className="text-2xl font-bold text-green-500">{calculatedTotalPaid} €</p>
          </Card>
        </div>

        <Tabs defaultValue="profile">
          <TabsList className="mb-4 owner-tabs">
            <TabsTrigger value="profile">{t('ownerDj.profile')}</TabsTrigger>
            <TabsTrigger value="planning">{t('ownerDj.planning')}</TabsTrigger>
            <TabsTrigger value="payments">{t('ownerDj.payments')}</TabsTrigger>
          </TabsList>

          <TabsContent value="profile">
            <Card className="p-6">
              <div className="flex items-start gap-4 mb-6">
                {dj.profile_image_url ? (
                  <img src={dj.profile_image_url} alt="" className="w-20 h-20 rounded-full object-cover" />
                ) : (
                  <div className="w-20 h-20 rounded-full bg-primary/20 flex items-center justify-center">
                    <Music className="h-10 w-10 text-primary" />
                  </div>
                )}
                <div className="flex-1">
                  <div className="flex items-center gap-2">
                    <h2 className="text-xl font-bold">{dj.stage_name || `${dj.first_name} ${dj.last_name}`}</h2>
                    <Badge variant={editForm.isActive ? "default" : "outline"}>
                      {editForm.isActive ? t('ownerDj.active') : t('ownerDj.inactive')}
                    </Badge>
                  </div>
                  <div className="flex items-center gap-3 mt-2">
                    {dj.instagram_url && (
                      <a href={dj.instagram_url} target="_blank" rel="noopener noreferrer" className="text-muted-foreground hover:text-primary">
                        <Instagram className="h-5 w-5" />
                      </a>
                    )}
                    {dj.whatsapp_number && (
                      <a href={`https://wa.me/${dj.whatsapp_number.replace(/\D/g, '')}`} target="_blank" rel="noopener noreferrer" className="text-muted-foreground hover:text-primary">
                        <Phone className="h-5 w-5" />
                      </a>
                    )}
                  </div>
                </div>
              </div>

              <div className="space-y-4">
                <div className="grid grid-cols-2 gap-4">
                  <div>
                    <Label>{t('ownerDj.firstName')}</Label>
                    <Input
                      value={editForm.firstName}
                      onChange={(e) => setEditForm({ ...editForm, firstName: e.target.value })}
                    />
                  </div>
                  <div>
                    <Label>{t('ownerDj.lastName')}</Label>
                    <Input
                      value={editForm.lastName}
                      onChange={(e) => setEditForm({ ...editForm, lastName: e.target.value })}
                    />
                  </div>
                </div>

                <div>
                  <Label>{t('ownerDj.stageName')}</Label>
                  <Input
                    value={editForm.stageName}
                    onChange={(e) => setEditForm({ ...editForm, stageName: e.target.value })}
                  />
                </div>

                <div className="grid grid-cols-2 gap-4">
                  <div>
                    <Label>WhatsApp</Label>
                    <Input
                      value={editForm.whatsapp}
                      onChange={(e) => setEditForm({ ...editForm, whatsapp: e.target.value })}
                    />
                  </div>
                  <div>
                    <Label>Instagram</Label>
                    <Input
                      value={editForm.instagram}
                      onChange={(e) => setEditForm({ ...editForm, instagram: e.target.value })}
                    />
                  </div>
                </div>

                <div>
                  <Label>TikTok</Label>
                  <Input
                    value={editForm.tiktok}
                    onChange={(e) => setEditForm({ ...editForm, tiktok: e.target.value })}
                  />
                </div>

                <div>
                  <Label>{t('ownerDj.musicGenres')}</Label>
                  <Input
                    value={editForm.genres}
                    onChange={(e) => setEditForm({ ...editForm, genres: e.target.value })}
                    placeholder="House, Techno, EDM"
                  />
                </div>

                <div>
                  <Label>Bio</Label>
                  <Textarea
                    value={editForm.bio}
                    onChange={(e) => setEditForm({ ...editForm, bio: e.target.value })}
                    rows={3}
                  />
                </div>

                <div className="flex items-center justify-between">
                  <Label>{t('ownerDj.active')}</Label>
                  <Switch
                    checked={editForm.isActive}
                    onCheckedChange={(checked) => setEditForm({ ...editForm, isActive: checked })}
                  />
                </div>

                <Button onClick={handleSave} disabled={saving} className="w-full">
                  <Save className="h-4 w-4 mr-2" />
                  {t('ownerDj.save')}
                </Button>
              </div>
            </Card>
          </TabsContent>

          <TabsContent value="planning">
            <div className="space-y-4">
              {events.length > 0 ? (
                <div className="flex justify-end">
                  <Button onClick={() => setShowSetDialog(true)}>
                    <Plus className="h-4 w-4 mr-2" />
                    {t('ownerDj.addSet')}
                  </Button>
                </div>
              ) : (
                <div className="p-4 bg-muted rounded-lg text-center">
                  <p className="text-muted-foreground text-sm">
                    {t('ownerDj.noUpcomingEvents')}
                  </p>
                </div>
              )}

              <DJCalendar
                sets={sets.map(s => ({ ...s, dj: { first_name: dj.first_name, last_name: dj.last_name, stage_name: dj.stage_name } }))}
                showDJNames={false}
                onSetClick={() => {}}
              />

              {/* Upcoming sets list */}
              <Card className="p-4">
                <h3 className="font-semibold mb-4">{t('ownerDj.upcomingSets')}</h3>
                {upcomingSets.length === 0 ? (
                  <p className="text-muted-foreground text-sm">{t('ownerDj.noSets')}</p>
                ) : (
                  <div className="space-y-2">
                    {upcomingSets.map(set => (
                      <div key={set.id} className="flex items-center justify-between p-3 bg-muted/30 rounded-lg">
                        <div>
                          <p className="font-medium">{set.event?.title || format(new Date(set.start_time), 'EEEE d MMMM', { locale: dateLocale })}</p>
                          <p className="text-sm text-muted-foreground">
                            {format(new Date(set.start_time), 'HH:mm')} - {format(new Date(set.end_time), 'HH:mm')}
                            {set.music_genre && ` • ${set.music_genre}`}
                          </p>
                        </div>
                        <div className="flex items-center gap-2">
                          {set.fee > 0 && (
                            <Badge variant={set.fee_paid ? "default" : "secondary"}>
                              {set.fee} € {set.fee_paid ? `(${t('ownerDj.paid')})` : ''}
                            </Badge>
                          )}
                          {!set.fee_paid && set.fee > 0 && (
                            <Button size="sm" variant="outline" onClick={() => handleMarkSetAsPaid(set)}>
                              <Check className="h-4 w-4" />
                            </Button>
                          )}
                          <Button size="sm" variant="ghost" onClick={() => handleDeleteSet(set.id)}>
                            <Trash2 className="h-4 w-4 text-destructive" />
                          </Button>
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </Card>
            </div>
          </TabsContent>

          <TabsContent value="payments">
            {/* Secured contracts (option) */}
            {contracts.length > 0 && (
              <Card className="p-4 mb-4">
                <h3 className="font-semibold mb-1 flex items-center gap-2">
                  <ShieldCheck className="h-4 w-4 text-primary" />
                  {st('Contrats sécurisés', 'Secured contracts', 'Contratos seguros')}
                </h3>
                <p className="text-xs text-muted-foreground mb-4">
                  {st('Paiement séquestré par Yuno : versé au DJ après la prestation.', 'Payment held in escrow by Yuno: released to the DJ after the gig.', 'Pago en depósito por Yuno: liberado al DJ tras la actuación.')}
                </p>
                <div className="space-y-3">
                  {contracts.map((c) => {
                    const cachet = c.cachet_cents / 100;
                    const acompte = c.acompte_cents / 100;
                    const balance = (c.cachet_cents - c.acompte_cents) / 100;
                    const statusMeta: Record<DJBookingContract['status'], { label: string; cls: string }> = {
                      draft: { label: st('Brouillon', 'Draft', 'Borrador'), cls: 'bg-muted text-muted-foreground' },
                      pending_dj_setup: { label: st('Attente Stripe DJ', 'DJ Stripe pending', 'Stripe DJ pendiente'), cls: 'bg-orange-500/10 text-orange-500' },
                      pending_signatures: { label: st('À signer', 'To sign', 'Por firmar'), cls: 'bg-orange-500/10 text-orange-500' },
                      pending_payment: { label: st('À payer', 'To pay', 'Por pagar'), cls: 'bg-orange-500/10 text-orange-500' },
                      funds_held: { label: st('Sécurisé', 'Secured', 'Seguro'), cls: 'bg-emerald-500/10 text-emerald-500' },
                      released: { label: st('Versé', 'Released', 'Pagado'), cls: 'bg-emerald-500/10 text-emerald-500' },
                      cancelled: { label: st('Annulé', 'Cancelled', 'Cancelado'), cls: 'bg-muted text-muted-foreground' },
                      refunded: { label: st('Remboursé', 'Refunded', 'Reembolsado'), cls: 'bg-muted text-muted-foreground' },
                    };
                    const meta = statusMeta[c.status];
                    const busy = actingId === c.id;
                    const title = c.dj_set?.event?.title
                      || (c.dj_set?.start_time ? format(new Date(c.dj_set.start_time), 'dd/MM/yyyy') : st('Prestation', 'Gig', 'Actuación'));
                    return (
                      <div key={c.id} className="p-3 rounded-lg border bg-muted/20">
                        <div className="flex items-start justify-between gap-3">
                          <div className="min-w-0">
                            <p className="font-medium text-sm truncate">{title}</p>
                            <p className="text-xs text-muted-foreground mt-0.5">
                              {st('Cachet', 'Fee', 'Caché')} {cachet}€
                              {acompte > 0 && ` • ${st('Acompte', 'Deposit', 'Anticipo')} ${acompte}€${c.acompte_released_at ? ' ✓' : ''}`}
                              {` • ${st('Solde', 'Balance', 'Saldo')} ${balance}€${c.released_at ? ' ✓' : ''}`}
                            </p>
                          </div>
                          <Badge className={meta.cls} variant="secondary">{meta.label}</Badge>
                        </div>

                        <div className="flex flex-wrap items-center gap-2 mt-3">
                          {c.status === 'pending_dj_setup' && (
                            <span className="text-xs text-muted-foreground">{st('En attente que le DJ active ses paiements Stripe.', 'Waiting for the DJ to activate Stripe payouts.', 'Esperando a que el DJ active sus pagos Stripe.')}</span>
                          )}
                          {c.status === 'pending_signatures' && !c.club_signed_at && (
                            <Button size="sm" onClick={() => handleSignContract(c)} disabled={busy}>
                              {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <FileSignature className="h-4 w-4 mr-1.5" />}
                              {st('Signer le contrat', 'Sign the contract', 'Firmar el contrato')}
                            </Button>
                          )}
                          {c.status === 'pending_signatures' && c.club_signed_at && !c.dj_signed_at && (
                            <span className="text-xs text-muted-foreground">{st('En attente de la signature du DJ.', 'Waiting for the DJ to sign.', 'Esperando la firma del DJ.')}</span>
                          )}
                          {c.status === 'pending_payment' && (
                            <Button size="sm" onClick={() => handlePayContract(c)} disabled={busy}>
                              {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <CreditCard className="h-4 w-4 mr-1.5" />}
                              {st('Payer le cachet', 'Pay the fee', 'Pagar el caché')}
                            </Button>
                          )}
                          {c.status === 'funds_held' && (
                            <>
                              <Button size="sm" onClick={() => handleReleaseContract(c)} disabled={busy}>
                                {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <Check className="h-4 w-4 mr-1.5" />}
                                {st('Prestation effectuée', 'Gig completed', 'Actuación realizada')}
                              </Button>
                              <Button size="sm" variant="outline" onClick={() => handleCancelContract(c)} disabled={busy}>
                                <Ban className="h-4 w-4 mr-1.5" />{st('Annuler & rembourser', 'Cancel & refund', 'Cancelar y reembolsar')}
                              </Button>
                            </>
                          )}
                          {['draft', 'pending_dj_setup', 'pending_signatures', 'pending_payment'].includes(c.status) && (
                            <Button size="sm" variant="ghost" onClick={() => handleCancelContract(c)} disabled={busy} className="text-destructive">
                              {st('Annuler', 'Cancel', 'Cancelar')}
                            </Button>
                          )}
                        </div>
                      </div>
                    );
                  })}
                </div>
              </Card>
            )}

            <Card className="p-4">
              <h3 className="font-semibold mb-4">{t('ownerDj.payments')}</h3>

              {/* Pending sets to pay */}
              {pendingSets.length > 0 && (
                <div className="mb-6">
                  <h4 className="text-sm font-medium text-muted-foreground mb-2">{t('ownerDj.pending')}</h4>
                  <div className="space-y-2">
                    {pendingSets.map(set => (
                      <div key={set.id} className="flex items-center justify-between p-3 bg-orange-500/10 rounded-lg border border-orange-500/20">
                        <div>
                          <p className="font-medium">{set.event?.title || format(new Date(set.start_time), 'dd/MM/yyyy')}</p>
                          <p className="text-sm text-muted-foreground">
                            {format(new Date(set.start_time), 'HH:mm')} - {format(new Date(set.end_time), 'HH:mm')}
                          </p>
                        </div>
                        <div className="flex items-center gap-2">
                          <span className="font-bold text-orange-500">{set.fee} €</span>
                          <Button size="sm" onClick={() => handleMarkSetAsPaid(set)}>
                            {t('ownerDj.markAsPaid')}
                          </Button>
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              )}

              {/* Payment history */}
              <h4 className="text-sm font-medium text-muted-foreground mb-2">{t('ownerDj.history')}</h4>
              {payments.length === 0 ? (
                <p className="text-muted-foreground text-sm">{t('ownerDj.noPayments')}</p>
              ) : (
                <div className="space-y-2">
                  {payments.map(payment => (
                    <div key={payment.id} className="flex items-center justify-between p-3 bg-muted/30 rounded-lg">
                      <div>
                        <p className="font-medium">{payment.description || t('ownerDj.payment')}</p>
                        <p className="text-sm text-muted-foreground">
                          {format(new Date(payment.paid_at), 'dd MMMM yyyy', { locale: dateLocale })}
                        </p>
                      </div>
                      <span className="font-bold text-green-500">+{payment.amount} €</span>
                    </div>
                  ))}
                </div>
              )}
            </Card>
          </TabsContent>

        </Tabs>
      </div>

      {/* Add Set Dialog */}
      <Dialog open={showSetDialog} onOpenChange={setShowSetDialog}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{t('ownerDj.addSet')}</DialogTitle>
          </DialogHeader>
          <div className="space-y-4">
            <div>
              <Label>{t('ownerDj.event')} *</Label>
              <Select value={newSet.eventId} onValueChange={(v) => setNewSet({ ...newSet, eventId: v })}>
                <SelectTrigger>
                  <SelectValue placeholder={t('ownerDj.selectEvent')} />
                </SelectTrigger>
                <SelectContent>
                  {events.map(event => (
                    <SelectItem key={event.id} value={event.id}>
                      {event.title} - {format(new Date(event.start_at), 'dd/MM/yyyy')}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <p className="text-xs text-muted-foreground mt-1">
                {t('ownerDj.setsOnlyForEvents')}
              </p>
            </div>
            <div className="grid grid-cols-2 gap-4">
              <div>
                <Label>{t('ownerDj.start')} *</Label>
                <Input
                  type="datetime-local"
                  value={newSet.startTime}
                  onChange={(e) => setNewSet({ ...newSet, startTime: e.target.value })}
                />
              </div>
              <div>
                <Label>{t('ownerDj.end')} *</Label>
                <Input
                  type="datetime-local"
                  value={newSet.endTime}
                  onChange={(e) => setNewSet({ ...newSet, endTime: e.target.value })}
                />
              </div>
            </div>
            <div>
              <Label>{t('ownerDj.musicGenre')}</Label>
              <Input
                value={newSet.genre}
                onChange={(e) => setNewSet({ ...newSet, genre: e.target.value })}
                placeholder="House, Techno..."
              />
            </div>
            <div>
              <Label>{t('ownerDj.fee')}</Label>
              <Input
                type="number"
                value={newSet.fee}
                onChange={(e) => setNewSet({ ...newSet, fee: Number(e.target.value) })}
              />
            </div>

            {/* Optional: secure the cachet via Yuno (escrow + digital contract). */}
            <div className="rounded-lg border p-3 space-y-3">
              <div className="flex items-start justify-between gap-3">
                <div>
                  <Label className="flex items-center gap-2">
                    <ShieldCheck className="h-4 w-4 text-primary" />
                    {st('Sécuriser le paiement via Yuno', 'Secure the payment via Yuno', 'Asegurar el pago con Yuno')}
                  </Label>
                  <p className="text-xs text-muted-foreground mt-1">
                    {st('Le club paie le cachet, Yuno le garde, le DJ est payé après la prestation. Contrat numérique signé par les deux.',
                        'The club pays the fee, Yuno holds it, the DJ is paid after the gig. Digital contract signed by both.',
                        'El club paga, Yuno lo retiene y el DJ cobra tras la actuación. Contrato firmado por ambos.')}
                  </p>
                </div>
                <Switch checked={newSet.secured} onCheckedChange={(v) => setNewSet({ ...newSet, secured: v })} />
              </div>
              {newSet.secured && (
                <div className="space-y-3 pt-1">
                  <div>
                    <Label>{st('Acompte (optionnel, versé au DJ à la signature)', 'Deposit (optional, paid to the DJ on signature)', 'Anticipo (opcional, pagado a la firma)')}</Label>
                    <Input
                      type="number" min={0} max={newSet.fee} value={newSet.acompte}
                      onChange={(e) => setNewSet({ ...newSet, acompte: Math.max(0, Math.min(Number(e.target.value), newSet.fee)) })}
                    />
                  </div>
                  <div>
                    <Label>{st('En cas d\'annulation', 'On cancellation', 'En caso de cancelación')}</Label>
                    <Select value={newSet.cancellationPolicy} onValueChange={(v) => setNewSet({ ...newSet, cancellationPolicy: v as 'acompte_to_dj' | 'full_refund' })}>
                      <SelectTrigger><SelectValue /></SelectTrigger>
                      <SelectContent>
                        <SelectItem value="acompte_to_dj">{st('Le DJ garde l\'acompte', 'The DJ keeps the deposit', 'El DJ conserva el anticipo')}</SelectItem>
                        <SelectItem value="full_refund">{st('Remboursement intégral au club', 'Full refund to the club', 'Reembolso íntegro al club')}</SelectItem>
                      </SelectContent>
                    </Select>
                  </div>
                  <p className="text-xs text-muted-foreground">
                    {st('Le club paie le cachet + les frais Stripe (~1,5% + 0,25€). Le DJ touche 100% du cachet.',
                        'The club pays the fee + Stripe fees (~1.5% + €0.25). The DJ gets 100% of the fee.',
                        'El club paga el caché + comisiones Stripe. El DJ recibe el 100%.')}
                  </p>
                </div>
              )}
            </div>

            <div>
              <Label>Notes</Label>
              <Textarea
                value={newSet.notes}
                onChange={(e) => setNewSet({ ...newSet, notes: e.target.value })}
                rows={2}
              />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setShowSetDialog(false)}>
              {t('ownerDj.cancel')}
            </Button>
            <Button onClick={handleCreateSet} disabled={!newSet.eventId || !newSet.startTime || !newSet.endTime}>
              {t('ownerDj.create')}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
