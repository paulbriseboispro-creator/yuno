import { useEffect, useState } from 'react';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from '@/components/ui/dialog';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Checkbox } from '@/components/ui/checkbox';
import { Button } from '@/components/ui/button';
import { Download, Loader2, PenLine, ArrowRight } from 'lucide-react';
import { useLanguage } from '@/contexts/LanguageContext';
import { translate } from '@/i18n/orgTranslate';
import { previewAmendmentPDF, type AmendmentPDFData } from '@/lib/generateAmendmentPDF';
import { COLLAB_DOMAINS, normalizeResponsibilities, type CollabDomain, type DomainHolder } from '@/utils/collabResponsibilities';

/**
 * Relecture d'un AVENANT avant signature, avec case « j'ai lu et j'accepte ».
 *
 * Pourquoi la case, alors qu'aucun écrit n'est légalement requis pour convenir
 * d'une répartition de tâches entre professionnels (art. L110-3 C. com.) : la
 * signature électronique simple est une preuve IMPARFAITE au sens du règlement
 * eIDAS. Sa force tient à ce qui l'entoure. Une case cochée devant le texte
 * intégral documente que le signataire a eu le contenu sous les yeux — c'est
 * exactement ce que fait déjà le flux de contrat, et c'est ce qui distingue un
 * consentement prouvable d'un clic sur un bouton rouge.
 *
 * Le contenu affiché est construit depuis la MÊME source que le PDF
 * (loadAmendmentPdfData), sans quoi on signerait autre chose que ce qu'on a lu.
 */
