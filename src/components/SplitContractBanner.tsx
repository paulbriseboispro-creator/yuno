import { useState, useEffect } from 'react';
import { useEventCollabContract } from '@/hooks/useEventCollabContract';
import { Button } from '@/components/ui/button';
import { Slider } from '@/components/ui/slider';
import { supabase } from '@/integrations/supabase/client';
import { downloadContractPDF } from '@/lib/generateContractPDF';
import { loadCollabContractPdfData } from '@/lib/collabContractData';
import { CollabContractTermsDialog } from '@/components/CollabContractTermsDialog';
import { AlertTriangle, CheckCircle2, Lock, PenLine, Download, FileSignature, Pencil, Banknote } from 'lucide-react';
import type { PartnershipSplitRules } from '@/hooks/useOrganizerPartnerships';
import { normalizeSplitRules } from '@/lib/splitRules';
import { computeYunoFee } from '@/utils/coEventSplit';
import { useLanguage } from '@/contexts/LanguageContext';
import { translate } from '@/i18n/orgTranslate';

interface Props {
  eventId: string;
  /** Which side the current viewer is. 'organizer' on the org event page, 'venue' on the club page. */
  side?: 'venue' | 'organizer';
}

/** Reference amounts for the € examples when the event has no priced items yet. */
const FALLBACK_TICKET_PRICE = 15;
const FALLBACK_TABLE_PRICE = 500;

const formatEur = (n: number) =>
  new Intl.NumberFormat('fr-FR', { style: 'currency', currency: 'EUR' }).format(n);

/**
 * Club ↔ organizer collaboration CONTRACT surface (event-level).
 * Propose the revenue split, sign bilaterally, then download the signed PDF.
 * Sales stay blocked (CONTRACT GUARD) until both parties sign. Either party can
 * also AMEND the split before a sale locks it — that resets signatures and sends
 * the other party a fresh verification.
 */
