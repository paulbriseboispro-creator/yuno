import jsPDF from 'jspdf';
import { pickL, type Lang, type L } from './collabContractTerms';
import { COLLAB_DOMAINS, normalizeResponsibilities, type CollabDomain, type DomainHolder } from '@/utils/collabResponsibilities';

/**
 * AVENANT à un contrat de collaboration — document autonome, signé par les deux
 * parties, qui décrit précisément la répartition des tâches convenue.
 *
 * Pourquoi un document séparé plutôt qu'un contrat réécrit : l'avenant ne
 * remplace pas le contrat d'origine, il s'y ajoute. Le PDF porte donc l'ÉTAT
 * ANTÉRIEUR et l'ÉTAT NOUVEAU côte à côte — c'est le delta qui est signé, pas
 * un état final sorti de nulle part.
 *
 * Cadre juridique (droit français, parties professionnelles) :
 *   • art. 1193 C. civ. — un contrat ne se modifie que du consentement mutuel
 *     des parties. C'est ce que matérialise la double signature.
 *   • art. L110-3 C. com. — entre commerçants la preuve est LIBRE : aucun écrit
 *     n'est imposé pour convenir d'une répartition de tâches. Ce document n'est
 *     donc pas une obligation légale, c'est un moyen de preuve.
 *   • Règlement eIDAS n° 910/2014 — signature électronique simple : la valeur
 *     probante tient à l'horodatage, l'adresse IP et le user-agent conservés.
 */

export interface AmendmentParty {
  name: string;
  legalName?: string | null;
  legalAddress?: string | null;
  registrationNumber?: string | null;
  vatNumber?: string | null;
}

export interface AmendmentPDFData {
  amendmentId: string;
  /** Contrat modifié : sa référence, et s'il couvre une série. */
  contractRef: string;
  recurring: boolean;
  /** « Yuno Electronic Body · tous les vendredis » ou le titre de la soirée. */
  subject: string;
  venue: AmendmentParty;
  organizer: AmendmentParty;
  /** Répartitions avant / après. `next` null = ce volet n'est pas modifié. */
  prevResponsibilities: unknown;
  nextResponsibilities: unknown | null;
  /** Partage des revenus avant / après. `next` null = inchangé. */
  prevSplit?: { tickets: { venue_pct: number }; tables: { venue_pct: number }; drinks: { venue_pct: number } } | null;
  nextSplit?: { tickets: { venue_pct: number }; tables: { venue_pct: number }; drinks: { venue_pct: number } } | null;
  reason?: string | null;
  proposedByLabel: string;
  proposedAt?: Date | null;
  venueSignedAt?: Date | null;
  venueSignedName?: string;
  venueSignedIp?: string | null;
  orgSignedAt?: Date | null;
  orgSignedName?: string;
  orgSignedIp?: string | null;
  effectiveAt?: Date | null;
  language?: Lang;
}

const DOMAIN_TITLE: Record<CollabDomain, L> = {
  design: {
    fr: 'Design', en: 'Design', es: 'Diseño',
  },
  operations: {
    fr: 'Opérationnel', en: 'Operations', es: 'Operativo',
  },
};

const DOMAIN_SCOPE: Record<CollabDomain, L> = {
  design: {
    fr: "Affiche et visuels, titre, description, genres musicaux, line-up DJ, ainsi que la façon dont la soirée est présentée au public (visibilité, apparition dans les pages de découverte, référencement).",
    en: 'Poster and visuals, title, description, music genres, DJ line-up, and how the event is presented to the public (visibility, appearance in discovery pages, search).',
    es: 'Cartel y visuales, título, descripción, géneros musicales, line-up de DJ, y cómo se presenta la noche al público (visibilidad, aparición en las páginas de descubrimiento, posicionamiento).',
  },
  operations: {
    fr: "Billetterie dans son ensemble (prix, paliers tarifaires, jauges, dates d'ouverture des ventes, liste d'attente), tables VIP et plan de salle, horaires de la soirée, lieu, adresse et conditions d'accès.",
    en: 'Ticketing as a whole (prices, price tiers, capacities, sale opening dates, waiting list), VIP tables and floor plan, event hours, venue, address and access conditions.',
    es: 'Las entradas en su conjunto (precios, tramos, aforos, fechas de apertura de ventas, lista de espera), mesas VIP y plano de sala, horarios de la noche, lugar, dirección y condiciones de acceso.',
  },
};

