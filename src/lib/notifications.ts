// Shared notification model used by the three inboxes: the owner one
// (venue-scoped `staff_notifications`), the organizer one
// (`organizer_notifications`) and the platform one (`admin_notifications`,
// super admin). The catalogue, priority config and scope-aware feed config all
// live here so the full-page inbox and the header bell popover stay in sync.

import {
  ShoppingCart, Ticket, Crown, Users, Star,
  Heart, Zap, BarChart3, Mail, Calendar,
  AlertCircle, Info, Radio, TrendingUp,
  UserCheck, AlertTriangle, Receipt, Music, Handshake, MessageSquare,
  Martini, DoorOpen, Gauge, Target, ShieldAlert, Clock,
  KeyRound, CalendarClock, Hourglass, ListChecks, Building2, UserPlus,
  Briefcase, Rocket, CreditCard, Banknote, LifeBuoy, Wrench, Siren,
} from 'lucide-react';

export interface AppNotif {
  id: string;
  title: string;
  message: string;
  notification_type: string;
  priority: 'low' | 'normal' | 'high' | 'urgent';
  created_at: string;
  read_at: string | null;
  event_id: string | null;
  reference_type: string | null;
  reference_id: string | null;
  metadata: Record<string, unknown>;
}

export interface NotifDef {
  icon: React.ElementType;
  category: string;
  label: string;
}