export function SplitContractBanner({ eventId, side }: Props) {
  const { contract, status, iSigned, partnerSigned, isMyTurn, create, sign, cancel, amend } =
    useEventCollabContract(eventId, side);
  const { language } = useLanguage();
  const t = (fr: string, en: string, es?: string) => translate(language, fr, en, es);
  const [editing, setEditing] = useState(false);
  const [signDialogOpen, setSignDialogOpen] = useState(false);
  const [ticketsOrg, setTicketsOrg] = useState(50);
  const [tablesOrg, setTablesOrg] = useState(0);
  const [drinksOrg, setDrinksOrg] = useState(0);
  // Drinks stay 100% club UNLESS the organizer attested their alcohol-sale licence.
  const [orgCanSellAlcohol, setOrgCanSellAlcohol] = useState(false);
  const [isBde, setIsBde] = useState(false);
  // Real event prices feed the € examples; fallbacks keep the example honest
  // ("exemple" is always displayed) when nothing is priced yet.
  const [ticketPrice, setTicketPrice] = useState<number | null>(null);
  const [tablePrice, setTablePrice] = useState<number | null>(null);

  useEffect(() => {
    let active = true;
    (async () => {
      const { data: ev } = await supabase
        .from('events')
        .select('organizer_user_id, partner_organizer_id, is_bde')
        .eq('id', eventId)
        .maybeSingle();
      if (active) setIsBde(Boolean((ev as { is_bde?: boolean } | null)?.is_bde));
      const orgId = (ev as { organizer_user_id?: string | null; partner_organizer_id?: string | null } | null)
        ?.organizer_user_id ?? (ev as { partner_organizer_id?: string | null } | null)?.partner_organizer_id;
      if (!orgId) { if (active) setOrgCanSellAlcohol(false); }
      else {
        const { data: op } = await supabase
          .from('organizer_profiles')
          .select('can_sell_alcohol')
          .eq('user_id', orgId)
          .maybeSingle();
        if (active) setOrgCanSellAlcohol(Boolean((op as { can_sell_alcohol?: boolean } | null)?.can_sell_alcohol));
      }
      // Prix réels pour les exemples chiffrés (meilleure vente billets + pack table).
      const [{ data: round }, { data: pack }] = await Promise.all([
        supabase.from('ticket_rounds').select('price').eq('event_id', eventId).eq('is_active', true)
          .order('position', { ascending: true }).limit(1).maybeSingle(),
        supabase.from('table_packs').select('base_price').eq('event_id', eventId).eq('is_active', true)
          .order('base_price', { ascending: true }).limit(1).maybeSingle(),
      ]);
      if (active) {
        const rp = Number((round as { price?: number } | null)?.price ?? 0);
        const pp = Number((pack as { base_price?: number } | null)?.base_price ?? 0);
        setTicketPrice(rp > 0 ? rp : null);
        setTablePrice(pp > 0 ? pp : null);
      }
    })();
    return () => { active = false; };
  }, [eventId]);

  const card = 'rounded-xl border p-4 text-sm';

  const buildRules = (): PartnershipSplitRules => ({
    tickets: { organizer_pct: ticketsOrg, venue_pct: 100 - ticketsOrg },
    tables: { organizer_pct: tablesOrg, venue_pct: 100 - tablesOrg },
    drinks: orgCanSellAlcohol
      ? { organizer_pct: drinksOrg, venue_pct: 100 - drinksOrg }
      : { organizer_pct: 0, venue_pct: 100 },
  });

  const handlePropose = () => create.mutate({ rules: buildRules() }, { onSuccess: () => setEditing(false) });
  const handleAmend = () => amend.mutate({ rules: buildRules() }, { onSuccess: () => setEditing(false) });

  // Open the editor pre-filled with whatever the split currently is.
  const startEdit = (prefill?: { tickets: { organizer_pct: number }; tables: { organizer_pct: number }; drinks: { organizer_pct: number } }) => {
    if (prefill) {
      setTicketsOrg(prefill.tickets.organizer_pct);
      setTablesOrg(prefill.tables.organizer_pct);
      setDrinksOrg(prefill.drinks.organizer_pct);
    }
    setEditing(true);
  };

  /** Exemple chiffré : « billet à 15 € → Orga 7,04 € · Club 7,04 € (net après frais Yuno) ». */
  const euroExample = (type: 'ticket' | 'table', orgPct: number): string => {
    const amount = type === 'ticket' ? (ticketPrice ?? FALLBACK_TICKET_PRICE) : (tablePrice ?? FALLBACK_TABLE_PRICE);
    const net = amount - computeYunoFee(type, amount, isBde);
    const orgShare = Math.round((net * orgPct) / 100 * 100) / 100;
    const venueShare = Math.round((net - orgShare) * 100) / 100;
    const label = type === 'ticket'
      ? t('billet à', 'ticket at', 'entrada a')
      : t('table à', 'table at', 'mesa a');
    return `${t('Ex.', 'E.g.', 'Ej.')} ${label} ${formatEur(amount)} → ${t('Orga', 'Organizer', 'Orga')} ${formatEur(orgShare)} · Club ${formatEur(venueShare)}`;
  };

  const splitRecap = (rules: { tickets: { organizer_pct: number; venue_pct: number }; tables: { organizer_pct: number; venue_pct: number }; drinks: { organizer_pct: number; venue_pct: number } }) => (
    <ul className="mt-2 text-xs text-muted-foreground space-y-1">
      <li>
        {t('Billets', 'Tickets', 'Entradas')} : {rules.tickets.organizer_pct}% {t('orga', 'organizer', 'orga')} / {rules.tickets.venue_pct}% club
        <span className="block text-[11px] opacity-80">{euroExample('ticket', rules.tickets.organizer_pct)}</span>
      </li>
      <li>
        Tables : {rules.tables.organizer_pct}% {t('orga', 'organizer', 'orga')} / {rules.tables.venue_pct}% club
        <span className="block text-[11px] opacity-80">{euroExample('table', rules.tables.organizer_pct)}</span>
      </li>
      <li>
        {t('Boissons', 'Drinks', 'Bebidas')} : {rules.drinks.organizer_pct}% {t('orga', 'organizer', 'orga')} / {rules.drinks.venue_pct}% club
      </li>
    </ul>
  );

  const payoutNote = (
    <p className="flex items-start gap-1.5 text-[11px] text-muted-foreground mt-1">
      <Banknote className="h-3.5 w-3.5 shrink-0 mt-0.5" />
      {t(
        'Encaissement sécurisé par Yuno : chaque partie reçoit sa part automatiquement sur son compte Stripe, environ 48 h après la fin de la soirée (fenêtre de remboursement).',
        'Payments are held securely by Yuno: each party automatically receives their share on their Stripe account, about 48 h after the event ends (refund window).',
        'Yuno retiene los cobros de forma segura: cada parte recibe su parte automáticamente en su cuenta de Stripe, unas 48 h después del final del evento (ventana de reembolso).',
      )}
    </p>
  );

  const editorBody = (submitLabel: string, onSubmit: () => void, pending: boolean) => (
    <div className="ml-8 space-y-4">
      <SplitRow label={t('Billets', 'Tickets', 'Entradas')} org={ticketsOrg} onChange={setTicketsOrg}
        example={euroExample('ticket', ticketsOrg)} orgLabel={t('Orga', 'Organizer', 'Orga')} />
      <SplitRow label="Tables / VIP" org={tablesOrg} onChange={setTablesOrg}
        example={euroExample('table', tablesOrg)} orgLabel={t('Orga', 'Organizer', 'Orga')} />
      {orgCanSellAlcohol ? (
        <>
          <SplitRow label={t('Boissons', 'Drinks', 'Bebidas')} org={drinksOrg} onChange={setDrinksOrg}
            orgLabel={t('Orga', 'Organizer', 'Orga')} />
          <p className="text-xs text-muted-foreground">
            🍹 {t(
              "L'organisateur a attesté ses documents de vente d'alcool — la part boissons est négociable.",
              'The organizer attested their alcohol-sale documents — the drinks share is negotiable.',
              'El organizador acreditó sus documentos de venta de alcohol: la parte de bebidas es negociable.',
            )}
          </p>
        </>
      ) : (
        <p className="text-xs text-muted-foreground">
          🍹 {t(
            "Boissons : 100% club (vendeur d'alcool). L'organisateur peut attester ses documents légaux d'alcool dans son profil pour négocier une part.",
            'Drinks: 100% club (alcohol merchant of record). The organizer can attest their legal alcohol documents in their profile to negotiate a share.',
            'Bebidas: 100% club (vendedor de alcohol). El organizador puede acreditar sus documentos legales de alcohol en su perfil para negociar una parte.',
          )}
        </p>
      )}
      {payoutNote}
      <div className="flex gap-2">
        <Button size="sm" onClick={onSubmit} disabled={pending}>{pending ? t('Envoi…', 'Sending…', 'Enviando…') : submitLabel}</Button>
        <Button size="sm" variant="outline" onClick={() => setEditing(false)}>{t('Annuler', 'Cancel', 'Cancelar')}</Button>
      </div>
    </div>
  );

  const handleDownload = async () => {
    if (!contract) return;
    downloadContractPDF(await loadCollabContractPdfData(contract, language));
  };

  // ── No contract yet → propose ──
  if (status === 'no_contract' || status === 'cancelled') {
    if (!side) return null;
    return (
      <div className={`${card} border-border/40 bg-muted/30 flex flex-col gap-3`}>
        <div className="flex items-start gap-3">
          <FileSignature className="h-5 w-5 text-muted-foreground shrink-0 mt-0.5" />
          <div>
            <p className="font-semibold text-foreground">{t('Contrat de collaboration', 'Collaboration agreement', 'Contrato de colaboración')}</p>
            <p className="text-muted-foreground">
              {t(
                'Définis la répartition des revenus et propose le contrat. Les ventes restent fermées tant que les deux parties n\'ont pas signé.',
                'Set the revenue split and propose the agreement. Sales stay closed until both parties have signed.',
                'Define el reparto de ingresos y propone el contrato. Las ventas permanecen cerradas hasta que ambas partes firmen.',
              )}
            </p>
          </div>
        </div>
        {!editing ? (
          <Button size="sm" className="self-start ml-8" onClick={() => setEditing(true)}>
            {t('Proposer le contrat', 'Propose the agreement', 'Proponer el contrato')}
          </Button>
        ) : (
          editorBody(t('Envoyer la proposition', 'Send the proposal', 'Enviar la propuesta'), handlePropose, create.isPending)
        )}
      </div>
    );
  }

  if (!contract) return null;
  // Normalize: contracts created from legacy recurring templates / flat partnership
  // defaults store a flat { organizer, venue } shape that lacks .tickets/.tables.
  // Reading those directly white-screened the collab dashboard — normalize first.
  const rules = normalizeSplitRules(contract.split_rules) ?? {
    tickets: { organizer_pct: 0, venue_pct: 100 },
    tables: { organizer_pct: 0, venue_pct: 100 },
    drinks: { organizer_pct: 0, venue_pct: 100 },
  };

  // ── Pending signatures ──
  if (status === 'pending_signatures') {
    return (
      <div className={`${card} border-amber-500/30 bg-amber-500/10 flex flex-col gap-3`}>
        <div className="flex items-start gap-3">
          <AlertTriangle className="h-5 w-5 text-amber-500 shrink-0 mt-0.5" />
          <div>
            <p className="font-semibold text-foreground">{t('Contrat en attente de signature', 'Agreement awaiting signature', 'Contrato pendiente de firma')}</p>
            <p className="text-muted-foreground">
              {isMyTurn
                ? t(
                    'Signe le contrat pour ouvrir les ventes. Les deux parties doivent signer.',
                    'Sign the agreement to open sales. Both parties must sign.',
                    'Firma el contrato para abrir las ventas. Ambas partes deben firmar.',
                  )
                : iSigned && !partnerSigned
                  ? t(
                      'Tu as signé. En attente de la signature du partenaire — les ventes restent fermées.',
                      'You have signed. Waiting for your partner\'s signature — sales stay closed.',
                      'Has firmado. A la espera de la firma de tu socio: las ventas siguen cerradas.',
                    )
                  : t(
                      'En attente de signature. Les ventes restent fermées tant qu\'il n\'y a pas double signature.',
                      'Awaiting signature. Sales stay closed until both parties have signed.',
                      'Pendiente de firma. Las ventas siguen cerradas hasta la doble firma.',
                    )}
            </p>
            {splitRecap(rules)}
            {payoutNote}
          </div>
        </div>
        {editing ? (
          editorBody(t('Envoyer la modification', 'Send the amendment', 'Enviar la modificación'), handleAmend, amend.isPending)
        ) : (
          <div className="flex flex-wrap gap-2 pl-8">
            {isMyTurn && (
              <Button size="sm" onClick={() => setSignDialogOpen(true)} disabled={sign.isPending}>
                <PenLine className="h-4 w-4 mr-1.5" /> {t('Lire et signer le contrat', 'Read and sign the agreement', 'Leer y firmar el contrato')}
              </Button>
            )}
            {side && (
              <Button size="sm" variant="outline" onClick={() => startEdit(rules)} disabled={amend.isPending}>
                <Pencil className="h-4 w-4 mr-1.5" /> {t('Modifier le contrat', 'Amend the agreement', 'Modificar el contrato')}
              </Button>
            )}
            {side && (
              <Button size="sm" variant="ghost" onClick={() => cancel.mutate()} disabled={cancel.isPending}>
                {t('Annuler', 'Cancel', 'Cancelar')}
              </Button>
            )}
          </div>
        )}
        <CollabContractTermsDialog
          open={signDialogOpen}
          onOpenChange={setSignDialogOpen}
          contract={contract}
          onConfirm={() => sign.mutate(undefined, { onSuccess: () => setSignDialogOpen(false) })}
          confirming={sign.isPending}
        />
      </div>
    );
  }

  // ── Active / locked ──
  if (status === 'active' || status === 'locked' || status === 'closed') {
    const locked = status === 'locked' || status === 'closed';
    return (
      <div className={`${card} ${locked ? 'border-border/40 bg-muted/40' : 'border-emerald-500/30 bg-emerald-500/5'} flex flex-col gap-3`}>
        <div className="flex items-start gap-3">
          {locked ? <Lock className="h-5 w-5 text-muted-foreground shrink-0 mt-0.5" /> : <CheckCircle2 className="h-5 w-5 text-emerald-500 shrink-0 mt-0.5" />}
          <div>
            <p className="font-semibold text-foreground">
              {locked ? t('Contrat verrouillé', 'Agreement locked', 'Contrato bloqueado') : t('Contrat signé et actif', 'Agreement signed and active', 'Contrato firmado y activo')}
            </p>
            <p className="text-muted-foreground">
              {locked
                ? t(
                    'Une vente a été enregistrée — la répartition ne peut plus changer.',
                    'A sale has been recorded — the split can no longer change.',
                    'Se ha registrado una venta: el reparto ya no puede cambiar.',
                  )
                : t(
                    'Les deux parties ont signé. La répartition s\'applique automatiquement à chaque vente.',
                    'Both parties have signed. The split is applied automatically to every sale.',
                    'Ambas partes han firmado. El reparto se aplica automáticamente a cada venta.',
                  )}
            </p>
            {splitRecap(rules)}
            {payoutNote}
          </div>
        </div>
        {editing && !locked ? (
          editorBody(t('Envoyer la modification', 'Send the amendment', 'Enviar la modificación'), handleAmend, amend.isPending)
        ) : (
          <div className="flex flex-wrap gap-2 ml-8">
            <Button size="sm" variant="outline" onClick={handleDownload}>
              <Download className="h-4 w-4 mr-1.5" /> {t('Télécharger le contrat (PDF)', 'Download the agreement (PDF)', 'Descargar el contrato (PDF)')}
            </Button>
            {side && !locked && (
              <Button size="sm" variant="ghost" onClick={() => startEdit(rules)} disabled={amend.isPending}>
                <Pencil className="h-4 w-4 mr-1.5" /> {t('Modifier le contrat', 'Amend the agreement', 'Modificar el contrato')}
              </Button>
            )}
          </div>
        )}
      </div>
    );
  }

  return null;
}

function SplitRow({ label, org, onChange, example, orgLabel }: {
  label: string;
  org: number;
  onChange: (v: number) => void;
  example?: string;
  orgLabel: string;
}) {
  return (
    <div className="space-y-1.5">
      <div className="flex items-center justify-between text-xs">
        <span className="font-medium text-foreground">{label}</span>
        <span className="text-muted-foreground">{orgLabel} {org}% · Club {100 - org}%</span>
      </div>
      <Slider value={[org]} min={0} max={100} step={5} onValueChange={(v) => onChange(v[0])} />
      {example && <p className="text-[11px] text-muted-foreground">{example}</p>}
    </div>
  );
}
