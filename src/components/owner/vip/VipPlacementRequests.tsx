import { useState } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { useLanguage } from '@/contexts/LanguageContext';
import { VenueFloorPlan, VipReservation } from '@/types';
import { PlacementFloorPlanSheet, type PlacementSheetReservation } from './PlacementFloorPlanSheet';
import { TableCancelDialog } from './TableCancelDialog';
import { useTableCancelRight } from '@/hooks/useTableCancelRight';
import { PlacementAdjustmentLine, TableMoneyBlock } from './TableMoneyBlock';
import { toast } from 'sonner';
import { Check, MapPin, Users, ArrowRightLeft, Clock, MessageSquare, Edit, Ban } from 'lucide-react';
import {
  VipCard, VipButton, VipPill, VipEmpty, type PillTone,
  T1, T3, F_BORDER, INNER_BG, BORDER,
} from './vip-ui';
import type { OwnerVipReservation } from '@/hooks/useOwnerVipData';
import { setTablePlacement, sendTableChangedEmail, saveReservationNote } from '@/lib/vipTableApi';

export interface PlacementRequest {
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
  /** La réservation entière : argent, formule, droit d'annuler. */
  reservation: OwnerVipReservation;
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
  // Plus produit depuis D2 (« refuser » n'existe plus) : lu pour les anciennes lignes.
  rejected: { label: 'vipPlacement.rejected', tone: 'danger' },
  assign_on_arrival: { label: 'vipPlacement.assignOnArrival', tone: 'muted' },
};

export function VipPlacementRequests({ requests, onRefresh, floorPlan, reservations = [] }: VipPlacementRequestsProps) {
  const { t } = useLanguage();
  const [processing, setProcessing] = useState<string | null>(null);
  const [sheet, setSheet] = useState<{ request: PlacementRequest; mode: 'propose' | 'move' } | null>(null);
  const [cancelFor, setCancelFor] = useState<OwnerVipReservation | null>(null);
  const [noteInputs, setNoteInputs] = useState<Record<string, string>>({});
  const [showNoteFor, setShowNoteFor] = useState<string | null>(null);

  const handleAction = async (request: PlacementRequest, action: 'assign_requested' | 'on_arrival') => {
    setProcessing(request.id);
    try {
      const res = await setTablePlacement({
        reservationId: request.id,
        action: action === 'assign_requested' ? 'assign' : 'on_arrival',
        tableId: action === 'assign_requested' ? request.requestedTableId : null,
        expectedPlacementStatus: request.placementStatus,
      });
      if (!res.ok) {
        toast.error(t(res.error.key));
        // Un collègue est déjà passé (ou la table est prise) : on relit la liste.
        if (res.error.refresh) onRefresh();
        return;
      }
      const note = noteInputs[request.id]?.trim();
      const noteSaved = note ? await saveReservationNote(request.id, note) : true;
      // E-mail « ta table change » : seulement quand le serveur le décide (table finale ≠ celle que le client croit avoir).
      const emailError = res.notify === 'table_changed' ? await sendTableChangedEmail(request.id) : null;
      toast.success(t('vipPlacement.actionSuccess'));
      if (!noteSaved) toast.warning(t('tblg.noteNotSaved'));
      if (emailError) toast.warning(`${t('tblg.emailNotSent')} ${t(emailError.key)}`);
      setShowNoteFor(null);
      setNoteInputs(prev => { const { [request.id]: _drop, ...rest } = prev; return rest; });
      onRefresh();
    } finally {
      setProcessing(null);
    }
  };

  if (requests.length === 0) {
    return <VipEmpty icon={MapPin} title={t('vipPlacement.noRequests')} />;
  }

  const sheetReservation: PlacementSheetReservation | null = sheet ? {
    id: sheet.request.id,
    fullName: sheet.request.fullName,
    guestCount: sheet.request.guestCount,
    zoneName: sheet.request.zoneName,
    packId: sheet.request.reservation.packId,
    requestedTableId: sheet.request.requestedTableId,
    requestedTableName: sheet.request.requestedTableName,
    assignedTableId: sheet.request.reservation.assignedTableId,
    placementStatus: sheet.request.placementStatus,
  } : null;

  return (
    <>
      <div className="space-y-3">
        {requests.map((request) => (
          <RequestCard
            key={request.id}
            request={request}
            processing={processing === request.id}
            canPlan={!!floorPlan}
            showNote={showNoteFor === request.id}
            note={noteInputs[request.id] || ''}
            onNote={(v) => setNoteInputs(prev => ({ ...prev, [request.id]: v }))}
            onToggleNote={() => setShowNoteFor(showNoteFor === request.id ? null : request.id)}
            onAssignRequested={() => handleAction(request, 'assign_requested')}
            onOnArrival={() => handleAction(request, 'on_arrival')}
            onPropose={() => setSheet({ request, mode: 'propose' })}
            onMove={() => setSheet({ request, mode: 'move' })}
            onCancel={() => setCancelFor(request.reservation)}
          />
        ))}
      </div>

      <PlacementFloorPlanSheet
        open={!!sheet}
        onClose={() => setSheet(null)}
        mode={sheet?.mode}
        reservation={sheetReservation}
        floorPlan={floorPlan || null}
        reservations={reservations}
        onRefresh={onRefresh}
      />

      <TableCancelDialog
        reservation={cancelFor}
        open={!!cancelFor}
        onClose={() => setCancelFor(null)}
        onChanged={onRefresh}
      />
    </>
  );
}

