import { useState, useEffect } from 'react';
import { useEventCollabContract } from '@/hooks/useEventCollabContract';
import { Button } from '@/components/ui/button';
import { Slider } from '@/components/ui/slider';
import { supabase } from '@/integrations/supabase/client';
import { downloadContractPDF } from '@/lib/generateContractPDF';
import { AlertTriangle, CheckCircle2, Lock, PenLine, Download, FileSignature, Pencil } from 'lucide-react';
import type { PartnershipSplitRules } from '@/hooks/useOrganizerPartnerships';
import { normalizeSplitRules } from '@/lib/splitRules';

interface Props {
  eventId: string;
  /** Which side the current viewer is. 'organizer' on the org event page, 'venue' on the club page. */
  side?: 'venue' | 'organizer';
}

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
  const [editing, setEditing] = useState(false);
  const [ticketsOrg, setTicketsOrg] = useState(50);
  const [tablesOrg, setTablesOrg] = useState(0);
  const [drinksOrg, setDrinksOrg] = useState(0);
  // Drinks stay 100% club UNLESS the organizer attested their alcohol-sale licence.
  const [orgCanSellAlcohol, setOrgCanSellAlcohol] = useState(false);

  useEffect(() => {
    let active = true;
    (async () => {
      const { data: ev } = await supabase
        .from('events')
        .select('organizer_user_id, partner_organizer_id')
        .eq('id', eventId)
        .maybeSingle();
      const orgId = (ev as { organizer_user_id?: string | null; partner_organizer_id?: string | null } | null)
        ?.organizer_user_id ?? (ev as { partner_organizer_id?: string | null } | null)?.partner_organizer_id;
      if (!orgId) { if (active) setOrgCanSellAlcohol(false); return; }
      const { data: op } = await supabase
        .from('organizer_profiles')
        .select('can_sell_alcohol')
        .eq('user_id', orgId)
        .maybeSingle();
      if (active) setOrgCanSellAlcohol(Boolean((op as { can_sell_alcohol?: boolean } | null)?.can_sell_alcohol));
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

  const editorBody = (submitLabel: string, onSubmit: () => void, pending: boolean) => (
    <div className="ml-8 space-y-4">
      <SplitRow label="Billets" org={ticketsOrg} onChange={setTicketsOrg} />
      <SplitRow label="Tables / VIP" org={tablesOrg} onChange={setTablesOrg} />
      {orgCanSellAlcohol ? (
        <>
          <SplitRow label="Boissons" org={drinksOrg} onChange={setDrinksOrg} />
          <p className="text-xs text-muted-foreground">🍹 L'organisateur a attesté ses documents de vente d'alcool — la part boissons est négociable.</p>
        </>
      ) : (
        <p className="text-xs text-muted-foreground">🍹 Boissons : 100% club (vendeur d'alcool). L'organisateur peut attester ses documents légaux d'alcool dans son profil pour négocier une part.</p>
      )}
      <div className="flex gap-2">
        <Button size="sm" onClick={onSubmit} disabled={pending}>{pending ? 'Envoi…' : submitLabel}</Button>
        <Button size="sm" variant="outline" onClick={() => setEditing(false)}>Annuler</Button>
      </div>
    </div>
  );

  const handleDownload = async () => {
    if (!contract) return;
    const [{ data: ev }, { data: venue }, { data: org }] = await Promise.all([
      supabase.from('events').select('title, start_at').eq('id', contract.event_id).maybeSingle(),
      supabase.from('venues').select('name').eq('id', contract.venue_id).maybeSingle(),
      supabase.from('profiles').select('*').eq('id', contract.organizer_user_id).maybeSingle(),
    ]);
    const o = org as Record<string, any> | null;
    const orgName = o?.full_name || [o?.first_name, o?.last_name].filter(Boolean).join(' ') || o?.business_name || 'Organisateur';
    downloadContractPDF({
      contractId: contract.id,
      venueName: (venue as any)?.name || 'Club',
      organizerName: orgName,
      eventTitle: (ev as any)?.title,
      eventDate: (ev as any)?.start_at ? new Date((ev as any).start_at) : null,
      splitRules: normalizeSplitRules(contract.split_rules) ?? {
        tickets: { organizer_pct: 0, venue_pct: 100 },
        tables: { organizer_pct: 0, venue_pct: 100 },
        drinks: { organizer_pct: 0, venue_pct: 100 },
      },
      cancellationPolicy: contract.cancellation_policy,
      venueSignedAt: contract.venue_signed_at ? new Date(contract.venue_signed_at) : null,
      venueSignedName: (venue as any)?.name,
      venueSignedIp: contract.venue_signed_ip,
      orgSignedAt: contract.org_signed_at ? new Date(contract.org_signed_at) : null,
      orgSignedName: orgName,
      orgSignedIp: contract.org_signed_ip,
      language: 'fr',
    });
  };

  // ── No contract yet → propose ──
  if (status === 'no_contract' || status === 'cancelled') {
    if (!side) return null;
    return (
      <div className={`${card} border-border/40 bg-muted/30 flex flex-col gap-3`}>
        <div className="flex items-start gap-3">
          <FileSignature className="h-5 w-5 text-muted-foreground shrink-0 mt-0.5" />
          <div>
            <p className="font-semibold text-foreground">Contrat de collaboration</p>
            <p className="text-muted-foreground">Définis la répartition des revenus et propose le contrat. Les ventes restent fermées tant que les deux parties n'ont pas signé.</p>
          </div>
        </div>
        {!editing ? (
          <Button size="sm" className="self-start ml-8" onClick={() => setEditing(true)}>Proposer le contrat</Button>
        ) : (
          editorBody('Envoyer la proposition', handlePropose, create.isPending)
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
            <p className="font-semibold text-foreground">Contrat en attente de signature</p>
            <p className="text-muted-foreground">
              {isMyTurn
                ? 'Signe le contrat pour ouvrir les ventes. Les deux parties doivent signer.'
                : iSigned && !partnerSigned
                  ? 'Tu as signé. En attente de la signature du partenaire — les ventes restent fermées.'
                  : 'En attente de signature. Les ventes restent fermées tant qu\'il n\'y a pas double signature.'}
            </p>
            <ul className="mt-2 text-xs text-muted-foreground space-y-0.5">
              <li>Billets : {rules.tickets.organizer_pct}% orga / {rules.tickets.venue_pct}% club</li>
              <li>Tables : {rules.tables.organizer_pct}% orga / {rules.tables.venue_pct}% club</li>
              <li>Boissons : {rules.drinks.organizer_pct}% orga / {rules.drinks.venue_pct}% club</li>
            </ul>
          </div>
        </div>
        {editing ? (
          editorBody('Envoyer la modification', handleAmend, amend.isPending)
        ) : (
          <div className="flex flex-wrap gap-2 pl-8">
            {isMyTurn && (
              <Button size="sm" onClick={() => sign.mutate()} disabled={sign.isPending}>
                <PenLine className="h-4 w-4 mr-1.5" /> Signer le contrat
              </Button>
            )}
            {side && (
              <Button size="sm" variant="outline" onClick={() => startEdit(rules)} disabled={amend.isPending}>
                <Pencil className="h-4 w-4 mr-1.5" /> Modifier le contrat
              </Button>
            )}
            {side && (
              <Button size="sm" variant="ghost" onClick={() => cancel.mutate()} disabled={cancel.isPending}>Annuler</Button>
            )}
          </div>
        )}
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
            <p className="font-semibold text-foreground">{locked ? 'Contrat verrouillé' : 'Contrat signé et actif'}</p>
            <p className="text-muted-foreground">
              {locked
                ? 'Une vente a été enregistrée — la répartition ne peut plus changer.'
                : 'Les deux parties ont signé. La répartition s\'applique automatiquement à chaque vente.'}
            </p>
            <ul className="mt-2 text-xs text-muted-foreground space-y-0.5">
              <li>Billets : {rules.tickets.organizer_pct}% orga / {rules.tickets.venue_pct}% club</li>
              <li>Tables : {rules.tables.organizer_pct}% orga / {rules.tables.venue_pct}% club</li>
              <li>Boissons : {rules.drinks.organizer_pct}% orga / {rules.drinks.venue_pct}% club</li>
            </ul>
          </div>
        </div>
        {editing && !locked ? (
          editorBody('Envoyer la modification', handleAmend, amend.isPending)
        ) : (
          <div className="flex flex-wrap gap-2 ml-8">
            <Button size="sm" variant="outline" onClick={handleDownload}>
              <Download className="h-4 w-4 mr-1.5" /> Télécharger le contrat (PDF)
            </Button>
            {side && !locked && (
              <Button size="sm" variant="ghost" onClick={() => startEdit(rules)} disabled={amend.isPending}>
                <Pencil className="h-4 w-4 mr-1.5" /> Modifier le contrat
              </Button>
            )}
          </div>
        )}
      </div>
    );
  }

  return null;
}

function SplitRow({ label, org, onChange }: { label: string; org: number; onChange: (v: number) => void }) {
  return (
    <div className="space-y-1.5">
      <div className="flex items-center justify-between text-xs">
        <span className="font-medium text-foreground">{label}</span>
        <span className="text-muted-foreground">Orga {org}% · Club {100 - org}%</span>
      </div>
      <Slider value={[org]} min={0} max={100} step={5} onValueChange={(v) => onChange(v[0])} />
    </div>
  );
}
