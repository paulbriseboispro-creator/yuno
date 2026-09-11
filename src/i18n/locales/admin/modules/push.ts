import type { AdminDict } from './types';

// Compléments des pages « Campagnes push » et « Notifications auto » — [EN, FR, ES].
const dict: AdminDict = {
  'adm.push.titlePlaceholder': ['Tonight from 11pm…', 'Ce soir dès 23 h…', 'Esta noche desde las 23 h…'],
  'adm.push.bodyPlaceholder': ['Doors open, the line is short…', 'Les portes ouvrent, la file est courte…', 'Las puertas abren, la fila es corta…'],
  'adm.push.historyScope': ['Platform campaigns only. Club and agency pushes live in their own dashboards, automatic ones in the registry.', 'Campagnes plateforme uniquement. Les push des clubs et des agences vivent dans leurs dashboards, les automatiques dans le registre.', 'Solo campañas de la plataforma. Los push de clubs y agencias viven en sus paneles, los automáticos en el registro.'],
  'adm.auto.unknownKey': ['Not in the front catalog yet', 'Pas encore dans le catalogue du front', 'Aún no está en el catálogo del front'],
  'adm.auto.k.audience_weekly_recap.name': ['Weekly audience recap', 'Récap d’audience hebdo', 'Resumen semanal de audiencia'],
  'adm.auto.k.audience_weekly_recap.desc': ['Sent to clubs, DJs and organizers: followers gained and lost over the week.', 'Envoyé aux clubs, DJs et organisateurs : abonnés gagnés et perdus sur la semaine.', 'Enviado a clubs, DJs y organizadores: seguidores ganados y perdidos en la semana.'],
  'adm.auto.k.door_manifest_preload.name': ['Load the door list before doors', 'Charger la liste avant les portes', 'Cargar la lista antes de la puerta'],
  'adm.auto.k.door_manifest_preload.desc': ['Sent 2 to 5 hours before doors to whoever works the door that night: opening Yuno Pro stores the whole guest list on their phone, so scanning still works with no signal. No server can fill a phone cache — this reminder is the only lever.', 'Envoyé 2 à 5 h avant l’ouverture à qui tiendra la porte ce soir-là : ouvrir Yuno Pro met toute la liste dans son téléphone, et le scan marche alors sans réseau. Aucun serveur ne peut remplir le cache d’un téléphone — ce rappel est le seul levier.', 'Enviado de 2 a 5 horas antes de la apertura a quien esté en la puerta esa noche: abrir Yuno Pro guarda toda la lista en su teléfono y el escaneo funciona sin cobertura. Ningún servidor puede llenar la caché de un teléfono: este aviso es la única palanca.'],
  'adm.auto.dormant': ['No sender any more', 'Plus aucun émetteur', 'Ya sin emisor'],
  'adm.auto.dormantHint': ['This key is still in the database but no function sends it today. Keeping it off costs nothing.', 'Cette clé existe encore en base mais aucune fonction ne l’envoie aujourd’hui. La laisser éteinte ne coûte rien.', 'Esta clave sigue en la base pero ninguna función la envía hoy. Dejarla apagada no cuesta nada.'],
};

export default dict;
