import { useState } from 'react';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter } from '@/components/ui/dialog';
import { Slider } from '@/components/ui/slider';
import { Sparkles, Lock } from 'lucide-react';
import type { PartnershipSplitRules, VenueOrganizerPartnership } from '@/hooks/useOrganizerPartnerships';
import { getPartnershipProposalStatus } from '@/hooks/useOrganizerPartnerships';
import { OrgButton, OrgPill, RED, T1, T2, T3, BORDER, INNER_BG } from '@/components/org-ui';
import { useLanguage } from '@/contexts/LanguageContext';
import { translate } from '@/i18n/orgTranslate';

interface Props {
  open: boolean;
  onOpenChange: (o: boolean) => void;
  partnership: VenueOrganizerPartnership;
  /** 'organizer' = current viewer is the organizer side; 'venue' = club side */
  side: 'organizer' | 'venue';
  onPropose: (rules: PartnershipSplitRules) => Promise<void> | void;
  isPending?: boolean;
}

const DEFAULT: PartnershipSplitRules = {
  tickets: { organizer_pct: 100, venue_pct: 0 },
  tables: { organizer_pct: 0, venue_pct: 100 },
  drinks: { organizer_pct: 0, venue_pct: 100 },
};

export function PartnershipSplitEditor({ open, onOpenChange, partnership, side, onPropose, isPending }: Props) {
  const current = partnership.default_split_rules ?? DEFAULT;
  const [tickets, setTickets] = useState<number>(current.tickets?.organizer_pct ?? 100);
  const [tables, setTables] = useState<number>(current.tables?.organizer_pct ?? 0);
  // Drinks are non-negotiable: always 100% club (alcohol licence). No slider.

  const { language } = useLanguage();
  const t = (fr: string, en: string, es?: string) => translate(language, fr, en, es);

  const status = getPartnershipProposalStatus(partnership);
  const hasPendingProposal = status !== 'no_proposal';

  const handleSubmit = async () => {
    const rules: PartnershipSplitRules = {
      tickets: { organizer_pct: tickets, venue_pct: 100 - tickets },
      tables: { organizer_pct: tables, venue_pct: 100 - tables },
      drinks: { organizer_pct: 0, venue_pct: 100 },
    };
    await onPropose(rules);
    onOpenChange(false);
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent style={{ background: '#0a0a0c', border: `1px solid ${BORDER}`, borderRadius: 18, maxWidth: 448 }}>
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2" style={{ color: T1, fontSize: 15.5, fontWeight: 600 }}>
            <Sparkles className="h-5 w-5" style={{ color: RED }} />
            {t('Modifier la répartition', 'Edit revenue split', 'Editar el reparto de ingresos')}
          </DialogTitle>
          <DialogDescription style={{ color: T3, fontSize: 12 }}>
            {t('Toute modification doit être acceptée par', 'Any change must be accepted by', 'Cualquier cambio debe ser aceptado por')}{' '}
            {side === 'organizer'
              ? t('le club', 'the club', 'el club')
              : t("l'organisateur", 'the organizer', 'el organizador')}{' '}
            {t("avant d'être appliquée aux futures soirées.", 'before it applies to future events.', 'antes de aplicarse a los próximos eventos.')}
          </DialogDescription>
        </DialogHeader>

        {hasPendingProposal && (
          <div className="flex items-start gap-2 rounded-xl p-3" style={{ border: '1px solid rgba(234,179,8,0.3)', background: 'rgba(234,179,8,0.08)', color: '#FCD34D', fontSize: 13 }}>
            <Lock className="mt-0.5 h-4 w-4 shrink-0" />
            <div>
              {t(
                "Une proposition est déjà en attente. Elle doit être traitée avant d'en faire une nouvelle.",
                'A proposal is already pending. It must be handled before you can make a new one.',
                'Ya hay una propuesta pendiente. Debe resolverse antes de hacer una nueva.',
              )}
            </div>
          </div>
        )}

        <div className="space-y-6 py-2">
          <SplitRow label={t('Billets', 'Tickets', 'Entradas')} organizerPct={tickets} onChange={setTickets} disabled={hasPendingProposal} />
          <SplitRow label={t('Tables / VIP', 'Tables / VIP', 'Mesas / VIP')} organizerPct={tables} onChange={setTables} disabled={hasPendingProposal} />
          <div className="rounded-xl p-3" style={{ background: INNER_BG, border: `1px solid ${BORDER}`, color: T3, fontSize: 11.5 }}>
            🍹 <strong style={{ color: T1 }}>{t('Boissons : 100% club', 'Drinks: 100% club', 'Bebidas: 100% club')}</strong> — {t(
              "le club est le vendeur d'alcool (licence) : les revenus boissons lui reviennent toujours intégralement. Non négociable.",
              'the club is the alcohol seller (licence): drink revenue always goes entirely to the club. Non-negotiable.',
              'el club es el vendedor de alcohol (licencia): los ingresos de bebidas siempre van íntegramente al club. No negociable.',
            )}
          </div>
        </div>

        <DialogFooter>
          <OrgButton variant="ghost" onClick={() => onOpenChange(false)}>{t('Annuler', 'Cancel', 'Cancelar')}</OrgButton>
          <OrgButton variant="primary" onClick={handleSubmit} disabled={isPending || hasPendingProposal}>
            {isPending ? t('Envoi…', 'Sending…', 'Enviando…') : t('Envoyer la proposition', 'Send proposal', 'Enviar la propuesta')}
          </OrgButton>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function SplitRow({
  label,
  organizerPct,
  onChange,
  disabled,
}: {
  label: string;
  organizerPct: number;
  onChange: (v: number) => void;
  disabled?: boolean;
}) {
  const { language } = useLanguage();
  const t = (fr: string, en: string, es?: string) => translate(language, fr, en, es);
  return (
    <div className="space-y-2">
      <div className="flex items-center justify-between">
        <span style={{ color: T1, fontSize: 13, fontWeight: 560 }}>{label}</span>
        <div className="flex items-center gap-2">
          <OrgPill tone="default">{t('Orga', 'Org', 'Org')} {organizerPct}%</OrgPill>
          <OrgPill tone="muted">{t('Club', 'Club', 'Club')} {100 - organizerPct}%</OrgPill>
        </div>
      </div>
      <Slider
        value={[organizerPct]}
        min={0}
        max={100}
        step={5}
        onValueChange={(v) => onChange(v[0])}
        disabled={disabled}
      />
    </div>
  );
}

/**
 * Compact display of pending proposal with accept/decline actions.
 */
export function PartnershipProposalBanner({
  partnership,
  side,
  onAccept,
  onDecline,
  isPending,
}: {
  partnership: VenueOrganizerPartnership;
  side: 'organizer' | 'venue';
  onAccept: () => void;
  onDecline: () => void;
  isPending?: boolean;
}) {
  const { language } = useLanguage();
  const t = (fr: string, en: string, es?: string) => translate(language, fr, en, es);
  const status = getPartnershipProposalStatus(partnership);
  if (status === 'no_proposal' || !partnership.split_proposal) return null;

  const youAlreadyApproved =
    (side === 'organizer' && partnership.split_approved_by_organizer) ||
    (side === 'venue' && partnership.split_approved_by_venue);

  const proposal = partnership.split_proposal;

  return (
    <div className="space-y-2 rounded-xl p-3" style={{ border: '1px solid rgba(232,25,44,0.3)', background: 'rgba(232,25,44,0.05)', fontSize: 13 }}>
      <div className="flex items-center gap-2" style={{ color: RED, fontWeight: 560 }}>
        <Sparkles className="h-4 w-4" />
        {t('Proposition de nouvelle répartition', 'New split proposal', 'Nueva propuesta de reparto')}
      </div>
      <div className="grid grid-cols-3 gap-2">
        <ProposalCell label={t('Billets', 'Tickets', 'Entradas')} o={proposal.tickets.organizer_pct} v={proposal.tickets.venue_pct} />
        <ProposalCell label={t('Tables', 'Tables', 'Mesas')} o={proposal.tables.organizer_pct} v={proposal.tables.venue_pct} />
        <ProposalCell label={t('Boissons', 'Drinks', 'Bebidas')} o={proposal.drinks.organizer_pct} v={proposal.drinks.venue_pct} />
      </div>
      {youAlreadyApproved ? (
        <div style={{ color: T3, fontSize: 11.5 }}>
          {t("✓ Tu as approuvé. En attente de l'autre partie.", '✓ You approved. Waiting for the other party.', '✓ Has aprobado. Esperando a la otra parte.')}
        </div>
      ) : (
        <div className="flex gap-2 pt-1">
          <OrgButton variant="primary" size="sm" onClick={onAccept} disabled={isPending}>{t('Accepter', 'Accept', 'Aceptar')}</OrgButton>
          <OrgButton variant="secondary" size="sm" onClick={onDecline} disabled={isPending}>{t('Refuser', 'Decline', 'Rechazar')}</OrgButton>
        </div>
      )}
    </div>
  );
}

function ProposalCell({ label, o, v }: { label: string; o: number; v: number }) {
  const { language } = useLanguage();
  const t = (fr: string, en: string, es?: string) => translate(language, fr, en, es);
  return (
    <div className="rounded-lg p-2 text-center" style={{ background: INNER_BG, border: `1px solid ${BORDER}` }}>
      <div style={{ color: T3, fontSize: 10, textTransform: 'uppercase', letterSpacing: '0.05em' }}>{label}</div>
      <div className="mt-0.5 font-mono" style={{ color: T2, fontSize: 11.5 }}>{t('Orga', 'Org', 'Org')} {o}% · {t('Club', 'Club', 'Club')} {v}%</div>
    </div>
  );
}
