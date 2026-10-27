import type { Triple } from '../../crm/modules/types';

// Analyses de Yuno Tickets, la bascule (lot 8 du plan combiné, 24/10) —
// [EN, FR, ES], vouvoiement. Communauté porte les trois vues de l'ancienne
// Analytics que le lot 5 redessinera (Abonnés, Achats, Public).
const dict: Record<string, Triple> = {
  'ya.cm.more.aria': ['Community views', 'Vues de Communauté', 'Vistas de Comunidad'],
  'ya.cm.more.overview': ['Overview', 'Vue d’ensemble', 'Resumen'],
  'ya.cm.more.subscribers': ['Subscribers', 'Abonnés', 'Suscriptores'],
  'ya.cm.more.purchase': ['Purchases', 'Achats', 'Compras'],
  'ya.cm.more.audience': ['Audience', 'Public', 'Público'],
  'ya.kept.tables': ['VIP consumption and hosts', 'Consommation VIP et hôtes', 'Consumo VIP y anfitriones'],
};

export default dict;
