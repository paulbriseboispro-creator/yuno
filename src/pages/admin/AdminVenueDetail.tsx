import { useState, useEffect } from 'react';
import { useParams, useNavigate, Link } from 'react-router-dom';
import { supabase } from '@/integrations/supabase/client';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { ArrowLeft, Building2, CheckCircle, XCircle, AlertTriangle, Users, Calendar, ExternalLink, CreditCard, Wine, Ticket, Armchair } from 'lucide-react';
import { format } from 'date-fns';

export default function AdminVenueDetail() {
  const { venueId } = useParams<{ venueId: string }>();
  const navigate = useNavigate();
  const [venue, setVenue] = useState<any>(null);
  const [owner, setOwner] = useState<any>(null);
  const [staff, setStaff] = useState<any[]>([]);
  const [events, setEvents] = useState<any[]>([]);
  const [stats, setStats] = useState({ orders: 0, orderRevenue: 0, tickets: 0, ticketRevenue: 0, tables: 0, tableRevenue: 0 });
  const [subscription, setSubscription] = useState<any>(null);
  const [onboarding, setOnboarding] = useState<any>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (venueId) loadVenue();
  }, [venueId]);

  const loadVenue = async () => {
    setLoading(true);
    const [venueRes, eventsRes, onbRes, subRes] = await Promise.all([
      supabase.from('venues').select('*').eq('id', venueId!).single(),
      supabase.from('events').select('id, title, start_at, end_at, is_active, ticketing_enabled, tables_enabled').eq('venue_id', venueId!).order('start_at', { ascending: false }).limit(20),
      supabase.from('venue_onboarding').select('*').eq('venue_id', venueId!).maybeSingle(),
      supabase.from('venue_subscriptions').select('*').eq('venue_id', venueId!).order('created_at', { ascending: false }).limit(1).maybeSingle(),
    ]);

    setVenue(venueRes.data);
    setEvents(eventsRes.data || []);
    setOnboarding(onbRes.data);
    setSubscription(subRes.data);

    if (venueRes.data?.owner_id) {
      const { data: ownerProfile } = await supabase.from('profiles').select('id, email, first_name, last_name').eq('id', venueRes.data.owner_id).single();
      setOwner(ownerProfile);
    }

    // Staff
    const { data: staffProfiles } = await supabase.from('profiles').select('id, email, first_name, last_name').eq('venue_id', venueId!);
    if (staffProfiles && staffProfiles.length > 0) {
      const staffIds = staffProfiles.map(s => s.id);
      const { data: staffRoles } = await supabase.from('user_roles').select('user_id, role').in('user_id', staffIds).in('role', ['barman', 'bouncer', 'vip_host', 'cloakroom', 'manager'] as any);
      const roleMap: Record<string, string[]> = {};
      (staffRoles || []).forEach(r => {
        if (!roleMap[r.user_id]) roleMap[r.user_id] = [];
        roleMap[r.user_id].push(r.role as string);
      });
      setStaff(staffProfiles.filter(s => roleMap[s.id]?.length > 0).map(s => ({ ...s, roles: roleMap[s.id] || [] })));
    }

    // Revenue stats
    const [ordersRes, ticketsRes, tablesRes] = await Promise.all([
      supabase.from('orders').select('id, total', { count: 'exact' }).eq('venue_id', venueId!).eq('status', 'paid'),
      supabase.from('tickets').select('id, total_price', { count: 'exact' }).eq('status', 'paid').in('event_id', (eventsRes.data || []).map(e => e.id)),
      supabase.from('table_reservations').select('id, total_price', { count: 'exact' }).eq('status', 'confirmed').in('zone_id', []),
    ]);
    // Calculate table stats via zones
    const { data: zones } = await supabase.from('table_zones').select('id').eq('venue_id', venueId!);
    let tableCount = 0, tableRev = 0;
    if (zones && zones.length > 0) {
      const { data: tableData, count } = await supabase.from('table_reservations').select('id, total_price', { count: 'exact' }).eq('status', 'confirmed').in('zone_id', zones.map(z => z.id));
      tableCount = count ?? 0;
      tableRev = (tableData || []).reduce((s, t) => s + (t.total_price || 0), 0);
    }

    setStats({
      orders: ordersRes.count ?? 0,
      orderRevenue: (ordersRes.data || []).reduce((s, o) => s + (o.total || 0), 0),
      tickets: ticketsRes.count ?? 0,
      ticketRevenue: (ticketsRes.data || []).reduce((s, t) => s + (t.total_price || 0), 0),
      tables: tableCount,
      tableRevenue: tableRev,
    });

    setLoading(false);
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center min-h-[50vh]">
        <div className="h-10 w-10 animate-spin rounded-full border-4 border-primary border-t-transparent" />
      </div>
    );
  }

  if (!venue) {
    return (
      <div className="p-6">
        <Button variant="ghost" onClick={() => navigate(-1)}><ArrowLeft className="h-4 w-4 mr-2" />Retour</Button>
        <p className="text-muted-foreground mt-4">Établissement introuvable.</p>
      </div>
    );
  }

  const stripeStatus = venue.stripe_charges_enabled
    ? { label: 'Connecté', variant: 'success' as const, icon: CheckCircle }
    : venue.stripe_account_id
      ? { label: 'En attente', variant: 'warning' as const, icon: AlertTriangle }
      : { label: 'Non configuré', variant: 'destructive' as const, icon: XCircle };

  const onboardingPct = onboarding?.completed_at ? 100 : (() => {
    const steps = onboarding?.steps as Record<string, boolean> | null;
    if (!steps) return Math.round(((onboarding?.current_step || 0) / 8) * 100);
    const total = Object.keys(steps).length;
    const done = Object.values(steps).filter(Boolean).length;
    return total > 0 ? Math.round((done / total) * 100) : 0;
  })();

  return (
    <div className="p-4 md:p-6 space-y-6 max-w-5xl">
      <div className="flex items-center gap-3">
        <Button variant="ghost" size="icon" onClick={() => navigate(-1)}><ArrowLeft className="h-5 w-5" /></Button>
        <Building2 className="h-6 w-6 text-primary" />
        <h1 className="text-2xl font-bold text-foreground">{venue.name}</h1>
        <a href={`/club/${venue.id}`} target="_blank" rel="noopener noreferrer">
          <Badge variant="outline" className="gap-1 cursor-pointer"><ExternalLink className="h-3 w-3" />Voir page</Badge>
        </a>
      </div>

      {/* Info + Stripe + Owner */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        <Card>
          <CardHeader className="pb-2"><CardTitle className="text-sm text-muted-foreground">Informations</CardTitle></CardHeader>
          <CardContent className="space-y-1 text-sm">
            <p><span className="text-muted-foreground">Ville :</span> {venue.city || '—'}</p>
            <p><span className="text-muted-foreground">Adresse :</span> {venue.address || '—'}</p>
            <p><span className="text-muted-foreground">Créé le :</span> {format(new Date(venue.created_at), 'dd/MM/yyyy')}</p>
            <div className="flex items-center gap-2 pt-1">
              <span className="text-muted-foreground">Onboarding :</span>
              <div className="h-2 w-16 bg-muted rounded-full overflow-hidden">
                <div className="h-full bg-primary rounded-full" style={{ width: `${onboardingPct}%` }} />
              </div>
              <span className="text-xs">{onboardingPct}%</span>
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="pb-2"><CardTitle className="text-sm text-muted-foreground flex items-center gap-1"><CreditCard className="h-4 w-4" /> Stripe</CardTitle></CardHeader>
          <CardContent className="space-y-2 text-sm">
            <Badge variant={stripeStatus.variant} className="gap-1">
              <stripeStatus.icon className="h-3 w-3" />{stripeStatus.label}
            </Badge>
            {subscription && (
              <div className="pt-2 space-y-1">
                <p><span className="text-muted-foreground">Abonnement :</span> <Badge variant="outline">{subscription.status}</Badge></p>
                {subscription.trial_end && (
                  <p className="text-xs text-muted-foreground">Fin essai : {format(new Date(subscription.trial_end), 'dd/MM/yyyy')}</p>
                )}
              </div>
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="pb-2"><CardTitle className="text-sm text-muted-foreground">Owner</CardTitle></CardHeader>
          <CardContent className="text-sm">
            {owner ? (
              <div className="space-y-1">
                <p className="font-medium">{`${owner.first_name || ''} ${owner.last_name || ''}`.trim() || 'Sans nom'}</p>
                <p className="text-muted-foreground">{owner.email}</p>
                <Link to={`/admin/directory/user/${owner.id}`} className="text-primary text-xs hover:underline">Voir profil →</Link>
              </div>
            ) : (
              <p className="text-muted-foreground">Aucun owner assigné</p>
            )}
          </CardContent>
        </Card>
      </div>

      {/* Revenue stats */}
      <div className="grid grid-cols-3 gap-4">
        <Card>
          <CardContent className="p-4 text-center">
            <Wine className="h-5 w-5 mx-auto text-muted-foreground mb-1" />
            <p className="text-2xl font-bold text-foreground">{stats.orders}</p>
            <p className="text-xs text-muted-foreground">Commandes · {stats.orderRevenue.toFixed(0)} €</p>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="p-4 text-center">
            <Ticket className="h-5 w-5 mx-auto text-muted-foreground mb-1" />
            <p className="text-2xl font-bold text-foreground">{stats.tickets}</p>
            <p className="text-xs text-muted-foreground">Billets · {stats.ticketRevenue.toFixed(0)} €</p>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="p-4 text-center">
            <Armchair className="h-5 w-5 mx-auto text-muted-foreground mb-1" />
            <p className="text-2xl font-bold text-foreground">{stats.tables}</p>
            <p className="text-xs text-muted-foreground">Tables · {stats.tableRevenue.toFixed(0)} €</p>
          </CardContent>
        </Card>
      </div>

      {/* Staff */}
      {staff.length > 0 && (
        <Card>
          <CardHeader><CardTitle className="text-lg flex items-center gap-2"><Users className="h-5 w-5" /> Staff ({staff.length})</CardTitle></CardHeader>
          <CardContent>
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Nom</TableHead>
                  <TableHead>Email</TableHead>
                  <TableHead>Rôles</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {staff.map(s => (
                  <TableRow key={s.id}>
                    <TableCell>
                      <Link to={`/admin/directory/user/${s.id}`} className="font-medium text-primary hover:underline">
                        {`${s.first_name || ''} ${s.last_name || ''}`.trim() || s.email}
                      </Link>
                    </TableCell>
                    <TableCell className="text-sm text-muted-foreground">{s.email}</TableCell>
                    <TableCell className="flex gap-1 flex-wrap">{s.roles.map((r: string) => <Badge key={r} variant="outline" className="text-xs">{r}</Badge>)}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </CardContent>
        </Card>
      )}

      {/* Events */}
      {events.length > 0 && (
        <Card>
          <CardHeader><CardTitle className="text-lg flex items-center gap-2"><Calendar className="h-5 w-5" /> Événements récents</CardTitle></CardHeader>
          <CardContent>
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Titre</TableHead>
                  <TableHead>Date</TableHead>
                  <TableHead>Actif</TableHead>
                  <TableHead>Billetterie</TableHead>
                  <TableHead>Tables</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {events.map(e => (
                  <TableRow key={e.id}>
                    <TableCell className="font-medium">{e.title}</TableCell>
                    <TableCell className="text-sm text-muted-foreground">{format(new Date(e.start_at), 'dd/MM/yyyy HH:mm')}</TableCell>
                    <TableCell>{e.is_active ? <Badge variant="outline" className="text-primary">Oui</Badge> : <Badge variant="outline">Non</Badge>}</TableCell>
                    <TableCell>{e.ticketing_enabled ? '✓' : '—'}</TableCell>
                    <TableCell>{e.tables_enabled ? '✓' : '—'}</TableCell>
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
