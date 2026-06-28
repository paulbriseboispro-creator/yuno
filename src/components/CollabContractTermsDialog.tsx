import { useEffect, useState } from 'react';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from '@/components/ui/dialog';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Checkbox } from '@/components/ui/checkbox';
import { Button } from '@/components/ui/button';
import { Download, Loader2, PenLine } from 'lucide-react';
import { loadCollabContractPdfData } from '@/lib/collabContractData';
import { previewContractPDF, type CollabContractPDFData } from '@/lib/generateContractPDF';
import { getCollabTerms, pickL, clauseBody, type Lang, type L } from '@/lib/collabContractTerms';
import type { EventCollabContractRow } from '@/hooks/useEventCollabContract';

interface Props {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** An event contract to load + render. Mutually exclusive with `pdfData`. */
  contract?: EventCollabContractRow;
  /** Pre-built contract data (e.g. a recurring SERIES contract). Skips the loader. */
  pdfData?: CollabContractPDFData;
  /** Optional dialog title override (e.g. "Lis et signe le contrat-cadre"). */
  title?: L;
  language?: Lang;
  /** Fired once the viewer has read + ticked acceptance and clicks "Signer". */
  onConfirm: () => void;
  confirming?: boolean;
}

/**
 * Pre-signature contract review. Renders the FULL contract (parties, split, every legal
 * article) from the same versioned source the PDF uses, then gates the "Signer" button
 * behind an explicit "I have read and accept" checkbox — so the signer actually sees the
 * terms they're bound by before the eIDAS click, instead of only the split percentages.
 *
 * Works for a per-soirée event contract (`contract`) OR a recurring framework contract
 * (`pdfData` pre-built via loadCollabSeriesContractPdfData, with recurring=true).
 */
export function CollabContractTermsDialog({ open, onOpenChange, contract, pdfData, title, language = 'fr', onConfirm, confirming }: Props) {
  const [data, setData] = useState<CollabContractPDFData | null>(null);
  const [accepted, setAccepted] = useState(false);

  useEffect(() => {
    if (!open) { setAccepted(false); return; }
    if (pdfData) { setData(pdfData); return; }
    if (!contract) { setData(null); return; }
    let active = true;
    setData(null);
    loadCollabContractPdfData(contract, language).then((d) => { if (active) setData(d); });
    return () => { active = false; };
  }, [open, contract, pdfData, language]);

  const t = (l: L) => pickL(language, l);

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-2xl">
        <DialogHeader>
          <DialogTitle>{t(title ?? { fr: 'Lis et signe le contrat', en: 'Read and sign the contract', es: 'Lee y firma el contrato' })}</DialogTitle>
        </DialogHeader>

        {!data ? (
          <div className="flex items-center justify-center py-16 text-muted-foreground">
            <Loader2 className="h-5 w-5 animate-spin" />
          </div>
        ) : (
          <>
            <ScrollArea className="h-[58vh] pr-4">
              <ContractTermsView data={data} language={language} />
            </ScrollArea>

            <label className="flex items-start gap-2.5 rounded-lg border border-border/60 bg-muted/30 p-3 text-sm cursor-pointer">
              <Checkbox checked={accepted} onCheckedChange={(v) => setAccepted(v === true)} className="mt-0.5" />
              <span className="text-foreground">
                {t({
                  fr: "J'ai lu et j'accepte l'intégralité des conditions ci-dessus. Ma signature électronique (horodatage + adresse IP) vaut accord.",
                  en: 'I have read and accept all the terms above. My electronic signature (timestamp + IP address) constitutes agreement.',
                  es: 'He leído y acepto todas las condiciones anteriores. Mi firma electrónica (marca de tiempo + dirección IP) constituye aceptación.',
                })}
              </span>
            </label>

            <DialogFooter className="gap-2 sm:gap-2">
              <Button variant="outline" size="sm" onClick={() => previewContractPDF(data)}>
                <Download className="h-4 w-4 mr-1.5" />
                {t({ fr: 'Aperçu PDF', en: 'PDF preview', es: 'Vista previa PDF' })}
              </Button>
              <Button size="sm" onClick={onConfirm} disabled={!accepted || confirming}>
                <PenLine className="h-4 w-4 mr-1.5" />
                {confirming
                  ? t({ fr: 'Signature…', en: 'Signing…', es: 'Firmando…' })
                  : t({ fr: 'Signer le contrat', en: 'Sign the contract', es: 'Firmar el contrato' })}
              </Button>
            </DialogFooter>
          </>
        )}
      </DialogContent>
    </Dialog>
  );
}

