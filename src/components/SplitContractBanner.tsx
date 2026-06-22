import { useState } from 'react';
import { useEventCollabContract } from '@/hooks/useEventCollabContract';
import { Button } from '@/components/ui/button';
import { Slider } from '@/components/ui/slider';
import { supabase } from '@/integrations/supabase/client';
import { downloadContractPDF } from '@/lib/generateContractPDF';
import { AlertTriangle, CheckCircle2, Lock, PenLine, Download, FileSignature } from 'lucide-react';
import type { PartnershipSplitRules } from '@/hooks/useOrganizerPartnerships';

interface Props {
  eventId: string;
  /** Which side the current viewer is. 'organizer' on the org event page, 'venue' on the club page. */
  side?: 'venue' | 'organizer';
}

/**
 * Club ↔ organizer collaboration CONTRACT surface (event-level).
 * Propose the revenue split, sign bilaterally, then download the signed PDF.
 * Sales stay blocked (CONTRACT GUARD) until both parties sign.
 */
export function SplitContractBanner({ eventId, side }: Props) {
  const { contract, status, iSigned, partnerSigned, isMyTurn, create, sign, cancel } =
    useEventCollabContract(eventId, side);
  const [editing, setEditing] = useState(false);
  const [ticketsOrg, setTicketsOrg] = useState(50);
  const [tablesOrg, setTablesOrg] = useState(0);

  const card = 'rounded-xl border p-4 text-sm';

  const handlePropose = () => {
    const rules: PartnershipSplitRules = {
      tickets: { organizer_pct: ticketsOrg, venue_pct: 100 - ticketsOrg },
      tables: { organizer_pct: tablesOrg, venue_pct: 100 - tablesOrg },
      drinks: { organizer_pct: 0, venue_pct: 100 },
    };
    create.mutate({ rules }, { onSuccess: () => setEditing(false) });
  };

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
      splitRules: contract.split_rules,
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
          <div className="ml-8 space-y-4">
            <SplitRow label="Billets" org={ticketsOrg} onChange={setTicketsOrg} />
            <SplitRow label="Tables / VIP" org={tablesOrg} onChange={setTablesOrg} />
            <p className="text-xs text-muted-foreground">🍹 Boissons : 100% club (vendeur d'alcool — politique Yuno).</p>
            <div className="flex gap-2">
              <Button size="sm" onClick={handlePropose} disabled={create.isPending}>
                {create.isPending ? 'Envoi…' : 'Envoyer la proposition'}
              </Button>
              <Button size="sm" variant="outline" onClick={() => setEditing(false)}>Annuler</Button>
            </div>
          </div>
        )}
      </div>
    );
  }

  if (!contract) return null;
  const rules = contract.split_rules;

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
              <li>Boissons : 100% club</li>
            </ul>
          </div>
        </div>
        <div className="flex gap-2 pl-8">
          {isMyTurn && (
            <Button size="sm" onClick={() => sign.mutate()} disabled={sign.isPending}>
              <PenLine className="h-4 w-4 mr-1.5" /> Signer le contrat
            </Button>
          )}
          {side && (
            <Button size="sm" variant="outline" onClick={() => cancel.mutate()} disabled={cancel.isPending}>Annuler</Button>
          )}
        </div>
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
              <li>Boissons : 100% club</li>
            </ul>
          </div>
        </div>
        <Button size="sm" variant="outline" className="self-start ml-8" onClick={handleDownload}>
          <Download className="h-4 w-4 mr-1.5" /> Télécharger le contrat (PDF)
        </Button>
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
