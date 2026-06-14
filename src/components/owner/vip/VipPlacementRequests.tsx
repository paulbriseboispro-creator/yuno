import { useState } from 'react';
import { supabase } from '@/integrations/supabase/client';
import type { TablesUpdate } from '@/integrations/supabase/types';
import { useLanguage } from '@/contexts/LanguageContext';
import { VenueFloorPlan, VipReservation } from '@/types';
import { PlacementFloorPlanSheet } from './PlacementFloorPlanSheet';
import { toast } from 'sonner';
import { Check, X, MapPin, Users, ArrowRightLeft, Clock, MessageSquare, Edit } from 'lucide-react';
import {
  VipCard, VipButton, VipPill, VipEmpty, type PillTone,
  T1, T3, F_BORDER, INNER_BG, BORDER,
} from './vip-ui';

interface PlacementRequest {
  id: string;
  fullName: string;
  email: string;
  phone?: string;
  guestCount: number;
  zoneName?: string;
  zoneColor?: string;
  requestedTableId?: string;
  requestedTableName?: string;
  placementStatus: string;
  totalPrice: number;
  deposit: number;
  createdAt: string;
}

interface VipPlacementRequestsProps {
  requests: PlacementRequest[];
  onRefresh: () => void;
  floorPlan?: VenueFloorPlan | null;
  reservations?: VipReservation[];
}

const statusBadge: Record<string, { label: string; tone: PillTone }> = {
  requested: { label: 'vipPlacement.requested', tone: 'warn' },
  approved: { label: 'vipPlacement.approved', tone: 'success' },
  modified: { label: 'vipPlacement.modified', tone: 'info' },
  rejected: { label: 'vipPlacement.rejected', tone: 'danger' },
  assign_on_arrival: { label: 'vipPlacement.assignOnArrival', tone: 'muted' },
};