export const NOTIF_CATALOGUE: Record<string, NotifDef> = {
  // 💰 Revenue
  new_order:      { icon: ShoppingCart, category: 'revenue',    label: 'notif.type.new_order' },
  ticket_sale:    { icon: Ticket,       category: 'revenue',    label: 'notif.type.ticket_sale' },
  table_booked:   { icon: Crown,        category: 'revenue',    label: 'notif.type.table_booked' },
  promoter_sale:  { icon: TrendingUp,   category: 'revenue',    label: 'notif.type.promoter_sale' },
  refund_issued:  { icon: Receipt,      category: 'revenue',    label: 'notif.type.refund_issued' },
  // 🎟️ Capacity
  ticket_round_warning:  { icon: AlertTriangle, category: 'capacity', label: 'notif.type.ticket_round_warning' },
  ticket_round_sold_out: { icon: Ticket,        category: 'capacity', label: 'notif.type.ticket_round_sold_out' },
  tables_warning:        { icon: AlertTriangle, category: 'capacity', label: 'notif.type.tables_warning' },
  tables_sold_out:       { icon: Crown,         category: 'capacity', label: 'notif.type.tables_sold_out' },
  // 📅 Events
  event_starting:  { icon: Radio,     category: 'events', label: 'notif.type.event_starting' },
  event_ended:     { icon: BarChart3, category: 'events', label: 'notif.type.event_ended' },
  lineup_reminder: { icon: Music,     category: 'events', label: 'notif.type.lineup_reminder' },
  // 🎧 Bookings (organizer-facing)
  dj_booking_accepted: { icon: Music, category: 'bookings', label: 'notif.type.dj_booking_accepted' },
  dj_booking_declined: { icon: Music, category: 'bookings', label: 'notif.type.dj_booking_declined' },
  // 🤝 People
  partner_request:     { icon: Handshake, category: 'people', label: 'notif.type.partner_request' },
  partner_accepted:    { icon: Handshake, category: 'people', label: 'notif.type.partner_accepted' },
  // co-event collaboration (per-night)
  collab_request:          { icon: Handshake,     category: 'people', label: 'notif.type.collab_request' },
  collab_accepted:         { icon: Handshake,     category: 'people', label: 'notif.type.collab_accepted' },
  collab_action_request:   { icon: AlertTriangle, category: 'people', label: 'notif.type.collab_action_request' },
  collab_action_scheduled: { icon: Calendar,      category: 'people', label: 'notif.type.collab_action_scheduled' },
  collab_action_done:      { icon: Calendar,      category: 'people', label: 'notif.type.collab_action_done' },
  collab_action_rejected:  { icon: AlertCircle,   category: 'people', label: 'notif.type.collab_action_rejected' },
  collab_message:          { icon: MessageSquare, category: 'people', label: 'notif.type.collab_message' },
  collab_tables_online:    { icon: Crown,          category: 'people', label: 'notif.type.collab_tables_online' },
  collab_tickets_online:   { icon: Ticket,         category: 'people', label: 'notif.type.collab_tickets_online' },
  // Allocation guest list : l'orga demande, le club tranche.
  guest_list_allocation_request: { icon: Users,      category: 'people', label: 'notif.type.guest_list_allocation_request' },
  guest_list_allocation_granted: { icon: UserCheck,  category: 'people', label: 'notif.type.guest_list_allocation_granted' },
  guest_list_allocation_denied:  { icon: AlertCircle, category: 'people', label: 'notif.type.guest_list_allocation_denied' },
  connection_accepted: { icon: UserCheck, category: 'people', label: 'notif.type.connection_accepted' },
  staff_login:         { icon: Users,     category: 'people', label: 'notif.type.staff_login' },
  favorite_added:      { icon: Heart,     category: 'people', label: 'notif.type.favorite_added' },
  // 📧 Marketing
  campaign_sent: { icon: Mail, category: 'marketing', label: 'notif.type.campaign_sent' },
  // 🔴 Live ops — alertes du centre de commandement (moteur cron 5 min)
  liveops_bar_backlog:    { icon: Martini,       category: 'liveops', label: 'notif.type.liveops_bar_backlog' },
  liveops_order_stuck:    { icon: Clock,         category: 'liveops', label: 'notif.type.liveops_order_stuck' },
  liveops_vip_no_show:    { icon: Crown,         category: 'liveops', label: 'notif.type.liveops_vip_no_show' },
  liveops_min_spend_risk: { icon: Crown,         category: 'liveops', label: 'notif.type.liveops_min_spend_risk' },
  liveops_door_slow:      { icon: DoorOpen,      category: 'liveops', label: 'notif.type.liveops_door_slow' },
  liveops_capacity_80:    { icon: Gauge,         category: 'liveops', label: 'notif.type.liveops_capacity_80' },
  liveops_capacity_95:    { icon: Gauge,         category: 'liveops', label: 'notif.type.liveops_capacity_95' },
  liveops_refund_spike:   { icon: Receipt,       category: 'liveops', label: 'notif.type.liveops_refund_spike' },
  liveops_revenue_goal:   { icon: Target,        category: 'liveops', label: 'notif.type.liveops_revenue_goal' },
  liveops_incident:       { icon: ShieldAlert,   category: 'liveops', label: 'notif.type.liveops_incident' },

  // ── 🤝 Espace affilié (agences ville + promoteurs) ─────────────────────────
  aff_new_assignment:     { icon: Calendar,      category: 'people', label: 'notif.type.aff_new_assignment' },
  aff_url_submitted:      { icon: UserCheck,     category: 'people', label: 'notif.type.aff_url_submitted' },
  aff_linktree_pending:   { icon: ListChecks,    category: 'people', label: 'notif.type.aff_linktree_pending' },
  aff_linktree_approved:  { icon: Rocket,        category: 'people', label: 'notif.type.aff_linktree_approved' },
  aff_linktree_rejected:  { icon: AlertTriangle, category: 'people', label: 'notif.type.aff_linktree_rejected' },
  aff_team_message:       { icon: MessageSquare, category: 'people', label: 'notif.type.aff_team_message' },
  aff_contract_signed:    { icon: Handshake,     category: 'people', label: 'notif.type.aff_contract_signed' },
  aff_contract_status:    { icon: AlertCircle,   category: 'people', label: 'notif.type.aff_contract_status' },
  aff_missing_ticket_url: { icon: AlertTriangle, category: 'events', label: 'notif.type.aff_missing_ticket_url' },

  // ── 🛡️ Super admin (flux plateforme) ───────────────────────────────────────
  // Échéances : les credentials et revues qui expirent tout seuls.
  admin_credential_due:      { icon: CalendarClock, category: 'deadlines', label: 'notif.type.admin_credential_due' },
  admin_credential_urgent:   { icon: Hourglass,     category: 'deadlines', label: 'notif.type.admin_credential_urgent' },
  admin_credential_overdue:  { icon: KeyRound,      category: 'deadlines', label: 'notif.type.admin_credential_overdue' },
  admin_credential_undated:  { icon: ListChecks,    category: 'deadlines', label: 'notif.type.admin_credential_undated' },
  // Croissance : qui arrive sur la plateforme, et qui s'active.
  admin_new_venue:           { icon: Building2,     category: 'growth',    label: 'notif.type.admin_new_venue' },
  admin_new_organizer:       { icon: UserPlus,      category: 'growth',    label: 'notif.type.admin_new_organizer' },
  admin_new_agency:          { icon: Briefcase,     category: 'growth',    label: 'notif.type.admin_new_agency' },
  admin_agency_club_lead:    { icon: Rocket,        category: 'growth',    label: 'notif.type.admin_agency_club_lead' },
  admin_waitlist_signup:     { icon: Users,         category: 'growth',    label: 'notif.type.admin_waitlist_signup' },
  admin_venue_first_sale:    { icon: Rocket,        category: 'growth',    label: 'notif.type.admin_venue_first_sale' },
  // Encaissement : ce qui empêche l'argent d'entrer, ou le fait ressortir.
  admin_stripe_onboarding_stuck: { icon: CreditCard, category: 'billing',  label: 'notif.type.admin_stripe_onboarding_stuck' },
  admin_subscription_changed:    { icon: CreditCard, category: 'billing',  label: 'notif.type.admin_subscription_changed' },
  admin_refund_spike:            { icon: Receipt,    category: 'billing',  label: 'notif.type.admin_refund_spike' },
  // Arbitrage : ce sur quoi Yuno doit trancher.
  admin_payout_disputed:     { icon: Banknote,      category: 'compliance', label: 'notif.type.admin_payout_disputed' },
  admin_feedback_new:        { icon: MessageSquare, category: 'compliance', label: 'notif.type.admin_feedback_new' },
  admin_feedback_critical:   { icon: LifeBuoy,      category: 'compliance', label: 'notif.type.admin_feedback_critical' },
  admin_mfa_reset_requested: { icon: ShieldAlert,   category: 'compliance', label: 'notif.type.admin_mfa_reset_requested' },
  // Système : l'état de la plateforme elle-même.
  admin_maintenance_mode:    { icon: Wrench,        category: 'system',    label: 'notif.type.admin_maintenance_mode' },
  admin_venue_purged:        { icon: Building2,     category: 'system',    label: 'notif.type.admin_venue_purged' },
  admin_venue_purge_failed:  { icon: AlertTriangle, category: 'system',    label: 'notif.type.admin_venue_purge_failed' },
  admin_payments_switch:     { icon: Siren,         category: 'system',    label: 'notif.type.admin_payments_switch' },
  admin_security_burst:      { icon: ShieldAlert,   category: 'system',    label: 'notif.type.admin_security_burst' },
  admin_push_queue_stuck:    { icon: Radio,         category: 'system',    label: 'notif.type.admin_push_queue_stuck' },
  // 🛟 Accès assisté Yuno (support) — flux club + organisateur.
  support_access_requested:  { icon: LifeBuoy,      category: 'people',    label: 'notif.type.support_access_requested' },
  support_access_session:    { icon: ShieldAlert,   category: 'people',    label: 'notif.type.support_access_session' },
  support_access_ended:      { icon: LifeBuoy,      category: 'people',    label: 'notif.type.support_access_ended' },
  // Flux super admin : un pro vient d'ouvrir la porte, la session est ouvrable.
  admin_support_access_ready:{ icon: LifeBuoy,      category: 'growth',    label: 'notif.type.admin_support_access_ready' },
};

