// Shared notification model used by both the owner inbox (venue-scoped
// `staff_notifications`) and the organizer inbox (`organizer_notifications`).
// The catalogue, priority config and scope-aware feed config all live here so
// the full-page inbox and the header bell popover stay in sync.

import {
  ShoppingCart, Ticket, Crown, Users, Star,
  Heart, Zap, BarChart3, Mail, Calendar,
  AlertCircle, Info, Radio, TrendingUp,
  UserCheck, AlertTriangle, Receipt, Music, Handshake,
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
  event_starting: { icon: Radio,     category: 'events', label: 'notif.type.event_starting' },
  event_ended:    { icon: BarChart3, category: 'events', label: 'notif.type.event_ended' },
  // 🎧 Bookings (organizer-facing)
  dj_booking_accepted: { icon: Music, category: 'bookings', label: 'notif.type.dj_booking_accepted' },
  dj_booking_declined: { icon: Music, category: 'bookings', label: 'notif.type.dj_booking_declined' },
  // 🤝 People
  partner_request:     { icon: Handshake, category: 'people', label: 'notif.type.partner_request' },
  partner_accepted:    { icon: Handshake, category: 'people', label: 'notif.type.partner_accepted' },
  connection_accepted: { icon: UserCheck, category: 'people', label: 'notif.type.connection_accepted' },
  staff_login:         { icon: Users,     category: 'people', label: 'notif.type.staff_login' },
  favorite_added:      { icon: Heart,     category: 'people', label: 'notif.type.favorite_added' },
  // 📧 Marketing
  campaign_sent: { icon: Mail, category: 'marketing', label: 'notif.type.campaign_sent' },
};

export const CATEGORY_META: Record<string, { label: string; color: string }> = {
  revenue:   { label: 'notif.cat.revenue',    color: 'text-emerald-400' },
  capacity:  { label: 'notif.cat.capacity',   color: 'text-orange-400'  },
  events:    { label: 'notif.cat.events',     color: 'text-blue-400'    },
  bookings:  { label: 'notif.cat.bookings',   color: 'text-violet-400'  },
  people:    { label: 'notif.cat.people',     color: 'text-purple-400'  },
  marketing: { label: 'notif.cat.marketing',  color: 'text-pink-400'    },
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
// Owner/manager read the venue inbox; organizers read their own. One config
// object drives the table name, the filter column/value and the realtime
// channel filter so every consumer (page + bell) queries the right place.

export interface FeedConfig {
  table: 'staff_notifications' | 'organizer_notifications';
  filterColumn: 'venue_id' | 'organizer_user_id';
  filterValue: string;
  /** Path to the full notifications inbox for this scope. */
  pagePath: string;
  /** Postgres-changes filter string for the realtime subscription. */
  realtimeFilter: string;
  /** Stable channel suffix. */
  channelKey: string;
}

export function getFeedConfig(params: {
  scope: 'venue' | 'organizer';
  venueId: string | null;
  organizerUserId: string | null;
  basePath: string;
}): FeedConfig | null {
  const { scope, venueId, organizerUserId, basePath } = params;
  if (scope === 'organizer') {
    if (!organizerUserId) return null;
    return {
      table: 'organizer_notifications',
      filterColumn: 'organizer_user_id',
      filterValue: organizerUserId,
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
    pagePath: `${basePath}/notifications`,
    realtimeFilter: `venue_id=eq.${venueId}`,
    channelKey: `venue_${venueId}`,
  };
}