export function VipPlacementRequests({ requests, onRefresh, floorPlan, reservations = [] }: VipPlacementRequestsProps) {
  const { t } = useLanguage();
  const [processing, setProcessing] = useState<string | null>(null);
  const [modifyingRequest, setModifyingRequest] = useState<PlacementRequest | null>(null);
  const [noteInputs, setNoteInputs] = useState<Record<string, string>>({});
  const [showNoteFor, setShowNoteFor] = useState<string | null>(null);

  const handleAction = async (reservationId: string, action: 'approve' | 'reject' | 'assign_on_arrival', note?: string) => {
    setProcessing(reservationId);
    try {
      const { data: { user } } = await supabase.auth.getUser();
      const request = requests.find(r => r.id === reservationId);

      const updates: TablesUpdate<'table_reservations'> = {
        placement_reviewed_by: user?.id,
        placement_reviewed_at: new Date().toISOString(),
        placement_note: note?.trim() || null,
      };

      if (action === 'approve' && request?.requestedTableId) {
        updates.placement_status = 'approved';
        updates.assigned_table_id = request.requestedTableId;
      } else if (action === 'reject') {
        updates.placement_status = 'rejected';
      } else if (action === 'assign_on_arrival') {
        updates.placement_status = 'assign_on_arrival';
        updates.assigned_table_id = null;
      }

      const { error } = await supabase
        .from('table_reservations')
        .update(updates)
        .eq('id', reservationId);

      if (error) throw error;

      // Send VIP confirmation email
      const emailType = action === 'approve' ? 'confirmed' : action === 'reject' ? 'refused' : '';
      if (emailType) {
        supabase.functions.invoke('send-vip-confirmation', {
          body: { reservation_id: reservationId, type: emailType },
        }).catch(err => console.error('Error sending VIP email:', err));
      }

      toast.success(t('vipPlacement.actionSuccess'));
      setShowNoteFor(null);
      setNoteInputs({});
      onRefresh();
    } catch {
      toast.error(t('common.error'));
    } finally {
      setProcessing(null);
    }
  };

  if (requests.length === 0) {
    return <VipEmpty icon={MapPin} title={t('vipPlacement.noRequests')} />;
  }

  return (
    <>
      <div className="space-y-3">
        {requests.map((request) => {
          const status = statusBadge[request.placementStatus] || statusBadge.requested;
          const isPending = request.placementStatus === 'requested';
          const canReplace = ['approved', 'modified', 'assign_on_arrival'].includes(request.placementStatus);
          const isProcessing = processing === request.id;
          const showNote = showNoteFor === request.id;

          return (
            <VipCard key={request.id} style={{ padding: 16 }}>
              <div className="flex items-start justify-between gap-3">
                <div className="flex-1 min-w-0 space-y-2">
                  <div className="flex items-center gap-2 flex-wrap">
                    <h4 className="font-semibold truncate" style={{ color: T1, fontSize: 14 }}>{request.fullName}</h4>
                    <VipPill tone={status.tone}>{t(status.label)}</VipPill>
                  </div>

                  <div className="flex flex-wrap items-center gap-x-3 gap-y-1" style={{ color: T3, fontSize: 11.5 }}>
                    <span className="flex items-center gap-1 tabular-nums">
                      <Users className="w-3 h-3" />
                      {request.guestCount}
                    </span>
                    {request.zoneName && (
                      <span className="flex items-center gap-1.5">
                        <div className="w-2 h-2 rounded-full" style={{ background: request.zoneColor || '#666' }} />
                        {request.zoneName}
                      </span>
                    )}
                    {request.requestedTableName && (
                      <span className="flex items-center gap-1">
                        <MapPin className="w-3 h-3" />
                        {request.requestedTableName}
                      </span>
                    )}
                    <span className="flex items-center gap-1 tabular-nums">
                      <Clock className="w-3 h-3" />
                      {new Date(request.createdAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                    </span>
                  </div>
                </div>

                <div className="text-right shrink-0">
                  <div className="tabular-nums" style={{ color: T1, fontSize: 15, fontWeight: 660 }}>{request.totalPrice}€</div>
                </div>
              </div>

              {isPending && (
                <>
                  {/* Note input toggle */}
                  {showNote && (
                    <div className="mt-3 pt-3" style={{ borderTop: `1px solid ${F_BORDER}` }}>
                      <div className="flex items-start gap-2">
                        <MessageSquare className="w-4 h-4 mt-2 shrink-0" style={{ color: T3 }} />
                        <textarea
                          value={noteInputs[request.id] || ''}
                          onChange={(e) => setNoteInputs(prev => ({ ...prev, [request.id]: e.target.value }))}
                          placeholder={t('vipPlacement.notePlaceholder')}
                          rows={2}
                          className="w-full rounded-xl px-3 py-2 text-[13px] outline-none resize-none transition-all duration-150"
                          style={{ background: INNER_BG, border: `1px solid ${BORDER}`, color: T1 }}
                          onFocus={(e) => (e.target.style.borderColor = 'rgba(255,255,255,0.18)')}
                          onBlur={(e) => (e.target.style.borderColor = BORDER)}
                        />
                      </div>
                    </div>
                  )}

                  <div className="flex gap-2 mt-3 pt-3" style={{ borderTop: `1px solid ${F_BORDER}` }}>
                    <VipButton variant="primary" full size="sm" onClick={() => handleAction(request.id, 'approve', noteInputs[request.id])} disabled={isProcessing}>
                      <Check className="w-3.5 h-3.5" />
                      {t('vipPlacement.approve')}
                    </VipButton>

                    {floorPlan && (
                      <VipButton variant="secondary" size="sm" onClick={() => setModifyingRequest(request)} disabled={isProcessing} title={t('vipPlacement.modify')}>
                        <Edit className="w-3.5 h-3.5" />
                        <span className="hidden sm:inline">{t('vipPlacement.modify')}</span>
                      </VipButton>
                    )}

                    <VipButton variant="secondary" size="sm" onClick={() => handleAction(request.id, 'assign_on_arrival', noteInputs[request.id])} disabled={isProcessing} title={t('vipPlacement.assignOnArrival')}>
                      <ArrowRightLeft className="w-3.5 h-3.5" />
                    </VipButton>

                    <VipButton variant={showNote ? 'secondary' : 'ghost'} size="sm" onClick={() => setShowNoteFor(showNote ? null : request.id)} title={t('vipPlacement.notePlaceholder')}>
                      <MessageSquare className="w-3.5 h-3.5" />
                    </VipButton>

                    <VipButton variant="danger" size="sm" onClick={() => handleAction(request.id, 'reject', noteInputs[request.id])} disabled={isProcessing}>
                      <X className="w-3.5 h-3.5" />
                    </VipButton>
                  </div>
                </>
              )}

              {/* Re-place button for already processed requests */}
              {canReplace && floorPlan && (
                <div className="flex gap-2 mt-3 pt-3" style={{ borderTop: `1px solid ${F_BORDER}` }}>
                  <VipButton variant="secondary" size="sm" onClick={() => setModifyingRequest(request)} disabled={isProcessing}>
                    <Edit className="w-3.5 h-3.5" />
                    {t('vipPlacement.modify')}
                  </VipButton>
                </div>
              )}
            </VipCard>
          );
        })}
      </div>

      {/* Placement modification floor plan sheet */}
      <PlacementFloorPlanSheet
        open={!!modifyingRequest}
        onClose={() => setModifyingRequest(null)}
        reservation={modifyingRequest ? {
          id: modifyingRequest.id,
          fullName: modifyingRequest.fullName,
          guestCount: modifyingRequest.guestCount,
          zoneName: modifyingRequest.zoneName,
          requestedTableId: modifyingRequest.requestedTableId,
          requestedTableName: modifyingRequest.requestedTableName,
        } : null}
        floorPlan={floorPlan || null}
        reservations={reservations}
        onRefresh={onRefresh}
      />
    </>
  );
}
