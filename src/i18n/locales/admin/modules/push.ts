import type { AdminDict } from './types';

// Compléments des pages « Campagnes push » et « Notifications auto » — [EN, FR, ES].
const dict: AdminDict = {
  'adm.push.titlePlaceholder': ['Tonight from 11pm…', 'Ce soir dès 23 h…', 'Esta noche desde las 23 h…'],
  'adm.push.bodyPlaceholder': ['Doors open, the line is short…', 'Les portes ouvrent, la file est courte…', 'Las puertas abren, la fila es corta…'],
  'adm.push.historyScope': ['Platform campaigns only. Club and agency pushes live in their own dashboards, automatic ones in the registry.', 'Campagnes plateforme uniquement. Les push des clubs et des agences vivent dans leurs dashboards, les automatiques dans le registre.', 'Solo campañas de la plataforma. Los push de clubs y agencias viven en sus paneles, los automáticos en el registro.'],
  'adm.auto.unknownKey': ['Not in the front catalog yet', 'Pas encore dans le catalogue du front', 'Aún no está en el catálogo del front'],
  'adm.auto.k.audience_weekly_recap.name': ['Weekly audience recap', 'Récap d’audience hebdo', 'Resumen semanal de audiencia'],
  'adm.auto.k.audience_weekly_recap.desc': ['Sent to clubs, DJs and organizers: followers gained and lost over the week.', 'Envoyé aux clubs, DJs et organisateurs : abonnés gagnés et perdus sur la semaine.', 'Enviado a clubs, DJs y organizadores: seguidores ganados y perdidos en la semana.'],
  'adm.auto.dormant': ['No sender any more', 'Plus aucun émetteur', 'Ya sin emisor'],
  'adm.auto.dormantHint': ['This key is still in the database but no function sends it today. Keeping it off costs nothing.', 'Cette clé existe encore en base mais aucune fonction ne l’envoie aujourd’hui. La laisser éteinte ne coûte rien.', 'Esta clave sigue en la base pero ninguna función la envía hoy. Dejarla apagada no cuesta nada.'],
};

export default dict;