export const CATEGORY_META: Record<string, { label: string; color: string }> = {
  revenue:    { label: 'notif.cat.revenue',    color: 'text-emerald-400' },
  capacity:   { label: 'notif.cat.capacity',   color: 'text-orange-400'  },
  events:     { label: 'notif.cat.events',     color: 'text-blue-400'    },
  bookings:   { label: 'notif.cat.bookings',   color: 'text-violet-400'  },
  people:     { label: 'notif.cat.people',     color: 'text-purple-400'  },
  marketing:  { label: 'notif.cat.marketing',  color: 'text-pink-400'    },
  liveops:    { label: 'notif.cat.liveops',    color: 'text-red-400'     },
  // Catégories propres au flux super admin.
  deadlines:  { label: 'notif.cat.deadlines',  color: 'text-amber-400'   },
  growth:     { label: 'notif.cat.growth',     color: 'text-emerald-400' },
  billing:    { label: 'notif.cat.billing',    color: 'text-sky-400'     },
  compliance: { label: 'notif.cat.compliance', color: 'text-rose-400'    },
  system:     { label: 'notif.cat.system',     color: 'text-slate-300'   },
};

export function getNotifDef(type: string): NotifDef {
  return NOTIF_CATALOGUE[type] ?? { icon: Info, category: 'other', label: type };
}

