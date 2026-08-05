import { useEffect, useState } from 'react';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter } from '@/components/ui/dialog';
import { Slider } from '@/components/ui/slider';
import { Switch } from '@/components/ui/switch';
import { supabase } from '@/integrations/supabase/client';
import { Sparkles, Lock } from 'lucide-react';
import type { PartnershipSplitRules, TableSplitBasis, VenueOrganizerPartnership } from '@/hooks/useOrganizerPartnerships';
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
  const [drinks, setDrinks] = useState<number>(current.drinks?.organizer_pct ?? 0);
  // Périmètre du deal : un pilier désactivé ne vend PAS (la vente est refusée
  // au checkout tant qu'un futur accord ne le réintègre pas). Absent = actif.
  const [ticketsOn, setTicketsOn] = useState<boolean>(current.tickets?.enabled !== false);
  const [tablesOn, setTablesOn] = useState<boolean>(current.tables?.enabled !== false);
  const [drinksOn, setDrinksOn] = useState<boolean>(current.drinks?.enabled !== false);
  // Base du partage des tables : acompte en ligne seul (historique) ou total
  // dépensé de la soirée (avec complément réglé au club en fin de soirée).
  const [tablesBasis, setTablesBasis] = useState<TableSplitBasis>(current.tables?.basis === 'total_spend' ? 'total_spend' : 'deposit');
  // Drinks stay 100% club UNLESS the organizer attested their alcohol-sale licence.
  const [orgCanSellAlcohol, setOrgCanSellAlcohol] = useState(false);

  const { language } = useLanguage();
  const t = (fr: string, en: string, es?: string) => translate(language, fr, en, es);

  useEffect(() => {
    let active = true;
    (async () => {
      const { data } = await supabase
        .from('organizer_profiles')
        .select('can_sell_alcohol')
        .eq('user_id', partnership.organizer_user_id)
        .maybeSingle();
      if (active) setOrgCanSellAlcohol(Boolean((data as { can_sell_alcohol?: boolean } | null)?.can_sell_alcohol));
    })();
    return () => { active = false; };
  }, [partnership.organizer_user_id]);

  const status = getPartnershipProposalStatus(partnership);
  const hasPendingProposal = status !== 'no_proposal';

  const handleSubmit = async () => {
    // On n'écrit `enabled` que pour désactiver, et `basis` que hors défaut :
    // les deals inchangés gardent exactement leur forme historique.
    const rules: PartnershipSplitRules = {
      tickets: { organizer_pct: tickets, venue_pct: 100 - tickets, ...(ticketsOn ? {} : { enabled: false }) },
      tables: {
        organizer_pct: tables,
        venue_pct: 100 - tables,
        ...(tablesOn ? {} : { enabled: false }),
        ...(tablesBasis === 'total_spend' ? { basis: 'total_spend' as TableSplitBasis } : {}),
      },
      drinks: orgCanSellAlcohol
        ? { organizer_pct: drinks, venue_pct: 100 - drinks, ...(drinksOn ? {} : { enabled: false }) }
        : { organizer_pct: 0, venue_pct: 100, ...(drinksOn ? {} : { enabled: false }) },
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
          <SplitRow
            label={t('Billets', 'Tickets', 'Entradas')}
            organizerPct={tickets}
            onChange={setTickets}
            enabled={ticketsOn}
            onToggle={setTicketsOn}
            disabled={hasPendingProposal}
          />
          <div className="space-y-2">
            <SplitRow
              label={t('Tables / VIP', 'Tables / VIP', 'Mesas / VIP')}
              organizerPct={tables}
              onChange={setTables}
              enabled={tablesOn}
              onToggle={setTablesOn}
              disabled={hasPendingProposal}
            />
            {tablesOn && (
              <BasisPicker value={tablesBasis} onChange={setTablesBasis} disabled={hasPendingProposal} />
            )}
          </div>
          {orgCanSellAlcohol ? (
            <SplitRow
              label={t('Boissons', 'Drinks', 'Bebidas')}
              organizerPct={drinks}
              onChange={setDrinks}
              enabled={drinksOn}
              onToggle={setDrinksOn}
              disabled={hasPendingProposal}
            />
          ) : (
            <div className="space-y-2 rounded-xl p-3" style={{ background: INNER_BG, border: `1px solid ${BORDER}`, color: T3, fontSize: 11.5 }}>
              <div className="flex items-center justify-between gap-3">
                <span>
                  🍹 <strong style={{ color: T1 }}>{t('Boissons : 100% club', 'Drinks: 100% club', 'Bebidas: 100% club')}</strong>
                </span>
                <span className="flex items-center gap-2">
                  {!drinksOn && <OrgPill tone="muted">{t('Hors du deal', 'Out of the deal', 'Fuera del acuerdo')}</OrgPill>}
                  <Switch checked={drinksOn} onCheckedChange={setDrinksOn} disabled={hasPendingProposal} />
                </span>
              </div>
              <div>
                {drinksOn
                  ? t(
                    "le club est le vendeur d'alcool (licence). L'organisateur peut attester ses documents légaux d'alcool dans son profil pour négocier une part.",
                    'the club is the alcohol seller (licence). The organizer can attest their alcohol-sale documents in their profile to negotiate a share.',
                    'el club es el vendedor de alcohol (licencia). El organizador puede acreditar sus documentos legales de alcohol en su perfil para negociar una parte.',
                  )
                  : t(
                    'La commande de boissons dans l\'app sera bloquée sur les soirées de cette collaboration.',
                    'In-app drink orders will be blocked on this collaboration\'s events.',
                    'Los pedidos de bebidas en la app quedarán bloqueados en los eventos de esta colaboración.',
                  )}
              </div>
            </div>
          )}
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
  enabled,
  onToggle,
  disabled,
}: {
  label: string;
  organizerPct: number;
  onChange: (v: number) => void;
  /** Pilier dans le périmètre du deal ? false = vente bloquée au checkout. */
  enabled: boolean;
  onToggle: (v: boolean) => void;
  disabled?: boolean;
}) {
  const { language } = useLanguage();
  const t = (fr: string, en: string, es?: string) => translate(language, fr, en, es);
  return (
    <div className="space-y-2">
      <div className="flex items-center justify-between gap-3">
        <span className="flex items-center gap-2">
          <Switch checked={enabled} onCheckedChange={onToggle} disabled={disabled} />
          <span style={{ color: enabled ? T1 : T3, fontSize: 13, fontWeight: 560 }}>{label}</span>
        </span>
        <div className="flex items-center gap-2">
          {enabled ? (
            <>
              <OrgPill tone="default">{t('Orga', 'Org', 'Org')} {organizerPct}%</OrgPill>
              <OrgPill tone="muted">{t('Club', 'Club', 'Club')} {100 - organizerPct}%</OrgPill>
            </>
          ) : (
            <OrgPill tone="muted">{t('Hors du deal — vente bloquée', 'Out of the deal — sales blocked', 'Fuera del acuerdo — venta bloqueada')}</OrgPill>
          )}
        </div>
      </div>
      {enabled && (
        <Slider
          value={[organizerPct]}
          min={0}
          max={100}
          step={5}
          onValueChange={(v) => onChange(v[0])}
          disabled={disabled}
        />
      )}
    </div>
  );
}