interface RequestCardProps {
  request: PlacementRequest;
  processing: boolean;
  canPlan: boolean;
  showNote: boolean;
  note: string;
  onNote: (v: string) => void;
  onToggleNote: () => void;
  onAssignRequested: () => void;
  onOnArrival: () => void;
  onPropose: () => void;
  onMove: () => void;
  onCancel: () => void;
}

function RequestCard(p: RequestCardProps) {
  const { t } = useLanguage();
  const { request } = p;
  const r = request.reservation;
  const status = statusBadge[request.placementStatus] || statusBadge.requested;
  const isPending = request.placementStatus === 'requested';
  const canReplace = ['approved', 'modified', 'assign_on_arrival', 'rejected'].includes(request.placementStatus);
  const canCancel = useTableCancelRight(r, true);
  const cancelLabel = r.hasOnlinePayment ? t('tblg.cancelRefund') : t('tblg.cancelReservation');
  const hasAdjustment = r.placementAdjustment === 'upgrade_free' || r.placementAdjustment === 'pay_on_site';

  return (
    <VipCard style={{ padding: 16 }}>
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
                <div className="w-2 h-2 rounded-full" style={{ background: request.zoneColor || 'var(--tx-666666)' }} />
                {request.zoneName}
              </span>
            )}
            {request.requestedTableName && (
              <span className="flex items-center gap-1">
                <MapPin className="w-3 h-3" />
                {t('tblg.requestedTable')} {request.requestedTableName}
              </span>
            )}
            <span className="flex items-center gap-1 tabular-nums">
              <Clock className="w-3 h-3" />
              {new Date(request.createdAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
            </span>
          </div>
          {hasAdjustment && (
            <p style={{ color: T3, fontSize: 11.5 }}>
              <PlacementAdjustmentLine adjustment={r.placementAdjustment} amount={r.placementAdjustmentAmount} />
            </p>
          )}
        </div>
      </div>

      <div className="mt-3"><TableMoneyBlock reservation={r} compact /></div>

      {p.showNote && (
        <div className="mt-3 pt-3" style={{ borderTop: `1px solid ${F_BORDER}` }}>
          <div className="flex items-start gap-2">
            <MessageSquare className="w-4 h-4 mt-2 shrink-0" style={{ color: T3 }} />
            <textarea
              value={p.note}
              onChange={(e) => p.onNote(e.target.value)}
              placeholder={t('vipPlacement.notePlaceholder')}
              rows={2}
              className="w-full rounded-xl px-3 py-2 text-[13px] outline-none resize-none transition-all duration-150"
              style={{ background: INNER_BG, border: `1px solid ${BORDER}`, color: T1 }}
              onFocus={(e) => (e.target.style.borderColor = 'rgb(var(--ink)/0.18)')}
              onBlur={(e) => (e.target.style.borderColor = BORDER)}
            />
          </div>
        </div>
      )}

      <div className="flex flex-wrap gap-2 mt-3 pt-3" style={{ borderTop: `1px solid ${F_BORDER}` }}>
        {isPending && request.requestedTableId && (
          <VipButton variant="primary" size="sm" onClick={p.onAssignRequested} disabled={p.processing}>
            <Check className="w-3.5 h-3.5" />
            {t('tblg.assignRequested')}
          </VipButton>
        )}
        {isPending && !request.requestedTableId && p.canPlan && (
          <VipButton variant="primary" size="sm" onClick={p.onPropose} disabled={p.processing}>
            <MapPin className="w-3.5 h-3.5" />
            {t('tblg.assignTable')}
          </VipButton>
        )}
        {isPending && request.requestedTableId && p.canPlan && (
          <VipButton variant="secondary" size="sm" onClick={p.onPropose} disabled={p.processing}>
            <Edit className="w-3.5 h-3.5" />
            {t('tblg.proposeOther')}
          </VipButton>
        )}
        {canReplace && p.canPlan && (
          <VipButton variant="secondary" size="sm" onClick={p.onMove} disabled={p.processing}>
            <Edit className="w-3.5 h-3.5" />
            {t('vipPlacement.modify')}
          </VipButton>
        )}
        {(isPending || r.assignedTableId) && (
          <VipButton variant="secondary" size="sm" onClick={p.onOnArrival} disabled={p.processing}>
            <ArrowRightLeft className="w-3.5 h-3.5" />
            {t('tblg.placeOnArrival')}
          </VipButton>
        )}
        {isPending && (
          <VipButton variant={p.showNote ? 'secondary' : 'ghost'} size="sm" onClick={p.onToggleNote} title={t('vipPlacement.notePlaceholder')}>
            <MessageSquare className="w-3.5 h-3.5" />
          </VipButton>
        )}
        {canCancel && (
          <VipButton variant="danger" size="sm" onClick={p.onCancel} disabled={p.processing}>
            <Ban className="w-3.5 h-3.5" />
            {cancelLabel}
          </VipButton>
        )}
      </div>
    </VipCard>
  );
}
