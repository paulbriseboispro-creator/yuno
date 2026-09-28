import jsPDF from 'jspdf';
import { deliverDocument } from '@/lib/generateDocuments';

/**
 * Accord de co-organisation — N parties, SANS Stripe.
 *
 * Ce texte est la vérité de ce que Yuno fait et ne fait pas : Yuno n'encaisse
 * pas pour les co-hôtes et ne leur verse rien. Il calcule un décompte à partir
 * des ventes qu'il voit et des lignes déclarées, le fait valider par TOUTES
 * les parties, puis trace les virements (déclaré par le payeur, confirmé par
 * le bénéficiaire). Promettre plus serait vendre ce que le logiciel n'assume
 * pas : un paiement Stripe n'a que deux jambes chez Yuno (payment-split.ts).
 *
 * Version figée à la signature : `event_coorg_deals.terms_version`.
 */
export const COORG_TERMS_VERSION = '2026-09-28';

type Lang = 'fr' | 'en' | 'es';
type L = Record<Lang, string>;

export const COORG_ARTICLES: { title: L; body: L }[] = [
  {
    title: { fr: 'Objet', en: 'Purpose', es: 'Objeto' },
    body: {
      fr: 'Les parties co-organisent la soirée désignée ci-dessus. Le présent accord fixe la part de chacune dans le résultat de la soirée et la façon de le régler.',
      en: 'The parties co-organize the event named above. This agreement sets each party’s share of the event result and how it is settled.',
      es: 'Las partes coorganizan el evento indicado. Este acuerdo fija la parte de cada una en el resultado del evento y cómo se liquida.',
    },
  },
  {
    title: { fr: 'Encaissement', en: 'Collection', es: 'Cobro' },
    body: {
      fr: 'Les ventes en ligne (billets, tables, boissons) sont encaissées par l’hôte principal de la soirée (ou réparties entre le club et l’organisateur signataires d’un contrat collab Yuno, selon ce contrat). Yuno ne verse aucune somme aux autres co-hôtes.',
      en: 'Online sales (tickets, tables, drinks) are collected by the event’s main host (or split between the club and the organizer bound by a Yuno collab contract, under that contract). Yuno pays nothing to the other co-hosts.',
      es: 'Las ventas online (entradas, mesas, bebidas) las cobra el anfitrión principal (o se reparten entre el club y el organizador firmantes de un contrato collab Yuno, según ese contrato). Yuno no paga nada a los demás coanfitriones.',
    },
  },
  {
    title: { fr: 'Résultat et parts', en: 'Result and shares', es: 'Resultado y partes' },
    body: {
      fr: 'Résultat = ventes Yuno nettes (après frais de service, remboursements et frais Stripe) encaissées par les parties + recettes déclarées hors Yuno − frais déclarés. Chaque partie a droit à sa part du résultat, plus le remboursement des frais qu’elle a avancés. Une perte se partage selon les mêmes parts.',
      en: 'Result = net Yuno sales (after service fees, refunds and Stripe fees) collected by the parties + declared off-Yuno revenue − declared costs. Each party is entitled to its share of the result, plus the costs it advanced. A loss is shared in the same proportions.',
      es: 'Resultado = ventas netas Yuno (tras gastos de servicio, reembolsos y comisiones Stripe) cobradas por las partes + ingresos declarados fuera de Yuno − gastos declarados. Cada parte tiene derecho a su parte del resultado más los gastos que adelantó. Una pérdida se reparte en las mismas proporciones.',
    },
  },
  {
    title: { fr: 'Décompte', en: 'Settlement statement', es: 'Liquidación' },
    body: {
      fr: 'Après la soirée, chaque partie déclare ses frais et ses recettes hors Yuno. Le décompte n’est arrêté que lorsque TOUTES les parties l’ont validé dans la même version ; toute ligne ajoutée ou retirée remet les validations à zéro.',
      en: 'After the event, each party declares its costs and off-Yuno revenue. The statement is final only once EVERY party has approved the same version; any line added or removed resets the approvals.',
      es: 'Tras el evento, cada parte declara sus gastos e ingresos fuera de Yuno. La liquidación solo es definitiva cuando TODAS las partes validan la misma versión; cualquier línea añadida o retirada reinicia las validaciones.',
    },
  },
  {
    title: { fr: 'Règlement', en: 'Payment', es: 'Pago' },
    body: {
      fr: 'Les soldes se règlent par virement bancaire entre les parties, avec la référence indiquée par Yuno, sous 15 jours après l’arrêté du décompte. Le payeur déclare le virement ; seul le bénéficiaire en confirme la réception ou le conteste. Yuno horodate chaque étape et ne touche jamais aux fonds.',
      en: 'Balances are paid by bank transfer between the parties, with the reference shown by Yuno, within 15 days of the final statement. The payer declares the transfer; only the payee confirms receipt or disputes it. Yuno timestamps each step and never handles the funds.',
      es: 'Los saldos se pagan por transferencia entre las partes, con la referencia indicada por Yuno, en 15 días tras la liquidación. El pagador declara la transferencia; solo el beneficiario confirma la recepción o la impugna. Yuno fecha cada paso y nunca toca los fondos.',
    },
  },
  {
    title: { fr: 'Clients et données', en: 'Customers and data', es: 'Clientes y datos' },
    body: {
      fr: 'Les parties sont responsables conjointes des données des participants pour l’organisation de la soirée. Un client n’entre dans la base marketing d’une partie que s’il a coché une case qui la nomme ; chaque partie respecte seule les désinscriptions reçues.',
      en: 'The parties are joint controllers of attendee data for running the event. A customer joins a party’s marketing list only if they ticked a box naming that party; each party honours the unsubscribes it receives.',
      es: 'Las partes son corresponsables de los datos de los asistentes para organizar el evento. Un cliente entra en la base de marketing de una parte solo si marcó una casilla que la nombra; cada parte respeta las bajas que recibe.',
    },
  },
  {
    title: { fr: 'Signature', en: 'Signature', es: 'Firma' },
    body: {
      fr: 'Chaque partie accepte l’accord électroniquement depuis sa Console Yuno (signature électronique simple : horodatage, compte, navigateur). L’accord prend effet quand toutes les parties l’ont accepté ; toute modification des parts exige une nouvelle acceptation de tous.',
      en: 'Each party accepts the agreement electronically from its Yuno Console (simple electronic signature: timestamp, account, browser). It takes effect once every party has accepted; any change to the shares requires everyone to accept again.',
      es: 'Cada parte acepta el acuerdo electrónicamente desde su Consola Yuno (firma electrónica simple: fecha, cuenta, navegador). Entra en vigor cuando todas lo aceptan; cualquier cambio de partes exige una nueva aceptación de todos.',
    },
  },
];

