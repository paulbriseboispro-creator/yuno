export type Promoter = {
  id: string;
  userId: string;
  venueId: string;
  promoCode: string;
  instagramUrl?: string;
  whatsappNumber?: string;
  iban?: string;
  bic?: string;
  profileImageUrl?: string;
  ticketCommissionType: 'fixed' | 'percentage';
  ticketCommissionValue: number;
  tableCommissionType: 'fixed' | 'percentage';
  tableCommissionValue: number;
  pendingAmount: number;
  totalPaid: number;
  isActive: boolean;
  createdAt: string;
  updatedAt: string;
  defaultCommissionTemplateId?: string;
  teamId?: string;
  canScanEntries: boolean;
  // Joined fields
  email?: string;
  firstName?: string;
  lastName?: string;
  teamName?: string;
};

export type PromoterClick = {
  id: string;
  promoterId: string;
  eventId?: string;
  source?: string;
  ipHash?: string;
  userAgent?: string;
  referrer?: string;
  clickedAt: string;
};

export type PromoterConversion = {
  id: string;
  promoterId: string;
  eventId?: string;
  orderId?: string;
  ticketId?: string;
  tableReservationId?: string;
  conversionType: 'order' | 'ticket' | 'table';
  amount: number;
  commission: number;
  status: 'pending' | 'paid';
  paidAt?: string;
  createdAt: string;
};

export type PromoterAnnouncement = {
  id: string;
  venueId: string;
  eventId?: string;
  title: string;
  content: string;
  createdAt: string;
  updatedAt: string;
};

export type PromoterMessage = {
  id: string;
  promoterId: string;
  senderId: string;
  content: string;
  isFromClub: boolean;
  isRead: boolean;
  createdAt: string;
};

// ── Commission Templates ──

export type RewardType = 'money' | 'free_entry' | 'vip' | 'drinks' | 'none';

export type PresetType = 'rewards' | 'guest_list' | 'client_discount';

export type CommissionRuleTier = {
  min: number;
  max: number | null;
  reward_type: RewardType;
  ticketValue?: number;
  reward_config?: {
    drinkCount?: number;
    drinkCategory?: string;
    vipType?: string;
    entryCount?: number;
  };
};

export type CommissionRuleBonus = {
  threshold: number;
  bonusAmount: number;
};

export type GuestListPreset = {
  quota: number;
  vipAccess: boolean;
  includesDrink: boolean;
  drinkCount?: number;
  normalQuota?: number;
  tableQuota?: number;
  drinkQuota?: number;
  entryDeadline?: string;
};

export type ClientDiscountPreset = {
  type: 'percentage' | 'fixed';
  value: number;
  appliesTo: 'tickets' | 'drinks' | 'both';
  label?: string;
};

// Time-windowed commission, e.g. "5€ avant 00h30 puis 2€". Applied at door-scan
// time for ticket/guestlist conversions. Windows are evaluated in order: the first
// whose `before` time is later than the scan time wins; past all windows the flat
// ticket rule applies. Post-midnight hours sort after the evening (night wrap).
export type CommissionTimeWindow = {
  before: string; // "HH:MM" local (Europe/Paris)
  type: 'fixed' | 'percentage';
  value: number;
};

export type CommissionRules = {
  preset_type?: PresetType;
  reward_type?: RewardType;
  reward_config?: {
    drinkCount?: number;
    drinkCategory?: string;
    vipType?: string;
    entryCount?: number;
  };
  ticket?: { type: 'fixed' | 'percentage'; value: number };
  table?: { type: 'fixed' | 'percentage'; value: number };
  tiers?: CommissionRuleTier[];
  bonus?: CommissionRuleBonus;
  time_windows?: CommissionTimeWindow[];
  /** Guest list : montant fixe PAR TETE (euros). Jamais un pourcentage : une
   *  entree gratuite n'a pas de montant, un pourcentage vaudrait toujours 0. */
  guestlist?: { value: number };
  guest_list?: GuestListPreset;
  customer_discount?: ClientDiscountPreset;
  /** Rattache automatiquement tout promoteur portant ce modèle à TOUTES les
   *  soirées à venir du club (et aux futures via le trigger). Pré-active
   *  `promoters.auto_assign_events` quand le modèle est appliqué. */
  auto_assign_events?: boolean;
  /** Allocation guest list pilotée par le modèle : chaque promoteur portant ce
   *  modèle reçoit automatiquement des places de guest list PAR TYPE sur chaque
   *  soirée reliée (part `guest_lists` matérialisée à l'assignation), avec une
   *  commission PAR TÊTE propre à chaque type (lue au scan par
   *  record_promoter_conversion). `table` = le type « VIP ». `gender` = quotas
   *  par sexe optionnels. `free_before` = heure limite d'entrée gratuite (HH:MM,
   *  défaut 02:00). `spots` = ancienne forme v1 (un seul nombre), lue en
   *  rétrocompat = tout en normal. */
  guestlist_allocation?: {
    free_before?: string;
    types?: {
      normal?: { spots: number; commission: number };
      drink?: { spots: number; commission: number };
      table?: { spots: number; commission: number };
    };
    gender?: { female: number; male: number };
    /** @deprecated v1 — lecture rétrocompat uniquement. */
    spots?: number;
  };
};

export type CommissionTemplate = {
  id: string;
  venueId: string;
  name: string;
  rules: CommissionRules;
  isDefault: boolean;
  createdAt: string;
  updatedAt: string;
};

// ── Event Assignments ──

export type PromoterEventAssignment = {
  id: string;
  promoterId: string;
  eventId: string;
  commissionTemplateId?: string;
  goalTarget?: number;
  maxTickets?: number;
  canAccessGuestlist: boolean;
  canAccessTables: boolean;
  status: 'active' | 'paused';
  assignedAt: string;
  // Joined fields
  eventTitle?: string;
  eventStartAt?: string;
  eventEndAt?: string;
};

// ── Teams ──

export type PromoterTeam = {
  id: string;
  venueId: string;
  name: string;
  leaderPromoterId?: string;
  maxSales?: number;
  createdAt: string;
  // Joined
  leaderName?: string;
  memberCount?: number;
};

// ── Payouts ──

export type PromoterPayout = {
  id: string;
  promoterId: string;
  venueId: string;
  periodLabel?: string;
  amount: number;
  status: 'pending' | 'approved' | 'paid';
  approvedAt?: string;
  approvedBy?: string;
  paidAt?: string;
  paidBy?: string;
  notes?: string;
  createdAt: string;
  // Joined
  promoterName?: string;
  promoterIban?: string;
};

// ── Stats (supports filtered periods) ──

export type PromoterStats = {
  totalClicks: number;
  clicksToday: number;
  clicksThisWeek: number;
  clicksThisMonth: number;
  totalConversions: number;
  conversionsThisMonth: number;
  conversionRate: number;
  totalRevenue: number;
  revenueThisMonth: number;
  totalCommission: number;
  pendingCommission: number;
  approvedCommission: number;
  paidCommission: number;
  ticketsSold: number;
  tablesReserved: number;
};

export type PromoterEventStats = {
  eventId: string;
  eventTitle: string;
  eventDate: string;
  clicks: number;
  ticketsSold: number;
  tablesReserved: number;
  revenue: number;
  commission: number;
  conversionRate: number;
  goalTarget?: number;
  goalProgress?: number;
};
