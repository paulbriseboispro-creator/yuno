import { useState, useEffect } from 'react';
import { useParams, useNavigate, Link } from 'react-router-dom';
import { supabase } from '@/integrations/supabase/client';
import { orderRevenue as orderClub, ticketRevenue as ticketClub, tableRevenue as tableClub } from '@/utils/fees';
import { ArrowLeft, Building2, CheckCircle, XCircle, AlertTriangle, Users, Calendar, ExternalLink, CreditCard, Wine, Ticket, Armchair, type LucideIcon } from 'lucide-react';
import { format } from 'date-fns';
import { motion } from 'framer-motion';

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

const thStyle: React.CSSProperties = { color: T3, fontSize: 11, fontWeight: 500, textTransform: 'uppercase', letterSpacing: '0.06em' };

function RolePill({ label }: { label: string }) {
  return (
    <span
      className="inline-flex items-center px-2.5 py-1 rounded-full"
      style={{ background: C_FAINT, border: `1px solid ${BORDER}`, color: T1, fontSize: 11, fontWeight: 600 }}
    >
      {label}
    </span>
  );
}

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
      supabase.from('orders').select('id, total, service_fee', { count: 'exact' }).eq('venue_id', venueId!).eq('status', 'paid'),
      supabase.from('tickets').select('id, total_price, service_fee, insurance_fee', { count: 'exact' }).eq('status', 'paid').in('event_id', (eventsRes.data || []).map(e => e.id)),
      supabase.from('table_reservations').select('id, total_price, service_fee, management_fee', { count: 'exact' }).eq('status', 'confirmed').in('zone_id', []),
    ]);
    // Calculate table stats via zones. Club revenue excludes Yuno fees (.gross).
    const { data: zones } = await supabase.from('table_zones').select('id').eq('venue_id', venueId!);
    let tableCount = 0, tableRev = 0;
    if (zones && zones.length > 0) {
      const { data: tableData, count } = await supabase.from('table_reservations').select('id, total_price, service_fee, management_fee', { count: 'exact' }).eq('status', 'confirmed').in('zone_id', zones.map(z => z.id));
      tableCount = count ?? 0;
      tableRev = (tableData || []).reduce((s, t) => s + tableClub(t).gross, 0);
    }

    setStats({
      orders: ordersRes.count ?? 0,
      orderRevenue: (ordersRes.data || []).reduce((s, o) => s + orderClub(o).gross, 0),
      tickets: ticketsRes.count ?? 0,
      ticketRevenue: (ticketsRes.data || []).reduce((s, t) => s + ticketClub(t).gross, 0),
      tables: tableCount,
      tableRevenue: tableRev,
    });

    setLoading(false);
  };

  if (loading) {
    return (
      <div className="flex min-h-screen items-center justify-center" style={{ background: '#000' }}>
        <div className="h-10 w-10 animate-spin rounded-full border-2" style={{ borderColor: `${BORDER} ${BORDER} ${BORDER} ${RED}` }} />
      </div>
    );
  }

  if (!venue) {
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
          <p className="mt-4" style={{ color: T3, fontSize: 13 }}>Établissement introuvable.</p>
        </div>
      </div>
    );
  }

  const stripeStatus = venue.stripe_charges_enabled
    ? { label: 'Connecté', tone: 'pos' as const, icon: CheckCircle }
    : venue.stripe_account_id
      ? { label: 'En attente', tone: 'accent' as const, icon: AlertTriangle }
      : { label: 'Non configuré', tone: 'neg' as const, icon: XCircle };

  const stripePillStyle: React.CSSProperties =
    stripeStatus.tone === 'pos'
      ? { background: 'rgba(52,211,153,0.1)', border: '1px solid rgba(52,211,153,0.25)', color: POS }
      : stripeStatus.tone === 'accent'
        ? { background: 'rgba(232,25,44,0.1)', border: '1px solid rgba(232,25,44,0.3)', color: RED }
        : { background: 'rgba(255,92,99,0.1)', border: '1px solid rgba(255,92,99,0.3)', color: NEG };

  const onboardingPct = onboarding?.completed_at ? 100 : (() => {
    const steps = onboarding?.steps as Record<string, boolean> | null;
    if (!steps) return Math.round(((onboarding?.current_step || 0) / 8) * 100);
    const total = Object.keys(steps).length;
    const done = Object.values(steps).filter(Boolean).length;
    return total > 0 ? Math.round((done / total) * 100) : 0;
  })();

  const statTiles = [
    { icon: Wine, value: stats.orders, label: `Commandes · ${stats.orderRevenue.toFixed(0)} €` },
    { icon: Ticket, value: stats.tickets, label: `Billets · ${stats.ticketRevenue.toFixed(0)} €` },
    { icon: Armchair, value: stats.tables, label: `Tables · ${stats.tableRevenue.toFixed(0)} €` },
  ];

  return (
    <div className="min-h-screen" style={{ background: '#000' }}>
      <div className="mx-auto max-w-[1340px] px-4 sm:px-6 py-6 space-y-6">
        {/* Header */}
        <div className="flex items-center gap-3 flex-wrap">
          <button
            onClick={() => navigate(-1)}
            className="flex h-9 w-9 items-center justify-center rounded-lg flex-none cursor-pointer transition-colors"
            style={{ background: 'rgba(255,255,255,0.04)', border: `1px solid ${F_BORDER}`, color: T3 }}
          >
            <ArrowLeft className="h-4 w-4" />
          </button>
          <div className="flex h-9 w-9 items-center justify-center rounded-xl flex-none" style={{ background: 'rgba(232,25,44,0.1)', border: '1px solid rgba(232,25,44,0.2)' }}>
            <Building2 className="h-4 w-4" style={{ color: RED }} />
          </div>
          <h1 style={{ color: T1, fontSize: 'clamp(22px,3vw,28px)', fontWeight: 700, letterSpacing: '-0.025em', lineHeight: 1.1 }}>{venue.name}</h1>
          <a href={`/club/${venue.id}`} target="_blank" rel="noopener noreferrer"
            className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full cursor-pointer transition-colors"
            style={{ background: C_FAINT, border: `1px solid ${BORDER}`, color: T2, fontSize: 11.5, fontWeight: 500 }}
          >
            <ExternalLink className="h-3 w-3" />Voir page
          </a>
        </div>

        {/* Info + Stripe + Owner */}
        <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
          <div style={cardStyle}>
            <p style={{ color: T3, fontSize: 11, fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.07em', marginBottom: 12 }}>Informations</p>
            <div className="space-y-1.5" style={{ fontSize: 13, color: T1 }}>
              <p><span style={{ color: T3 }}>Ville :</span> {venue.city || '—'}</p>
              <p><span style={{ color: T3 }}>Adresse :</span> {venue.address || '—'}</p>
              <p><span style={{ color: T3 }}>Créé le :</span> {format(new Date(venue.created_at), 'dd/MM/yyyy')}</p>
              <div className="flex items-center gap-2 pt-1">
                <span style={{ color: T3 }}>Onboarding :</span>
                <div className="h-2 w-16 rounded-full overflow-hidden" style={{ background: 'rgba(255,255,255,0.06)' }}>
                  <div className="h-full rounded-full" style={{ width: `${onboardingPct}%`, background: RED }} />
                </div>
                <span className="tabular-nums" style={{ fontSize: 12, color: T1 }}>{onboardingPct}%</span>
              </div>
            </div>
          </div>

          <div style={cardStyle}>
            <p className="flex items-center gap-1.5" style={{ color: T3, fontSize: 11, fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.07em', marginBottom: 12 }}>
              <CreditCard className="h-3.5 w-3.5" /> Stripe
            </p>
            <div className="space-y-2" style={{ fontSize: 13 }}>
              <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full" style={{ ...stripePillStyle, fontSize: 12, fontWeight: 600 }}>
                <stripeStatus.icon className="h-3 w-3" />{stripeStatus.label}
              </span>
              {subscription && (
                <div className="pt-2 space-y-1.5">
                  <p className="flex items-center gap-2">
                    <span style={{ color: T3 }}>Abonnement :</span>
                    <span className="inline-flex items-center px-2 py-0.5 rounded-full" style={{ background: C_FAINT, border: `1px solid ${BORDER}`, color: T1, fontSize: 11, fontWeight: 600 }}>{subscription.status}</span>
                  </p>
                  {subscription.trial_end && (
                    <p style={{ fontSize: 12, color: T3 }}>Fin essai : {format(new Date(subscription.trial_end), 'dd/MM/yyyy')}</p>
                  )}
                </div>
              )}
            </div>
          </div>

          <div style={cardStyle}>
            <p style={{ color: T3, fontSize: 11, fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.07em', marginBottom: 12 }}>Owner</p>
            <div style={{ fontSize: 13 }}>
              {owner ? (
                <div className="space-y-1">
                  <p style={{ color: T1, fontWeight: 600 }}>{`${owner.first_name || ''} ${owner.last_name || ''}`.trim() || 'Sans nom'}</p>
                  <p style={{ color: T2 }}>{owner.email}</p>
                  <Link to={`/admin/directory/user/${owner.id}`} style={{ color: RED, fontSize: 12, textDecoration: 'none' }}>Voir profil →</Link>
                </div>
              ) : (
                <p style={{ color: T3 }}>Aucun owner assigné</p>
              )}
            </div>
          </div>
        </div>

        {/* Revenue stats */}
        <div className="grid grid-cols-3 gap-4">
          {statTiles.map((tile, i) => (
            <div key={i} style={{ ...cardStyle, padding: '16px 18px' }} className="text-center">
              <div className="flex h-8 w-8 items-center justify-center rounded-lg mx-auto mb-2" style={{ background: C_FAINT, border: `1px solid ${BORDER}` }}>
                <tile.icon className="h-4 w-4" style={{ color: T2 }} />
              </div>
              <p className="tabular-nums" style={{ color: T1, fontSize: 26, fontWeight: 640, letterSpacing: '-0.025em', lineHeight: 1 }}>{tile.value}</p>
              <p style={{ color: T3, fontSize: 11, marginTop: 8 }}>{tile.label}</p>
            </div>
          ))}
        </div>

        {/* Staff */}
        {staff.length > 0 && (
          <section>
            <SectionHeader icon={Users} label={`Staff (${staff.length})`} />
            <div style={{ ...cardStyle, padding: '8px 4px' }}>
              <div className="overflow-x-auto">
                <table className="w-full text-[13px]">
                  <thead>
                    <tr style={{ borderBottom: `1px solid ${F_BORDER}` }}>
                      <th className="px-3 py-2.5 text-left font-medium" style={thStyle}>Nom</th>
                      <th className="px-3 py-2.5 text-left font-medium" style={thStyle}>Email</th>
                      <th className="px-3 py-2.5 text-left font-medium" style={thStyle}>Rôles</th>
                    </tr>
                  </thead>
                  <tbody>
                    {staff.map((s, i) => (
                      <motion.tr
                        key={s.id}
                        initial={{ opacity: 0, x: -8 }}
                        animate={{ opacity: 1, x: 0 }}
                        transition={{ delay: Math.min(i * 0.03, 0.3) }}
                        style={{ borderBottom: i < staff.length - 1 ? `1px solid ${F_BORDER}` : 'none' }}
                      >
                        <td className="px-3 py-3">
                          <Link to={`/admin/directory/user/${s.id}`} style={{ color: RED, fontWeight: 600, textDecoration: 'none' }}>
                            {`${s.first_name || ''} ${s.last_name || ''}`.trim() || s.email}
                          </Link>
                        </td>
                        <td className="px-3 py-3" style={{ color: T2 }}>{s.email}</td>
                        <td className="px-3 py-3"><div className="flex gap-1 flex-wrap">{s.roles.map((r: string) => <RolePill key={r} label={r} />)}</div></td>
                      </motion.tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          </section>
        )}

        {/* Events */}
        {events.length > 0 && (
          <section>
            <SectionHeader icon={Calendar} label="Événements récents" />
            <div style={{ ...cardStyle, padding: '8px 4px' }}>
              <div className="overflow-x-auto">
                <table className="w-full text-[13px]">
                  <thead>
                    <tr style={{ borderBottom: `1px solid ${F_BORDER}` }}>
                      <th className="px-3 py-2.5 text-left font-medium" style={thStyle}>Titre</th>
                      <th className="px-3 py-2.5 text-left font-medium" style={thStyle}>Date</th>
                      <th className="px-3 py-2.5 text-left font-medium" style={thStyle}>Actif</th>
                      <th className="px-3 py-2.5 text-left font-medium" style={thStyle}>Billetterie</th>
                      <th className="px-3 py-2.5 text-left font-medium" style={thStyle}>Tables</th>
                    </tr>
                  </thead>
                  <tbody>
                    {events.map((e, i) => (
                      <motion.tr
                        key={e.id}
                        initial={{ opacity: 0, x: -8 }}
                        animate={{ opacity: 1, x: 0 }}
                        transition={{ delay: Math.min(i * 0.03, 0.3) }}
                        style={{ borderBottom: i < events.length - 1 ? `1px solid ${F_BORDER}` : 'none' }}
                      >
                        <td className="px-3 py-3" style={{ color: T1, fontWeight: 600 }}>{e.title}</td>
                        <td className="px-3 py-3" style={{ color: T2 }}>{format(new Date(e.start_at), 'dd/MM/yyyy HH:mm')}</td>
                        <td className="px-3 py-3">
                          {e.is_active
                            ? <span className="inline-flex items-center px-2 py-0.5 rounded-full" style={{ background: 'rgba(52,211,153,0.1)', border: '1px solid rgba(52,211,153,0.25)', color: POS, fontSize: 11, fontWeight: 600 }}>Oui</span>
                            : <span className="inline-flex items-center px-2 py-0.5 rounded-full" style={{ background: C_FAINT, border: `1px solid ${BORDER}`, color: T2, fontSize: 11, fontWeight: 600 }}>Non</span>}
                        </td>
                        <td className="px-3 py-3" style={{ color: e.ticketing_enabled ? POS : T3 }}>{e.ticketing_enabled ? '✓' : '—'}</td>
                        <td className="px-3 py-3" style={{ color: e.tables_enabled ? POS : T3 }}>{e.tables_enabled ? '✓' : '—'}</td>
                      </motion.tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          </section>
        )}
      </div>
    </div>
  );
}
