import type { AdminDict } from './types';

// Page « Commandes » — remboursement (compléments aux clés admin.orders.*) — [EN, FR, ES].
const dict: AdminDict = {
  'adm.orders.refund': ['Refund', 'Rembourser', 'Reembolsar'],
  'adm.orders.paidAmount': ['Amount paid', 'Montant payé', 'Importe pagado'],
  'adm.orders.refundAmount': ['Amount to refund (€)', 'Montant à rembourser (€)', 'Importe a reembolsar (€)'],
  'adm.orders.reason': ['Reason (required)', 'Raison (obligatoire)', 'Motivo (obligatorio)'],
  'adm.orders.reasonPh': ['e.g. event cancelled, double payment…', 'Ex : soirée annulée, double paiement…', 'Ej.: evento cancelado, doble pago…'],
  'adm.orders.refundHint': ['Stripe refunds the customer and reverses the transfer to the club. The amount is capped server-side at (paid − Yuno service fee).', 'Stripe rembourse le client et inverse le transfert au club. Le montant est plafonné côté serveur à (payé − frais de service Yuno).', 'Stripe reembolsa al cliente y revierte la transferencia al club. El importe se limita en el servidor a (pagado − comisión de servicio Yuno).'],
  'adm.orders.processing': ['Processing…', 'Traitement…', 'Procesando…'],
  'adm.orders.confirmRefund': ['Confirm refund', 'Confirmer le remboursement', 'Confirmar reembolso'],
  'adm.orders.invalidAmount': ['Invalid amount', 'Montant invalide', 'Importe no válido'],
  'adm.orders.reasonRequired': ['A reason is required', 'La raison est obligatoire', 'El motivo es obligatorio'],
  'adm.orders.refundFailed': ['Refund failed', 'Échec du remboursement', 'Reembolso fallido'],
  'adm.orders.refunded': ['Refund of {v} issued', 'Remboursement de {v} effectué', 'Reembolso de {v} emitido'],
  // Onglet Guest list — pilier sans argent : ce qui compte est qui est inscrit
  // et qui est vraiment passé à la porte.
  'adm.orders.guestlist': ['Guest list', 'Guest list', 'Guest list'],
  'adm.orders.gl.signups': ['Sign-ups', 'Inscriptions', 'Inscripciones'],
  'adm.orders.gl.entered': ['Checked in', 'Entrées', 'Entradas'],
  'adm.orders.gl.cancelled': ['Cancelled', 'Annulations', 'Cancelaciones'],
  'adm.orders.gl.showRate': ['{v} of sign-ups', '{v} des inscrits', '{v} de los inscritos'],
  'adm.orders.gl.host': ['Host', 'Hôte', 'Anfitrión'],
  'adm.orders.gl.part': ['List', 'Part', 'Lista'],
  'adm.orders.gl.type': ['Type', 'Type', 'Tipo'],
  'adm.orders.gl.searchPh': ['Search by email or name', 'Rechercher par email ou nom', 'Buscar por email o nombre'],
  'adm.orders.refundUnavailable': ['Refund service unavailable (owner-refund function not deployed).', 'Service de remboursement indisponible (fonction owner-refund non déployée).', 'Servicio de reembolso no disponible (función owner-refund sin desplegar).'],
};

export default dict;
