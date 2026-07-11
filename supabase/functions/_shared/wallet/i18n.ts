// Labels des passes Apple Wallet — FR/EN/ES (décision D6 : le pass est généré
// dans la langue de l'utilisateur au moment de l'émission, pas de .lproj).
// Même défaut que les emails : 'fr'.

export type WalletLang = 'fr' | 'en' | 'es';

const LABELS: Record<WalletLang, Record<string, string>> = {
  fr: {
    event: 'ÉVÉNEMENT',
    venue: 'CLUB',
    date: 'DATE',
    ticket: 'BILLET',
    persons: 'PERSONNES',
    table: 'TABLE',
    arrival: 'ARRIVÉE',
    minSpend: 'MINIMUM CONSO',
    guests: 'INVITÉS',
    reference: 'Référence',
    holder: 'Titulaire',
    help: 'Aide',
    ticketDescription: 'Billet',
    vipDescription: 'Table VIP',
    manage: 'Gérer ma commande',
    showAtEntry: 'Présente ce code à l’entrée',
  },
  en: {
    event: 'EVENT',
    venue: 'VENUE',
    date: 'DATE',
    ticket: 'TICKET',
    persons: 'GUESTS',
    table: 'TABLE',
    arrival: 'ARRIVAL',
    minSpend: 'MIN. SPEND',
    guests: 'GUESTS',
    reference: 'Reference',
    holder: 'Holder',
    help: 'Help',
    ticketDescription: 'Ticket',
    vipDescription: 'VIP table',
    manage: 'Manage my order',
    showAtEntry: 'Show this code at the door',
  },
  es: {
    event: 'EVENTO',
    venue: 'CLUB',
    date: 'FECHA',
    ticket: 'ENTRADA',
    persons: 'PERSONAS',
    table: 'MESA',
    arrival: 'LLEGADA',
    minSpend: 'CONSUMO MÍNIMO',
    guests: 'INVITADOS',
    reference: 'Referencia',
    holder: 'Titular',
    help: 'Ayuda',
    ticketDescription: 'Entrada',
    vipDescription: 'Mesa VIP',
    manage: 'Gestionar mi pedido',
    showAtEntry: 'Muestra este código en la entrada',
  },
};

export function normalizeWalletLang(lang: string | null | undefined): WalletLang {
  return lang === 'en' || lang === 'es' ? lang : 'fr';
}

/** Label localisé d'un champ de pass. */
export function wl(lang: WalletLang, key: string): string {
  return LABELS[lang][key] ?? LABELS.fr[key] ?? key;
}