const HOLDER_L: Record<DomainHolder, L> = {
  venue: { fr: 'le Club', en: 'the Club', es: 'el Club' },
  organizer: { fr: "l'Organisateur", en: 'the Organizer', es: 'el Organizador' },
  both: { fr: 'les deux parties conjointement', en: 'both parties jointly', es: 'ambas partes conjuntamente' },
};

const LBL = {
  docTitle: { fr: 'Avenant au contrat de collaboration', en: 'Amendment to the collaboration contract', es: 'Adenda al contrato de colaboración' },
  parties: { fr: 'Parties', en: 'Parties', es: 'Partes' },
  club: { fr: 'Club (lieu, vendeur de record)', en: 'Club (venue, seller of record)', es: 'Club (local, vendedor de registro)' },
  org: { fr: 'Organisateur', en: 'Organizer', es: 'Organizador' },
  denom: { fr: 'Dénomination sociale', en: 'Registered name', es: 'Razón social' },
  address: { fr: 'Adresse', en: 'Address', es: 'Dirección' },
  reg: { fr: "N° d'immatriculation (SIRET / NIF)", en: 'Registration no. (SIRET / NIF)', es: 'N.º de registro (SIRET / NIF)' },
  vat: { fr: 'N° TVA', en: 'VAT no.', es: 'N.º IVA' },
  object: { fr: 'Objet de l’avenant', en: 'Purpose of the amendment', es: 'Objeto de la adenda' },
  objectBody: {
    fr: "Le présent avenant modifie la répartition des responsabilités opérationnelles convenue entre les parties au titre du contrat de collaboration visé ci-dessus. Il ne remplace pas ce contrat : il s'y ajoute et n'en modifie aucune autre stipulation.",
    en: 'This amendment modifies the allocation of operational responsibilities agreed between the parties under the collaboration contract referenced above. It does not replace that contract: it is added to it and modifies no other provision.',
    es: 'La presente adenda modifica el reparto de responsabilidades operativas acordado entre las partes en el contrato de colaboración indicado. No sustituye dicho contrato: se le añade y no modifica ninguna otra estipulación.',
  },
  allocation: { fr: 'Nouvelle répartition des responsabilités', en: 'New allocation of responsibilities', es: 'Nuevo reparto de responsabilidades' },
  before: { fr: 'Avant', en: 'Before', es: 'Antes' },
  after: { fr: 'Après', en: 'After', es: 'Después' },
  unchanged: { fr: 'Inchangé', en: 'Unchanged', es: 'Sin cambios' },
  scope: { fr: 'Périmètre', en: 'Scope', es: 'Alcance' },
  effect: { fr: 'Portée et prise d’effet', en: 'Scope and effect', es: 'Alcance y entrada en vigor' },
  effectSingle: {
    fr: "La partie à laquelle un domaine est confié en a la maîtrise exclusive : l'autre partie ne peut plus modifier les éléments qui en relèvent. Un domaine confié aux deux parties reste modifiable par chacune. Cette répartition est appliquée techniquement par la plateforme Yuno, et non seulement déclarative. Elle prend effet à la date de la seconde signature et s'applique à la soirée visée.",
    en: 'The party to whom a domain is allocated has exclusive control over it: the other party may no longer modify the items falling within it. A domain allocated to both parties remains editable by each. This allocation is technically enforced by the Yuno platform, not merely declaratory. It takes effect on the date of the second signature and applies to the event concerned.',
    es: 'La parte a la que se asigna un dominio tiene su control exclusivo: la otra parte ya no puede modificar los elementos correspondientes. Un dominio asignado a ambas partes sigue siendo editable por cada una. Este reparto lo aplica técnicamente la plataforma Yuno, no es solo declarativo. Surte efecto en la fecha de la segunda firma y se aplica a la noche indicada.',
  },
  effectSeries: {
    fr: "La partie à laquelle un domaine est confié en a la maîtrise exclusive : l'autre partie ne peut plus modifier les éléments qui en relèvent. Un domaine confié aux deux parties reste modifiable par chacune. Cette répartition est appliquée techniquement par la plateforme Yuno, et non seulement déclarative. Elle prend effet à la date de la seconde signature et s'applique à TOUTES LES DATES À VENIR de la série, les soirées déjà tenues restant régies par la répartition antérieure. Le jour et l'horaire de la série demeurent fixés par le Club, en tant qu'éléments d'identification du contrat-cadre.",
    en: 'The party to whom a domain is allocated has exclusive control over it: the other party may no longer modify the items falling within it. A domain allocated to both parties remains editable by each. This allocation is technically enforced by the Yuno platform, not merely declaratory. It takes effect on the date of the second signature and applies to ALL UPCOMING DATES of the series; events already held remain governed by the prior allocation. The day and time of the series remain set by the Club, as identifying elements of the framework contract.',
    es: 'La parte a la que se asigna un dominio tiene su control exclusivo: la otra parte ya no puede modificar los elementos correspondientes. Un dominio asignado a ambas partes sigue siendo editable por cada una. Este reparto lo aplica técnicamente la plataforma Yuno, no es solo declarativo. Surte efecto en la fecha de la segunda firma y se aplica a TODAS LAS FECHAS FUTURAS de la serie; las noches ya celebradas siguen rigiéndose por el reparto anterior. El día y el horario de la serie los sigue fijando el Club, como elementos identificativos del contrato marco.',
  },
  split: { fr: 'Modification du partage des revenus', en: 'Change to the revenue split', es: 'Modificación del reparto de ingresos' },
  splitNote: {
    fr: "Cette modification ne s'applique qu'aux soirées dont les ventes n'ont pas commencé. Une soirée déjà ouverte à la vente conserve les conditions financières sous lesquelles le public a acheté.",
    en: 'This change applies only to events whose sales have not started. An event already open for sale keeps the financial terms under which the public purchased.',
    es: 'Esta modificación solo se aplica a las noches cuyas ventas no han comenzado. Una noche ya abierta a la venta conserva las condiciones económicas bajo las que el público compró.',
  },
  tickets: { fr: 'Billets', en: 'Tickets', es: 'Entradas' },
  tables: { fr: 'Tables / VIP', en: 'Tables / VIP', es: 'Mesas / VIP' },
  drinks: { fr: 'Boissons', en: 'Drinks', es: 'Bebidas' },
  reason: { fr: 'Motif invoqué', en: 'Stated reason', es: 'Motivo alegado' },
  legal: { fr: 'Régime juridique', en: 'Legal regime', es: 'Régimen jurídico' },
  legalBody: {
    fr: "Conformément à l'article 1193 du Code civil, le contrat ne peut être modifié que du consentement mutuel des parties : le présent avenant ne produit aucun effet tant qu'il n'est pas signé par les deux. Les parties étant des professionnels, la preuve est libre entre elles (article L110-3 du Code de commerce) ; aucun écrit n'est imposé par la loi pour convenir d'une telle répartition, et le présent document est établi à titre de preuve. Les signatures ci-dessous sont des signatures électroniques simples au sens du règlement (UE) n° 910/2014 (eIDAS) : leur force probante repose sur l'horodatage, l'adresse IP et le terminal enregistrés par la plateforme au moment du clic.",
    en: 'Pursuant to article 1193 of the French Civil Code, a contract may only be modified by mutual consent of the parties: this amendment has no effect until signed by both. As the parties are businesses, evidence is free between them (article L110-3 of the French Commercial Code); no writing is required by law to agree on such an allocation, and this document is drawn up as evidence. The signatures below are simple electronic signatures within the meaning of Regulation (EU) No 910/2014 (eIDAS): their evidential weight rests on the timestamp, IP address and device recorded by the platform at the time of the click.',
    es: 'Conforme al artículo 1193 del Código Civil francés, el contrato solo puede modificarse por consentimiento mutuo de las partes: la presente adenda no produce efecto alguno mientras no la firmen ambas. Al ser las partes profesionales, la prueba es libre entre ellas (artículo L110-3 del Código de Comercio francés); la ley no impone ningún escrito para acordar tal reparto, y este documento se establece como medio de prueba. Las firmas siguientes son firmas electrónicas simples en el sentido del Reglamento (UE) n.º 910/2014 (eIDAS): su fuerza probatoria descansa en la marca de tiempo, la dirección IP y el terminal registrados por la plataforma en el momento del clic.',
  },
  signatures: { fr: 'Signatures électroniques', en: 'Electronic signatures', es: 'Firmas electrónicas' },
  forClub: { fr: 'Pour le Club', en: 'For the Club', es: 'Por el Club' },
  forOrg: { fr: "Pour l'Organisateur", en: 'For the Organizer', es: 'Por el Organizador' },
  signedOn: { fr: 'Signé le', en: 'Signed on', es: 'Firmado el' },
  notSigned: { fr: 'En attente de signature', en: 'Awaiting signature', es: 'Pendiente de firma' },
  proposedBy: { fr: 'Proposé par', en: 'Proposed by', es: 'Propuesto por' },
  contract: { fr: 'Contrat modifié', en: 'Amended contract', es: 'Contrato modificado' },
  subject: { fr: 'Objet de la collaboration', en: 'Collaboration subject', es: 'Objeto de la colaboración' },
  footer: {
    fr: "Document généré par Yuno. Signature électronique simple (eIDAS) — la preuve juridique est l'horodatage et l'adresse IP enregistrés.",
    en: 'Document generated by Yuno. Simple electronic signature (eIDAS) — the legal evidence is the recorded timestamp and IP address.',
    es: 'Documento generado por Yuno. Firma electrónica simple (eIDAS) — la prueba legal es la marca de tiempo y la IP registradas.',
  },
} satisfies Record<string, L>;