export const PRIORITY_CONFIG = {
  urgent: {
    dot: 'bg-[#E8192C]',
    badge: 'bg-[rgba(232,25,44,0.15)] text-[#E8192C] border-[rgba(232,25,44,0.25)]',
    glow: 'shadow-[0_0_12px_rgba(232,25,44,0.18)]',
    icon: 'text-[#E8192C]',
    label: 'notif.prio.urgent',
  },
  high: {
    dot: 'bg-orange-400',
    badge: 'bg-orange-400/10 text-orange-400 border-orange-400/20',
    glow: 'shadow-[0_0_8px_rgba(251,146,60,0.12)]',
    icon: 'text-orange-400',
    label: 'notif.prio.high',
  },
  normal: {
    dot: 'bg-blue-400',
    badge: 'bg-blue-400/10 text-blue-400 border-blue-400/20',
    glow: '',
    icon: 'text-blue-400',
    label: 'notif.prio.normal',
  },
  low: {
    dot: 'bg-white/20',
    badge: 'bg-white/5 text-white/30 border-white/10',
    glow: '',
    icon: 'text-white/30',
    label: 'notif.prio.low',
  },
} as const;

// ─── Scope-aware feed config ──────────────────────────────────────────────────
// Owner/manager read the venue inbox; organizers read their own; the super
// admin reads the platform one. One config object drives the table name, the
// filter column/value and the realtime channel filter so every consumer
// (page + bell) queries the right place.

export interface FeedConfig {
  table: 'staff_notifications' | 'organizer_notifications' | 'admin_notifications' | 'affiliate_app_notifications';
  filterColumn: 'venue_id' | 'organizer_user_id' | 'scope' | 'feed_key';
  filterValue: string;
  /** Dashboard root this feed belongs to (`/owner`, `/organizer-app`, `/admin`…). */
  basePath: string;
  /** Path to the full notifications inbox for this scope. */
  pagePath: string;
  /** Postgres-changes filter string for the realtime subscription. */
  realtimeFilter: string;
  /** Stable channel suffix. */
  channelKey: string;
}

/**
 * The platform inbox. It has no per-user key — there is one super admin feed —
 * so the constant `scope` column stands in as the filter, keeping the shape
 * identical to the two scoped feeds. Its page lives at `/admin/alerts` and not
 * `/admin/notifications`, which is already the automatic-push registry.
 */
export const ADMIN_FEED_CONFIG: FeedConfig = {
  table: 'admin_notifications',
  filterColumn: 'scope',
  filterValue: 'platform',
  basePath: '/admin',
  pagePath: '/admin/alerts',
  realtimeFilter: 'scope=eq.platform',
  channelKey: 'admin_platform',
};

