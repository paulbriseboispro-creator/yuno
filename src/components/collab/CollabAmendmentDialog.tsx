import { useState } from 'react';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { supabase } from '@/integrations/supabase/client';
import { toast } from 'sonner';
import { useLanguage } from '@/contexts/LanguageContext';
import { translate } from '@/i18n/orgTranslate';
import { FileSignature, ArrowRight, Lock } from 'lucide-react';
import { ResponsibilitiesPicker } from './ResponsibilitiesPicker';
import {
  COLLAB_DOMAINS, normalizeResponsibilities,
  type CollabResponsibilities, type DomainHolder,
} from '@/utils/collabResponsibilities';
import { normalizeSplitRules } from '@/lib/splitRules';
import type { PartnershipSplitRules } from '@/hooks/useOrganizerPartnerships';

const T1 = 'rgba(255,255,255,0.96)';
const T3 = 'rgba(255,255,255,0.36)';
const RED = '#E8192C';
const BORDER = 'rgba(255,255,255,0.085)';
const INNER_BG = 'rgba(255,255,255,0.032)';

export interface AmendmentTarget {
  /** Exactement l'un des deux, comme la contrainte serveur. */
  contractId?: string;
  seriesContractId?: string;
  /** Répartition actuellement en vigueur. */
  responsibilities: unknown;
  splitRules: unknown;
  eventMode: string | null;
  label: string;
  partnerName: string;
  /**
   * Les ventes ont commencé sur cette soirée → le partage des revenus est figé
   * (le serveur refuse un avenant financier, cf. propose_collab_amendment).
   * Sans effet sur les responsabilités.
   */
  splitLocked?: boolean;
  /** Contrat-cadre : l'avenant portera sur toutes les dates à venir. */
  recurring?: boolean;
}

/**
 * Proposer un AVENANT à un contrat de collaboration en vigueur.
 *
 * On ne réécrit jamais le contrat signé : l'avenant est une pièce séparée qui
 * s'empile dessus et ne prend effet qu'à la double signature. Tant que l'autre
 * partie n'a pas contresigné, les conditions actuelles restent en vigueur — le
 * dialogue le dit explicitement, parce qu'une proposition qui a l'air d'un
 * enregistrement est une promesse qu'on ne tient pas.
 */