const fmtDateTime = (d?: Date | null) =>
  d ? `${d.toLocaleDateString('fr-FR')} ${d.toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' })}` : '—';

export function generateAmendmentPDF(data: AmendmentPDFData): Blob {
  const lang: Lang = data.language ?? 'fr';
  const pick = (l: L) => pickL(lang, l);

  const doc = new jsPDF({ unit: 'mm', format: 'a4' });
  const PAGE_W = 210;
  const PAGE_H = 297;
  const M = 18;
  const CONTENT_W = PAGE_W - M * 2;
  let y = M;
  let article = 0;

  const ensure = (h: number) => {
    if (y + h > PAGE_H - M - 8) { doc.addPage(); y = M; }
  };

  const heading = (title: L) => {
    article += 1;
    ensure(12);
    y += 3;
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(11);
    doc.setTextColor(20, 20, 20);
    doc.text(`${article}. ${pick(title)}`, M, y);
    y += 5.5;
  };

  const para = (l: L) => {
    doc.setFont('helvetica', 'normal');
    doc.setFontSize(9);
    doc.setTextColor(60, 60, 60);
    const lines = doc.splitTextToSize(pick(l), CONTENT_W) as string[];
    ensure(lines.length * 4.2 + 2);
    doc.text(lines, M, y);
    y += lines.length * 4.2 + 1.5;
  };

  const row = (label: string, value: string) => {
    ensure(7);
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(8.5);
    doc.setTextColor(120, 120, 120);
    doc.text(label, M, y);
    doc.setFont('helvetica', 'normal');
    doc.setFontSize(9.5);
    doc.setTextColor(20, 20, 20);
    const lines = doc.splitTextToSize(value || '—', CONTENT_W - 58) as string[];
    doc.text(lines, M + 55, y);
    y += Math.max(6.5, lines.length * 4.6);
  };

  const detail = (label: L, val?: string | null) => {
    if (!val) return;
    doc.setFont('helvetica', 'normal');
    doc.setFontSize(8.5);
    doc.setTextColor(115, 115, 115);
    const lines = doc.splitTextToSize(`${pick(label)} : ${val}`, CONTENT_W) as string[];
    ensure(lines.length * 4);
    doc.text(lines, M, y);
    y += lines.length * 4;
  };

  const party = (role: L, p: AmendmentParty) => {
    ensure(14);
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(8.5);
    doc.setTextColor(120, 120, 120);
    doc.text(pick(role), M, y);
    y += 4.5;
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(11);
    doc.setTextColor(20, 20, 20);
    doc.text(p.name || '—', M, y);
    y += 5;
    detail(LBL.denom, p.legalName);
    detail(LBL.address, p.legalAddress);
    detail(LBL.reg, p.registrationNumber);
    detail(LBL.vat, p.vatNumber);
    y += 3;
  };

  // ── En-tête ──
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(16);
  doc.setTextColor(15, 15, 15);
  doc.text(pick(LBL.docTitle), M, y);
  y += 6;
  doc.setFont('helvetica', 'normal');
  doc.setFontSize(8.5);
  doc.setTextColor(130, 130, 130);
  doc.text(`Réf. ${data.amendmentId}`, M, y);
  y += 7;

  // ── 1. Parties ──
  heading(LBL.parties);
  party(LBL.club, data.venue);
  party(LBL.org, data.organizer);
  row(pick(LBL.contract), data.contractRef);
  row(pick(LBL.subject), data.subject);
  row(pick(LBL.proposedBy), `${data.proposedByLabel}${data.proposedAt ? ` — ${fmtDateTime(data.proposedAt)}` : ''}`);

  // ── 2. Objet ──
  heading(LBL.object);
  para(LBL.objectBody);

  // ── 3. Nouvelle répartition ──
  heading(LBL.allocation);
  const prev = normalizeResponsibilities(data.prevResponsibilities, null);
  const next = data.nextResponsibilities ? normalizeResponsibilities(data.nextResponsibilities, null) : null;
  for (const d of COLLAB_DOMAINS) {
    ensure(20);
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(9.5);
    doc.setTextColor(20, 20, 20);
    doc.text(pick(DOMAIN_TITLE[d]), M, y);
    y += 5;
    const from = pick(HOLDER_L[prev[d]]);
    const to = next ? pick(HOLDER_L[next[d]]) : null;
    const changed = !!next && next[d] !== prev[d];
    doc.setFont('helvetica', changed ? 'bold' : 'normal');
    doc.setFontSize(9);
    doc.setTextColor(changed ? 20 : 110, changed ? 20 : 110, changed ? 20 : 110);
    doc.text(
      changed ? `${pick(LBL.before)} : ${from}   →   ${pick(LBL.after)} : ${to}`
        : `${pick(LBL.unchanged)} — ${from}`,
      M + 2, y,
    );
    y += 5;
    doc.setFont('helvetica', 'normal');
    doc.setFontSize(8.5);
    doc.setTextColor(115, 115, 115);
    const sc = doc.splitTextToSize(`${pick(LBL.scope)} : ${pick(DOMAIN_SCOPE[d])}`, CONTENT_W - 2) as string[];
    ensure(sc.length * 4);
    doc.text(sc, M + 2, y);
    y += sc.length * 4 + 3;
  }

  // ── 4. Partage des revenus (seulement s'il change) ──
  if (data.nextSplit) {
    heading(LBL.split);
    const p = data.prevSplit;
    const n = data.nextSplit;
    row(pick(LBL.tickets), `${p ? `${p.tickets.venue_pct}% Club` : '—'}  →  ${n.tickets.venue_pct}% Club`);
    row(pick(LBL.tables), `${p ? `${p.tables.venue_pct}% Club` : '—'}  →  ${n.tables.venue_pct}% Club`);
    row(pick(LBL.drinks), `${p ? `${p.drinks.venue_pct}% Club` : '—'}  →  ${n.drinks.venue_pct}% Club`);
    y += 1;
    para(LBL.splitNote);
  }

  // ── 5. Portée et prise d'effet ──
  heading(LBL.effect);
  para(data.recurring ? LBL.effectSeries : LBL.effectSingle);

  // ── 6. Motif ──
  if (data.reason) {
    heading(LBL.reason);
    para({ fr: data.reason, en: data.reason, es: data.reason });
  }

  // ── 7. Régime juridique ──
  heading(LBL.legal);
  para(LBL.legalBody);

  // ── Signatures ──
  ensure(46);
  y += 2;
  doc.setDrawColor(232, 232, 232);
  doc.line(M, y, PAGE_W - M, y);
  y += 5;
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(10);
  doc.setTextColor(20, 20, 20);
  doc.text(pick(LBL.signatures), M, y);
  y += 6;

  const sigBlock = (role: L, name: string | undefined, at: Date | null | undefined, ip: string | null | undefined, x: number) => {
    let sy = y;
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(8.5);
    doc.setTextColor(120, 120, 120);
    doc.text(pick(role), x, sy);
    sy += 5;
    doc.setFont('helvetica', 'normal');
    doc.setFontSize(9.5);
    doc.setTextColor(20, 20, 20);
    doc.text(name || '—', x, sy);
    sy += 5;
    doc.setFontSize(8);
    doc.setTextColor(115, 115, 115);
    doc.text(at ? `${pick(LBL.signedOn)} ${fmtDateTime(at)}` : pick(LBL.notSigned), x, sy);
    sy += 4;
    if (ip) { doc.text(`IP ${ip}`, x, sy); sy += 4; }
    return sy;
  };
  const yA = sigBlock(LBL.forClub, data.venueSignedName ?? data.venue.name, data.venueSignedAt, data.venueSignedIp, M);
  const yB = sigBlock(LBL.forOrg, data.orgSignedName ?? data.organizer.name, data.orgSignedAt, data.orgSignedIp, M + CONTENT_W / 2);
  y = Math.max(yA, yB) + 4;

  if (data.effectiveAt) {
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(8.5);
    doc.setTextColor(20, 20, 20);
    doc.text(
      `${pick({ fr: "Prise d'effet", en: 'Effective from', es: 'Entrada en vigor' })} : ${fmtDateTime(data.effectiveAt)}`,
      M, y,
    );
    y += 6;
  }

  // ── Pied de page sur chaque page ──
  const pages = doc.getNumberOfPages();
  for (let i = 1; i <= pages; i++) {
    doc.setPage(i);
    doc.setFont('helvetica', 'normal');
    doc.setFontSize(7.5);
    doc.setTextColor(150, 150, 150);
    const lines = doc.splitTextToSize(pick(LBL.footer), CONTENT_W) as string[];
    doc.text(lines, M, PAGE_H - M + 2);
    doc.text(`${i} / ${pages}`, PAGE_W - M, PAGE_H - M + 2, { align: 'right' });
  }

  return doc.output('blob');
}

export function previewAmendmentPDF(data: AmendmentPDFData) {
  const url = URL.createObjectURL(generateAmendmentPDF(data));
  window.open(url, '_blank');
  setTimeout(() => URL.revokeObjectURL(url), 60_000);
}