const pick = (l: L, lang: string): string => l[(['fr', 'en', 'es'].includes(lang) ? lang : 'en') as Lang];

export interface CoorgAgreementPDFData {
  language: string;
  eventTitle: string;
  eventDate: string;
  parties: { key: string; name: string; pct: number; signedAt?: string | null; ua?: string | null }[];
  clauses?: string | null;
  version: number;
  termsVersion: string;
}

export async function generateCoorgAgreementPDF(d: CoorgAgreementPDFData): Promise<void> {
  const L = (fr: string, en: string, es: string) => (d.language === 'fr' ? fr : d.language === 'es' ? es : en);
  const doc = new jsPDF({ unit: 'mm', format: 'a4' });
  const W = 210;
  const M = 18;
  let y = 22;
  const line = (h = 5) => { y += h; if (y > 280) { doc.addPage(); y = 20; } };
  const para = (text: string, size = 9.5, bold = false) => {
    doc.setFont('helvetica', bold ? 'bold' : 'normal');
    doc.setFontSize(size);
    for (const l of doc.splitTextToSize(text, W - 2 * M) as string[]) { doc.text(l, M, y); line(size * 0.45); }
  };

  doc.setFont('helvetica', 'bold'); doc.setFontSize(16);
  doc.text(L('Accord de co-organisation', 'Co-organization agreement', 'Acuerdo de coorganización'), M, y); line(8);
  para(`${d.eventTitle} — ${d.eventDate}`, 11, true); line(2);
  para(L(`Version ${d.version} · termes ${d.termsVersion}`, `Version ${d.version} · terms ${d.termsVersion}`, `Versión ${d.version} · términos ${d.termsVersion}`), 8.5);
  line(4);

  para(L('Parties et parts du résultat', 'Parties and shares of the result', 'Partes y partes del resultado'), 11, true); line(1);
  for (const p of d.parties) {
    para(`• ${p.name} — ${p.pct} %`, 10, true);
    para(p.signedAt
      ? L(`Accepté le ${new Date(p.signedAt).toLocaleString('fr-FR')}`, `Accepted on ${new Date(p.signedAt).toLocaleString('en-GB')}`, `Aceptado el ${new Date(p.signedAt).toLocaleString('es-ES')}`)
      : L('En attente d’acceptation', 'Awaiting acceptance', 'Pendiente de aceptación'), 8.5);
  }
  line(4);

  COORG_ARTICLES.forEach((a, i) => {
    para(`${i + 1}. ${pick(a.title, d.language)}`, 10.5, true);
    para(pick(a.body, d.language));
    line(2);
  });
  if (d.clauses && d.clauses.trim()) {
    para(`${COORG_ARTICLES.length + 1}. ${L('Clauses particulières', 'Specific clauses', 'Cláusulas particulares')}`, 10.5, true);
    para(d.clauses.trim());
  }
  line(4);
  para(L(
    'Document généré par Yuno. Yuno n’est pas partie à l’accord : il fournit le calcul, la validation et la traçabilité.',
    'Document generated by Yuno. Yuno is not a party to the agreement: it provides the calculation, approval flow and audit trail.',
    'Documento generado por Yuno. Yuno no es parte del acuerdo: aporta el cálculo, la validación y la trazabilidad.',
  ), 8);

  const blob = doc.output('blob');
  const safe = d.eventTitle.replace(/[^\w-]+/g, '_').slice(0, 40) || 'soiree';
  await deliverDocument(blob, `accord-co-organisation-${safe}.pdf`, d.eventTitle);
}