/** Readable HTML mirror of the PDF — same versioned terms, same order. */
function ContractTermsView({ data, language }: { data: CollabContractPDFData; language: Lang }) {
  const terms = getCollabTerms(data.termsVersion, { recurring: data.recurring });
  const { labels } = terms;
  const t = (l: L) => pickL(language, l);
  const fmtDate = (d?: Date | null) =>
    d ? d.toLocaleDateString('fr-FR', { day: '2-digit', month: 'long', year: 'numeric' }) : '—';

  const legalLine = (label: L, val?: string | null) =>
    val ? <div className="text-xs text-muted-foreground">{t(label)} : {val}</div> : null;

  return (
    <div className="space-y-5 text-sm">
      <div>
        <h2 className="text-lg font-bold text-foreground">{t(labels.docTitle)}</h2>
        <p className="text-xs text-muted-foreground">Réf. {data.contractId}</p>
      </div>

      {terms.articles.map((article) => (
        <section key={article.num} className="space-y-2 border-t border-border/50 pt-3">
          <h3 className="font-semibold text-foreground">{article.num}. {t(article.title)}</h3>

          {article.kind === 'parties' && (
            <div className="space-y-3">
              <div>
                <div className="text-xs font-medium text-muted-foreground">{t(labels.clubRole)}</div>
                <div className="font-semibold text-foreground">{data.venueName}</div>
                {legalLine(labels.denom, data.venueLegal?.legalName)}
                {legalLine(labels.address, data.venueLegal?.legalAddress)}
                {legalLine(labels.reg, data.venueLegal?.registrationNumber)}
                {legalLine(labels.vat, data.venueLegal?.vatNumber)}
              </div>
              <div>
                <div className="text-xs font-medium text-muted-foreground">{t(labels.orgRole)}</div>
                <div className="font-semibold text-foreground">{data.organizerName}</div>
                {legalLine(labels.denom, data.organizerLegal?.legalName)}
                {legalLine(labels.address, data.organizerLegal?.legalAddress)}
                {legalLine(labels.reg, data.organizerLegal?.registrationNumber)}
                {legalLine(labels.vat, data.organizerLegal?.vatNumber)}
              </div>
              <div className="text-xs text-muted-foreground">
                {data.eventTitle && <div>{t(labels.event)} : <span className="text-foreground">{data.eventTitle}</span></div>}
                <div>{t(labels.date)} : <span className="text-foreground">{fmtDate(data.eventDate)}</span></div>
              </div>
            </div>
          )}

          {article.kind === 'split' && (
            <div className="space-y-1.5">
              <ul className="text-xs text-muted-foreground space-y-0.5">
                <li>{t(labels.ticketsRow)} : {t(labels.orgShort)} {data.splitRules.tickets.organizer_pct}% · Club {data.splitRules.tickets.venue_pct}%</li>
                <li>{t(labels.tablesRow)} : {t(labels.orgShort)} {data.splitRules.tables.organizer_pct}% · Club {data.splitRules.tables.venue_pct}%</li>
                <li>{t(labels.drinksRow)} : {t(labels.orgShort)} {data.splitRules.drinks.organizer_pct}% · Club {data.splitRules.drinks.venue_pct}%</li>
              </ul>
              <p className="text-xs text-muted-foreground">{t(article.note)}</p>
            </div>
          )}

          {article.kind === 'static' && (
            <div className="space-y-2">
              {article.intro && <p className="text-xs text-muted-foreground">{t(article.intro)}</p>}
              {(article.clauses ?? []).map((c, i) => (
                <div key={i}>
                  <div className="text-xs font-semibold text-foreground">{t(c.term)}</div>
                  <p className="text-xs text-muted-foreground whitespace-pre-line">{t(clauseBody(c, data.cancellationPolicy))}</p>
                </div>
              ))}
            </div>
          )}
        </section>
      ))}

      <p className="border-t border-border/50 pt-3 text-[11px] text-muted-foreground">{t(labels.footer)}</p>
    </div>
  );
}
