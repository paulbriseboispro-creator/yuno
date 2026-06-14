// Shared types and utilities for event recap stats
// Yuno brand colors
const YUNO_RED = '#dc2626';
const YUNO_RED_LIGHT = '#ef4444';
const YUNO_GREEN = '#22c55e';
const YUNO_GOLD = '#fbbf24';
const YUNO_WHITE = '#ffffff';
const YUNO_GRAY = '#9ca3af';

export interface UserStats {
  drinksCount: number;
  totalSpent: number;
  ticketsCount: number;
  tablesCount: number;
  pointsEarned: number;
  currentBalance: number;
  tier: string;
  visitCount: number;
  lifetimeSpent: number;
  lifetimePoints: number;
  favoriteCategory: string | null;
  isFirstVisit: boolean;
  ticketDetails: TicketDetail[];
  drinkDetails: DrinkDetail[];
  tableSavings: number;
}

export interface TicketDetail {
  roundName: string;
  quantity: number;
  unitPrice: number;
  totalPrice: number;
  includesDrink: boolean;
  drinkName?: string;
  drinkRedeemed: boolean;
}

export interface DrinkDetail {
  name: string;
  quantity: number;
  category: string;
}

export interface StatDisplay {
  value: string;
  label: string;
  color: string;
  priority: number;
}

// Calculate ticket savings based on round position (earlier = cheaper)
export function calculateTicketSavings(tickets: TicketDetail[], regularPrice: number = 15): number {
  let savings = 0;
  for (const ticket of tickets) {
    if (ticket.includesDrink && ticket.drinkRedeemed) {
      savings += 8 * ticket.quantity;
    }
    if (ticket.unitPrice < regularPrice) {
      savings += (regularPrice - ticket.unitPrice) * ticket.quantity;
    }
  }
  return savings;
}

// Get most ordered drink category
export function getMostOrderedCategory(drinks: DrinkDetail[]): string | null {
  const categoryCount: Record<string, number> = {};
  for (const drink of drinks) {
    const cat = drink.category || 'autres';
    categoryCount[cat] = (categoryCount[cat] || 0) + drink.quantity;
  }
  
  let maxCategory: string | null = null;
  let maxCount = 0;
  for (const [cat, count] of Object.entries(categoryCount)) {
    if (count > maxCount) {
      maxCount = count;
      maxCategory = cat;
    }
  }
  return maxCategory;
}

