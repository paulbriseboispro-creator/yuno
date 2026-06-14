export type LegalSection = 'mentions-legales' | 'cgu' | 'cgv-utilisateurs' | 'cgv-clubs' | 'privacy' | 'cookies';

interface LegalDocument {
  title: string;
  content: string;
}

type LegalContentMap = Record<LegalSection, Record<'fr' | 'en' | 'es', LegalDocument>>;

export const legalContent: LegalContentMap = {
  'mentions-legales': {
    fr: {
      title: 'Mentions Légales',
      content: `**Éditeur du site / plateforme**
Yuno est éditée par : WOMBER (auto-entrepreneur)
Activité principale : vente de textile / Activité secondaire : Yuno
SIRET : 995 130 747 00018
Adresse : 25 avenue Mercure, 31130 Quint-Fonsegrives, France
Email : contact@yunoapp.eu

**Directeur de la publication**
Paul Brisebois (pour WOMBER)

**Hébergement**
Hébergeur (Backend) : Supabase (supabase.com)
Les données sont hébergées sur des serveurs sécurisés avec chiffrement en transit (HTTPS/TLS).

**Plateforme d'intermédiation**
Yuno est une plateforme de mise en relation et de vente en ligne permettant à des établissements partenaires (clubs/organisateurs) de proposer des produits (billets, tables VIP, consommations). Yuno n'est pas le vendeur des produits proposés par les clubs.

**Propriété intellectuelle**
L'ensemble des éléments (marques, logos, textes, interfaces, visuels) est protégé. Toute reproduction sans autorisation est interdite.

**TVA**
Auto-entrepreneur : TVA non applicable – article 293 B du CGI.`
    },
    en: {
      title: 'Legal Notice',
      content: `**Website / Platform Publisher**
Yuno is published by: WOMBER (sole proprietorship)
Main activity: textile sales / Secondary activity: Yuno
SIRET: 995 130 747 00018
Address: 25 avenue Mercure, 31130 Quint-Fonsegrives, France
Email: contact@yunoapp.eu

**Publication Director**
Paul Brisebois (for WOMBER)

**Hosting**
Host (Backend): Supabase (supabase.com)
Data is hosted on secure servers with encryption in transit (HTTPS/TLS).

**Intermediation Platform**
Yuno is an online marketplace platform enabling partner establishments (clubs/organizers) to offer products (tickets, VIP tables, drinks). Yuno is not the seller of products offered by clubs.

**Intellectual Property**
All elements (trademarks, logos, texts, interfaces, visuals) are protected. Any unauthorized reproduction is prohibited.

**VAT**
Sole proprietorship: VAT not applicable – article 293 B of the French General Tax Code.`
    },
    es: {
      title: 'Aviso Legal',
      content: `**Editor del sitio / plataforma**
Yuno es editada por: WOMBER (autónomo)
Actividad principal: venta de textil / Actividad secundaria: Yuno
SIRET: 995 130 747 00018
Dirección: 25 avenue Mercure, 31130 Quint-Fonsegrives, Francia
Email: contact@yunoapp.eu

**Director de publicación**
Paul Brisebois (para WOMBER)

**Alojamiento**
Proveedor (Backend): Supabase (supabase.com)
Los datos están alojados en servidores seguros con cifrado en tránsito (HTTPS/TLS).

**Plataforma de intermediación**
Yuno es una plataforma de intermediación y venta online que permite a establecimientos asociados (clubs/organizadores) ofrecer productos (entradas, mesas VIP, consumiciones). Yuno no es el vendedor de los productos ofrecidos por los clubs.

**Propiedad intelectual**
Todos los elementos (marcas, logotipos, textos, interfaces, visuales) están protegidos. Cualquier reproducción no autorizada está prohibida.

**IVA**
Autónomo: IVA no aplicable – artículo 293 B del Código General de Impuestos francés.`
    }
  },

  'cgu': {
    fr: {
      title: 'Conditions Générales d\'Utilisation',
      content: `**1. Objet**
Les présentes CGU encadrent l'accès et l'utilisation de la plateforme Yuno (site web / web app), permettant de découvrir des événements et d'acheter des produits proposés par des clubs partenaires.

**2. Définitions**
• Plateforme : Yuno (web app yunoapp.eu)
• Utilisateur : toute personne naviguant ou commandant via Yuno
• Club / Organisateur : établissement partenaire proposant des produits
• Produits : billets, acomptes/réservations VIP, consommations, packs, etc.

**3. Accès au service**
Yuno est accessible en ligne. Certaines fonctionnalités nécessitent une commande (et donc la saisie d'informations personnelles). Yuno peut faire évoluer, suspendre ou interrompre certaines fonctionnalités pour maintenance.

**4. Règles d'usage & comportement**
L'Utilisateur s'engage à :
• fournir des informations exactes (notamment email, identité, âge lors d'une première commande)
• ne pas contourner les règles d'accès (contrôle d'identité/âge à l'entrée)
• ne pas utiliser Yuno à des fins frauduleuses (revente abusive, usurpation, contestations injustifiées, etc.)

**5. Alcool, âge et accès en club**
• La commande de produits alcoolisés est réservée aux personnes majeures (18+).
• Lors de la première commande, l'Utilisateur déclare son âge et atteste sur l'honneur être majeur si requis.
• Le club reste responsable du contrôle d'identité et peut refuser l'entrée ou le service (alcool) selon ses obligations légales et sa politique interne.
• En cas de refus d'entrée lié à l'âge réel (mineur) ou à l'état d'ébriété, la gestion du remboursement suit la politique définie à l'article "Remboursements" des CGV Utilisateurs.

**6. Rôle de Yuno (plateforme)**
Yuno :
• met à disposition une interface de vente, de paiement et de QR codes ;
• n'est pas propriétaire des produits vendus ;
• ne fixe pas les prix des clubs ;
• ne fournit pas la prestation sur place (entrée, service, table, boissons) ;
• ne garantit pas la capacité d'un club à exécuter la prestation (même si Yuno peut assister en support).

**7. Responsabilité**
Yuno est tenue à une obligation de moyens sur la disponibilité de la plateforme, et ne peut être responsable :
• d'un refus d'entrée, d'un refus de service, d'un incident sur place ;
• d'une modification d'événement décidée par un club ;
• d'un contenu publié par un club (affiche, description, prix, etc.)

**8. Compte, QR codes, sécurité**
Les QR codes sont personnels et destinés à sécuriser l'accès/commande. L'Utilisateur ne doit pas partager ses QR codes si cela contrevient aux règles du club ou à la politique anti-fraude.

**9. Données personnelles**
La gestion des données est décrite dans la Politique de confidentialité (accessible depuis les réglages de votre compte ou via yunoapp.eu/legal/privacy).

**10. Modifications**
Les CGU peuvent évoluer. La version applicable est celle publiée à la date d'utilisation/commande.

**11. Droit applicable**
Droit français. Juridiction compétente selon règles légales en vigueur.`
    },
    en: {
      title: 'Terms of Use',
      content: `**1. Purpose**
These Terms of Use govern access to and use of the Yuno platform (website / web app), enabling users to discover events and purchase products offered by partner clubs.

**2. Definitions**
• Platform: Yuno (web app yunoapp.eu)
• User: any person browsing or ordering through Yuno
• Club / Organizer: partner establishment offering products
• Products: tickets, VIP deposits/reservations, drinks, packs, etc.

**3. Access to the Service**
Yuno is accessible online. Some features require placing an order (and therefore providing personal information). Yuno may update, suspend, or discontinue certain features for maintenance.

**4. Usage Rules & Behavior**
The User agrees to:
• provide accurate information (including email, identity, age during first order)
• not circumvent access rules (identity/age verification at entry)
• not use Yuno for fraudulent purposes (abusive resale, impersonation, unjustified disputes, etc.)

**5. Alcohol, Age, and Club Access**
• Ordering alcoholic products is reserved for persons of legal drinking age (18+).
• During the first order, the User declares their age and certifies on their honor that they are of legal age if required.
• The club remains responsible for identity verification and may refuse entry or service (alcohol) according to its legal obligations and internal policy.
• In case of entry refusal related to actual age (minor) or intoxication, refund management follows the policy defined in the "Refunds" article of the User Terms of Sale.

**6. Role of Yuno (Platform)**
Yuno:
• provides a sales, payment, and QR code interface;
• does not own the products sold;
• does not set club prices;
• does not provide on-site services (entry, service, table, drinks);
• does not guarantee a club's ability to deliver the service (though Yuno may assist with support).

**7. Liability**
Yuno is bound by an obligation of means regarding platform availability and cannot be held responsible for:
• entry refusal, service refusal, or on-site incidents;
• event modifications decided by a club;
• content published by a club (poster, description, prices, etc.)

**8. Account, QR Codes, Security**
QR codes are personal and designed to secure access/orders. Users must not share their QR codes if it violates club rules or anti-fraud policies.

**9. Personal Data**
Data management is described in the Privacy Policy (accessible from your account settings or at yunoapp.eu/legal/privacy).

**10. Amendments**
These Terms may evolve. The applicable version is the one published on the date of use/order.

**11. Applicable Law**
French law. Competent jurisdiction according to applicable legal rules.`
    },
    es: {
      title: 'Condiciones Generales de Uso',
      content: `**1. Objeto**
Las presentes CGU regulan el acceso y uso de la plataforma Yuno (sitio web / web app), que permite descubrir eventos y comprar productos ofrecidos por clubs asociados.

**2. Definiciones**
• Plataforma: Yuno (web app yunoapp.eu)
• Usuario: toda persona que navega o realiza pedidos a través de Yuno
• Club / Organizador: establecimiento asociado que ofrece productos
• Productos: entradas, depósitos/reservas VIP, consumiciones, packs, etc.

**3. Acceso al servicio**
Yuno es accesible en línea. Algunas funcionalidades requieren realizar un pedido (y por tanto proporcionar información personal). Yuno puede actualizar, suspender o interrumpir ciertas funcionalidades por mantenimiento.

**4. Reglas de uso y comportamiento**
El Usuario se compromete a:
• proporcionar información exacta (especialmente email, identidad, edad en el primer pedido)
• no eludir las reglas de acceso (control de identidad/edad en la entrada)
• no utilizar Yuno con fines fraudulentos (reventa abusiva, suplantación, disputas injustificadas, etc.)

**5. Alcohol, edad y acceso al club**
• La compra de productos alcohólicos está reservada a personas mayores de edad (18+).
• En el primer pedido, el Usuario declara su edad y certifica bajo su honor ser mayor de edad si es necesario.
• El club sigue siendo responsable del control de identidad y puede denegar la entrada o el servicio (alcohol) según sus obligaciones legales y su política interna.
• En caso de denegación de entrada por edad real (menor) o estado de embriaguez, la gestión del reembolso sigue la política definida en el artículo "Reembolsos" de las CGV Usuarios.

**6. Rol de Yuno (plataforma)**
Yuno:
• pone a disposición una interfaz de venta, pago y códigos QR;
• no es propietaria de los productos vendidos;
• no fija los precios de los clubs;
• no proporciona el servicio en el lugar (entrada, servicio, mesa, bebidas);
• no garantiza la capacidad de un club para ejecutar la prestación (aunque Yuno puede asistir con soporte).

**7. Responsabilidad**
Yuno está sujeta a una obligación de medios sobre la disponibilidad de la plataforma y no puede ser responsable de:
• una denegación de entrada, denegación de servicio o incidente en el lugar;
• una modificación de evento decidida por un club;
• un contenido publicado por un club (cartel, descripción, precios, etc.)

**8. Cuenta, códigos QR, seguridad**
Los códigos QR son personales y están destinados a asegurar el acceso/pedido. El Usuario no debe compartir sus códigos QR si esto contraviene las reglas del club o la política antifraude.

**9. Datos personales**
La gestión de datos se describe en la Política de Privacidad (accesible desde la configuración de tu cuenta o en yunoapp.eu/legal/privacy).

**10. Modificaciones**
Las CGU pueden evolucionar. La versión aplicable es la publicada en la fecha de uso/pedido.

**11. Derecho aplicable**
Derecho francés. Jurisdicción competente según las reglas legales vigentes.`
    }
  },

  'cgv-utilisateurs': {
    fr: {
      title: 'Conditions de Vente – Utilisateurs',
      content: `**1. Objet**
Les présentes conditions encadrent la commande de produits via Yuno (billets, acomptes VIP, consommations). La vente du produit est réalisée par le club, Yuno fournissant un service d'intermédiation et des frais de service.

**2. Qui vend quoi ?**
• Le club vend : billets, tables/acomptes VIP, consommations, packs, etc.
• Yuno facture : des frais de service ajoutés au checkout.

**3. Prix, frais et paiement**
Le prix affiché inclut :
• le prix du produit fixé par le club ;
• les frais Stripe (supportés par le club) ;
• les frais de service Yuno (payés par l'Utilisateur au checkout) :
  – 7% sur billets
  – 7% sur acomptes VIP
  – 5% sur boissons

Paiement via Stripe. Les fonds du produit sont versés au club via son compte Stripe connecté, et les frais de service Yuno sont versés à Yuno.

**4. Exécution de la prestation**
Le club est responsable de :
• l'accès à l'événement, le contrôle d'identité/âge, la sécurité ;
• le service des boissons, la disponibilité, les règles de tables VIP ;
• l'application de ses politiques internes (dress code, capacité, refus, etc.)

**5. Annulation & "assurance annulation"**
• Certains événements peuvent proposer une option d'assurance annulation (si l'événement est à plus de 24h), activable/désactivable par le club.
• Les conditions exactes de cette option sont affichées au moment de l'achat.

**6. Droit de rétractation**
Conformément au Code de la consommation, le droit de rétractation ne s'applique pas notamment aux prestations de loisirs devant être fournies à une date ou période déterminée (ex : billets d'événements).

**7. Remboursements**
Principe : le club décide de la politique de remboursement, sauf bug plateforme.
Cas couverts :
1. Refus d'entrée / refus de service (ex. trop alcoolisé, non-respect règles, etc.) → Remboursement possible selon décision du club. Par défaut (si le club l'applique), remboursement à 90% du prix (10% conservés pour couvrir les frais d'annulation).
2. Mineur malgré déclaration → Annulation possible sans accès ; politique du club applicable.
3. Bug / incident plateforme imputable à Yuno → Remboursement 100% des Utilisateurs concernés.

Important : les frais de service Yuno peuvent être non remboursables si la prestation est annulée pour des causes imputables à l'Utilisateur (ex : mineur, fraude, non-respect règles), sauf exigence légale contraire ou geste commercial.

**8. QR codes & contrôle**
L'Utilisateur doit présenter le QR code à l'entrée / pour retirer une prestation. Le club peut vérifier l'identité.

**9. Support & litiges**
Support : contact@yunoapp.eu ou WhatsApp support si affiché sur la page club. En cas de litige sur la prestation (entrée, table, service), l'Utilisateur doit contacter le club en priorité, Yuno pouvant faciliter la mise en relation.

**10. Médiation de la consommation**
Conformément à la réglementation, l'Utilisateur peut recourir à un médiateur de la consommation.
Médiateur : en cours de désignation.
Veuillez nous contacter à l'email suivant pour le moment : contact@yunoapp.eu

**11. Droit applicable**
Droit français.`
    },
    en: {
      title: 'Terms of Sale – Users',
      content: `**1. Purpose**
These terms govern the ordering of products through Yuno (tickets, VIP deposits, drinks). The product sale is made by the club, with Yuno providing an intermediation service and service fees.

**2. Who sells what?**
• The club sells: tickets, VIP tables/deposits, drinks, packs, etc.
• Yuno charges: service fees added at checkout.

**3. Prices, Fees, and Payment**
The displayed price includes:
• the product price set by the club;
• Stripe fees (borne by the club);
• Yuno service fees (paid by the User at checkout):
  – 7% on tickets
  – 7% on VIP deposits
  – 5% on drinks

Payment via Stripe. Product funds are transferred to the club via their connected Stripe account, and Yuno service fees are transferred to Yuno.

**4. Service Delivery**
The club is responsible for:
• event access, identity/age verification, security;
• drink service, availability, VIP table rules;
• enforcing its internal policies (dress code, capacity, refusal, etc.)

**5. Cancellation & "Cancellation Insurance"**
• Some events may offer a cancellation insurance option (if the event is more than 24 hours away), which can be enabled/disabled by the club.
• The exact terms of this option are displayed at the time of purchase.

**6. Right of Withdrawal**
In accordance with consumer law, the right of withdrawal does not apply to leisure services to be provided on a specific date or period (e.g., event tickets).

**7. Refunds**
Principle: the club decides the refund policy, except in case of platform bugs.
Covered cases:
1. Entry refusal / service refusal (e.g., intoxication, rule violations, etc.) → Refund possible at the club's discretion. By default (if applied by the club), 90% refund (10% retained to cover cancellation costs).
2. Minor despite declaration → Cancellation possible without access; club policy applies.
3. Bug / platform incident attributable to Yuno → 100% refund for affected Users.

Important: Yuno service fees may be non-refundable if the service is cancelled due to causes attributable to the User (e.g., minor, fraud, rule violations), unless legally required otherwise or as a goodwill gesture.

**8. QR Codes & Verification**
The User must present the QR code at entry / to collect a service. The club may verify identity.

**9. Support & Disputes**
Support: contact@yunoapp.eu or WhatsApp support if displayed on the club page. In case of service disputes (entry, table, service), the User should contact the club first; Yuno may facilitate communication.

**10. Consumer Mediation**
In accordance with regulations, the User may use a consumer mediator.
Mediator: designation in progress.
Please contact us at: contact@yunoapp.eu

**11. Applicable Law**
French law.`
    },
    es: {
      title: 'Condiciones de Venta – Usuarios',
      content: `**1. Objeto**
Estas condiciones regulan los pedidos de productos a través de Yuno (entradas, depósitos VIP, consumiciones). La venta del producto la realiza el club, proporcionando Yuno un servicio de intermediación y gastos de servicio.

**2. ¿Quién vende qué?**
• El club vende: entradas, mesas/depósitos VIP, consumiciones, packs, etc.
• Yuno factura: gastos de servicio añadidos al checkout.

**3. Precios, gastos y pago**
El precio mostrado incluye:
• el precio del producto fijado por el club;
• las comisiones de Stripe (asumidas por el club);
• los gastos de servicio de Yuno (pagados por el Usuario al checkout):
  – 7% en entradas
  – 7% en depósitos VIP
  – 5% en bebidas

Pago a través de Stripe. Los fondos del producto se transfieren al club a través de su cuenta Stripe conectada, y los gastos de servicio de Yuno se transfieren a Yuno.

**4. Ejecución de la prestación**
El club es responsable de:
• el acceso al evento, el control de identidad/edad, la seguridad;
• el servicio de bebidas, la disponibilidad, las reglas de mesas VIP;
• la aplicación de sus políticas internas (código de vestimenta, capacidad, rechazo, etc.)

**5. Cancelación y "seguro de cancelación"**
• Algunos eventos pueden ofrecer una opción de seguro de cancelación (si el evento es a más de 24 horas), activable/desactivable por el club.
• Las condiciones exactas de esta opción se muestran en el momento de la compra.

**6. Derecho de desistimiento**
De conformidad con la ley de consumo, el derecho de desistimiento no se aplica a los servicios de ocio que deben prestarse en una fecha o período determinado (ej: entradas de eventos).

**7. Reembolsos**
Principio: el club decide la política de reembolso, salvo error de la plataforma.
Casos cubiertos:
1. Denegación de entrada / denegación de servicio (ej. ebriedad, incumplimiento de normas, etc.) → Reembolso posible según decisión del club. Por defecto (si el club lo aplica), reembolso del 90% del precio (10% retenido para cubrir los gastos de cancelación).
2. Menor a pesar de la declaración → Cancelación posible sin acceso; se aplica la política del club.
3. Error / incidente de la plataforma atribuible a Yuno → Reembolso del 100% a los Usuarios afectados.

Importante: los gastos de servicio de Yuno pueden no ser reembolsables si la prestación se cancela por causas atribuibles al Usuario (ej: menor, fraude, incumplimiento de normas), salvo exigencia legal contraria o gesto comercial.

**8. Códigos QR y control**
El Usuario debe presentar el código QR en la entrada / para recoger una prestación. El club puede verificar la identidad.

**9. Soporte y litigios**
Soporte: contact@yunoapp.eu o WhatsApp si aparece en la página del club. En caso de litigio sobre la prestación (entrada, mesa, servicio), el Usuario debe contactar primero al club; Yuno puede facilitar la comunicación.

**10. Mediación del consumo**
De conformidad con la normativa, el Usuario puede recurrir a un mediador de consumo.
Mediador: en proceso de designación.
Por favor contáctenos en: contact@yunoapp.eu

**11. Derecho aplicable**
Derecho francés.`
    }
  },

  'cgv-clubs': {
    fr: {
      title: 'Conditions Pro – Clubs',
      content: `**1. Objet**
Ces conditions régissent l'accès des clubs à la plateforme Yuno, la publication de produits, l'encaissement via Stripe et la gestion des QR codes.

**2. Abonnement**
Accès plateforme clubs : 99 € / mois / club (hors frais Stripe). L'abonnement donne accès aux outils de gestion : création événements/produits, QR, suivi commandes, données basiques.

**3. Rôle du club**
Le club est vendeur des produits et responsable :
• de la conformité légale (alcool, sécurité, capacité, contrôle d'âge)
• des prix affichés et de la description des produits
• de l'exécution des prestations sur place
• des décisions de remboursement (sauf bug plateforme)

**4. Paiements (Stripe Connect)**
Chaque club connecte son compte Stripe.
• Les paiements "produits club" sont versés au club (moins frais Stripe).
• Les frais de service Yuno sont collectés à part au checkout et versés à Yuno.

**5. Frais de service Yuno (affichés à l'Utilisateur)**
Yuno applique au checkout :
• 7% billets
• 7% acomptes VIP
• 5% boissons

**6. Contenus & données**
Le club garantit disposer des droits sur les visuels/posters et s'interdit tout contenu trompeur. Le club accepte que Yuno affiche ses pages sur l'app, et que les données de performance (visites, clics, conversions, commandes) soient disponibles dans son espace.

**7. Promoters / DJs (option)**
Si le club active un système promoters :
• Le club définit les règles (récompenses, seuils, réduction éventuelle).
• Yuno calcule les performances via liens affiliés.
• Le paiement des promoters/DJs est effectué hors Yuno, Yuno pouvant afficher un "montant estimé dû" et l'IBAN renseigné par le bénéficiaire.

**8. Remboursements & annulations**
Le club définit sa politique, sous réserve du droit applicable. En cas de bug imputable à Yuno : Yuno peut initier ou demander une procédure de remboursement 100%.

**10. Accès administrateur plateforme**
L'opérateur Yuno dispose d'un accès technique aux données de gestion des établissements (statistiques de performance, commandes, événements, configuration) afin d'assurer le bon fonctionnement du service, la détection de fraude, le support technique et la résolution de litiges, conformément au RGPD (intérêt légitime). Ces données ne sont jamais partagées avec des tiers non autorisés.

**11. Droit applicable**
Droit français.`
    },
    en: {
      title: 'Professional Terms – Clubs',
      content: `**1. Purpose**
These terms govern club access to the Yuno platform, product publication, payment processing via Stripe, and QR code management.

**2. Subscription**
Club platform access: €99/month/club (excluding Stripe fees). The subscription provides access to management tools: event/product creation, QR codes, order tracking, basic analytics.

**3. Club's Role**
The club is the product seller and is responsible for:
• legal compliance (alcohol, security, capacity, age verification)
• displayed prices and product descriptions
• on-site service delivery
• refund decisions (except platform bugs)

**4. Payments (Stripe Connect)**
Each club connects its Stripe account.
• "Club product" payments are transferred to the club (minus Stripe fees).
• Yuno service fees are collected separately at checkout and transferred to Yuno.

**5. Yuno Service Fees (Displayed to User)**
Yuno applies at checkout:
• 7% on tickets
• 7% on VIP deposits
• 5% on drinks

**6. Content & Data**
The club guarantees it has rights to visuals/posters and prohibits misleading content. The club agrees that Yuno may display its pages on the app and that performance data (visits, clicks, conversions, orders) is available in its dashboard.

**7. Promoters / DJs (Optional)**
If the club activates a promoter system:
• The club defines the rules (rewards, thresholds, potential discounts).
• Yuno calculates performance via affiliate links.
• Promoter/DJ payments are made outside Yuno; Yuno may display an "estimated amount due" and the IBAN provided by the beneficiary.

**8. Refunds & Cancellations**
The club defines its policy, subject to applicable law. In case of a bug attributable to Yuno: Yuno may initiate or request a 100% refund procedure.

**10. Platform Administrator Access**
The Yuno operator has technical access to establishment management data (performance statistics, orders, events, configuration) to ensure proper service operation, fraud detection, technical support, and dispute resolution, in accordance with GDPR (legitimate interest). This data is never shared with unauthorized third parties.

**11. Applicable Law**
French law.`
    },
    es: {
      title: 'Condiciones Pro – Clubs',
      content: `**1. Objeto**
Estas condiciones regulan el acceso de los clubs a la plataforma Yuno, la publicación de productos, el cobro mediante Stripe y la gestión de códigos QR.

**2. Suscripción**
Acceso a la plataforma clubs: 99 €/mes/club (sin incluir comisiones de Stripe). La suscripción da acceso a herramientas de gestión: creación de eventos/productos, QR, seguimiento de pedidos, datos básicos.

**3. Rol del club**
El club es el vendedor de los productos y responsable de:
• la conformidad legal (alcohol, seguridad, capacidad, control de edad)
• los precios mostrados y la descripción de los productos
• la ejecución de las prestaciones en el lugar
• las decisiones de reembolso (salvo error de la plataforma)

**4. Pagos (Stripe Connect)**
Cada club conecta su cuenta Stripe.
• Los pagos de "productos del club" se transfieren al club (menos comisiones de Stripe).
• Los gastos de servicio de Yuno se cobran por separado al checkout y se transfieren a Yuno.

**5. Gastos de servicio Yuno (mostrados al Usuario)**
Yuno aplica al checkout:
• 7% en entradas
• 7% en depósitos VIP
• 5% en bebidas

**6. Contenidos y datos**
El club garantiza que tiene los derechos sobre los visuales/carteles y se prohíbe cualquier contenido engañoso. El club acepta que Yuno muestre sus páginas en la app, y que los datos de rendimiento (visitas, clics, conversiones, pedidos) estén disponibles en su espacio.

**7. Promotores / DJs (opción)**
Si el club activa un sistema de promotores:
• El club define las reglas (recompensas, umbrales, descuento eventual).
• Yuno calcula el rendimiento mediante enlaces de afiliados.
• El pago de promotores/DJs se realiza fuera de Yuno; Yuno puede mostrar un "importe estimado debido" y el IBAN proporcionado por el beneficiario.

**8. Reembolsos y cancelaciones**
El club define su política, sujeta al derecho aplicable. En caso de error atribuible a Yuno: Yuno puede iniciar o solicitar un procedimiento de reembolso del 100%.

**10. Acceso del administrador de la plataforma**
El operador de Yuno tiene acceso técnico a los datos de gestión de los establecimientos (estadísticas de rendimiento, pedidos, eventos, configuración) para garantizar el correcto funcionamiento del servicio, la detección de fraudes, el soporte técnico y la resolución de disputas, de conformidad con el RGPD (interés legítimo). Estos datos nunca se comparten con terceros no autorizados.

**11. Derecho aplicable**
Derecho francés.`
    }
  },

  'privacy': {
    fr: {
      title: 'Politique de Confidentialité',
      content: `**1. Responsable du traitement**
WOMBER – 25 avenue Mercure, 31130 Quint-Fonsegrives – contact@yunoapp.eu

**2. Données collectées**
• Identité & contact : nom, prénom, email, téléphone
• Données de commande : produits achetés, montants, horodatage, club concerné
• Données âge (déclaratif) : date de naissance / confirmation de majorité
• Données techniques : logs de sécurité, appareil, cookies si activés
• Données clubs : informations établissement, produits, performances

**3. Finalités & bases légales**
• Exécuter les commandes & fournir QR codes : exécution du contrat
• Sécuriser la plateforme / anti-fraude : intérêt légitime
• Support client : exécution du contrat / intérêt légitime
• Statistiques internes : intérêt légitime (ou consentement si traceurs non nécessaires)
• Communications (si newsletter) : consentement (si applicable)

**4. Destinataires**
• Clubs partenaires (données nécessaires à l'exécution : commande, identité si nécessaire, QR)
• Stripe (paiements – les données de paiement sont traitées directement par Stripe et ne transitent pas par les serveurs de Yuno)
• Hébergeur Backend (Supabase – supabase.com – serveurs sécurisés avec chiffrement en transit via HTTPS/TLS)
• Sous-traitants techniques strictement nécessaires

**5. Durées de conservation**
• Données de commandes : 5 ans (preuve/gestion litiges et obligations comptables)
• Support : 2 ans après dernier contact
• Logs sécurité : 12 mois
• Compte utilisateur inactif : 24 mois puis suppression/anonymisation (sauf obligations légales)

**6. Droits**
Accès, rectification, suppression, opposition, limitation, portabilité.
Contact : contact@yunoapp.eu
Réclamation CNIL : cnil.fr

**7. Sécurité**
Mesures techniques et organisationnelles : contrôles d'accès, limitation des permissions, chiffrement en transit via HTTPS, authentification sécurisée, politique de mots de passe renforcée.

**8bis. Accès administrateur**
L'opérateur de la plateforme dispose d'un accès aux données de gestion des établissements partenaires (performances, commandes, événements) pour assurer le bon fonctionnement du service et le support. Cet accès est fondé sur l'intérêt légitime de l'opérateur et encadré par des mesures de sécurité appropriées.

**9. Transferts hors UE**
Stripe peut impliquer des transferts de données hors de l'Union Européenne, encadrés par les clauses contractuelles types de la Commission européenne conformément au RGPD. L'hébergeur (Supabase) utilise des infrastructures conformes aux normes européennes de protection des données.`
    },
    en: {
      title: 'Privacy Policy',
      content: `**1. Data Controller**
WOMBER – 25 avenue Mercure, 31130 Quint-Fonsegrives, France – contact@yunoapp.eu

**2. Data Collected**
• Identity & contact: last name, first name, email, phone
• Order data: purchased products, amounts, timestamps, related club
• Age data (declarative): date of birth / confirmation of legal age
• Technical data: security logs, device, cookies if enabled
• Club data: establishment information, products, performance

**3. Purposes & Legal Bases**
• Execute orders & provide QR codes: contract performance
• Secure the platform / anti-fraud: legitimate interest
• Customer support: contract performance / legitimate interest
• Internal statistics: legitimate interest (or consent if non-essential trackers)
• Communications (if newsletter): consent (if applicable)

**4. Recipients**
• Partner clubs (data necessary for execution: order, identity if needed, QR)
• Stripe (payments – payment data is processed directly by Stripe and does not pass through Yuno's servers)
• Backend Host (Supabase – supabase.com – secure servers with encryption in transit via HTTPS/TLS)
• Strictly necessary technical subcontractors

**5. Retention Periods**
• Order data: 5 years (proof/dispute management and accounting obligations)
• Support: 2 years after last contact
• Security logs: 12 months
• Inactive user account: 24 months then deletion/anonymization (unless legal obligations apply)

**6. Rights**
Access, rectification, deletion, objection, restriction, portability.
Contact: contact@yunoapp.eu
Complaint with CNIL: cnil.fr

**7. Security**
Technical and organizational measures: access controls, permission restrictions, encryption in transit via HTTPS, secure authentication, enforced password policies.

**8. Transfers Outside the EU**
Stripe may involve data transfers outside the European Union, governed by the European Commission's standard contractual clauses in accordance with GDPR. The host (Supabase) uses infrastructure compliant with European data protection standards.`
    },
    es: {
      title: 'Política de Privacidad',
      content: `**1. Responsable del tratamiento**
WOMBER – 25 avenue Mercure, 31130 Quint-Fonsegrives, Francia – contact@yunoapp.eu

**2. Datos recogidos**
• Identidad y contacto: apellido, nombre, email, teléfono
• Datos de pedido: productos comprados, importes, marcas de tiempo, club concernido
• Datos de edad (declarativos): fecha de nacimiento / confirmación de mayoría de edad
• Datos técnicos: logs de seguridad, dispositivo, cookies si están activadas
• Datos de clubs: información del establecimiento, productos, rendimiento

**3. Finalidades y bases legales**
• Ejecutar pedidos y proporcionar códigos QR: ejecución del contrato
• Asegurar la plataforma / antifraude: interés legítimo
• Soporte al cliente: ejecución del contrato / interés legítimo
• Estadísticas internas: interés legítimo (o consentimiento si rastreadores no necesarios)
• Comunicaciones (si newsletter): consentimiento (si aplicable)

**4. Destinatarios**
• Clubs asociados (datos necesarios para la ejecución: pedido, identidad si es necesario, QR)
• Stripe (pagos – los datos de pago son procesados directamente por Stripe y no pasan por los servidores de Yuno)
• Alojamiento Backend (Supabase – supabase.com – servidores seguros con cifrado en tránsito via HTTPS/TLS)
• Subcontratistas técnicos estrictamente necesarios

**5. Plazos de conservación**
• Datos de pedidos: 5 años (prueba/gestión de litigios y obligaciones contables)
• Soporte: 2 años después del último contacto
• Logs de seguridad: 12 meses
• Cuenta de usuario inactiva: 24 meses y luego eliminación/anonimización (salvo obligaciones legales)

**6. Derechos**
Acceso, rectificación, supresión, oposición, limitación, portabilidad.
Contacto: contact@yunoapp.eu
Reclamación ante la CNIL: cnil.fr

**7. Seguridad**
Medidas técnicas y organizativas: controles de acceso, limitación de permisos, cifrado en tránsito via HTTPS, autenticación segura, política de contraseñas reforzada.

**8. Transferencias fuera de la UE**
Stripe puede implicar transferencias de datos fuera de la Unión Europea, reguladas por las cláusulas contractuales tipo de la Comisión Europea de conformidad con el RGPD. El proveedor de alojamiento (Supabase) utiliza infraestructuras conformes con los estándares europeos de protección de datos.`
    }
  },

  'cookies': {
    fr: {
      title: 'Politique Cookies',
      content: `**1. Principe**
Yuno utilise des cookies/traceurs nécessaires au fonctionnement (session, sécurité, préférences). Les cookies non nécessaires (mesure d'audience, marketing) ne sont déposés qu'après consentement.

**2. Consentement & refus**
Toute action autre qu'un acte positif = refus (pour les traceurs soumis au consentement). Il doit être aussi simple de retirer son consentement que de le donner.

**3. Gérer ses choix**
Un menu "Cookies" est accessible à tout moment depuis : Profil → Réglages → Données légales → Cookies.

**4. Liste des cookies utilisés**

**Cookies strictement nécessaires** (pas de consentement requis) :
• Session d'authentification : permet de maintenir votre connexion
• Préférences de langue : mémorise votre choix de langue (FR/EN/ES)
• Sécurité : protection contre la fraude et les abus

**Cookies tiers** :
• Stripe : cookies de sécurité pour le traitement des paiements (nécessaires au fonctionnement du paiement sécurisé)

**Cookies analytiques** :
• Aucun cookie analytique tiers n'est actuellement utilisé. Si nous en ajoutons à l'avenir, votre consentement sera requis.`
    },
    en: {
      title: 'Cookie Policy',
      content: `**1. Principle**
Yuno uses cookies/trackers necessary for operation (session, security, preferences). Non-essential cookies (audience measurement, marketing) are only placed after consent.

**2. Consent & Refusal**
Any action other than a positive act = refusal (for trackers subject to consent). Withdrawing consent must be as easy as giving it.

**3. Managing Your Choices**
A "Cookies" menu is accessible at any time from: Profile → Settings → Legal Information → Cookies.

**4. List of Cookies Used**

**Strictly Necessary Cookies** (no consent required):
• Authentication session: maintains your login
• Language preferences: remembers your language choice (FR/EN/ES)
• Security: protection against fraud and abuse

**Third-Party Cookies**:
• Stripe: security cookies for payment processing (necessary for secure payment operation)

**Analytical Cookies**:
• No third-party analytical cookies are currently used. If we add any in the future, your consent will be required.`
    },
    es: {
      title: 'Política de Cookies',
      content: `**1. Principio**
Yuno utiliza cookies/rastreadores necesarios para el funcionamiento (sesión, seguridad, preferencias). Las cookies no necesarias (medición de audiencia, marketing) solo se instalan tras el consentimiento.

**2. Consentimiento y rechazo**
Cualquier acción que no sea un acto positivo = rechazo (para los rastreadores sujetos a consentimiento). Retirar el consentimiento debe ser tan fácil como darlo.

**3. Gestionar tus opciones**
Un menú "Cookies" es accesible en cualquier momento desde: Perfil → Ajustes → Datos legales → Cookies.

**4. Lista de cookies utilizadas**

**Cookies estrictamente necesarias** (sin necesidad de consentimiento):
• Sesión de autenticación: mantiene tu conexión
• Preferencias de idioma: recuerda tu elección de idioma (FR/EN/ES)
• Seguridad: protección contra fraude y abusos

**Cookies de terceros**:
• Stripe: cookies de seguridad para el procesamiento de pagos (necesarias para el funcionamiento del pago seguro)

**Cookies analíticas**:
• Actualmente no se utilizan cookies analíticas de terceros. Si las añadimos en el futuro, se requerirá tu consentimiento.`
    }
  }
};

export const legalSections: { key: LegalSection; icon: string }[] = [
  { key: 'mentions-legales', icon: 'FileText' },
  { key: 'cgu', icon: 'ScrollText' },
  { key: 'cgv-utilisateurs', icon: 'ShoppingBag' },
  { key: 'cgv-clubs', icon: 'Building2' },
  { key: 'privacy', icon: 'Shield' },
  { key: 'cookies', icon: 'Cookie' },
];