export function CollabAmendmentReviewDialog({
  open, onOpenChange, data, onConfirm, confirming,
}: {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  data: AmendmentPDFData | null;
  onConfirm: () => void;
  confirming?: boolean;
}) {
  const { language } = useLanguage();
  const tt = (fr: string, en: string, es?: string) => translate(language, fr, en, es);
  const [accepted, setAccepted] = useState(false);

  useEffect(() => { if (!open) setAccepted(false); }, [open]);

  const domainTitle = (d: CollabDomain) => tt(
    d === 'design' ? 'Design' : 'Opérationnel',
    d === 'design' ? 'Design' : 'Operations',
    d === 'design' ? 'Diseño' : 'Operativo',
  );
  const domainScope = (d: CollabDomain) => tt(
    d === 'design'
      ? "Affiche et visuels, titre, description, genres musicaux, line-up DJ, et la façon dont la soirée est présentée au public."
      : "Billetterie dans son ensemble (prix, paliers, jauges, ouverture des ventes), tables VIP et plan de salle, horaires, lieu et accès.",
    d === 'design'
      ? 'Poster and visuals, title, description, music genres, DJ line-up, and how the event is presented to the public.'
      : 'Ticketing as a whole (prices, tiers, capacities, sale opening), VIP tables and floor plan, hours, venue and access.',
    d === 'design'
      ? 'Cartel y visuales, título, descripción, géneros musicales, line-up de DJ, y cómo se presenta la noche al público.'
      : 'Las entradas en su conjunto (precios, tramos, aforos, apertura de ventas), mesas VIP y plano de sala, horarios, lugar y acceso.',
  );
  const holder = (h: DomainHolder) => tt(
    h === 'venue' ? 'le Club' : h === 'organizer' ? "l'Organisateur" : 'les deux parties',
    h === 'venue' ? 'the Club' : h === 'organizer' ? 'the Organizer' : 'both parties',
    h === 'venue' ? 'el Club' : h === 'organizer' ? 'el Organizador' : 'ambas partes',
  );

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-2xl">
        <DialogHeader>
          <DialogTitle>{tt("Lis et signe l'avenant", 'Read and sign the amendment', 'Lee y firma la adenda')}</DialogTitle>
        </DialogHeader>

        {!data ? (
          <div className="flex items-center justify-center py-16 text-muted-foreground">
            <Loader2 className="h-5 w-5 animate-spin" />
          </div>
        ) : (
          <>
            <ScrollArea className="h-[56vh] pr-4">
              <div className="space-y-5 text-sm">
                <div>
                  <h2 className="text-lg font-bold text-foreground">
                    {tt('Avenant au contrat de collaboration', 'Amendment to the collaboration contract', 'Adenda al contrato de colaboración')}
                  </h2>
                  <p className="text-xs text-muted-foreground">Réf. {data.amendmentId}</p>
                </div>

                {/* 1. Parties + objet de la collaboration */}
                <section className="space-y-2 border-t border-border/50 pt-3">
                  <h3 className="font-semibold text-foreground">1. {tt('Parties', 'Parties', 'Partes')}</h3>
                  <div>
                    <div className="text-xs font-medium text-muted-foreground">{tt('Club (lieu, vendeur de record)', 'Club (venue, seller of record)', 'Club (local, vendedor de registro)')}</div>
                    <div className="font-semibold text-foreground">{data.venue.name}</div>
                    {data.venue.legalName && <div className="text-xs text-muted-foreground">{tt('Dénomination sociale', 'Registered name', 'Razón social')} : {data.venue.legalName}</div>}
                    {data.venue.registrationNumber && <div className="text-xs text-muted-foreground">SIRET / NIF : {data.venue.registrationNumber}</div>}
                  </div>
                  <div>
                    <div className="text-xs font-medium text-muted-foreground">{tt('Organisateur', 'Organizer', 'Organizador')}</div>
                    <div className="font-semibold text-foreground">{data.organizer.name}</div>
                    {data.organizer.legalName && <div className="text-xs text-muted-foreground">{tt('Dénomination sociale', 'Registered name', 'Razón social')} : {data.organizer.legalName}</div>}
                    {data.organizer.registrationNumber && <div className="text-xs text-muted-foreground">SIRET / NIF : {data.organizer.registrationNumber}</div>}
                  </div>
                  <div className="text-xs text-muted-foreground">
                    <div>{tt('Objet de la collaboration', 'Collaboration subject', 'Objeto de la colaboración')} : <span className="text-foreground">{data.subject}</span></div>
                    <div>{tt('Proposé par', 'Proposed by', 'Propuesto por')} : <span className="text-foreground">{data.proposedByLabel}</span></div>
                  </div>
                </section>

                {/* 2. Objet de l'avenant */}
                <section className="space-y-2 border-t border-border/50 pt-3">
                  <h3 className="font-semibold text-foreground">2. {tt("Objet de l'avenant", 'Purpose of the amendment', 'Objeto de la adenda')}</h3>
                  <p className="text-xs text-muted-foreground">
                    {tt(
                      "Le présent avenant modifie la répartition des responsabilités opérationnelles convenue entre les parties. Il ne remplace pas le contrat de collaboration : il s'y ajoute et n'en modifie aucune autre stipulation.",
                      'This amendment modifies the allocation of operational responsibilities agreed between the parties. It does not replace the collaboration contract: it is added to it and modifies no other provision.',
                      'La presente adenda modifica el reparto de responsabilidades operativas acordado entre las partes. No sustituye el contrato de colaboración: se le añade y no modifica ninguna otra estipulación.',
                    )}
                  </p>
                </section>

                {/* 3. La répartition, domaine par domaine */}
                <section className="space-y-2 border-t border-border/50 pt-3">
                  <h3 className="font-semibold text-foreground">3. {tt('Nouvelle répartition des responsabilités', 'New allocation of responsibilities', 'Nuevo reparto de responsabilidades')}</h3>
                  {(() => {
                    const prev = normalizeResponsibilities(data.prevResponsibilities, null);
                    const next = data.nextResponsibilities ? normalizeResponsibilities(data.nextResponsibilities, null) : null;
                    return COLLAB_DOMAINS.map(d => {
                      const changed = !!next && next[d] !== prev[d];
                      return (
                        <div key={d} className="space-y-0.5">
                          <div className="text-xs font-semibold text-foreground">{domainTitle(d)}</div>
                          <div className={`text-xs flex flex-wrap items-center gap-1.5 ${changed ? 'text-foreground font-medium' : 'text-muted-foreground'}`}>
                            <span>{holder(prev[d])}</span>
                            {changed && <><ArrowRight className="h-3 w-3" /><span className="text-primary">{holder(next![d])}</span></>}
                            {!changed && <span>· {tt('inchangé', 'unchanged', 'sin cambios')}</span>}
                          </div>
                          <p className="text-xs text-muted-foreground">{domainScope(d)}</p>
                        </div>
                      );
                    });
                  })()}
                </section>

                {/* 4. Partage des revenus, seulement s'il bouge */}
                {data.nextSplit && (
                  <section className="space-y-2 border-t border-border/50 pt-3">
                    <h3 className="font-semibold text-foreground">4. {tt('Modification du partage des revenus', 'Change to the revenue split', 'Modificación del reparto de ingresos')}</h3>
                    <ul className="text-xs text-muted-foreground space-y-0.5">
                      <li>{tt('Billets', 'Tickets', 'Entradas')} : {data.prevSplit ? `${data.prevSplit.tickets.venue_pct}%` : '—'} → <span className="text-foreground">{data.nextSplit.tickets.venue_pct}%</span> club</li>
                      <li>{tt('Tables / VIP', 'Tables / VIP', 'Mesas / VIP')} : {data.prevSplit ? `${data.prevSplit.tables.venue_pct}%` : '—'} → <span className="text-foreground">{data.nextSplit.tables.venue_pct}%</span> club</li>
                      <li>{tt('Boissons', 'Drinks', 'Bebidas')} : {data.prevSplit ? `${data.prevSplit.drinks.venue_pct}%` : '—'} → <span className="text-foreground">{data.nextSplit.drinks.venue_pct}%</span> club</li>
                    </ul>
                    <p className="text-xs text-muted-foreground">
                      {tt(
                        "Cette modification ne s'applique qu'aux soirées dont les ventes n'ont pas commencé. Une soirée déjà ouverte à la vente conserve les conditions sous lesquelles le public a acheté.",
                        'This change applies only to events whose sales have not started. An event already open for sale keeps the terms under which the public purchased.',
                        'Esta modificación solo se aplica a las noches cuyas ventas no han comenzado. Una noche ya abierta a la venta conserva las condiciones bajo las que el público compró.',
                      )}
                    </p>
                  </section>
                )}

                {/* 5. Portée dans le temps */}
                <section className="space-y-2 border-t border-border/50 pt-3">
                  <h3 className="font-semibold text-foreground">{data.nextSplit ? 5 : 4}. {tt("Portée et prise d'effet", 'Scope and effect', 'Alcance y entrada en vigor')}</h3>
                  <p className="text-xs text-muted-foreground">
                    {data.recurring
                      ? tt(
                        "La partie à laquelle un domaine est confié en a la maîtrise exclusive ; l'autre ne peut plus modifier ce qui en relève. La répartition est appliquée techniquement par Yuno. Elle prend effet à la seconde signature et s'applique à TOUTES LES DATES À VENIR de la série ; les soirées déjà tenues restent régies par la répartition antérieure. Le jour et l'horaire de la série demeurent fixés par le Club.",
                        'The party allocated a domain has exclusive control over it; the other may no longer modify what falls within it. The allocation is technically enforced by Yuno. It takes effect on the second signature and applies to ALL UPCOMING DATES of the series; events already held remain governed by the prior allocation. The day and time of the series remain set by the Club.',
                        'La parte a la que se asigna un dominio tiene su control exclusivo; la otra ya no puede modificar lo que le corresponde. El reparto lo aplica técnicamente Yuno. Surte efecto en la segunda firma y se aplica a TODAS LAS FECHAS FUTURAS de la serie; las noches ya celebradas siguen rigiéndose por el reparto anterior. El día y el horario de la serie los sigue fijando el Club.',
                      )
                      : tt(
                        "La partie à laquelle un domaine est confié en a la maîtrise exclusive ; l'autre ne peut plus modifier ce qui en relève. La répartition est appliquée techniquement par Yuno. Elle prend effet à la seconde signature et s'applique à la soirée visée.",
                        'The party allocated a domain has exclusive control over it; the other may no longer modify what falls within it. The allocation is technically enforced by Yuno. It takes effect on the second signature and applies to the event concerned.',
                        'La parte a la que se asigna un dominio tiene su control exclusivo; la otra ya no puede modificar lo que le corresponde. El reparto lo aplica técnicamente Yuno. Surte efecto en la segunda firma y se aplica a la noche indicada.',
                      )}
                  </p>
                </section>

                {data.reason && (
                  <section className="space-y-1 border-t border-border/50 pt-3">
                    <h3 className="font-semibold text-foreground">{tt('Motif invoqué', 'Stated reason', 'Motivo alegado')}</h3>
                    <p className="text-xs text-muted-foreground italic">« {data.reason} »</p>
                  </section>
                )}

                {/* Régime juridique — le même texte que le PDF, mot pour mot. */}
                <section className="space-y-2 border-t border-border/50 pt-3">
                  <h3 className="font-semibold text-foreground">{tt('Régime juridique', 'Legal regime', 'Régimen jurídico')}</h3>
                  <p className="text-xs text-muted-foreground">
                    {tt(
                      "Conformément à l'article 1193 du Code civil, le contrat ne peut être modifié que du consentement mutuel des parties : le présent avenant ne produit aucun effet tant qu'il n'est pas signé par les deux. Les parties étant des professionnels, la preuve est libre entre elles (article L110-3 du Code de commerce) ; aucun écrit n'est imposé par la loi pour convenir d'une telle répartition, et le présent document est établi à titre de preuve. Les signatures sont des signatures électroniques simples au sens du règlement (UE) n° 910/2014 (eIDAS) : leur force probante repose sur l'horodatage, l'adresse IP et le terminal enregistrés au moment du clic.",
                      'Pursuant to article 1193 of the French Civil Code, a contract may only be modified by mutual consent: this amendment has no effect until signed by both parties. As the parties are businesses, evidence is free between them (article L110-3 of the French Commercial Code); no writing is required by law to agree on such an allocation, and this document is drawn up as evidence. The signatures are simple electronic signatures within the meaning of Regulation (EU) No 910/2014 (eIDAS): their evidential weight rests on the timestamp, IP address and device recorded at the time of the click.',
                      'Conforme al artículo 1193 del Código Civil francés, el contrato solo puede modificarse por consentimiento mutuo: la presente adenda no produce efecto alguno mientras no la firmen ambas partes. Al ser las partes profesionales, la prueba es libre entre ellas (artículo L110-3 del Código de Comercio francés); la ley no impone ningún escrito para acordar tal reparto, y este documento se establece como medio de prueba. Las firmas son firmas electrónicas simples en el sentido del Reglamento (UE) n.º 910/2014 (eIDAS): su fuerza probatoria descansa en la marca de tiempo, la dirección IP y el terminal registrados en el momento del clic.',
                    )}
                  </p>
                </section>
              </div>
            </ScrollArea>

            <label className="flex items-start gap-2.5 rounded-lg border border-border/60 bg-muted/30 p-3 text-sm cursor-pointer">
              <Checkbox checked={accepted} onCheckedChange={(v) => setAccepted(v === true)} className="mt-0.5" />
              <span className="text-foreground">
                {tt(
                  "J'ai lu et j'accepte l'intégralité de l'avenant ci-dessus. Ma signature électronique (horodatage + adresse IP) vaut accord.",
                  'I have read and accept the whole amendment above. My electronic signature (timestamp + IP address) constitutes agreement.',
                  'He leído y acepto la totalidad de la adenda anterior. Mi firma electrónica (marca de tiempo + dirección IP) constituye aceptación.',
                )}
              </span>
            </label>

            <DialogFooter className="gap-2 sm:gap-2">
              <Button variant="outline" size="sm" onClick={() => previewAmendmentPDF(data)}>
                <Download className="h-4 w-4 mr-1.5" />
                {tt('Aperçu PDF', 'PDF preview', 'Vista previa PDF')}
              </Button>
              <Button size="sm" onClick={onConfirm} disabled={!accepted || confirming}>
                <PenLine className="h-4 w-4 mr-1.5" />
                {confirming
                  ? tt('Signature…', 'Signing…', 'Firmando…')
                  : tt("Signer l'avenant", 'Sign the amendment', 'Firmar la adenda')}
              </Button>
            </DialogFooter>
          </>
        )}
      </DialogContent>
    </Dialog>
  );
}

export default CollabAmendmentReviewDialog;
