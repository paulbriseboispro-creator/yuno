import {
  Megaphone, Link2, Coins, BarChart3, QrCode, Users, ShieldAlert, ChefHat, Bell, Clock,
  Crown, Sparkles, MousePointerClick, TrendingUp, Shirt, Package, CreditCard, type LucideIcon,
} from 'lucide-react';

export type RoleIntroKey = 'promoter' | 'bouncer' | 'barman' | 'viphost' | 'affiliate' | 'cloakroom';

// Trilingual tuple: [fr, en, es]
type L = [string, string, string];

export interface RoleIntroSlide {
  icon: LucideIcon;
  title: L;
  desc: L;
}

export interface RoleIntroDef {
  icon: LucideIcon;
  title: L;
  slides: RoleIntroSlide[];
}

export const ROLE_INTROS: Record<RoleIntroKey, RoleIntroDef> = {
  promoter: {
    icon: Megaphone,
    title: ['Bienvenue, promoteur', 'Welcome, promoter', 'Bienvenido, promotor'],
    slides: [
      {
        icon: Link2,
        title: ['Votre lien unique', 'Your unique link', 'Tu enlace único'],
        desc: [
          'Partagez votre lien personnel : chaque billet ou table vendu via ce lien vous est crédité automatiquement.',
          'Share your personal link: every ticket or table sold through it is automatically credited to you.',
          'Comparte tu enlace personal: cada entrada o mesa vendida con él se te acredita automáticamente.',
        ],
      },
      {
        icon: Coins,
        title: ['Vos commissions', 'Your commissions', 'Tus comisiones'],
        desc: [
          'Vous touchez une commission à chaque entrée validée à la porte. Suivez vos gains en temps réel.',
          'You earn a commission on every guest checked in at the door. Track your earnings in real time.',
          'Ganas una comisión por cada entrada validada en la puerta. Sigue tus ganancias en tiempo real.',
        ],
      },
      {
        icon: BarChart3,
        title: ['Votre tableau de bord', 'Your dashboard', 'Tu panel'],
        desc: [
          'Ventes, clics, classement : tout est ici. Plus vous partagez, plus vous gagnez.',
          'Sales, clicks, ranking: it is all here. The more you share, the more you earn.',
          'Ventas, clics, ranking: todo está aquí. Cuanto más compartes, más ganas.',
        ],
      },
    ],
  },

  bouncer: {
    icon: QrCode,
    title: ['Votre poste à la porte', 'Your spot at the door', 'Tu puesto en la puerta'],
    slides: [
      {
        icon: QrCode,
        title: ['Scannez les billets', 'Scan tickets', 'Escanea las entradas'],
        desc: [
          'Scannez le QR de chaque client. Vert = entrée OK, rouge = refusé ou déjà utilisé.',
          'Scan each guest\'s QR code. Green = let them in, red = refused or already used.',
          'Escanea el QR de cada cliente. Verde = adelante, rojo = rechazado o ya usado.',
        ],
      },
      {
        icon: Users,
        title: ['Liste & recherche', 'List & search', 'Lista y búsqueda'],
        desc: [
          'Pas de QR ? Cherchez le client par nom dans la liste et validez l\'entrée manuellement.',
          'No QR? Find the guest by name in the list and check them in manually.',
          '¿Sin QR? Busca al cliente por nombre en la lista y valida la entrada manualmente.',
        ],
      },
      {
        icon: ShieldAlert,
        title: ['Signalements', 'Flagging', 'Reportes'],
        desc: [
          'Signalez un comportement à risque : l\'info remonte instantanément à l\'équipe et au club.',
          'Flag risky behavior: the alert goes straight to the team and the venue.',
          'Reporta un comportamiento de riesgo: la alerta llega al instante al equipo y al local.',
        ],
      },
    ],
  },

  cloakroom: {
    icon: Shirt,
    title: ['Bienvenue au vestiaire', 'Welcome to the cloakroom', 'Bienvenido al guardarropa'],
    slides: [
      {
        icon: QrCode,
        title: ['Scannez, puis numérotez', 'Scan, then number it', 'Escanea y numera'],
        desc: [
          'Scannez le billet du client, saisissez le numéro de patère, c\'est enregistré.',
          'Scan the guest\'s ticket, type the peg number, and it\'s logged.',
          'Escanea la entrada del cliente, escribe el número de percha y queda registrado.',
        ],
      },
      {
        icon: Package,
        title: ['La restitution', 'Handing things back', 'La devolución'],
        desc: [
          'Le client repasse son QR en fin de soirée : son numéro s\'affiche, vous rendez ses affaires.',
          'The guest scans their QR at the end of the night: their number shows up, you hand their things back.',
          'El cliente vuelve a escanear su QR al final de la noche: aparece su número y le devuelves sus cosas.',
        ],
      },
      {
        icon: CreditCard,
        title: ['Les paiements', 'Payments', 'Los pagos'],
        desc: [
          'Payé en ligne : rien à encaisser. Payé sur place : confirmez l\'encaissement avant de valider.',
          'Paid online: nothing to collect. Paid on site: confirm the payment before validating.',
          'Pagado en línea: nada que cobrar. Pagado en el sitio: confirma el cobro antes de validar.',
        ],
      },
    ],
  },

  barman: {
    icon: ChefHat,
    title: ['Bienvenue au bar', 'Welcome to the bar', 'Bienvenido a la barra'],
    slides: [
      {
        icon: Bell,
        title: ['Les commandes arrivent ici', 'Orders land here', 'Los pedidos llegan aquí'],
        desc: [
          'Chaque commande payée s\'affiche en temps réel. Préparez-la, puis marquez-la « prête ».',
          'Every paid order shows up in real time. Prepare it, then mark it "ready".',
          'Cada pedido pagado aparece en tiempo real. Prepáralo y márcalo como "listo".',
        ],
      },
      {
        icon: QrCode,
        title: ['Remise au client', 'Handing it over', 'Entrega al cliente'],
        desc: [
          'Le client présente son QR au bar. Scannez-le pour valider la remise de la commande.',
          'The guest shows their QR at the bar. Scan it to confirm handover.',
          'El cliente muestra su QR en la barra. Escanéalo para confirmar la entrega.',
        ],
      },
      {
        icon: Clock,
        title: ['Votre service', 'Your shift', 'Tu turno'],
        desc: [
          'Suivez vos stats de service et basculez entre les bars du club si besoin.',
          'Track your shift stats and switch between the venue\'s bars when needed.',
          'Sigue las estadísticas de tu turno y cambia entre las barras del local si hace falta.',
        ],
      },
    ],
  },

  viphost: {
    icon: Crown,
    title: ['Bienvenue, hôte VIP', 'Welcome, VIP host', 'Bienvenido, anfitrión VIP'],
    slides: [
      {
        icon: Crown,
        title: ['Vos tables VIP', 'Your VIP tables', 'Tus mesas VIP'],
        desc: [
          'Visualisez toutes les réservations de la soirée : plan de salle ou grille, par zone.',
          'See every reservation of the night: floor plan or grid, by zone.',
          'Visualiza todas las reservas de la noche: plano o cuadrícula, por zona.',
        ],
      },
      {
        icon: Bell,
        title: ['Arrivées & commandes', 'Arrivals & orders', 'Llegadas y pedidos'],
        desc: [
          'Les arrivées clients et les commandes bouteilles vous sont notifiées en direct.',
          'Guest arrivals and bottle orders are pushed to you live.',
          'Las llegadas de clientes y los pedidos de botellas se te notifican en directo.',
        ],
      },
      {
        icon: Sparkles,
        title: ['Placement & service', 'Seating & service', 'Ubicación y servicio'],
        desc: [
          'Placez les groupes, suivez le minimum de dépense et gérez le service de A à Z.',
          'Seat groups, track minimum spend and run the service end to end.',
          'Ubica los grupos, controla el consumo mínimo y gestiona el servicio de principio a fin.',
        ],
      },
    ],
  },

  affiliate: {
    icon: Link2,
    title: ['Bienvenue, affilié', 'Welcome, affiliate', 'Bienvenido, afiliado'],
    slides: [
      {
        icon: Link2,
        title: ['Votre linktree', 'Your linktree', 'Tu linktree'],
        desc: [
          'Votre page de liens multi-ville : ajoutez les clubs et événements que vous promouvez.',
          'Your multi-city link page: add the venues and events you promote.',
          'Tu página de enlaces multiciudad: añade los locales y eventos que promocionas.',
        ],
      },
      {
        icon: MousePointerClick,
        title: ['Clics & vues', 'Clicks & views', 'Clics y vistas'],
        desc: [
          'Suivez les clics et les vues sur chacun de vos liens, ville par ville.',
          'Track clicks and views on each of your links, city by city.',
          'Sigue los clics y las vistas de cada enlace, ciudad por ciudad.',
        ],
      },
      {
        icon: TrendingUp,
        title: ['Vos performances', 'Your performance', 'Tu rendimiento'],
        desc: [
          'Analysez ce qui marche et concentrez-vous sur vos meilleurs spots.',
          'See what works and double down on your best spots.',
          'Analiza qué funciona y enfócate en tus mejores sitios.',
        ],
      },
    ],
  },
};
