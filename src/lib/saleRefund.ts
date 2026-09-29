/**
 * Règle de remboursement d'une vente — la MÊME que le serveur applique
 * (owner-refund, cancel-ticket, webhook `charge.refunded`). Une seule source :
 * le module pur de supabase/functions/_shared, importé tel quel. L'écran affiche
 * donc exactement le plafond que le serveur acceptera.
 */
export * from '../../supabase/functions/_shared/sale-refund.ts';
