import { useState, useEffect, useMemo } from 'react';
import { VipReservation, VipConsumption } from '@/types';
import { AlertTriangle, Clock, CreditCard, Users, X, Target } from 'lucide-react';
import { useLanguage } from '@/contexts/LanguageContext';

interface VipAlertsProps {
  reservations: VipReservation[];
  consumptionTimes: Map<string, Date>;
  consumptions?: Map<string, VipConsumption[]>;
  onAlertClick?: (reservationId: string) => void;
}

interface Alert {
  id: string;
  type: 'no_order' | 'new_waiting' | 'low_credit' | 'negative_credit' | 'long_session' | 'under_minimum';
  message: string;
  reservationId?: string;
  priority: 'low' | 'medium' | 'high';
  icon: typeof AlertTriangle;
}

export function VipAlerts({ 
  reservations, 
  consumptionTimes, 
  consumptions,
  onAlertClick 
}: VipAlertsProps) {
  const { t } = useLanguage();
  const [dismissedAlerts, setDismissedAlerts] = useState<Set<string>>(new Set());

  const alerts = useMemo(() => {
    const newAlerts: Alert[] = [];
    const now = new Date();

    reservations.forEach(r => {
      // Check for tables with no orders in 45 minutes (active tables only)
      if (r.vipStatus === 'active' && r.placedAt) {
        const lastActivity = consumptionTimes.get(r.id) || new Date(r.placedAt);
        const minutesSinceActivity = (now.getTime() - lastActivity.getTime()) / (1000 * 60);
        
        if (minutesSinceActivity >= 45) {
          const alertId = `no_order_${r.id}`;
          if (!dismissedAlerts.has(alertId)) {
            newAlerts.push({
              id: alertId,
              type: 'no_order',
              message: `${r.fullName} - pas de commande depuis 45min`,
              reservationId: r.id,
              priority: 'medium',
              icon: Clock,
            });
          }
        }

        // Check for long sessions (4h+)
        const hoursActive = (now.getTime() - new Date(r.placedAt).getTime()) / (1000 * 60 * 60);
        if (hoursActive >= 4) {
          const alertId = `long_session_${r.id}`;
          if (!dismissedAlerts.has(alertId)) {
            newAlerts.push({
              id: alertId,
              type: 'long_session',
              message: `${r.fullName} - actif depuis ${Math.floor(hoursActive)}h`,
              reservationId: r.id,
              priority: 'low',
              icon: Clock,
            });
          }
        }
      }

      // Check credit status
      if (consumptions && ['placed', 'active'].includes(r.vipStatus)) {
        const items = consumptions.get(r.id) || [];
        const totalConsumed = items.reduce((sum, c) => sum + c.totalPrice, 0);
        const remaining = r.totalPrice - totalConsumed;

        if (remaining < 0) {
          const alertId = `negative_credit_${r.id}`;
          if (!dismissedAlerts.has(alertId)) {
            newAlerts.push({
              id: alertId,
              type: 'negative_credit',
              message: `${r.fullName} - crédit négatif (${remaining.toFixed(0)}€)`,
              reservationId: r.id,
              priority: 'high',
              icon: CreditCard,
            });
          }
        } else if (remaining < 50 && remaining >= 0) {
          const alertId = `low_credit_${r.id}`;
          if (!dismissedAlerts.has(alertId)) {
            newAlerts.push({
              id: alertId,
              type: 'low_credit',
              message: `${r.fullName} - crédit faible (${remaining.toFixed(0)}€)`,
              reservationId: r.id,
              priority: 'medium',
              icon: CreditCard,
            });
          }
        }

        // Check minimum spend status
        const minimumSpend = r.minimumSpend || 0;
        if (minimumSpend > 0) {
          const percentage = (totalConsumed / minimumSpend) * 100;
          
          // Alert if under 50% of minimum spend
          if (percentage < 50 && r.vipStatus === 'active') {
            const alertId = `under_minimum_${r.id}`;
            if (!dismissedAlerts.has(alertId)) {
              const remaining = minimumSpend - totalConsumed;
              newAlerts.push({
                id: alertId,
                type: 'under_minimum',
                message: `${r.fullName} - ${remaining.toFixed(0)}€ ${t('vipHost.toMinimum')} (${percentage.toFixed(0)}%)`,
                reservationId: r.id,
                priority: percentage < 25 ? 'high' : 'medium',
                icon: Target,
              });
            }
          }
        }
      }
    });

    // Check for new waiting groups
    const waitingCount = reservations.filter(r => r.vipStatus === 'waiting').length;
    if (waitingCount > 0) {
      const alertId = `waiting_${waitingCount}`;
      if (!dismissedAlerts.has(alertId)) {
        newAlerts.push({
          id: alertId,
          type: 'new_waiting',
          message: `${waitingCount} groupe${waitingCount > 1 ? 's' : ''} en attente`,
          priority: 'medium',
          icon: Users,
        });
      }
    }

    // Sort by priority
    const priorityOrder = { high: 0, medium: 1, low: 2 };
    return newAlerts.sort((a, b) => priorityOrder[a.priority] - priorityOrder[b.priority]);
  }, [reservations, consumptionTimes, consumptions, dismissedAlerts, t]);

  const handleDismiss = (e: React.MouseEvent, alertId: string) => {
    e.stopPropagation();
    setDismissedAlerts(prev => new Set([...prev, alertId]));
  };

  const handleClick = (alert: Alert) => {
    if (alert.reservationId && onAlertClick) {
      onAlertClick(alert.reservationId);
    }
  };

  if (alerts.length === 0) return null;

  const getAlertStyles = (alert: Alert) => {
    switch (alert.priority) {
      case 'high':
        return 'bg-destructive/10 border-destructive/30 text-destructive';
      case 'medium':
        return 'bg-amber-500/10 border-amber-500/30 text-amber-400';
      case 'low':
      default:
        return 'border text-[rgba(255,255,255,0.58)] bg-[rgba(255,255,255,0.032)] border-[rgba(255,255,255,0.085)]';
    }
  };

  return (
    <div className="space-y-2">
      {alerts.map(alert => {
        const Icon = alert.icon;
        return (
          <div 
            key={alert.id}
            onClick={() => handleClick(alert)}
            className={`px-3 py-2 rounded-lg text-sm flex items-center gap-2 border cursor-pointer transition-opacity hover:opacity-80 ${getAlertStyles(alert)}`}
          >
            <Icon className="w-4 h-4 shrink-0" />
            <span className="flex-1">{alert.message}</span>
            <button 
              onClick={(e) => handleDismiss(e, alert.id)}
              className="p-1 opacity-70 hover:opacity-100"
            >
              <X className="w-3.5 h-3.5" />
            </button>
          </div>
        );
      })}
    </div>
  );
}