/**
 * Le flux affilié suit le même modèle que les trois autres inboxes, avec une
 * clé de filtre unique `feed_key` : `admin:<affiliate_id>` pour le chef
 * d'agence (lu aussi par les managers), `member:<member_id>` pour le flux
 * personnel d'un promoteur. Une seule colonne = compatible telle quelle avec
 * la cloche partagée (un eq + un filtre realtime).
 */
export function getAffiliateFeedConfig(feedKey: string, pagePath = '/affiliate/inbox'): FeedConfig {
  return {
    table: 'affiliate_app_notifications',
    filterColumn: 'feed_key',
    filterValue: feedKey,
    basePath: '/affiliate',
    // Le cockpit agence passe '/agency-app/inbox' (miroir sans mur MFA) ; les
    // membres/managers gardent l'inbox affiliée par défaut.
    pagePath,
    realtimeFilter: `feed_key=eq.${feedKey}`,
    channelKey: `aff_${feedKey.replace(':', '_')}`,
  };
}

export function getFeedConfig(params: {
  scope: 'venue' | 'organizer' | 'admin';
  venueId: string | null;
  organizerUserId: string | null;
  basePath: string;
}): FeedConfig | null {
  const { scope, venueId, organizerUserId, basePath } = params;
  if (scope === 'admin') return ADMIN_FEED_CONFIG;
  if (scope === 'organizer') {
    if (!organizerUserId) return null;
    return {
      table: 'organizer_notifications',
      filterColumn: 'organizer_user_id',
      filterValue: organizerUserId,
      basePath,
      pagePath: `${basePath}/notifications`,
      realtimeFilter: `organizer_user_id=eq.${organizerUserId}`,
      channelKey: `org_${organizerUserId}`,
    };
  }
  if (!venueId) return null;
  return {
    table: 'staff_notifications',
    filterColumn: 'venue_id',
    filterValue: venueId,
    basePath,
    pagePath: `${basePath}/notifications`,
    realtimeFilter: `venue_id=eq.${venueId}`,
    channelKey: `venue_${venueId}`,
  };
}

// ─── Click-through routing ────────────────────────────────────────────────────
// Maps a notification to the most relevant in-app destination for the scope it
// belongs to. Scope-aware because the same notification type lives behind
// different routes for an owner (`/owner`), a manager (`/manager`) and an
// organizer (`/organizer-app`) — e.g. only owners have a per-event collab
// dashboard. Returns `null` when there is no good destination for this scope,
// in which case a click just marks the notification as read without navigating.

