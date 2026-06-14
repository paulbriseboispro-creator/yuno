import { useEffect, useState } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { useLanguage } from '@/contexts/LanguageContext';
import { Badge } from '@/components/ui/badge';
import { Check, Clock, MapPin, ArrowRightLeft, X, MessageSquare } from 'lucide-react';

interface VipPlacementTrackerProps {
  reservationId: string;
  placementStatus: string;
  requestedTableName?: string;
  assignedTableName?: string;
  placementNote?: string;
}

export function VipPlacementTracker({
  reservationId,
  placementStatus: initialStatus,
  requestedTableName,
  assignedTableName: initialAssignedTable,
  placementNote: initialNote,
}: VipPlacementTrackerProps) {
  const { t } = useLanguage();
  const [status, setStatus] = useState(initialStatus);
  const [assignedTableName] = useState(initialAssignedTable);
  const [placementNote, setPlacementNote] = useState(initialNote);

  // Realtime subscription for placement updates
  useEffect(() => {
    const channel = supabase
      .channel(`placement-${reservationId}`)
      .on(
        'postgres_changes',
        {
          event: 'UPDATE',
          schema: 'public',
          table: 'table_reservations',
          filter: `id=eq.${reservationId}`,
        },
        (payload) => {
          const newData = payload.new as any;
          if (newData.placement_status) setStatus(newData.placement_status);
          if (newData.placement_note !== undefined) setPlacementNote(newData.placement_note);
        }
      )
      .subscribe();

    return () => {
      supabase.removeChannel(channel);
    };
  }, [reservationId]);

  if (!status || status === 'none') return null;

  const getStatusConfig = () => {
    switch (status) {
      case 'requested':
        return {
          icon: Clock,
          label: t('vipPlacement.statusRequested'),
          description: requestedTableName
            ? t('vipPlacement.requestedTableDesc').replace('{table}', requestedTableName)
            : t('vipPlacement.requestedDesc'),
          badgeClass: 'bg-amber-500/20 text-amber-400 border-amber-500/30',
          dotClass: 'bg-amber-400',
        };
      case 'approved':
        return {
          icon: Check,
          label: t('vipPlacement.statusApproved'),
          description: assignedTableName
            ? t('vipPlacement.approvedTableDesc').replace('{table}', assignedTableName)
            : t('vipPlacement.approvedDesc'),
          badgeClass: 'bg-emerald-500/20 text-emerald-400 border-emerald-500/30',
          dotClass: 'bg-emerald-400',
        };
      case 'modified':
        return {
          icon: ArrowRightLeft,
          label: t('vipPlacement.statusModified'),
          description: assignedTableName
            ? t('vipPlacement.modifiedTableDesc').replace('{table}', assignedTableName)
            : t('vipPlacement.modifiedDesc'),
          badgeClass: 'bg-blue-500/20 text-blue-400 border-blue-500/30',
          dotClass: 'bg-blue-400',
        };
      case 'rejected':
        return {
          icon: X,
          label: t('vipPlacement.statusRejected'),
          description: t('vipPlacement.rejectedDesc'),
          badgeClass: 'bg-destructive/20 text-destructive border-destructive/30',
          dotClass: 'bg-destructive',
        };
      case 'assign_on_arrival':
        return {
          icon: MapPin,
          label: t('vipPlacement.statusAssignOnArrival'),
          description: t('vipPlacement.assignOnArrivalDesc'),
          badgeClass: 'bg-muted text-muted-foreground border-muted',
          dotClass: 'bg-muted-foreground',
        };
      default:
        return null;
    }
  };

  const config = getStatusConfig();
  if (!config) return null;

  const Icon = config.icon;

  return (
    <div className="mt-1 p-2 rounded-lg border border-border/50 bg-surface/80 space-y-1">
      <div className="flex items-center gap-2 flex-nowrap">
        <div className={`w-2 h-2 rounded-full shrink-0 ${config.dotClass}`} />
        <Badge variant="outline" className={`text-[10px] shrink-0 ${config.badgeClass}`}>
          <Icon className="h-2.5 w-2.5 mr-0.5" />
          {config.label}
        </Badge>
        <p className="text-[11px] text-muted-foreground leading-snug truncate">{config.description}</p>
      </div>
      {placementNote && (
        <p className="text-[10px] text-muted-foreground/70 italic flex items-center gap-1 pl-4">
          <MessageSquare className="h-2.5 w-2.5 shrink-0 inline" />
          {placementNote}
        </p>
      )}
    </div>
  );
}