export function CollabAmendmentDialog({
  open, onOpenChange, target, onDone,
}: {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  target: AmendmentTarget | null;
  onDone?: () => void;
}) {
  const { language } = useLanguage();
  const tt = (fr: string, en: string, es?: string) => translate(language, fr, en, es);

  const current = normalizeResponsibilities(target?.responsibilities, target?.eventMode);
  const currentSplit = normalizeSplitRules(target?.splitRules) ?? null;

  const [resp, setResp] = useState<CollabResponsibilities>(current);
  const [changeSplit, setChangeSplit] = useState(false);
  const [ticketsVenuePct, setTicketsVenuePct] = useState(currentSplit?.tickets.venue_pct ?? 50);
  const [tablesVenuePct, setTablesVenuePct] = useState(currentSplit?.tables.venue_pct ?? 100);
  // Périmètre du deal : un pilier désactivé ne vend pas (garde au checkout).
  // L'avenant est LE chemin pour sortir un pilier du deal ou l'y réintégrer.
  const [ticketsOn, setTicketsOn] = useState(currentSplit?.tickets.enabled !== false);
  const [tablesOn, setTablesOn] = useState(currentSplit?.tables.enabled !== false);
  const [drinksOn, setDrinksOn] = useState(currentSplit?.drinks.enabled !== false);
  // Base du partage tables : acompte en ligne seul, ou total dépensé de la
  // soirée (complément réglé par virement en fin de soirée, double vérif).
  const [tablesBasis, setTablesBasis] = useState<'deposit' | 'total_spend'>(
    currentSplit?.tables.basis === 'total_spend' ? 'total_spend' : 'deposit',
  );
  const [reason, setReason] = useState('');
  const [saving, setSaving] = useState(false);
  const [seeded, setSeeded] = useState<string | null>(null);

  // Réamorcer quand on ouvre le dialogue sur une AUTRE cible.
  const key = target ? (target.contractId ?? target.seriesContractId ?? '') : '';
  if (open && key && seeded !== key) {
    setSeeded(key);
    setResp(current);
    setChangeSplit(false);
    setTicketsVenuePct(currentSplit?.tickets.venue_pct ?? 50);
    setTablesVenuePct(currentSplit?.tables.venue_pct ?? 100);
    setTicketsOn(currentSplit?.tickets.enabled !== false);
    setTablesOn(currentSplit?.tables.enabled !== false);
    setDrinksOn(currentSplit?.drinks.enabled !== false);
    setTablesBasis(currentSplit?.tables.basis === 'total_spend' ? 'total_spend' : 'deposit');
    setReason('');
  }

  if (!target) return null;

  const respChanged = COLLAB_DOMAINS.some(d => resp[d] !== current[d]);
  const splitChanged = changeSplit && (
    ticketsVenuePct !== (currentSplit?.tickets.venue_pct ?? 50)
    || tablesVenuePct !== (currentSplit?.tables.venue_pct ?? 100)
    || ticketsOn !== (currentSplit?.tickets.enabled !== false)
    || tablesOn !== (currentSplit?.tables.enabled !== false)
    || drinksOn !== (currentSplit?.drinks.enabled !== false)
    || tablesBasis !== (currentSplit?.tables.basis === 'total_spend' ? 'total_spend' : 'deposit')
  );
  const nothingToDo = !respChanged && !splitChanged;

  const holderLabel = (h: DomainHolder) =>
    h === 'venue' ? tt('Club', 'Club', 'Club')
      : h === 'organizer' ? target.partnerName || tt('Organisateur', 'Organizer', 'Organizador')
        : tt('Les deux', 'Both', 'Ambos');

  const submit = async () => {
    if (saving || nothingToDo) return;
    setSaving(true);
    try {
      const { data: amendmentId, error } = await supabase.rpc('propose_collab_amendment' as never, {
        p_contract_id: target.contractId ?? null,
        p_series_contract_id: target.seriesContractId ?? null,
        p_responsibilities: respChanged ? resp : null,
        // Les % boissons ne sont jamais proposés ici : ils restent 100 % club
        // tant que l'organisateur n'a pas attesté sa licence, et le serveur
        // réapplique cette règle de toute façon (enforce_drinks_alcohol_gate,
        // qui PRÉSERVE le flag de périmètre). Le périmètre (enabled) et la base
        // tables (basis), eux, se négocient dans l'avenant.
        p_split_rules: splitChanged ? {
          tickets: { organizer_pct: 100 - ticketsVenuePct, venue_pct: ticketsVenuePct, ...(ticketsOn ? {} : { enabled: false }) },
          tables: {
            organizer_pct: 100 - tablesVenuePct,
            venue_pct: tablesVenuePct,
            ...(tablesOn ? {} : { enabled: false }),
            ...(tablesBasis === 'total_spend' ? { basis: 'total_spend' } : {}),
          },
          drinks: {
            organizer_pct: currentSplit?.drinks.organizer_pct ?? 0,
            venue_pct: currentSplit?.drinks.venue_pct ?? 100,
            ...(drinksOn ? {} : { enabled: false }),
          },
        } as PartnershipSplitRules : null,
        p_reason: reason.trim() || null,
        p_user_agent: navigator.userAgent,
      } as never);
      if (error) throw error;

      // Prevenir la partie qui doit contresigner. Best-effort : l'avenant est la
      // source de verite, un envoi rate ne doit pas annuler la proposition - elle
      // reste dans sa page Collaborations.
      try {
        await supabase.functions.invoke('notify-split-proposal', {
          body: {
            kind: 'amendment',
            id: amendmentId,
            action: 'proposed',
            // proposer_side est deduit SERVEUR depuis amendment.proposed_by :
            // le destinataire d'une demande de signature ne se laisse pas
            // choisir par le client.
            proposer_side: 'venue',
          },
        });
      } catch (e) { console.warn('[amendment] notify failed', e); }

      toast.success(tt('Avenant envoyé', 'Amendment sent', 'Adenda enviada'), {
        description: tt(
          "Rien ne change tant que l'autre partie n'a pas signé.",
          'Nothing changes until the other party signs.',
          'Nada cambia hasta que la otra parte firme.',
        ),
      });
      onOpenChange(false);
      onDone?.();
    } catch (e) {
      toast.error((e as { message?: string }).message || tt('Erreur', 'Error', 'Error'));
    } finally { setSaving(false); }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[88vh] overflow-y-auto sm:max-w-lg">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <FileSignature className="h-4 w-4" style={{ color: RED }} />
            {tt('Proposer un avenant', 'Propose an amendment', 'Proponer una adenda')}
          </DialogTitle>
          <DialogDescription>
            {target.label} · {target.partnerName}
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4">
          <div className="rounded-xl p-3" style={{ background: INNER_BG, border: `1px solid ${BORDER}`, color: T3, fontSize: 11.5, lineHeight: 1.45 }}>
            {tt(
              "Le contrat signé n'est pas réécrit : l'avenant s'y ajoute et ne prend effet qu'une fois signé par les deux parties. D'ici là, les conditions actuelles restent en vigueur.",
              'The signed contract is not rewritten: the amendment is added to it and only takes effect once both parties have signed. Until then, the current terms remain in force.',
              'El contrato firmado no se reescribe: la adenda se añade y solo surte efecto cuando ambas partes la firmen. Hasta entonces, siguen vigentes las condiciones actuales.',
            )}
          </div>

          <ResponsibilitiesPicker
            value={resp}
            onChange={setResp}
            partnerName={target.partnerName}
            note={target.recurring
              ? tt(
                "S'appliquera à toutes les dates à venir de la série.",
                'Will apply to every upcoming date in the series.',
                'Se aplicará a todas las fechas futuras de la serie.',
              )
              : undefined}
          />

          {/* Delta lisible : ce qu'on signe, c'est le changement, pas l'état final. */}
          {respChanged && (
            <div className="rounded-xl p-3 space-y-1" style={{ background: 'rgba(232,25,44,0.06)', border: '1px solid rgba(232,25,44,0.22)' }}>
              <p style={{ color: T1, fontSize: 12, fontWeight: 600 }}>
                {tt('Ce qui change', 'What changes', 'Lo que cambia')}
              </p>
              {COLLAB_DOMAINS.filter(d => resp[d] !== current[d]).map(d => (
                <p key={d} className="flex items-center gap-1.5" style={{ color: T3, fontSize: 11.5 }}>
                  <span>{tt(
                    d === 'design' ? 'Design' : 'Opérationnel',
                    d === 'design' ? 'Design' : 'Operations',
                    d === 'design' ? 'Diseño' : 'Operativo',
                  )}</span>
                  <span>{holderLabel(current[d])}</span>
                  <ArrowRight className="h-3 w-3" />
                  <span style={{ color: RED }}>{holderLabel(resp[d])}</span>
                </p>
              ))}
            </div>
          )}

          {/* Partage des revenus — impossible dès qu'une soirée a vendu. */}
          {target.splitLocked ? (
            <p className="flex items-start gap-2" style={{ color: T3, fontSize: 11.5, lineHeight: 1.45 }}>
              <Lock className="mt-0.5 h-3.5 w-3.5 shrink-0" />
              {tt(
                'Les ventes ont commencé : le partage des revenus ne peut plus changer sur cette soirée. La répartition des responsabilités, si.',
                'Sales have started: the revenue split can no longer change for this event. The allocation of responsibilities still can.',
                'Las ventas han comenzado: el reparto de ingresos ya no puede cambiar en esta noche. El reparto de responsabilidades sí.',
              )}
            </p>
          ) : (
            <div className="space-y-2">
              <label className="flex items-center gap-2" style={{ color: T1, fontSize: 12.5, cursor: 'pointer' }}>
                <input type="checkbox" checked={changeSplit} onChange={e => setChangeSplit(e.target.checked)} />
                {tt('Modifier aussi le partage des revenus', 'Also change the revenue split', 'Cambiar también el reparto de ingresos')}
              </label>
              {changeSplit && (
                <div className="space-y-3 rounded-xl p-3" style={{ background: INNER_BG, border: `1px solid ${BORDER}` }}>
                  {([
                    { label: tt('Billets', 'Tickets', 'Entradas'), v: ticketsVenuePct, set: setTicketsVenuePct, on: ticketsOn, setOn: setTicketsOn },
                    { label: tt('Tables VIP', 'VIP tables', 'Mesas VIP'), v: tablesVenuePct, set: setTablesVenuePct, on: tablesOn, setOn: setTablesOn },
                  ]).map(row => (
                    <div key={row.label} className="space-y-1.5">
                      <div className="flex items-center gap-3">
                        <label className="flex flex-1 items-center gap-2" style={{ color: row.on ? T1 : T3, fontSize: 11.5, cursor: 'pointer' }}>
                          <input type="checkbox" checked={row.on} onChange={e => row.setOn(e.target.checked)} />
                          {row.label}
                        </label>
                        {row.on ? (
                          <>
                            <input
                              type="number" min={0} max={100} value={row.v}
                              onChange={e => row.set(Math.max(0, Math.min(100, Number(e.target.value))))}
                              style={{ width: 64, padding: '6px 8px', borderRadius: 8, background: 'transparent', border: `1px solid ${BORDER}`, color: T1, fontSize: 12 }}
                            />
                            <span style={{ color: T3, fontSize: 11 }}>
                              {tt('% club', '% club', '% club')} · {100 - row.v}% {target.partnerName}
                            </span>
                          </>
                        ) : (
                          <span style={{ color: T3, fontSize: 11 }}>
                            {tt('Hors du deal — vente bloquée', 'Out of the deal — sales blocked', 'Fuera del acuerdo — venta bloqueada')}
                          </span>
                        )}
                      </div>
                    </div>
                  ))}
                  {/* Base du partage tables : sur quoi porte le % ? */}
                  {tablesOn && (
                    <div className="space-y-1.5">
                      <p style={{ color: T3, fontSize: 11, fontWeight: 600 }}>
                        {tt('Base du partage des tables', 'Tables split basis', 'Base del reparto de mesas')}
                      </p>
                      <div className="flex gap-2">
                        {([
                          { key: 'deposit' as const, label: tt('Acompte en ligne', 'Online deposit', 'Anticipo en línea') },
                          { key: 'total_spend' as const, label: tt('Total dépensé', 'Total spend', 'Gasto total') },
                        ]).map(o => (
                          <button
                            key={o.key} type="button" onClick={() => setTablesBasis(o.key)}
                            className="flex-1 rounded-lg px-2 py-1.5"
                            style={{
                              fontSize: 11.5,
                              color: tablesBasis === o.key ? T1 : T3,
                              background: tablesBasis === o.key ? 'rgba(232,25,44,0.12)' : 'transparent',
                              border: `1px solid ${tablesBasis === o.key ? 'rgba(232,25,44,0.4)' : BORDER}`,
                            }}
                          >
                            {o.label}
                          </button>
                        ))}
                      </div>
                      {tablesBasis === 'total_spend' && (
                        <p style={{ color: T3, fontSize: 10.5, lineHeight: 1.4 }}>
                          {tt(
                            "Le % s'applique au total dépensé de la soirée. Le complément dû à l'organisateur est calculé en fin de soirée et réglé par virement, avec double vérification.",
                            'The % applies to the night\'s total spend. The top-up owed to the organizer is computed after the night and settled by bank transfer, with two-step verification.',
                            'El % se aplica al gasto total de la noche. El complemento se calcula al final de la noche y se liquida por transferencia, con doble verificación.',
                          )}
                        </p>
                      )}
                    </div>
                  )}
                  {/* Boissons : % verrouillé par la licence, périmètre négociable. */}
                  <div className="flex items-center gap-3">
                    <label className="flex flex-1 items-center gap-2" style={{ color: drinksOn ? T1 : T3, fontSize: 11.5, cursor: 'pointer' }}>
                      <input type="checkbox" checked={drinksOn} onChange={e => setDrinksOn(e.target.checked)} />
                      {tt('Boissons', 'Drinks', 'Bebidas')}
                    </label>
                    <span style={{ color: T3, fontSize: 11 }}>
                      {drinksOn
                        ? tt('Dans le deal', 'In the deal', 'En el acuerdo')
                        : tt('Hors du deal — commande bloquée', 'Out of the deal — orders blocked', 'Fuera del acuerdo — pedidos bloqueados')}
                    </span>
                  </div>
                  <p style={{ color: T3, fontSize: 10.5, lineHeight: 1.4 }}>
                    {tt(
                      "Le % boissons reste 100 % club tant que l'organisateur n'a pas attesté sa licence d'alcool.",
                      'The drinks % stays 100% club until the organizer has attested their alcohol licence.',
                      'El % de bebidas sigue 100 % club hasta que el organizador acredite su licencia de alcohol.',
                    )}
                  </p>
                </div>
              )}
            </div>
          )}

          <div>
            <p style={{ color: T3, fontSize: 11, fontWeight: 600, letterSpacing: '0.07em', textTransform: 'uppercase', marginBottom: 6 }}>
              {tt('Motif (facultatif)', 'Reason (optional)', 'Motivo (opcional)')}
            </p>
            <textarea
              value={reason} onChange={e => setReason(e.target.value)} rows={2}
              placeholder={tt('Pourquoi ce changement ?', 'Why this change?', '¿Por qué este cambio?')}
              style={{ width: '100%', padding: '10px 12px', borderRadius: 12, fontSize: 13, background: INNER_BG, border: `1px solid ${BORDER}`, color: T1, outline: 'none' }}
            />
          </div>
        </div>

        <DialogFooter className="gap-2">
          <Button variant="ghost" onClick={() => onOpenChange(false)} disabled={saving}>
            {tt('Annuler', 'Cancel', 'Cancelar')}
          </Button>
          <Button onClick={submit} disabled={saving || nothingToDo}>
            {saving
              ? tt('Envoi…', 'Sending…', 'Enviando…')
              : tt("Envoyer l'avenant", 'Send amendment', 'Enviar adenda')}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

export default CollabAmendmentDialog;
