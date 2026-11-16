/**
 * Règles de la rubrique « Légal » (module PUR, testé : src/admin/legal/__tests__/rules.test.ts).
 *
 * Rien ici n'est un avis juridique. Chaque seuil ou obligation cite la source du
 * dépôt qui le porte, ou se dit « à confirmer par un juriste » dans l'écran.
 */
export type LegalState = 'ok' | 'todo' | 'late';

/**
 * Documents qu'un titulaire de compte pro doit avoir acceptés, par produit.
 * Billetterie : CGU pro et engagement de confidentialité, demandés à l'inscription
 * (`complete_pro_signup`, LegalAcceptance). CRM : Conditions Yuno CRM et accord de
 * sous-traitance, demandés par `CrmLegalGate` (CLAUDE.md, « Textes légaux »).
 */
export const REQUIRED_DOCS: Record<'suite' | 'crm', string[]> = {
  suite: ['terms_pro', 'confidentiality'],
  crm: ['terms_crm', 'dpa'],
};

/** Documents manquants ou acceptés dans une version périmée. */
export function missingDocs(
  products: string[],
  docs: Record<string, { v: string } | undefined>,
  /** LEGAL_VERSIONS (src/lib/legal.ts), passé par l'appelant : ce module reste pur. */
  versions: Record<string, string>,
): string[] {
  const out = new Set<string>();
  for (const p of products) {
    for (const d of REQUIRED_DOCS[p as 'suite' | 'crm'] ?? []) {
      const got = docs[d]?.v;
      if (!got || got !== versions[d]) out.add(d);
    }
  }
  return [...out].sort();
}

/** Échéance d'une demande : réception + 1 mois, prolongée de 0 à 2 mois (RGPD art. 12.3). */
export function requestDeadline(receivedAt: string, extensionMonths = 0): Date {
  const d = new Date(receivedAt);
  const day = d.getUTCDate();
  d.setUTCDate(1);
  d.setUTCMonth(d.getUTCMonth() + 1 + extensionMonths);
  const last = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + 1, 0)).getUTCDate();
  d.setUTCDate(Math.min(day, last));
  return d;
}

/** Jours pleins jusqu'à une date (négatif = dépassée). */
export function daysUntil(iso: string | Date | null | undefined, now: number = Date.now()): number | null {
  if (!iso) return null;
  const t = typeof iso === 'string' ? new Date(iso.length === 10 ? `${iso}T00:00:00` : iso).getTime() : iso.getTime();
  if (Number.isNaN(t)) return null;
  return Math.floor((t - now) / 86_400_000);
}

/** Heures restantes avant une échéance (incidents : 72 h). */
export function hoursUntil(iso: string | null | undefined, now: number = Date.now()): number | null {
  if (!iso) return null;
  return (new Date(iso).getTime() - now) / 3_600_000;
}

/** État d'une demande : en retard si l'échéance est passée et la demande ouverte. */
export function requestState(r: { closed?: boolean; deadline?: string | null }, now: number = Date.now()): LegalState {
  if (r.closed) return 'ok';
  const d = daysUntil(r.deadline ?? null, now);
  if (d != null && d < 0) return 'late';
  return 'todo';
}

// ── Vue d'ensemble ───────────────────────────────────────────────────────────

export interface OverviewPayload {
  requests: { open: number; overdue: number; next: string | null };
  incidents: { open: number; cnil_pending: number; overdue: number; next: string | null };
  terms: { pros: number; missing: number };
  sellers: { with_stripe: number; incomplete: number };
  deadlines: { active: number; undated: number; soon: number; overdue: number; next: string | null };
  support: { grants: number; sessions: number };
  reports: { pending: number; total: number };
}

export type ObligationId = 'requests' | 'incidents' | 'terms' | 'sellers' | 'deadlines' | 'support' | 'reports';

export interface Obligation {
  id: ObligationId;
  state: LegalState;
  /** Le chiffre qui compte (ouvert, manquant…). */
  count: number;
  /** Prochaine échéance, ISO. */
  next: string | null;
  path: string;
}

/**
 * Les obligations suivies et leur état. « En retard » = une échéance est
 * dépassée ; « à traiter » = quelque chose attend un geste ; sinon « en règle ».
 * Les accès assistés ouverts ne sont jamais « en retard » : ils sont consentis
 * (admin_support_grants), l'écran les rappelle pour qu'on les referme.
 */