/**
 * Base du partage des tables. 'deposit' : seul l'acompte payé en ligne est
 * partagé via Stripe (comportement historique). 'total_spend' : le partage
 * porte sur le TOTAL dépensé de la soirée (acompte + solde sur place + extras) ;
 * l'acompte reste partagé via Stripe et le complément est calculé automatiquement
 * en fin de soirée, réglé par virement club → organisateur avec double
 * vérification (comme le règlement promoteur).
 */
function BasisPicker({ value, onChange, disabled }: { value: TableSplitBasis; onChange: (v: TableSplitBasis) => void; disabled?: boolean }) {
  const { language } = useLanguage();
  const t = (fr: string, en: string, es?: string) => translate(language, fr, en, es);
  const options: { key: TableSplitBasis; label: string }[] = [
    { key: 'deposit', label: t('Acompte en ligne', 'Online deposit', 'Anticipo en línea') },
    { key: 'total_spend', label: t('Total dépensé', 'Total spend', 'Gasto total') },
  ];
  return (
    <div className="space-y-1.5 rounded-xl p-3" style={{ background: INNER_BG, border: `1px solid ${BORDER}` }}>
      <p style={{ color: T2, fontSize: 11.5, fontWeight: 560 }}>
        {t('Base du partage', 'Split basis', 'Base del reparto')}
      </p>
      <div className="flex gap-2">
        {options.map((o) => (
          <button
            key={o.key}
            type="button"
            disabled={disabled}
            onClick={() => onChange(o.key)}
            className="flex-1 rounded-lg px-3 py-2 transition-colors"
            style={{
              fontSize: 12,
              color: value === o.key ? T1 : T3,
              background: value === o.key ? 'rgba(232,25,44,0.12)' : 'transparent',
              border: `1px solid ${value === o.key ? 'rgba(232,25,44,0.4)' : BORDER}`,
            }}
          >
            {o.label}
          </button>
        ))}
      </div>
      <p style={{ color: T3, fontSize: 10.5, lineHeight: 1.45 }}>
        {value === 'total_spend'
          ? t(
            "Le % s'applique au total dépensé de la soirée (acompte + solde sur place + extras). Le complément dû à l'organisateur est calculé automatiquement en fin de soirée et réglé par virement, avec double vérification.",
            'The % applies to the night\'s total spend (deposit + on-site balance + extras). The top-up owed to the organizer is computed automatically after the night and settled by bank transfer, with two-step verification.',
            'El % se aplica al gasto total de la noche (anticipo + saldo en el local + extras). El complemento debido al organizador se calcula automáticamente al final de la noche y se liquida por transferencia, con doble verificación.',
          )
          : t(
            "Le % ne s'applique qu'à l'acompte payé en ligne, partagé automatiquement via Stripe. Ce qui se dépense sur place reste au club.",
            'The % only applies to the online deposit, split automatically via Stripe. On-site spending stays with the club.',
            'El % solo se aplica al anticipo pagado en línea, repartido automáticamente vía Stripe. Lo gastado en el local queda para el club.',
          )}
      </p>
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
        <ProposalCell label={t('Billets', 'Tickets', 'Entradas')} block={proposal.tickets} />
        <ProposalCell label={t('Tables', 'Tables', 'Mesas')} block={proposal.tables} />
        <ProposalCell label={t('Boissons', 'Drinks', 'Bebidas')} block={proposal.drinks} />
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

function ProposalCell({ label, block }: { label: string; block: { organizer_pct: number; venue_pct: number; enabled?: boolean; basis?: string } }) {
  const { language } = useLanguage();
  const t = (fr: string, en: string, es?: string) => translate(language, fr, en, es);
  const off = block.enabled === false;
  return (
    <div className="rounded-lg p-2 text-center" style={{ background: INNER_BG, border: `1px solid ${BORDER}` }}>
      <div style={{ color: T3, fontSize: 10, textTransform: 'uppercase', letterSpacing: '0.05em' }}>{label}</div>
      {off ? (
        <div className="mt-0.5" style={{ color: T3, fontSize: 11.5 }}>{t('Hors du deal', 'Out of the deal', 'Fuera del acuerdo')}</div>
      ) : (
        <>
          <div className="mt-0.5 font-mono" style={{ color: T2, fontSize: 11.5 }}>{t('Orga', 'Org', 'Org')} {block.organizer_pct}% · {t('Club', 'Club', 'Club')} {block.venue_pct}%</div>
          {block.basis === 'total_spend' && (
            <div style={{ color: T3, fontSize: 9.5 }}>{t('sur total dépensé', 'on total spend', 'sobre gasto total')}</div>
          )}
        </>
      )}
    </div>
  );
}