export function notifLink(n: AppNotif, config: FeedConfig): string | null {
  const basePath = config.basePath;
  const isOrganizer = config.table === 'organizer_notifications';
  const isOwner = basePath === '/owner';
  const isManager = basePath === '/manager';

  // The platform feed shares nothing with the two dashboard feeds — different
  // types, different routes — so it branches out before the shared switch.
  if (config.table === 'admin_notifications') return adminNotifLink(n);
  // Même logique pour le flux affilié : types et routes qui lui sont propres.
  if (config.table === 'affiliate_app_notifications') return affiliateNotifLink(n);
  const metaEventId = typeof n.metadata?.event_id === 'string' ? n.metadata.event_id : null;
  const eventId = n.event_id ?? metaEventId;
  // Sale notifications carry the order/ticket/reservation id in reference_id, so
  // the orders page can auto-open that exact order's detail (the one just placed).
  const orderFocus = n.reference_id ? `&focus=${n.reference_id}` : '';

  switch (n.notification_type) {
    // Co-event collaboration (per-night). Owners get the per-event collab
    // dashboard; organizers only have the collaborations list; managers have
    // no collab surface.
    case 'collab_request':
    case 'collab_accepted':
    case 'collab_action_request':
    case 'collab_action_scheduled':
    case 'collab_action_done':
    case 'collab_action_rejected':
    case 'collab_message':
      if (isOwner) return eventId ? `/owner/collab/event/${eventId}` : '/owner/collaborations';
      if (isOrganizer) return `${basePath}/collaborations`;
      return null;

    // Co-event ops going live (tables / ticketing). Point each party straight at
    // the relevant event surface: owners to the per-event collab dashboard,
    // organizers to their event detail page.
    case 'collab_tables_online':
    case 'collab_tickets_online':
      if (isOwner) return eventId ? `/owner/collab/event/${eventId}` : '/owner/collaborations';
      if (isOrganizer) return eventId ? `${basePath}/events/${eventId}` : `${basePath}/collaborations`;
      return null;

    // Allocation guest list : on ouvre la page Guest list SUR la bonne soirée
    // (sans ?event= elle retombe sur la 1re de la liste). Le manager gère aussi
    // la guest list, il a donc droit au même lien.
    case 'guest_list_allocation_request':
    case 'guest_list_allocation_granted':
    case 'guest_list_allocation_denied':
      if (isOwner || isManager || isOrganizer) {
        return eventId ? `${basePath}/guest-list?event=${eventId}` : `${basePath}/guest-list`;
      }
      return null;

    // Account-level partnerships.
    case 'partner_request':
    case 'partner_accepted':
    case 'connection_accepted':
      if (isOrganizer) return `${basePath}/partners`;
      if (isOwner) return '/owner/collaborations';
      return null;

    // DJ booking responses (owner + organizer book DJs).
    case 'dj_booking_accepted':
    case 'dj_booking_declined':
      return isManager ? null : `${basePath}/book-dj`;

    // Ticket sale → the orders page, tickets tab, opened on the sale just made.
    case 'ticket_sale':
      return `${basePath}/orders?tab=tickets${orderFocus}`;
    // Ticketing capacity alerts stay on the ticketing management page.
    case 'ticket_round_warning':
    case 'ticket_round_sold_out':
      return `${basePath}/ticketing`;

    // VIP table booked → the orders page, VIP tab, opened on the new reservation.
    case 'table_booked':
      return `${basePath}/orders?tab=vip${orderFocus}`;
    // VIP capacity alerts (owner has a tables page; organizer has no such surface).
    case 'tables_warning':
    case 'tables_sold_out':
      return isOrganizer ? null : `${basePath}/tables`;

    // Drink order (venue scope only) → the orders page, drinks tab.
    case 'new_order':
      return isOrganizer ? null : `${basePath}/orders?tab=drinks${orderFocus}`;
    case 'refund_issued':
      return `${basePath}/refunds`;

    // Promoter conversions.
    case 'promoter_sale':
      return eventId ? `${basePath}/promoters/event/${eventId}` : `${basePath}/guest-list`;

    // Line-up reminder.
    case 'lineup_reminder':
      if (isOrganizer && eventId) return `${basePath}/events/${eventId}`;
      return `${basePath}/events`;

    // Event lifecycle.
    case 'event_starting':
    case 'event_ended':
      if (isOrganizer && eventId) return `${basePath}/events/${eventId}`;
      return `${basePath}/analytics`;

    // Marketing.
    case 'campaign_sent':
      return isManager ? null : `${basePath}/campaigns`;

    // CRM.
    case 'favorite_added':
      return `${basePath}/customers`;

    // Staff (owner/manager only).
    case 'staff_login':
      return isOrganizer ? null : `${basePath}/staff`;

    // Live ops (owner/manager). La commande oubliée et la table à risque
    // ouvrent la commande/réservation exacte ; le reste ramène au centre de
    // commandement.
    case 'liveops_order_stuck':
      return isOrganizer ? null : `${basePath}/orders?tab=drinks${orderFocus}`;
    case 'liveops_vip_no_show':
    case 'liveops_min_spend_risk':
      return isOrganizer ? null : `${basePath}/orders?tab=vip${orderFocus}`;
    case 'liveops_bar_backlog':
    case 'liveops_door_slow':
    case 'liveops_capacity_80':
    case 'liveops_capacity_95':
    case 'liveops_refund_spike':
    case 'liveops_revenue_goal':
    case 'liveops_incident':
      return isOrganizer ? null : `${basePath}/live`;

    // Accès assisté Yuno : toujours vers le panneau de consentement, quel que
    // soit le dashboard — c'est là que le pro accepte, révoque et lit le journal.
    case 'support_access_requested':
    case 'support_access_session':
    case 'support_access_ended':
      return isOrganizer ? '/organizer-app/support-access' : `${basePath}/support-access`;

    default:
      return null;
  }
}