export function obligations(o: OverviewPayload): Obligation[] {
  const st = (late: boolean, todo: boolean): LegalState => (late ? 'late' : todo ? 'todo' : 'ok');
  return [
    { id: 'requests', state: st(o.requests.overdue > 0, o.requests.open > 0), count: o.requests.open, next: o.requests.next, path: '/admin/legal/requests' },
    { id: 'incidents', state: st(o.incidents.overdue > 0, o.incidents.open > 0), count: o.incidents.open, next: o.incidents.next, path: '/admin/legal/incidents' },
    { id: 'terms', state: st(false, o.terms.missing > 0), count: o.terms.missing, next: null, path: '/admin/legal/terms' },
    { id: 'sellers', state: st(false, o.sellers.incomplete > 0), count: o.sellers.incomplete, next: null, path: '/admin/legal/sellers' },
    { id: 'deadlines', state: st(o.deadlines.overdue > 0, o.deadlines.soon > 0 || o.deadlines.undated > 0), count: o.deadlines.overdue + o.deadlines.soon + o.deadlines.undated, next: o.deadlines.next, path: '/admin/legal/deadlines' },
    { id: 'support', state: st(false, o.support.grants + o.support.sessions > 0), count: o.support.grants + o.support.sessions, next: null, path: '/admin/pros/support' },
    { id: 'reports', state: st(false, o.reports.pending > 0), count: o.reports.pending, next: null, path: '/admin/legal/reports' },
  ];
}

// ── Vendeurs ─────────────────────────────────────────────────────────────────

export interface SellerRow {
  key: string; kind: 'club' | 'organizer' | 'association'; name: string; email: string | null; is_demo: boolean;
  legal_name: string | null; siret: string | null; rna: string | null; vat_number: string | null;
  legal_address: string | null; vat_regime: string | null; vat_rate: number;
  stripe_account: boolean; charges: boolean; payouts: boolean;
  sales: number; amount: number; invoiced: number; missing_invoices: number; invoices_issued: number;
}

/**
 * Repères DAC7 (directive UE 2021/514) : un vendeur sous 30 ventes ET sous
 * 2 000 € dans l'année est exclu de la déclaration. Repères seulement : les
 * seuils et le statut de Yuno (opérateur de plateforme ou non) sont À CONFIRMER
 * PAR UN JURISTE (plan de la refonte de l'admin, section 6).
 */
export const DAC7_MARKERS = { sales: 30, amount: 2000 } as const;

export function dac7Reached(s: Pick<SellerRow, 'sales' | 'amount'>): boolean {
  return s.sales >= DAC7_MARKERS.sales || s.amount >= DAC7_MARKERS.amount;
}

/** Les champs d'un dossier vendeur qui manquent (aucune obligation inventée : des champs présents ou non). */
export function sellerGaps(s: SellerRow): string[] {
  const gaps: string[] = [];
  if (!s.legal_name) gaps.push('legal_name');
  if (!s.siret && !s.rna) gaps.push('id');
  if (!s.legal_address) gaps.push('address');
  if (s.kind !== 'club' && !s.vat_regime) gaps.push('vat');
  if (!s.charges) gaps.push('stripe');
  return gaps;
}

function csvCell(v: unknown): string {
  const s = v == null ? '' : String(v);
  return /[;"\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

/** Export annuel (séparateur « ; », BOM UTF-8 posé à l'enregistrement). */
export function sellersCsv(rows: SellerRow[], year: number): string {
  const head = ['year', 'account', 'type', 'name', 'legal_name', 'siret', 'rna', 'vat_number', 'legal_address', 'vat_regime', 'vat_rate',
    'stripe_charges', 'stripe_payouts', 'sales', 'amount_eur', 'invoices_issued', 'sales_without_invoice', 'dac7_marker_reached', 'file_complete'];
  const lines = rows.map((s) => [year, s.key, s.kind, s.name, s.legal_name, s.siret, s.rna, s.vat_number, s.legal_address, s.vat_regime, s.vat_rate,
    s.charges ? 'yes' : 'no', s.payouts ? 'yes' : 'no', s.sales, s.amount.toFixed(2), s.invoices_issued, s.missing_invoices,
    dac7Reached(s) ? 'yes' : 'no', sellerGaps(s).length === 0 ? 'yes' : 'no'].map(csvCell).join(';'));
  return [head.join(';'), ...lines].join('\r\n');
}

// ── Liens ────────────────────────────────────────────────────────────────────

/** Fiche d'un pro (lot 2) : `/admin/pros/venue:<id>` | `/admin/pros/org:<uuid>`. */
export function proHref(key: string | null | undefined): string | null {
  if (!key || !/^(venue|org|agency):.+/.test(key)) return null;
  return `/admin/pros/${key}`;
}

/** Fiche d'une personne (lot 3) : la clé est l'e-mail. */
export function personHref(email: string | null | undefined): string | null {
  const e = (email ?? '').trim().toLowerCase();
  return e ? `/admin/clients/${encodeURIComponent(e)}` : null;
}