// Generate the 3 best stats for this user based on their actual activity
export function selectBestStats(stats: UserStats): StatDisplay[] {
  const allStats: StatDisplay[] = [];
  
  // Ticket-specific stats (more detailed than just count)
  if (stats.ticketDetails.length > 0) {
    const ticketSavings = calculateTicketSavings(stats.ticketDetails);
    const firstTicket = stats.ticketDetails[0];
    
    // If they saved money with early tickets
    if (ticketSavings > 0) {
      allStats.push({
        value: `${ticketSavings.toFixed(0)}€`,
        label: 'économisés avec Yuno',
        color: YUNO_GREEN,
        priority: 15
      });
    }
    
    // If ticket included a drink
    if (firstTicket.includesDrink && firstTicket.drinkRedeemed) {
      allStats.push({
        value: firstTicket.drinkName || '1 drink',
        label: 'offert avec ton ticket',
        color: YUNO_GOLD,
        priority: 12
      });
    }
    
    // Show the ticket type they bought
    allStats.push({
      value: firstTicket.roundName,
      label: stats.ticketsCount > 1 ? `× ${stats.ticketsCount} tickets` : 'ticket réservé',
      color: YUNO_RED,
      priority: 8
    });
  }
  
  // Drink-specific stats
  if (stats.drinksCount > 0 && stats.drinkDetails.length > 0) {
    const topDrink = stats.drinkDetails.sort((a, b) => b.quantity - a.quantity)[0];
    
    if (stats.drinksCount >= 2) {
      allStats.push({
        value: String(stats.drinksCount),
        label: 'drinks commandés',
        color: YUNO_RED,
        priority: stats.drinksCount >= 3 ? 11 : 7
      });
    }
    
    // Show their top drink
    if (topDrink && topDrink.quantity >= 2) {
      allStats.push({
        value: topDrink.name,
        label: `ton préféré (×${topDrink.quantity})`,
        color: YUNO_RED_LIGHT,
        priority: 6
      });
    }
  }
  
  // Spending stats
  if (stats.totalSpent > 0) {
    allStats.push({
      value: `${stats.totalSpent.toFixed(0)}€`,
      label: 'dépensés ce soir',
      color: YUNO_GREEN,
      priority: stats.totalSpent >= 50 ? 9 : 4
    });
  }
  
  // Table reservation (premium feature)
  if (stats.tablesCount > 0) {
    allStats.push({
      value: String(stats.tablesCount),
      label: stats.tablesCount === 1 ? 'table VIP réservée' : 'tables VIP réservées',
      color: YUNO_GOLD,
      priority: 14
    });
  }
  
  // Points earned (shows loyalty value)
  if (stats.pointsEarned > 0) {
    allStats.push({
      value: `+${stats.pointsEarned}`,
      label: 'points fidélité gagnés',
      color: YUNO_RED,
      priority: 7
    });
  }
  
  // Balance (only if significant and not first visit)
  if (stats.currentBalance >= 50 && !stats.isFirstVisit) {
    allStats.push({
      value: String(stats.currentBalance),
      label: 'points cumulés',
      color: YUNO_RED_LIGHT,
      priority: 5
    });
  }
  
  // Visit count milestone
  if (stats.visitCount === 2) {
    allStats.push({
      value: '2ème',
      label: 'visite ici 🎉',
      color: YUNO_RED,
      priority: 10
    });
  } else if (stats.visitCount >= 5) {
    allStats.push({
      value: `#${stats.visitCount}`,
      label: 'visite - tu es un habitué!',
      color: YUNO_RED,
      priority: 9
    });
  } else if (stats.visitCount > 2) {
    allStats.push({
      value: `#${stats.visitCount}`,
      label: 'visite ici',
      color: YUNO_RED,
      priority: 4
    });
  }
  
  // Tier (only if upgraded)
  if (stats.tier && stats.tier !== 'bronze' && !stats.isFirstVisit) {
    const tierLabels: Record<string, string> = {
      silver: 'membre Silver 🥈',
      gold: 'membre Gold 🥇',
      platinum: 'membre Platinum 💎'
    };
    const tierColors: Record<string, string> = {
      silver: '#c0c0c0',
      gold: '#ffd700',
      platinum: '#e5e4e2'
    };
    allStats.push({
      value: tierLabels[stats.tier] || stats.tier.toUpperCase(),
      label: 'statut actuel',
      color: tierColors[stats.tier] || YUNO_RED,
      priority: stats.tier === 'platinum' ? 13 : stats.tier === 'gold' ? 11 : 8
    });
  }
  
  // Lifetime spending milestone
  if (stats.lifetimeSpent >= 500) {
    allStats.push({
      value: `${stats.lifetimeSpent.toFixed(0)}€`,
      label: 'dépensés au total ici',
      color: YUNO_GOLD,
      priority: 6
    });
  }
  
  // Sort by priority and take top 3
  allStats.sort((a, b) => b.priority - a.priority);
  return allStats.slice(0, 3);
}

// Generate HTML for stats section with Yuno branding
export function generateStatsHtml(stats: StatDisplay[]): string {
  if (stats.length === 0) return '';
  
  const statCells = stats.map(stat => `
    <td style="background: rgba(255,255,255,0.05); border-radius: 12px; padding: 20px; text-align: center; width: ${stats.length === 3 ? '33%' : '50%'};">
      <p style="color: ${stat.color}; margin: 0; font-size: 28px; font-weight: 800;">${stat.value}</p>
      <p style="color: ${YUNO_GRAY}; margin: 4px 0 0; font-size: 13px;">${stat.label}</p>
    </td>
  `).join('<td style="width: 8px;"></td>');
  
  return `
    <table width="100%" cellpadding="0" cellspacing="0" style="margin-bottom: 24px;">
      <tr>${statCells}</tr>
    </table>
  `;
}

// Select the best template based on user profile
export function selectTemplate(stats: UserStats): string {
  if (stats.isFirstVisit) {
    return 'recap-first-timer';
  }
  
  if (stats.tablesCount > 0 || stats.totalSpent >= 100) {
    return 'recap-vip-spender';
  }
  
  if (stats.ticketDetails.length > 0 && stats.drinksCount === 0) {
    return 'recap-ticket-buyer';
  }
  
  if (stats.visitCount >= 3 || (stats.tier && stats.tier !== 'bronze')) {
    return 'recap-loyal-regular';
  }
  
  return 'end-of-night-recap';
}