/**
 * Affiliate-feed routing. Admin-feed types point at the agency surface where
 * the decision gets made; member-feed types point at the promoter's own space.
 */
function affiliateNotifLink(n: AppNotif): string | null {
  switch (n.notification_type) {
    case 'aff_new_assignment':
      return '/affiliate/promoteur';
    case 'aff_url_submitted':
      return '/affiliate/assignments';
    case 'aff_linktree_pending':
      return '/affiliate/members';
    case 'aff_linktree_approved':
    case 'aff_linktree_rejected':
      return '/affiliate/promoteur/linktree';
    case 'aff_contract_signed':
    case 'aff_contract_status':
      return '/agency-app/clubs';
    case 'aff_missing_ticket_url':
      return '/affiliate/events';
    case 'aff_team_message': {
      const actionUrl = typeof n.metadata?.action_url === 'string' ? n.metadata.action_url : null;
      return actionUrl && actionUrl.startsWith('/') ? actionUrl : '/affiliate/inbox';
    }
    default:
      return null;
  }
}

/**
 * Platform-feed routing. Every alert points at the admin surface where the
 * matching decision gets made, so a click is one step from the fix rather than
 * from a search. Deadline alerts land back on the alerts page itself, where the
 * registry and its "renewed today" button live.
 */
function adminNotifLink(n: AppNotif): string | null {
  const ref = n.reference_id;

  switch (n.notification_type) {
    case 'admin_credential_due':
    case 'admin_credential_urgent':
    case 'admin_credential_overdue':
    case 'admin_credential_undated':
      return '/admin/alerts';

    case 'admin_new_venue':
    case 'admin_venue_first_sale':
    case 'admin_stripe_onboarding_stuck':
      return ref ? `/admin/directory/venue/${ref}` : '/admin/venues';

    case 'admin_new_organizer':
      return ref ? `/admin/directory/user/${ref}` : '/admin/organizers';

    // Accès assisté prêt : atterrir directement sur la fiche du pro, là où vit
    // le bouton « Ouvrir une session ».
    case 'admin_support_access_ready': {
      const target = typeof n.metadata?.target_user_id === 'string' ? n.metadata.target_user_id : null;
      return target ? `/admin/directory/user/${target}` : '/admin/directory';
    }

    case 'admin_new_agency':
      return '/admin/directory';

    case 'admin_agency_club_lead':
      return '/admin/affiliates';

    case 'admin_waitlist_signup':
      return '/admin/waitlist';

    case 'admin_subscription_changed':
      return '/admin/subscriptions';

    case 'admin_refund_spike':
      return '/admin/orders';

    // Pas de page dédiée aux règlements promoteur côté admin : la comptabilité
    // est l'endroit où le litige se tranche.
    case 'admin_payout_disputed':
      return '/admin/accounting';

    case 'admin_feedback_new':
    case 'admin_feedback_critical':
      return '/admin/feedback';

    case 'admin_mfa_reset_requested':
      return ref ? `/admin/directory/user/${ref}` : '/admin/directory';

    case 'admin_maintenance_mode':
    case 'admin_payments_switch':
      return '/admin';

    // Le club purgé n'existe plus : la liste des clubs est le seul point
    // d'atterrissage qui reste vrai (et celui d'où on relance une purge ratée).
    case 'admin_venue_purged':
    case 'admin_venue_purge_failed':
      return '/admin/venues';

    case 'admin_security_burst':
      return '/admin/audit';

    case 'admin_push_queue_stuck':
      return '/admin/push';

    default:
      return null;
  }
}
