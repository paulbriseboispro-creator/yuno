export type LegalSection = 'mentions-legales' | 'cgu' | 'cgv-utilisateurs' | 'cgv-clubs' | 'cgv-crm' | 'confidentialite' | 'dpa' | 'privacy' | 'cookies';

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
• L'assurance annulation n'est plus commercialisée et ne peut plus être souscrite lors d'un achat.
• Les billets souscrits avec cette option avant son retrait restent couverts : les conditions affichées au moment de leur achat continuent de s'appliquer.
• En dehors de ce cas, l'annulation et le remboursement d'un billet relèvent de la décision du club organisateur.

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
• Cancellation insurance is no longer offered and can no longer be added to a purchase.
• Tickets bought with this option before it was withdrawn remain covered: the terms shown at the time of their purchase continue to apply.
• Otherwise, cancelling and refunding a ticket is at the organising club's discretion.

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
• El seguro de cancelación ya no se comercializa y no puede añadirse a una compra.
• Las entradas adquiridas con esta opción antes de su retirada siguen cubiertas: se aplican las condiciones mostradas en el momento de su compra.
• En los demás casos, la cancelación y el reembolso de una entrada dependen de la decisión del club organizador.
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
L'accès à la plateforme est proposé selon plusieurs formules d'abonnement, dont une formule gratuite. Le détail des formules, des fonctionnalités incluses et des prix en vigueur figure sur la page Tarifs de yunoapp.eu. Les frais Stripe restent à la charge du club.

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
Le club garantit disposer des droits sur les visuels/posters et s'interdit tout contenu trompeur. Le club accepte que Yuno affiche ses pages sur l'app, et que les données de performance (visites, clics, conversions, commandes) soient disponibles dans son espace. Le traitement par Yuno des données des clients du club est encadré par l'Accord de sous-traitance des données (yunoapp.eu/legal/dpa), qui fait partie intégrante des présentes conditions.

**7. Promoters / DJs (option)**
Si le club active un système promoters :
• Le club définit les règles (récompenses, seuils, réduction éventuelle).
• Yuno calcule les performances via liens affiliés.
• Le paiement des promoters/DJs est effectué hors Yuno, Yuno pouvant afficher un "montant estimé dû" et l'IBAN renseigné par le bénéficiaire.

**8. Remboursements & annulations**
Le club définit sa politique, sous réserve du droit applicable. En cas de bug imputable à Yuno : Yuno peut initier ou demander une procédure de remboursement 100%.

**9. Confidentialité & non-exploitation**
L'accès à l'espace professionnel donne accès à des informations confidentielles de Yuno (fonctionnalités non publiées, feuille de route, logique de tarification et de commissions, outils, données, savoir-faire), protégées notamment au titre du secret des affaires (articles L. 151-1 et suivants du Code de commerce). Le club s'engage à ne pas les divulguer à des tiers, à ne pas les utiliser à d'autres fins que l'utilisation normale du service, et à ne pas les exploiter, directement ou indirectement, pour concevoir, développer, faire développer ou commercialiser un produit ou service concurrent, pendant la durée du contrat et pendant 3 ans après sa fin. L'Engagement de confidentialité complet (yunoapp.eu/legal/confidentialite) fait partie intégrante des présentes conditions.

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
Platform access is offered through several subscription plans, including a free plan. Details of plans, included features, and current prices are available on the yunoapp.eu Pricing page. Stripe fees remain the club's responsibility.

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
The club guarantees it has rights to visuals/posters and prohibits misleading content. The club agrees that Yuno may display its pages on the app and that performance data (visits, clicks, conversions, orders) is available in its dashboard. Yuno's processing of the club's customer data is governed by the Data Processing Agreement (yunoapp.eu/legal/dpa), which is an integral part of these terms.

**7. Promoters / DJs (Optional)**
If the club activates a promoter system:
• The club defines the rules (rewards, thresholds, potential discounts).
• Yuno calculates performance via affiliate links.
• Promoter/DJ payments are made outside Yuno; Yuno may display an "estimated amount due" and the IBAN provided by the beneficiary.

**8. Refunds & Cancellations**
The club defines its policy, subject to applicable law. In case of a bug attributable to Yuno: Yuno may initiate or request a 100% refund procedure.

**9. Confidentiality & Non-Exploitation**
Access to the professional dashboard exposes Yuno's confidential information (unreleased features, roadmap, pricing and commission logic, tools, data, know-how), protected in particular under French trade secret law (Articles L. 151-1 et seq. of the French Commercial Code). The club agrees not to disclose it to third parties, not to use it for any purpose other than normal use of the service, and not to exploit it, directly or indirectly, to design, develop, have developed, or market a competing product or service, for the duration of the contract and for 3 years after its end. The full Confidentiality Commitment (yunoapp.eu/legal/confidentialite) is an integral part of these terms.

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
El acceso a la plataforma se ofrece mediante varias fórmulas de suscripción, incluida una fórmula gratuita. El detalle de las fórmulas, las funcionalidades incluidas y los precios vigentes figura en la página de Tarifas de yunoapp.eu. Las comisiones de Stripe corren a cargo del club.

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
El club garantiza que tiene los derechos sobre los visuales/carteles y se prohíbe cualquier contenido engañoso. El club acepta que Yuno muestre sus páginas en la app, y que los datos de rendimiento (visitas, clics, conversiones, pedidos) estén disponibles en su espacio. El tratamiento por Yuno de los datos de los clientes del club se rige por el Acuerdo de encargo de tratamiento (yunoapp.eu/legal/dpa), que forma parte integrante de estas condiciones.

**7. Promotores / DJs (opción)**
Si el club activa un sistema de promotores:
• El club define las reglas (recompensas, umbrales, descuento eventual).
• Yuno calcula el rendimiento mediante enlaces de afiliados.
• El pago de promotores/DJs se realiza fuera de Yuno; Yuno puede mostrar un "importe estimado debido" y el IBAN proporcionado por el beneficiario.

**8. Reembolsos y cancelaciones**
El club define su política, sujeta al derecho aplicable. En caso de error atribuible a Yuno: Yuno puede iniciar o solicitar un procedimiento de reembolso del 100%.

**9. Confidencialidad y no explotación**
El acceso al espacio profesional expone información confidencial de Yuno (funcionalidades no publicadas, hoja de ruta, lógica de precios y comisiones, herramientas, datos, know-how), protegida en particular por el secreto empresarial (artículos L. 151-1 y siguientes del Código de Comercio francés). El club se compromete a no divulgarla a terceros, a no utilizarla para fines distintos del uso normal del servicio, y a no explotarla, directa o indirectamente, para diseñar, desarrollar, hacer desarrollar o comercializar un producto o servicio competidor, durante la vigencia del contrato y durante los 3 años posteriores a su fin. El Compromiso de Confidencialidad completo (yunoapp.eu/legal/confidentialite) forma parte integrante de estas condiciones.

**10. Acceso del administrador de la plataforma**
El operador de Yuno tiene acceso técnico a los datos de gestión de los establecimientos (estadísticas de rendimiento, pedidos, eventos, configuración) para garantizar el correcto funcionamiento del servicio, la detección de fraudes, el soporte técnico y la resolución de disputas, de conformidad con el RGPD (interés legítimo). Estos datos nunca se comparten con terceros no autorizados.

**11. Derecho aplicable**
Derecho francés.`
    }
  },

  'cgv-crm': {
    fr: {
      title: 'Conditions Yuno CRM',
      content: `Version du 8 octobre 2026

Ces conditions forment le contrat entre WOMBER, entreprise individuelle (Paul Brisebois), SIRET 995 130 747 00018, 25 avenue Mercure, 31130 Quint-Fonsegrives, France, contact@yunoapp.eu (« Yuno »), et le club, l'organisateur d'événements ou l'association qui ouvre un compte Yuno CRM (le « Client »). Le contrat comprend aussi l'Accord de sous-traitance des données (yunoapp.eu/legal/dpa), dont le chapitre 12 « Yuno CRM » s'applique au Client, l'Engagement de confidentialité (yunoapp.eu/legal/confidentialite), et les prix affichés sur la page Tarifs et dans la Console au moment de la souscription. En cas de contradiction, l'Accord de sous-traitance prévaut pour la protection des données, puis les présentes conditions.

**1. Le service**
Yuno CRM est un logiciel en ligne, accessible sur crm.yunoapp.eu (la « Console »). Il se connecte à la billetterie du Client (Shotgun aujourd'hui), lit ses ventes et ses acheteurs, accepte des fichiers de contacts, et aide le Client à connaître son public et à lui écrire : base de contacts, segments, analyses, e-mails, SMS, automatisations, pages d'inscription et liens suivis.
Yuno CRM ne vend rien : chaque billet reste vendu par la billetterie du Client, selon ses propres conditions. Une fonction marquée « Bientôt » dans la Console ne fait pas partie du service tant qu'elle n'est pas ouverte.
Yuno CRM est réservé aux professionnels. Le Client agit pour son activité professionnelle ; le droit de rétractation prévu par le Code de la consommation ne s'applique pas.

**2. Compte, équipe et sécurité**
Le compte est ouvert par une personne habilitée à engager le Client (le « titulaire »), qui accepte les présentes conditions en son nom. Le titulaire invite son équipe, choisit les rôles, et répond des actions faites depuis le compte.
Les identifiants sont personnels. Le Client garde ses accès confidentiels, active la double authentification quand la Console la demande, et prévient Yuno sans délai de tout accès suspect.
Yuno n'accède aux données du Client que pour faire fonctionner le service, assurer sa sécurité, prévenir la fraude, traiter un incident ou répondre à une demande du Client. Yuno n'ouvre une session dans la Console du Client (« accès assisté ») qu'avec l'accord du titulaire, qu'il peut retirer à tout moment ; chaque accès est journalisé.

**3. Essai, abonnement et prix**
L'essai dure 14 jours, sans carte bancaire, avec la dotation de Yunits affichée à l'ouverture du compte. À la fin de l'essai sans abonnement, le compte passe en pause : la base reste lisible et exportable, mais la synchronisation avec la billetterie et les envois s'arrêtent.
L'abonnement est mensuel ou annuel, payé d'avance par carte bancaire via Stripe, et se renouvelle à chaque échéance jusqu'à sa résiliation. Les prix et ce que chaque formule inclut figurent sur la page Tarifs et dans la Console. Le prix d'un abonnement en cours reste celui de sa souscription tant qu'il n'est pas interrompu. Si Yuno devait modifier le prix d'un abonnement en cours, il l'annoncerait au moins 30 jours à l'avance par e-mail et dans la Console ; le Client pourrait résilier avant l'application du nouveau prix.
Les prix sont indiqués hors taxes. Tant que l'éditeur relève de la franchise en base de TVA, aucune TVA n'est facturée (article 293 B du Code général des impôts). Les factures sont disponibles dans la Console.
En cas d'échec de paiement, Yuno relance le Client ; sans régularisation, le compte passe en pause.

**4. Les Yunits**
Les Yunits sont l'unité de compte des envois. Chaque envoi en consomme selon le barème affiché dans la Console avant l'envoi (par exemple un e-mail, un SMS vers la France, un SMS vers l'étranger). La Console montre le coût d'un envoi et le solde avant toute validation. Un changement de barème est annoncé dans la Console et ne s'applique jamais à un envoi déjà validé.
Les Yunits sont offerts (essai, abonnement) ou achetés (recharge). Chacun a la date de validité affichée dans la Console au moment de son attribution ou de son achat ; les Yunits qui expirent le plus tôt sont utilisés en premier.
Aucun Yunit n'est débité pour un envoi de test, pour un destinataire écarté par les règles d'envoi, ni pour un message refusé par le fournisseur avant son envoi. Un message accepté par le fournisseur, puis non distribué (numéro inexistant, téléphone éteint trop longtemps), reste décompté.
Les Yunits ne sont ni remboursables, ni cessibles, ni convertibles en argent. Exception : si Yuno arrête définitivement Yuno CRM, il rembourse les Yunits achetés et non utilisés.

**5. Connexion à la billetterie et données importées**
Le Client connecte lui-même son compte de billetterie et fournit la clé d'accès. Sa billetterie traite les données de ses acheteurs pour son compte ; en connectant Yuno CRM, le Client désigne Yuno comme un autre prestataire chargé de les traiter pour lui, et garantit que son contrat avec sa billetterie le permet. Yuno lit ces données et n'écrit jamais rien chez la billetterie. La clé d'accès est conservée dans un coffre chiffré et n'est jamais réaffichée.
Les chiffres de la Console viennent de ce que la billetterie rapporte. Quand une donnée n'est pas fournie par la billetterie, la Console le dit ; elle ne remplace jamais une donnée manquante par une estimation sans l'indiquer. Yuno ne répond pas des erreurs, interruptions ou changements de la billetterie.
Pour tout fichier importé, le Client atteste l'origine des contacts et leur accord à recevoir ses messages ; Yuno conserve cette attestation, horodatée.

**6. Analyses, hypothèses et « Chances de venir »**
Pour le compte du Client, et sur ses seules données, Yuno CRM calcule :
• des statistiques de ventes, de fréquentation et de messages ;
• « Ce qui fait venir » : des hypothèses sur ce qui fait revenir le public du Client (artistes, genre musical, format, série de soirées, jour, habitudes d'achat comme l'achat tôt, de dernière minute ou à plusieurs, distance entre la commune déclarée et le lieu). Chaque hypothèse est testée sur les soirées passées du Client et porte un statut (« confirmée », « pas de différence nette sur votre compte », « à tester ») ; sur la fiche d'un client, elle s'affiche comme un fait observé dans ses achats, jamais comme une affirmation sur la personne ;
• « Chances de venir » : pour chaque client déjà venu, un niveau (fortes, moyennes, faibles) de chances d'acheter pour une prochaine soirée, avec ses principales raisons, jamais un pourcentage ;
• « Qui cibler » : des groupes de clients proposés pour une soirée à venir, et un groupe témoin de 10 % non contactés, tirés au hasard, pour mesurer l'effet réel des messages.
Ces calculs n'utilisent ni le genre des personnes, ni les ouvertures ou les clics de leurs e-mails. Ce sont des estimations statistiques : elles peuvent se tromper. Elles servent à organiser la communication commerciale du Client (à qui écrire, quand, avec quel message) et à comprendre son public.
Le Client s'interdit de s'en servir pour prendre une décision qui produit un effet juridique sur une personne ou l'affecte de manière significative : refuser l'entrée ou la vente, fixer un prix, réserver une remise ou une prévente selon la personne, inscrire quelqu'un sur une liste d'exclusion. Il s'interdit aussi toute utilisation visant à déduire ou à cibler l'origine, les opinions politiques, les convictions religieuses, la santé, la vie ou l'orientation sexuelle d'une personne, y compris à partir du thème d'une soirée, et tout ciblage de personnes mineures.
Quand une personne s'oppose à l'analyse, le Client l'en exclut depuis sa fiche (« Exclure du profilage ») : son profil et ses estimations sont effacés et ne sont plus calculés.
Yuno ne garantit aucun résultat commercial.

**7. Envois de messages**
Le Client est l'expéditeur et l'annonceur de ses messages. Il en choisit le contenu et les destinataires, et répond de leur conformité :
• accord préalable du destinataire, ou relation client existante pour des produits analogues, dans les conditions de l'article L. 34-5 du Code des postes et des communications électroniques ; un accord pour les e-mails ne vaut pas pour les SMS ;
• identité de l'annonceur, lien de désinscription dans chaque e-mail, mention STOP dans chaque SMS ;
• accord du destinataire, lorsqu'il est requis, à la mesure individuelle de l'ouverture et des clics de ses e-mails, qui repose sur des traceurs (article 82 de la loi Informatique et Libertés ; recommandation de la CNIL n° 2026-042 du 12 mars 2026) ;
• droit de la publicité des boissons alcooliques.
Yuno applique à tous les comptes des règles d'envoi que le Client ne peut pas désactiver : pas d'envoi à une personne désinscrite, à une adresse en échec ou à un numéro qui a répondu STOP, limite de fréquence par personne, heures d'envoi (aucun SMS entre 21 h 30 et 8 h), surveillance des plaintes et des échecs. Yuno peut suspendre un envoi ou les envois d'un compte en cas de plaintes ou d'échecs anormaux, de contenu illicite ou de risque pour la réputation d'envoi de la plateforme ; il en informe le Client.
Avant le premier SMS, le Client renseigne son identité légale (raison sociale et numéro SIRET, RNA ou TVA) et un nom d'expéditeur conforme aux règles des opérateurs.
Sont interdits les messages illicites, trompeurs, haineux ou discriminatoires, et tout envoi à des adresses achetées, louées ou collectées sans accord.

**8. Les données des clients du Client**
Pour les données de ses clients, contacts et participants, le Client est responsable de traitement et Yuno agit comme sous-traitant, dans les conditions de l'Accord de sous-traitance (chapitre 12 « Yuno CRM »). Le Client :
• informe ses clients de l'usage de leurs données, y compris de l'analyse décrite à l'article 6, de leur droit de s'y opposer et des traceurs de ses e-mails ; un modèle de texte figure en annexe, à publier notamment comme politique de confidentialité de sa billetterie ;
• s'assure d'une base légale pour chaque usage, documente la mise en balance de son intérêt légitime pour l'analyse, et recueille les accords nécessaires à ses envois ;
• répond aux demandes des personnes (accès, rectification, effacement, opposition), avec l'aide des outils de la Console et du support de Yuno ;
• choisit une durée de conservation dans Réglages › Données ; Yuno recommande 3 ans après le dernier contact venu de la personne (achat, venue, clic, inscription) ;
• réalise l'analyse d'impact prévue par l'article 35 du RGPD lorsqu'elle est requise ; Yuno lui fournit sur demande un modèle d'analyse d'impact et de mise en balance adapté à Yuno CRM.
Pour les données des comptes professionnels (titulaire, équipe), la facturation, la sécurité et la mesure d'utilisation de la Console, Yuno est responsable de traitement (Politique de confidentialité, yunoapp.eu/legal/privacy).

**9. Statistiques anonymes**
Le Client autorise Yuno à réutiliser les données traitées pour son compte afin d'en tirer des comptages agrégés et anonymes, destinés à améliorer les règles d'analyse de Yuno CRM pour tous ses utilisateurs, dans les conditions précises de l'article 12.6 de l'Accord de sous-traitance. Pour cette réutilisation, Yuno est responsable de traitement. Ces comptages ne contiennent aucune donnée personnelle ni aucune information commerciale du Client (titre de soirée, artiste, ville). Le titulaire peut retirer cette autorisation à tout moment dans Réglages › Données ; les comptages déjà versés sont alors retirés.

**10. Disponibilité, support et évolutions**
Yuno met en œuvre les moyens raisonnables pour que le service soit disponible et fonctionne correctement, sans garantir une disponibilité continue : maintenances, mises à jour, pannes de prestataires ou de la billetterie peuvent l'interrompre. Le support répond depuis la Console et à contact@yunoapp.eu.
Le service évolue. Si Yuno retire une fonction essentielle à l'usage du Client, il l'annonce au moins 30 jours à l'avance ; le Client peut alors résilier et obtenir le remboursement de la part non utilisée de son abonnement.

**11. Propriété**
Yuno reste titulaire de tous les droits sur le logiciel, les règles d'analyse, les modèles d'e-mails et de pages, et la marque Yuno. Il accorde au Client, pendant l'abonnement, un droit d'utilisation personnel, non exclusif et non cessible.
Le Client reste propriétaire de ses données et de ses contenus (textes, images, logos). Il accorde à Yuno le droit de les héberger, reproduire et traiter dans la seule mesure nécessaire au service, et garantit disposer des droits sur les contenus qu'il importe.

**12. Responsabilité**
Yuno est tenu d'une obligation de moyens. Il ne répond pas des dommages indirects (perte de chiffre d'affaires, de clientèle, d'image), ni des conséquences des décisions commerciales du Client, ni des faits de la billetterie ou d'un opérateur de télécommunication.
Sauf faute lourde ou intentionnelle, la responsabilité totale de Yuno est limitée aux sommes payées par le Client au titre de Yuno CRM au cours des 12 mois précédant le fait générateur.
Le Client garantit Yuno contre toute réclamation née de ses messages, de ses contenus, des données qu'il importe ou de l'usage qu'il fait des analyses.

**13. Durée, résiliation et sort des données**
Le Client résilie à tout moment depuis Abonnement et facturation ; la résiliation prend effet à la fin de la période payée, sans remboursement de la période en cours. Le compte passe alors en pause.
Yuno peut suspendre ou résilier le compte en cas de manquement grave du Client non corrigé 15 jours après une mise en demeure par e-mail, et sans délai en cas d'envoi massif non sollicité, de fraude ou d'atteinte à la sécurité du service.
En pause, la base reste lisible et exportable. Le Client peut demander à tout moment la suppression de son compte et de ses données. Sans réactivation, Yuno clôt le compte 12 mois après la fin de l'abonnement ou de l'essai, après en avoir averti le titulaire par e-mail au moins 30 jours avant. À la clôture, les données des clients du Client sont supprimées dans les 30 jours, et des sauvegardes au plus tard 90 jours après ; les factures et preuves que la loi impose de garder sont conservées pour la durée légale.

**14. Modification des conditions**
Yuno peut modifier ces conditions. Un changement important est annoncé au moins 30 jours avant son entrée en vigueur, par e-mail et dans la Console, où le titulaire l'accepte. Le Client qui le refuse peut résilier sans frais avant cette date.

**15. Droit applicable et litiges**
Les présentes conditions sont soumises au droit français. En cas de différend, les parties cherchent d'abord une solution amiable pendant 30 jours à compter d'un écrit de l'une d'elles. À défaut, et sous réserve des règles d'ordre public, le litige est porté devant les juridictions compétentes du ressort de la cour d'appel de Toulouse.

**Annexe — Modèle de texte pour informer vos clients**
À adapter, puis à publier dans votre politique de confidentialité (y compris celle que votre billetterie affiche sur vos pages de soirée), sur vos pages d'inscription, et en lien dans vos e-mails. Remplacez ce qui est entre crochets. Si vous n'utilisez pas une fonction, retirez le paragraphe qui la décrit.

« Vos données et nos messages
[Nom de votre structure], [adresse], [e-mail de contact], est responsable du traitement de vos données. Nous utilisons notre billetterie ([Shotgun]) pour vendre nos billets, et Yuno CRM, édité par WOMBER (France), pour gérer notre relation avec notre public. Ces deux prestataires agissent pour notre compte.
Données : celles que vous donnez en achetant un billet ou en vous inscrivant (nom, e-mail, téléphone, âge, genre, ville, code postal, pays s'ils sont demandés), vos billets, tarifs et entrées, et vos réactions à nos messages.
Pourquoi :
• gérer vos billets et nos soirées (exécution de la vente) ;
• vous envoyer nos informations et offres par e-mail ou SMS, si vous l'avez accepté (ou, par e-mail, si vous êtes déjà client et ne vous y êtes pas opposé) ;
• analyser vos achats (artistes, styles, jours, habitudes d'achat comme l'achat tôt ou à plusieurs, distance entre votre commune et le lieu) pour comprendre ce qui fait venir notre public, estimer vos chances de revenir à une prochaine soirée et choisir les messages les plus utiles. Une partie de notre public, tirée au sort, ne reçoit pas certains messages pour que nous en mesurions l'effet. Cette analyse repose sur notre intérêt légitime à connaître et fidéliser notre public ; elle n'a aucun effet juridique, ne fixe aucun prix et ne conditionne jamais l'accès à nos soirées ;
• mesurer l'ouverture de nos e-mails et les clics sur leurs liens, si vous l'avez accepté.
Notre prestataire Yuno peut aussi tirer de nos données des comptages anonymes (sans aucune donnée vous concernant) pour améliorer son service.
Destinataires : notre équipe et nos prestataires techniques (billetterie, Yuno et ses sous-traitants d'hébergement, d'envoi d'e-mails et de SMS), dans l'Union européenne ou encadrés par les clauses types de la Commission européenne. Nous ne vendons pas vos données.
Durée : [3 ans] après votre dernier achat, votre dernière venue ou votre dernière réponse à nos messages.
Vos droits : vous pouvez à tout moment vous opposer à cette analyse et à nos messages, sans avoir à vous justifier : écrivez à [contact], cliquez sur le lien de désinscription en bas de chaque e-mail, ou répondez STOP à un SMS. Vous pouvez aussi accéder à vos données, les faire rectifier ou effacer, et retirer un accord donné. Vous pouvez saisir la CNIL (cnil.fr). »`
    },
    en: {
      title: 'Yuno CRM Terms',
      content: `Version of 8 October 2026

These terms form the contract between WOMBER, a sole proprietorship (Paul Brisebois), SIRET 995 130 747 00018, 25 avenue Mercure, 31130 Quint-Fonsegrives, France, contact@yunoapp.eu ("Yuno"), and the club, event organizer or association that opens a Yuno CRM account (the "Client"). The contract also includes the Data Processing Agreement (yunoapp.eu/legal/dpa), whose chapter 12 "Yuno CRM" applies to the Client, the Confidentiality Commitment (yunoapp.eu/legal/confidentialite), and the prices shown on the Pricing page and in the Console when the Client subscribes. In case of conflict, the Data Processing Agreement prevails on data protection, then these terms. The French version of these terms prevails.

**1. The service**
Yuno CRM is online software available at crm.yunoapp.eu (the "Console"). It connects to the Client's ticketing (Shotgun today), reads its sales and buyers, accepts contact files, and helps the Client know its audience and write to it: contact base, segments, analyses, emails, SMS, automations, sign-up pages and tracked links.
Yuno CRM sells nothing: every ticket is still sold by the Client's ticketing, under its own terms. A feature marked "Soon" in the Console is not part of the service until it opens.
Yuno CRM is reserved for professionals. The Client acts for its business; the right of withdrawal under the French Consumer Code does not apply.

**2. Account, team and security**
The account is opened by a person authorised to bind the Client (the "account holder"), who accepts these terms on its behalf. The account holder invites the team, chooses roles, and answers for actions taken from the account.
Credentials are personal. The Client keeps its access confidential, turns on two-factor authentication when the Console asks, and tells Yuno at once of any suspicious access.
Yuno accesses the Client's data only to run the service, keep it secure, prevent fraud, handle an incident or answer a request from the Client. Yuno opens a session in the Client's Console ("assisted access") only with the account holder's agreement, which can be withdrawn at any time; every access is logged.

**3. Trial, subscription and prices**
The trial lasts 14 days, with no card, with the Yunits allowance shown when the account opens. If no subscription is taken at the end of the trial, the account is paused: the base stays readable and exportable, but syncing with the ticketing and sending stop.
The subscription is monthly or yearly, paid in advance by card through Stripe, and renews at each term until cancelled. Prices and what each plan includes are on the Pricing page and in the Console. The price of a running subscription stays the one at which it was taken while it is not interrupted. Should Yuno change the price of a running subscription, it would announce it at least 30 days in advance by email and in the Console; the Client could cancel before the new price applies.
Prices are shown excluding taxes. As long as the publisher benefits from the VAT franchise, no VAT is charged (article 293 B of the French General Tax Code). Invoices are available in the Console.
If a payment fails, Yuno reminds the Client; without settlement, the account is paused.

**4. Yunits**
Yunits are the unit used for sends. Each send uses Yunits according to the rates shown in the Console before sending (for example an email, an SMS to France, an SMS abroad). The Console shows the cost of a send and the balance before any confirmation. A change of rates is announced in the Console and never applies to a send already confirmed.
Yunits are free (trial, subscription) or bought (top-up). Each has the expiry date shown in the Console when granted or bought; the Yunits that expire first are used first.
No Yunit is used for a test send, for a recipient set aside by the sending rules, or for a message refused by the provider before sending. A message accepted by the provider and then not delivered (number that does not exist, phone off for too long) is still counted.
Yunits are not refundable, transferable or convertible into money. Exception: if Yuno permanently stops Yuno CRM, it refunds the bought Yunits not yet used.

**5. Ticketing connection and imported data**
The Client connects its ticketing account itself and provides the access key. Its ticketing processes its buyers' data on its behalf; by connecting Yuno CRM, the Client appoints Yuno as another provider to process that data for it, and warrants that its contract with its ticketing allows this. Yuno reads this data and never writes anything to the ticketing. The access key is kept in an encrypted vault and is never shown again.
The figures in the Console come from what the ticketing reports. When the ticketing does not provide a piece of data, the Console says so; it never replaces missing data with an estimate without saying it. Yuno is not liable for errors, outages or changes of the ticketing.
For any imported file, the Client attests where the contacts come from and that they agreed to receive its messages; Yuno keeps this attestation, time-stamped.

**6. Analyses, hypotheses and "Chance of coming"**
On the Client's behalf, and from its data only, Yuno CRM computes:
• sales, attendance and messaging statistics;
• "What brings them": hypotheses on what brings the Client's audience back (artists, music genre, format, series of nights, day, buying habits such as buying early, last minute or as a group, distance between the declared town and the venue). Each hypothesis is tested on the Client's past nights and has a status ("confirmed", "no clear difference on your account", "to test"); on a customer's card, it shows as a fact observed in their purchases, never as a statement about the person;
• "Chance of coming": for each customer who already came, a level (high, medium, low) of chance of buying for an upcoming night, with its main reasons, never a percentage;
• "Who to target": groups of customers suggested for an upcoming night, and a control group of 10% not contacted, drawn at random, to measure the real effect of messages.
These computations use neither people's gender nor the opens and clicks measured in their emails. They are statistical estimates: they can be wrong. They serve to organise the Client's marketing communication (who to write to, when, with which message) and to understand its audience.
The Client shall not use them to take a decision that produces a legal effect on a person or significantly affects them: refusing entry or a sale, setting a price, reserving a discount or a presale for some people, putting someone on an exclusion list. It shall not use them either to infer or target a person's origin, political opinions, religious beliefs, health, sex life or sexual orientation, including from the theme of a night, nor to target minors.
When a person objects to the analysis, the Client excludes them from their card ("Exclude from profiling"): their profile and estimates are deleted and no longer computed.
Yuno guarantees no commercial result.

**7. Sending messages**
The Client is the sender and advertiser of its messages. It chooses their content and recipients, and answers for their compliance:
• the recipient's prior agreement, or an existing customer relationship for similar products, under article L. 34-5 of the French Postal and Electronic Communications Code; an agreement for emails does not cover SMS;
• the advertiser's identity, an unsubscribe link in every email, the STOP mention in every SMS;
• the recipient's agreement, where required, to the individual measurement of opens and clicks of its emails, which relies on trackers (article 82 of the French Data Protection Act; CNIL recommendation no. 2026-042 of 12 March 2026);
• the law on advertising alcoholic beverages.
Yuno applies to every account sending rules that the Client cannot turn off: no sending to an unsubscribed person, to a failing address or to a number that replied STOP, a frequency cap per person, sending hours (no SMS between 9:30 pm and 8 am), monitoring of complaints and failures. Yuno may suspend a send or an account's sends in case of abnormal complaints or failures, unlawful content or risk to the platform's sending reputation; it informs the Client.
Before the first SMS, the Client enters its legal identity (company name and SIRET, RNA or VAT number) and a sender name that complies with operators' rules.
Unlawful, misleading, hateful or discriminatory messages are forbidden, as is any send to addresses bought, rented or collected without agreement.

**8. The data of the Client's customers**
For the data of its customers, contacts and attendees, the Client is the controller and Yuno acts as processor, under the Data Processing Agreement (chapter 12 "Yuno CRM"). The Client:
• informs its customers of how their data is used, including the analysis described in article 6, their right to object to it and the trackers in its emails; a template sits in the appendix, to be published in particular as the privacy policy of its ticketing;
• ensures a legal basis for each use, documents the balancing of its legitimate interest for the analysis, and collects the agreements its sends require;
• answers people's requests (access, rectification, erasure, objection), with the Console's tools and Yuno's support;
• chooses a retention period in Settings › Data; Yuno recommends 3 years after the last contact coming from the person (purchase, visit, click, sign-up);
• carries out the impact assessment under article 35 GDPR when required; on request, Yuno provides a template impact assessment and balancing test suited to Yuno CRM.
For the data of professional accounts (account holder, team), billing, security and measurement of Console usage, Yuno is the controller (Privacy Policy, yunoapp.eu/legal/privacy).

**9. Anonymous statistics**
The Client authorises Yuno to reuse the data processed on its behalf to draw aggregated, anonymous counts from it, meant to improve Yuno CRM's analysis rules for all its users, under the precise conditions of article 12.6 of the Data Processing Agreement. For this reuse, Yuno is the controller. These counts contain no personal data and no commercial information of the Client (night title, artist, town). The account holder can withdraw this authorisation at any time in Settings › Data; counts already contributed are then removed.

**10. Availability, support and changes**
Yuno uses reasonable means for the service to be available and work properly, without guaranteeing continuous availability: maintenance, updates, provider or ticketing outages may interrupt it. Support answers from the Console and at contact@yunoapp.eu.
The service evolves. If Yuno removes a feature essential to the Client's use, it announces it at least 30 days in advance; the Client can then cancel and be refunded the unused part of its subscription.

**11. Ownership**
Yuno keeps all rights in the software, the analysis rules, the email and page templates, and the Yuno brand. It grants the Client, during the subscription, a personal, non-exclusive and non-transferable right of use.
The Client keeps ownership of its data and content (texts, images, logos). It grants Yuno the right to host, reproduce and process them only as needed for the service, and warrants that it holds the rights in the content it imports.

**12. Liability**
Yuno has an obligation of means. It is not liable for indirect damage (loss of revenue, customers, image), for the consequences of the Client's commercial decisions, or for acts of the ticketing or of a telecom operator.
Except for gross or intentional misconduct, Yuno's total liability is capped at the amounts paid by the Client for Yuno CRM in the 12 months before the event giving rise to it.
The Client holds Yuno harmless from any claim arising from its messages, its content, the data it imports or its use of the analyses.

**13. Term, cancellation and fate of data**
The Client cancels at any time from Subscription and billing; cancellation takes effect at the end of the paid period, with no refund of the current period. The account is then paused.
Yuno may suspend or close the account for a serious breach by the Client not remedied 15 days after formal notice by email, and immediately in case of mass unsolicited sending, fraud or harm to the security of the service.
While paused, the base stays readable and exportable. The Client may ask at any time for its account and data to be deleted. Without reactivation, Yuno closes the account 12 months after the end of the subscription or trial, after warning the account holder by email at least 30 days before. On closing, the data of the Client's customers is deleted within 30 days, and from backups no later than 90 days after; invoices and proofs the law requires are kept for the legal period.

**14. Changes to these terms**
Yuno may change these terms. A significant change is announced at least 30 days before it applies, by email and in the Console, where the account holder accepts it. A Client who refuses it may cancel at no cost before that date.

**15. Governing law and disputes**
These terms are governed by French law. In case of dispute, the parties first seek an amicable solution for 30 days from a written notice by either of them. Failing that, and subject to mandatory rules, the dispute is brought before the competent courts within the jurisdiction of the Toulouse Court of Appeal.

**Appendix — Template text to inform your customers**
Adapt it, then publish it in your privacy policy (including the one your ticketing shows on your event pages), on your sign-up pages, and as a link in your emails. Replace what is in brackets. If you do not use a feature, remove the paragraph describing it.

"Your data and our messages
[Name of your organisation], [address], [contact email], is the controller of your data. We use our ticketing ([Shotgun]) to sell our tickets, and Yuno CRM, published by WOMBER (France), to manage our relationship with our audience. Both providers act on our behalf.
Data: what you give when buying a ticket or signing up (name, email, phone, age, gender, town, postcode, country where asked), your tickets, prices and entries, and how you react to our messages.
Why:
• manage your tickets and our nights (performance of the sale);
• send you our news and offers by email or SMS, if you agreed (or, by email, if you are already a customer and did not object);
• analyse your purchases (artists, styles, days, buying habits such as buying early or as a group, distance between your town and the venue) to understand what brings our audience, estimate your chance of coming back to an upcoming night and choose the most useful messages. Part of our audience, drawn at random, does not receive some messages so that we can measure their effect. This analysis relies on our legitimate interest in knowing and keeping our audience; it has no legal effect, sets no price and never conditions access to our nights;
• measure the opening of our emails and the clicks on their links, if you agreed.
Our provider Yuno may also draw anonymous counts from our data (with no data about you) to improve its service.
Recipients: our team and our technical providers (ticketing, Yuno and its hosting, email and SMS sub-processors), in the European Union or covered by the European Commission's standard clauses. We do not sell your data.
Retention: [3 years] after your last purchase, your last visit or your last response to our messages.
Your rights: you can object at any time to this analysis and to our messages, without giving a reason: write to [contact], click the unsubscribe link at the bottom of every email, or reply STOP to an SMS. You can also access your data, have it rectified or erased, and withdraw an agreement you gave. You can lodge a complaint with the CNIL (cnil.fr) or your local data protection authority."`
    },
    es: {
      title: 'Condiciones de Yuno CRM',
      content: `Versión del 8 de octubre de 2026

Estas condiciones forman el contrato entre WOMBER, empresa individual (Paul Brisebois), SIRET 995 130 747 00018, 25 avenue Mercure, 31130 Quint-Fonsegrives, Francia, contact@yunoapp.eu («Yuno»), y la discoteca, el organizador de eventos o la asociación que abre una cuenta de Yuno CRM (el «Cliente»). El contrato incluye también el Acuerdo de encargo del tratamiento (yunoapp.eu/legal/dpa), cuyo capítulo 12 «Yuno CRM» se aplica al Cliente, el Compromiso de confidencialidad (yunoapp.eu/legal/confidentialite) y los precios mostrados en la página de Tarifas y en la Consola en el momento de la suscripción. En caso de contradicción, el Acuerdo de encargo del tratamiento prevalece en materia de protección de datos y, después, estas condiciones. Prevalece la versión francesa de estas condiciones.

**1. El servicio**
Yuno CRM es un software en línea, disponible en crm.yunoapp.eu (la «Consola»). Se conecta a la ticketera del Cliente (hoy Shotgun), lee sus ventas y sus compradores, acepta archivos de contactos y ayuda al Cliente a conocer a su público y a escribirle: base de contactos, segmentos, análisis, e-mails, SMS, automatizaciones, páginas de registro y enlaces de seguimiento.
Yuno CRM no vende nada: cada entrada la sigue vendiendo la ticketera del Cliente, según sus propias condiciones. Una función marcada como «Próximamente» en la Consola no forma parte del servicio mientras no esté abierta.
Yuno CRM está reservado a profesionales. El Cliente actúa para su actividad profesional; no se aplica el derecho de desistimiento previsto por el Código de consumo francés.

**2. Cuenta, equipo y seguridad**
La cuenta la abre una persona facultada para obligar al Cliente (el «titular»), que acepta estas condiciones en su nombre. El titular invita a su equipo, elige los roles y responde de las acciones realizadas desde la cuenta.
Las credenciales son personales. El Cliente mantiene sus accesos confidenciales, activa la doble autenticación cuando la Consola lo pide y avisa a Yuno sin demora de cualquier acceso sospechoso.
Yuno solo accede a los datos del Cliente para hacer funcionar el servicio, garantizar su seguridad, prevenir el fraude, tratar una incidencia o responder a una solicitud del Cliente. Yuno solo abre una sesión en la Consola del Cliente («acceso asistido») con el acuerdo del titular, que puede retirarlo en cualquier momento; cada acceso queda registrado.

**3. Prueba, suscripción y precios**
La prueba dura 14 días, sin tarjeta, con la dotación de Yunits mostrada al abrir la cuenta. Si al final de la prueba no hay suscripción, la cuenta queda en pausa: la base sigue legible y exportable, pero la sincronización con la ticketera y los envíos se detienen.
La suscripción es mensual o anual, se paga por adelantado con tarjeta a través de Stripe y se renueva en cada vencimiento hasta su cancelación. Los precios y lo que incluye cada fórmula figuran en la página de Tarifas y en la Consola. El precio de una suscripción en curso sigue siendo el de su contratación mientras no se interrumpa. Si Yuno tuviera que modificar el precio de una suscripción en curso, lo anunciaría con al menos 30 días de antelación por e-mail y en la Consola; el Cliente podría cancelar antes de que se aplique el nuevo precio.
Los precios se indican sin impuestos. Mientras el editor se acoja a la franquicia de IVA, no se factura IVA (artículo 293 B del Código General de Impuestos francés). Las facturas están disponibles en la Consola.
Si un pago falla, Yuno se lo recuerda al Cliente; sin regularización, la cuenta queda en pausa.

**4. Los Yunits**
Los Yunits son la unidad de cuenta de los envíos. Cada envío consume Yunits según la tarifa mostrada en la Consola antes del envío (por ejemplo, un e-mail, un SMS a Francia, un SMS al extranjero). La Consola muestra el coste de un envío y el saldo antes de cualquier confirmación. Un cambio de tarifa se anuncia en la Consola y nunca se aplica a un envío ya confirmado.
Los Yunits son gratuitos (prueba, suscripción) o comprados (recarga). Cada uno tiene la fecha de validez mostrada en la Consola al asignarse o comprarse; los Yunits que caducan antes se usan primero.
No se descuenta ningún Yunit por un envío de prueba, por un destinatario apartado por las reglas de envío ni por un mensaje rechazado por el proveedor antes de su envío. Un mensaje aceptado por el proveedor y después no entregado (número inexistente, teléfono apagado demasiado tiempo) sigue descontándose.
Los Yunits no son reembolsables, ni cedibles, ni convertibles en dinero. Excepción: si Yuno deja definitivamente de ofrecer Yuno CRM, reembolsa los Yunits comprados y no usados.

**5. Conexión con la ticketera y datos importados**
El Cliente conecta él mismo su cuenta de ticketera y facilita la clave de acceso. Su ticketera trata los datos de sus compradores por cuenta suya; al conectar Yuno CRM, el Cliente designa a Yuno como otro proveedor encargado de tratarlos para él, y garantiza que su contrato con la ticketera lo permite. Yuno lee estos datos y nunca escribe nada en la ticketera. La clave de acceso se guarda en una caja fuerte cifrada y nunca se vuelve a mostrar.
Las cifras de la Consola proceden de lo que informa la ticketera. Cuando la ticketera no facilita un dato, la Consola lo dice; nunca sustituye un dato que falta por una estimación sin indicarlo. Yuno no responde de los errores, interrupciones o cambios de la ticketera.
Para todo archivo importado, el Cliente certifica el origen de los contactos y su acuerdo para recibir sus mensajes; Yuno conserva esa certificación, con fecha y hora.

**6. Análisis, hipótesis y «Probabilidad de venir»**
Por cuenta del Cliente, y solo con sus datos, Yuno CRM calcula:
• estadísticas de ventas, asistencia y mensajes;
• «Lo que les hace venir»: hipótesis sobre lo que hace volver al público del Cliente (artistas, género musical, formato, serie de noches, día, hábitos de compra como comprar pronto, a última hora o en grupo, distancia entre el municipio declarado y el local). Cada hipótesis se prueba con las noches pasadas del Cliente y tiene un estado («confirmada», «sin diferencia clara en su cuenta», «por probar»); en la ficha de un cliente, se muestra como un hecho observado en sus compras, nunca como una afirmación sobre la persona;
• «Probabilidad de venir»: para cada cliente que ya vino, un nivel (alta, media, baja) de probabilidad de comprar para una próxima noche, con sus principales motivos, nunca un porcentaje;
• «A quién dirigirse»: grupos de clientes propuestos para una próxima noche, y un grupo de control del 10 % no contactado, sorteado, para medir el efecto real de los mensajes.
Estos cálculos no usan ni el género de las personas ni las aperturas y clics medidos en sus e-mails. Son estimaciones estadísticas: pueden equivocarse. Sirven para organizar la comunicación comercial del Cliente (a quién escribir, cuándo, con qué mensaje) y para entender a su público.
El Cliente se compromete a no usarlas para tomar una decisión que produzca efectos jurídicos sobre una persona o la afecte de forma significativa: denegar la entrada o la venta, fijar un precio, reservar un descuento o una preventa según la persona, incluir a alguien en una lista de exclusión. Se compromete también a no usarlas para deducir o dirigirse al origen, las opiniones políticas, las convicciones religiosas, la salud, la vida o la orientación sexual de una persona, incluso a partir de la temática de una noche, ni para dirigirse a menores.
Cuando una persona se opone al análisis, el Cliente la excluye desde su ficha («Excluir del perfilado»): su perfil y sus estimaciones se borran y dejan de calcularse.
Yuno no garantiza ningún resultado comercial.

**7. Envío de mensajes**
El Cliente es el remitente y el anunciante de sus mensajes. Elige su contenido y sus destinatarios, y responde de su conformidad:
• acuerdo previo del destinatario, o relación de cliente existente para productos similares, en las condiciones del artículo L. 34-5 del Código de correos y comunicaciones electrónicas francés; un acuerdo para e-mails no vale para SMS;
• identidad del anunciante, enlace de baja en cada e-mail, mención STOP en cada SMS;
• acuerdo del destinatario, cuando se exija, para la medición individual de la apertura y los clics de sus e-mails, que se basa en rastreadores (artículo 82 de la ley francesa de protección de datos; recomendación de la CNIL n.º 2026-042 del 12 de marzo de 2026);
• normativa sobre publicidad de bebidas alcohólicas.
Yuno aplica a todas las cuentas reglas de envío que el Cliente no puede desactivar: ningún envío a una persona dada de baja, a una dirección con errores o a un número que respondió STOP, límite de frecuencia por persona, horarios de envío (ningún SMS entre las 21:30 y las 8:00), vigilancia de quejas y errores. Yuno puede suspender un envío o los envíos de una cuenta en caso de quejas o errores anormales, contenido ilícito o riesgo para la reputación de envío de la plataforma; informa de ello al Cliente.
Antes del primer SMS, el Cliente indica su identidad legal (razón social y número SIRET, RNA o IVA) y un nombre de remitente conforme a las reglas de los operadores.
Están prohibidos los mensajes ilícitos, engañosos, de odio o discriminatorios, y cualquier envío a direcciones compradas, alquiladas o recogidas sin acuerdo.

**8. Los datos de los clientes del Cliente**
Para los datos de sus clientes, contactos y asistentes, el Cliente es responsable del tratamiento y Yuno actúa como encargado, en las condiciones del Acuerdo de encargo del tratamiento (capítulo 12 «Yuno CRM»). El Cliente:
• informa a sus clientes del uso de sus datos, incluido el análisis descrito en el artículo 6, su derecho a oponerse y los rastreadores de sus e-mails; en el anexo figura un modelo de texto, que puede publicar en particular como política de privacidad de su ticketera;
• garantiza una base jurídica para cada uso, documenta la ponderación de su interés legítimo para el análisis y recoge los acuerdos que exigen sus envíos;
• responde a las solicitudes de las personas (acceso, rectificación, supresión, oposición), con las herramientas de la Consola y el soporte de Yuno;
• elige un plazo de conservación en Ajustes › Datos; Yuno recomienda 3 años tras el último contacto procedente de la persona (compra, visita, clic, registro);
• realiza la evaluación de impacto del artículo 35 del RGPD cuando se exija; Yuno le facilita, si lo pide, un modelo de evaluación de impacto y de ponderación adaptado a Yuno CRM.
Para los datos de las cuentas profesionales (titular, equipo), la facturación, la seguridad y la medición del uso de la Consola, Yuno es responsable del tratamiento (Política de privacidad, yunoapp.eu/legal/privacy).

**9. Estadísticas anónimas**
El Cliente autoriza a Yuno a reutilizar los datos tratados por su cuenta para obtener recuentos agregados y anónimos, destinados a mejorar las reglas de análisis de Yuno CRM para todos sus usuarios, en las condiciones precisas del artículo 12.6 del Acuerdo de encargo del tratamiento. Para esta reutilización, Yuno es responsable del tratamiento. Estos recuentos no contienen ningún dato personal ni ninguna información comercial del Cliente (título de noche, artista, ciudad). El titular puede retirar esta autorización en cualquier momento en Ajustes › Datos; los recuentos ya aportados se retiran entonces.

**10. Disponibilidad, soporte y cambios**
Yuno pone los medios razonables para que el servicio esté disponible y funcione correctamente, sin garantizar una disponibilidad continua: mantenimientos, actualizaciones o caídas de proveedores o de la ticketera pueden interrumpirlo. El soporte responde desde la Consola y en contact@yunoapp.eu.
El servicio evoluciona. Si Yuno retira una función esencial para el uso del Cliente, lo anuncia con al menos 30 días de antelación; el Cliente puede entonces cancelar y obtener el reembolso de la parte no usada de su suscripción.

**11. Propiedad**
Yuno conserva todos los derechos sobre el software, las reglas de análisis, las plantillas de e-mails y páginas, y la marca Yuno. Concede al Cliente, durante la suscripción, un derecho de uso personal, no exclusivo e intransferible.
El Cliente sigue siendo propietario de sus datos y contenidos (textos, imágenes, logotipos). Concede a Yuno el derecho a alojarlos, reproducirlos y tratarlos solo en la medida necesaria para el servicio, y garantiza que dispone de los derechos sobre los contenidos que importa.

**12. Responsabilidad**
Yuno asume una obligación de medios. No responde de daños indirectos (pérdida de facturación, clientela, imagen), ni de las consecuencias de las decisiones comerciales del Cliente, ni de hechos de la ticketera o de un operador de telecomunicaciones.
Salvo culpa grave o dolo, la responsabilidad total de Yuno se limita a las cantidades pagadas por el Cliente por Yuno CRM en los 12 meses anteriores al hecho generador.
El Cliente mantiene indemne a Yuno frente a cualquier reclamación derivada de sus mensajes, sus contenidos, los datos que importa o el uso que hace de los análisis.

**13. Duración, cancelación y destino de los datos**
El Cliente cancela en cualquier momento desde Suscripción y facturación; la cancelación surte efecto al final del periodo pagado, sin reembolso del periodo en curso. La cuenta queda entonces en pausa.
Yuno puede suspender o cerrar la cuenta en caso de incumplimiento grave del Cliente no subsanado 15 días después de un requerimiento por e-mail, y sin demora en caso de envío masivo no solicitado, fraude o atentado contra la seguridad del servicio.
En pausa, la base sigue legible y exportable. El Cliente puede pedir en cualquier momento la supresión de su cuenta y de sus datos. Sin reactivación, Yuno cierra la cuenta 12 meses después del final de la suscripción o de la prueba, tras avisar al titular por e-mail con al menos 30 días de antelación. Al cierre, los datos de los clientes del Cliente se suprimen en 30 días, y de las copias de seguridad a más tardar 90 días después; las facturas y pruebas que la ley obliga a conservar se guardan durante el plazo legal.

**14. Modificación de las condiciones**
Yuno puede modificar estas condiciones. Un cambio importante se anuncia al menos 30 días antes de su entrada en vigor, por e-mail y en la Consola, donde el titular lo acepta. El Cliente que lo rechace puede cancelar sin coste antes de esa fecha.

**15. Derecho aplicable y litigios**
Estas condiciones se rigen por el derecho francés. En caso de controversia, las partes buscan primero una solución amistosa durante 30 días desde un escrito de cualquiera de ellas. A falta de acuerdo, y sin perjuicio de las normas de orden público, el litigio se somete a los tribunales competentes de la jurisdicción de la Cour d'appel de Toulouse.

**Anexo — Modelo de texto para informar a sus clientes**
Adáptelo y publíquelo en su política de privacidad (incluida la que su ticketera muestra en sus páginas de eventos), en sus páginas de registro y como enlace en sus e-mails. Sustituya lo que está entre corchetes. Si no usa una función, elimine el párrafo que la describe.

«Sus datos y nuestros mensajes
[Nombre de su estructura], [dirección], [e-mail de contacto], es responsable del tratamiento de sus datos. Usamos nuestra ticketera ([Shotgun]) para vender nuestras entradas, y Yuno CRM, editado por WOMBER (Francia), para gestionar nuestra relación con nuestro público. Ambos proveedores actúan por cuenta nuestra.
Datos: los que facilita al comprar una entrada o registrarse (nombre, e-mail, teléfono, edad, género, ciudad, código postal, país si se piden), sus entradas, tarifas y accesos, y sus reacciones a nuestros mensajes.
Para qué:
• gestionar sus entradas y nuestras noches (ejecución de la venta);
• enviarle nuestras novedades y ofertas por e-mail o SMS, si lo aceptó (o, por e-mail, si ya es cliente y no se opuso);
• analizar sus compras (artistas, estilos, días, hábitos de compra como comprar pronto o en grupo, distancia entre su municipio y el local) para entender qué hace venir a nuestro público, estimar su probabilidad de volver a una próxima noche y elegir los mensajes más útiles. Una parte de nuestro público, sorteada, no recibe algunos mensajes para que podamos medir su efecto. Este análisis se basa en nuestro interés legítimo en conocer y fidelizar a nuestro público; no tiene efectos jurídicos, no fija ningún precio y nunca condiciona el acceso a nuestras noches;
• medir la apertura de nuestros e-mails y los clics en sus enlaces, si lo aceptó.
Nuestro proveedor Yuno puede además obtener de nuestros datos recuentos anónimos (sin ningún dato sobre usted) para mejorar su servicio.
Destinatarios: nuestro equipo y nuestros proveedores técnicos (ticketera, Yuno y sus encargados de alojamiento, envío de e-mails y SMS), en la Unión Europea o cubiertos por las cláusulas tipo de la Comisión Europea. No vendemos sus datos.
Conservación: [3 años] tras su última compra, su última visita o su última respuesta a nuestros mensajes.
Sus derechos: puede oponerse en cualquier momento a este análisis y a nuestros mensajes, sin justificarlo: escriba a [contacto], pulse el enlace de baja al final de cada e-mail o responda STOP a un SMS. También puede acceder a sus datos, rectificarlos o suprimirlos, y retirar un acuerdo dado. Puede presentar una reclamación ante la CNIL (cnil.fr) o la autoridad de protección de datos de su país.»`
    }
  },

  'confidentialite': {
    fr: {
      title: 'Engagement de Confidentialité',
      content: `**1. Objet**
Le présent engagement protège les informations confidentielles de Yuno, plateforme éditée par WOMBER (SIREN 995 130 747, 25 avenue Mercure, 31130 Quint-Fonsegrives, France). Il s'applique à toute personne qui accède à un espace professionnel Yuno (club, organisateur, promoteur, affilié, DJ, staff) ou à un aperçu de démonstration (lien de preview), et complète les conditions applicables à votre compte.

**2. Informations confidentielles**
Sont confidentielles toutes les informations non publiques auxquelles vous accédez via Yuno, notamment : fonctionnalités et interfaces non publiées, feuille de route, logique de tarification et de commissions, outils professionnels, méthodes et savoir-faire, données commerciales et statistiques, ainsi que l'existence et le contenu des échanges avec Yuno.

**3. Vos engagements**
En accédant à un espace professionnel ou à un aperçu de démonstration, vous vous engagez à :
• ne pas divulguer ces informations à des tiers ;
• ne pas les copier, enregistrer, filmer ou reproduire au-delà de l'usage normal du service ;
• ne pas les utiliser à d'autres fins que l'évaluation ou l'utilisation de Yuno ;
• ne pas décompiler le service ni procéder à de l'ingénierie inverse.

**4. Non-exploitation**
Vous vous interdisez d'utiliser ces informations, directement ou indirectement, pour concevoir, développer, faire développer, financer ou commercialiser un produit ou service reproduisant ou s'inspirant substantiellement de Yuno, pendant votre accès et pendant 3 ans après la dernière communication d'informations confidentielles.

**5. Non-contournement**
Pendant votre accès et pendant 12 mois après, vous vous interdisez d'utiliser les informations confidentielles pour contourner Yuno auprès des partenaires, organisateurs, DJs ou clients qui vous auraient été révélés par la plateforme, lorsque vous n'en aviez pas connaissance par ailleurs.

**6. Propriété intellectuelle**
Tous les droits (code, interfaces, marques, contenus, bases de données, savoir-faire) restent la propriété exclusive de Yuno / WOMBER. Aucune licence ni cession n'est consentie au-delà du droit strictement limité d'utiliser le service.

**7. Durée**
Les obligations de confidentialité survivent 5 ans après la fin de votre accès. Les informations relevant du secret des affaires (articles L. 151-1 et suivants du Code de commerce) restent protégées tant qu'elles conservent ce caractère.

**8. Responsabilité**
Tout manquement engage votre responsabilité et peut donner lieu à la réparation intégrale du préjudice subi par Yuno, ainsi qu'à toute mesure d'urgence destinée à faire cesser le trouble.

**9. Preuve d'acceptation**
L'acceptation en ligne (case cochée lors de l'inscription, de l'onboarding ou de l'accès à un aperçu) vaut signature électronique au sens du règlement (UE) n° 910/2014 (eIDAS). Yuno conserve la preuve de l'acceptation : identifiant ou email, version du document, horodatage, adresse IP.

**10. Droit applicable**
Droit français. Tribunaux compétents du ressort de la Cour d'appel de Toulouse, dans les limites permises par la loi.`
    },
    en: {
      title: 'Confidentiality Commitment',
      content: `**1. Purpose**
This commitment protects the confidential information of Yuno, a platform operated by WOMBER (SIREN 995 130 747, 25 avenue Mercure, 31130 Quint-Fonsegrives, France). It applies to anyone accessing a Yuno professional dashboard (club, organizer, promoter, affiliate, DJ, staff) or a demo preview (preview link), and supplements the terms applicable to your account.

**2. Confidential Information**
All non-public information you access through Yuno is confidential, including: unreleased features and interfaces, roadmap, pricing and commission logic, professional tools, methods and know-how, business and statistical data, as well as the existence and content of discussions with Yuno.

**3. Your Commitments**
By accessing a professional dashboard or a demo preview, you agree to:
• not disclose this information to third parties;
• not copy, record, film, or reproduce it beyond normal use of the service;
• not use it for any purpose other than evaluating or using Yuno;
• not decompile or reverse engineer the service.

**4. Non-Exploitation**
You agree not to use this information, directly or indirectly, to design, develop, have developed, fund, or market a product or service that reproduces or is substantially inspired by Yuno, during your access and for 3 years after the last disclosure of confidential information.

**5. Non-Circumvention**
During your access and for 12 months after, you agree not to use confidential information to circumvent Yuno with partners, organizers, DJs, or clients revealed to you through the platform, when you did not otherwise know them.

**6. Intellectual Property**
All rights (code, interfaces, trademarks, content, databases, know-how) remain the exclusive property of Yuno / WOMBER. No license or assignment is granted beyond the strictly limited right to use the service.

**7. Duration**
Confidentiality obligations survive for 5 years after your access ends. Information qualifying as a trade secret (Articles L. 151-1 et seq. of the French Commercial Code) remains protected for as long as it retains that status.

**8. Liability**
Any breach engages your liability and may give rise to full compensation for the harm suffered by Yuno, as well as any urgent measure to stop the breach.

**9. Proof of Acceptance**
Online acceptance (checkbox at signup, onboarding, or preview access) constitutes an electronic signature within the meaning of Regulation (EU) No 910/2014 (eIDAS). Yuno retains proof of acceptance: identifier or email, document version, timestamp, IP address.

**10. Applicable Law**
French law. Competent courts within the jurisdiction of the Toulouse Court of Appeal, to the extent permitted by law.`
    },
    es: {
      title: 'Compromiso de Confidencialidad',
      content: `**1. Objeto**
Este compromiso protege la información confidencial de Yuno, plataforma operada por WOMBER (SIREN 995 130 747, 25 avenue Mercure, 31130 Quint-Fonsegrives, Francia). Se aplica a cualquier persona que acceda a un espacio profesional de Yuno (club, organizador, promotor, afiliado, DJ, staff) o a una vista previa de demostración (enlace de preview), y complementa las condiciones aplicables a tu cuenta.

**2. Información confidencial**
Es confidencial toda la información no pública a la que accedas a través de Yuno, en particular: funcionalidades e interfaces no publicadas, hoja de ruta, lógica de precios y comisiones, herramientas profesionales, métodos y know-how, datos comerciales y estadísticos, así como la existencia y el contenido de los intercambios con Yuno.

**3. Tus compromisos**
Al acceder a un espacio profesional o a una vista previa de demostración, te comprometes a:
• no divulgar esta información a terceros;
• no copiarla, grabarla, filmarla ni reproducirla más allá del uso normal del servicio;
• no utilizarla para fines distintos de la evaluación o el uso de Yuno;
• no descompilar el servicio ni realizar ingeniería inversa.

**4. No explotación**
Te comprometes a no utilizar esta información, directa o indirectamente, para diseñar, desarrollar, hacer desarrollar, financiar o comercializar un producto o servicio que reproduzca o se inspire sustancialmente en Yuno, durante tu acceso y durante los 3 años posteriores a la última comunicación de información confidencial.

**5. No elusión**
Durante tu acceso y durante los 12 meses posteriores, te comprometes a no utilizar la información confidencial para eludir a Yuno con los socios, organizadores, DJs o clientes que te hayan sido revelados a través de la plataforma, cuando no los conocieras por otros medios.

**6. Propiedad intelectual**
Todos los derechos (código, interfaces, marcas, contenidos, bases de datos, know-how) siguen siendo propiedad exclusiva de Yuno / WOMBER. No se concede ninguna licencia ni cesión más allá del derecho estrictamente limitado de usar el servicio.

**7. Duración**
Las obligaciones de confidencialidad sobreviven durante 5 años tras el fin de tu acceso. La información que constituya secreto empresarial (artículos L. 151-1 y siguientes del Código de Comercio francés) permanece protegida mientras conserve ese carácter.

**8. Responsabilidad**
Cualquier incumplimiento compromete tu responsabilidad y puede dar lugar a la reparación íntegra del perjuicio sufrido por Yuno, así como a cualquier medida urgente destinada a hacer cesar la infracción.

**9. Prueba de aceptación**
La aceptación en línea (casilla marcada durante el registro, el onboarding o el acceso a una vista previa) constituye una firma electrónica en el sentido del Reglamento (UE) n.º 910/2014 (eIDAS). Yuno conserva la prueba de la aceptación: identificador o email, versión del documento, marca de tiempo, dirección IP.

**10. Derecho aplicable**
Derecho francés. Tribunales competentes de la jurisdicción de la Corte de Apelación de Toulouse, en los límites permitidos por la ley.`
    }
  },

  'dpa': {
    fr: {
      title: 'Accord de Sous-Traitance des Données (DPA)',
      content: `Version du 8 octobre 2026

**1. Objet et rôles**
Le présent accord encadre, conformément à l'article 28 du RGPD, les traitements de données personnelles que Yuno (éditée par WOMBER, SIREN 995 130 747, 25 avenue Mercure, 31130 Quint-Fonsegrives) réalise pour le compte des établissements et organisateurs partenaires (le « Partenaire »). Pour les données des clients finaux du Partenaire (participants, invités, acheteurs), le Partenaire est responsable de traitement et Yuno agit en qualité de sous-traitant. Pour la gestion des comptes professionnels, la facturation, la sécurité de la plateforme et l'amélioration du service, Yuno agit en qualité de responsable de traitement distinct (voir la Politique de Confidentialité). Le présent accord fait partie intégrante des Conditions Pro et des Conditions Yuno CRM (yunoapp.eu/legal/cgv-crm).

**2. Traitements concernés**
• Nature et finalités : vente et contrôle de billets, gestion de guest lists, réservations de tables VIP, commandes de boissons, campagnes de communication du Partenaire, statistiques d'audience.
• Catégories de données : identité, coordonnées, données de commande et de présence, données démographiques déclaratives.
• Personnes concernées : clients, participants et invités du Partenaire.
• Durée : durée d'utilisation de la plateforme par le Partenaire.

**3. Instructions**
Yuno traite ces données uniquement sur instruction documentée du Partenaire ; le paramétrage et l'utilisation des fonctionnalités de la plateforme valent instruction. La connexion, par le Partenaire, d'un assistant IA de son choix à sa Console (connecteur Yuno pour assistants IA) vaut instruction de transmettre à cet assistant les données que le Partenaire a choisies (statistiques, et fiches clients seulement s'il l'a coché) ; le fournisseur de cet assistant n'est pas un sous-traitant ultérieur de Yuno mais un destinataire désigné par le Partenaire, qui peut couper cet accès à tout moment depuis sa Console. Par cette connexion, l'assistant peut aussi enregistrer dans la Console des brouillons d'e-mails et des pages d'inscription (en brouillon, ou en proposition de modification d'une page déjà publiée) préparés à la demande du Partenaire ; aucun envoi ni aucune publication n'a lieu sans une action du Partenaire dans sa Console. Yuno informe le Partenaire si, à son avis, une instruction constitue une violation du RGPD.

**4. Confidentialité et sécurité**
Les personnes autorisées à traiter les données sont soumises à une obligation de confidentialité. Yuno met en œuvre les mesures techniques et organisationnelles appropriées (article 32 RGPD) : chiffrement en transit (HTTPS/TLS), cloisonnement des données par établissement (row level security), contrôle d'accès par rôle, authentification renforcée (MFA), journalisation de sécurité.

**5. Sous-traitants ultérieurs**
Le Partenaire autorise de manière générale le recours aux sous-traitants ultérieurs suivants : Supabase (hébergement base de données), Stripe (paiements), Resend (envoi d'emails), Octopush (envoi de SMS, société française, données hébergées en France), OpenAI (Assistant Console, lorsque le Partenaire l'utilise), Mapbox (cartographie), Cloudflare (diffusion du site), PostHog (mesure d'audience, hébergement UE). Yuno informe le Partenaire de tout changement envisagé (ajout ou remplacement), lui laissant la possibilité d'émettre des objections raisonnables, et impose à ses sous-traitants des obligations équivalentes au présent accord.

**6. Assistance**
Compte tenu de la nature du traitement, Yuno aide le Partenaire, par des mesures techniques et organisationnelles appropriées, à donner suite aux demandes d'exercice des droits des personnes concernées (accès, rectification, effacement, opposition, limitation, portabilité), et l'assiste pour ses obligations d'analyse d'impact et de consultation préalable le cas échéant.

**7. Violations de données**
Yuno notifie au Partenaire toute violation de données à caractère personnel le concernant dans les meilleurs délais après en avoir pris connaissance, avec les informations utiles à la notification éventuelle à la CNIL et aux personnes concernées.

**8. Sort des données**
Au terme des prestations, Yuno supprime ou restitue au Partenaire, selon son choix, les données traitées pour son compte, et détruit les copies existantes, sauf obligation légale de conservation.

**9. Audit**
Yuno met à la disposition du Partenaire les informations nécessaires pour démontrer le respect du présent accord et permet la réalisation d'audits, dans la limite d'un audit par période de douze mois, moyennant un préavis raisonnable de trente jours, aux frais du Partenaire, pendant les heures ouvrées et sans accès aux données d'autres partenaires.

**10. Transferts hors UE**
Les données sont hébergées dans l'Union Européenne. Certains sous-traitants ultérieurs (notamment Stripe, Resend, Cloudflare, Mapbox, OpenAI) peuvent réaliser des traitements hors UE, encadrés par les clauses contractuelles types de la Commission européenne ou tout autre mécanisme de transfert reconnu.

**11. Droit applicable**
Droit français. Le présent accord prévaut sur les Conditions Pro et les Conditions Yuno CRM pour ce qui concerne la protection des données traitées pour le compte du Partenaire.

**12. Chapitre Yuno CRM**
Ce chapitre s'applique au Partenaire qui utilise Yuno CRM (crm.yunoapp.eu). Il complète les articles 1 à 11 et prévaut sur eux pour ce qui concerne Yuno CRM.

**12.1 Traitements confiés**
Sur instruction du Partenaire, Yuno :
• importe et met à jour, en lecture seule, les données de la billetterie que le Partenaire connecte (cette billetterie est elle-même son prestataire), et celles des fichiers qu'il importe ;
• tient sa base de contacts, son registre des accords et des désinscriptions ;
• produit ses statistiques, segments et analyses, dont le profilage décrit à l'article 12.4 ;
• envoie ses e-mails et SMS, mesure leur remise, leurs ouvertures et leurs clics, applique les désinscriptions et les STOP ;
• héberge ses pages d'inscription, ses liens suivis et ses automatisations ;
• répond à ses questions dans l'Assistant Console, et transmet ses données à l'assistant IA qu'il connecte lui-même (article 3).

**12.2 Données et personnes concernées**
Personnes : acheteurs, invités, participants et contacts du Partenaire.
Données : identité et coordonnées (nom, prénom, e-mail, téléphone) ; données transmises par la billetterie ou les fichiers (âge ou année de naissance, genre, ville, code postal, pays) ; achats et présence (soirées, tarifs, montants, canal d'achat, entrée scannée, invitations) ; accords, désinscriptions et leurs preuves ; interactions avec les messages et les pages (remise, ouverture, clic, inscription) ; données déduites (hypothèses, niveau de « Chances de venir » et ses raisons, appartenance à un segment, distance au lieu calculée à partir du code postal).
Aucune donnée de carte bancaire n'est traitée. Aucune catégorie particulière de données (article 9 du RGPD) n'est demandée ni recherchée par Yuno.

**12.3 Instructions**
La connexion d'une billetterie, l'import d'un fichier, la création d'un segment, d'une campagne, d'une automatisation ou d'une page valent instruction documentée. L'analyse décrite à l'article 12.4 fait partie du service choisi par le Partenaire ; il peut en exclure toute personne depuis sa fiche client.

**12.4 Profilage pour le compte du Partenaire**
Yuno CRM calcule, pour le seul compte du Partenaire et à partir de ses seules données :
• « Ce qui fait venir » : des hypothèses testées sur les soirées passées du Partenaire (artistes, genre musical, format, série, jour, habitudes d'achat, distance), affichées sur la fiche d'un client comme des faits observés dans ses achats, avec le statut de l'hypothèse sur le compte ;
• « Chances de venir » : un niveau (fortes, moyennes, faibles) de chances d'acheter pour une prochaine soirée, avec ses principales raisons, calculé par un modèle statistique propre au compte du Partenaire, ajusté chaque nuit sur les soirées de ses douze derniers mois et effacé avec le compte ;
• « Qui cibler » : des groupes proposés pour une soirée, avec un groupe témoin tiré au hasard et non contacté.
Yuno s'engage à :
• ne jamais rapprocher les données d'une personne entre deux comptes ;
• n'utiliser pour ces calculs ni le genre des personnes, ni les ouvertures et les clics mesurés dans leurs e-mails ;
• n'entraîner aucun modèle commun sur des données de personnes, et ne transmettre aucune donnée personnelle à un fournisseur d'IA pour ces calculs ;
• ne pas afficher de pourcentage individuel, et montrer les raisons de chaque niveau ;
• ne faire figurer ni hypothèse ni niveau dans un export ;
• ne prendre aucune décision : ces estimations servent au Partenaire à choisir les destinataires et le moment de ses messages ; elles ne produisent aucun effet juridique et n'affectent pas les personnes de manière significative au sens de l'article 22 du RGPD ;
• appliquer l'exclusion d'une personne (« Exclure du profilage ») : son profil, ses estimations et leur historique sont effacés, puis elle n'est plus calculée ; son adresse est gardée dans une liste d'exclusion, à cette seule fin ;
• effacer profils et estimations avec la personne, avec la connexion à la billetterie, avec le compte, et à l'échéance de la durée de conservation choisie par le Partenaire.

**12.5 Obligations propres du Partenaire**
Le Partenaire, responsable de traitement :
• informe les personnes (articles 13 et 14 du RGPD) au plus tard lors du premier message, y compris du profilage, de sa logique et de leur droit de s'y opposer, présenté séparément ; un modèle figure en annexe des Conditions Yuno CRM ;
• dispose d'une base légale pour chaque finalité : intérêt légitime documenté pour l'analyse et la segmentation ; accord préalable ou relation client existante pour ses envois (article L. 34-5 du Code des postes et des communications électroniques), l'accord pour les e-mails ne valant pas pour les SMS ; accord du destinataire, lorsqu'il est requis, à la mesure individuelle des ouvertures et des clics (article 82 de la loi Informatique et Libertés ; recommandation de la CNIL n° 2026-042 du 12 mars 2026) ;
• garantit que son contrat avec sa billetterie lui permet de transmettre ses données à Yuno ;
• traite toute opposition d'une personne, à la prospection comme au profilage, sans délai et sans lui demander de justification ;
• n'utilise pas les estimations pour fixer un prix, accorder ou refuser une remise, une prévente ou l'entrée, ni pour cibler des mineurs ou déduire une donnée de l'article 9 du RGPD, notamment à partir du thème d'une soirée ;
• fixe une durée de conservation (Réglages › Données) ;
• réalise l'analyse d'impact de l'article 35 lorsqu'elle est requise ; Yuno lui fournit sur demande un modèle d'analyse d'impact et de mise en balance adapté à Yuno CRM.

**12.6 Statistiques anonymes (réutilisation autorisée)**
En acceptant le présent accord, le Partenaire autorise par écrit Yuno à réutiliser les données traitées pour son compte, pour la seule finalité suivante : produire des comptages agrégés destinés à régler les seuils des règles d'analyse de Yuno CRM pour l'ensemble de ses utilisateurs. Cette réutilisation, compatible avec la finalité d'origine (elle améliore le service même que le Partenaire utilise, sans aucune conséquence pour les personnes), se fait aux conditions suivantes :
• seuls des comptages sortent du compte (par exemple « nombre de retours testés », « nombre de choix conformes », « nombre attendu au hasard »), par famille d'analyse et par trimestre ;
• aucune donnée personnelle ni identifiant (adresse e-mail ou empreinte de celle-ci, nom, téléphone, identifiant de personne), aucune information commerciale du Partenaire (titre de soirée, artiste, ville) ;
• tout comptage portant sur moins de dix personnes est supprimé à la source ; les personnes exclues du profilage n'y entrent pas ;
• les comptages sont rattachés à une clé aléatoire propre au compte, détruite avec lui ;
• un résultat commun n'est publié qu'à partir de cinq comptes contributeurs, aucun ne représentant plus de la moitié du total ;
• les règles d'analyse ne changent qu'après validation humaine par Yuno ;
• aucune donnée de personne n'entraîne de modèle ni n'est transmise à un système d'IA pour cette finalité ;
• le titulaire du compte peut retirer cette autorisation à tout moment depuis Réglages › Données ; ses comptages sont alors supprimés ;
• le compte de démonstration n'y contribue jamais.
Pour cette réutilisation, Yuno agit comme responsable de traitement, sur la base de son intérêt légitime à améliorer son service ; il documente l'évaluation du caractère anonyme des comptages et la tient à la disposition du Partenaire et de la CNIL.

**12.7 Sous-traitants ultérieurs de Yuno CRM**
Supabase (hébergement, Union européenne), Cloudflare (diffusion du site, liens courts), Resend (e-mails), Octopush (SMS, France), Stripe (facturation de l'abonnement, sans données des clients du Partenaire), OpenAI (Assistant Console, quand le Partenaire l'utilise : sa question et les données nécessaires à la réponse, sans réutilisation pour entraîner un modèle). La billetterie connectée n'est pas un sous-traitant de Yuno : c'est le prestataire du Partenaire, source des données.

**12.8 Violations, durée et fin**
Yuno notifie au Partenaire toute violation de données le concernant dans les meilleurs délais, et au plus tard 48 heures après en avoir pris connaissance.
Les données sont traitées tant que le compte existe. En pause, elles restent lisibles et exportables par le Partenaire. Sans réactivation, le compte est clos 12 mois après la fin de l'abonnement ou de l'essai, après avertissement du titulaire au moins 30 jours avant. À la clôture, ou sur demande du Partenaire, Yuno supprime ses données dans les 30 jours, et des sauvegardes au plus tard 90 jours après ; le Partenaire peut les exporter auparavant.`
    },
    en: {
      title: 'Data Processing Agreement (DPA)',
      content: `Version of 8 October 2026

**1. Purpose and Roles**
This agreement governs, in accordance with Article 28 GDPR, the processing of personal data that Yuno (operated by WOMBER, SIREN 995 130 747, 25 avenue Mercure, 31130 Quint-Fonsegrives, France) carries out on behalf of partner venues and organizers (the "Partner"). For the Partner's end-customer data (attendees, guests, buyers), the Partner is the data controller and Yuno acts as processor. For professional account management, billing, platform security, and service improvement, Yuno acts as an independent controller (see the Privacy Policy). This agreement is an integral part of the Professional Terms and of the Yuno CRM Terms (yunoapp.eu/legal/cgv-crm).

**2. Processing Covered**
• Nature and purposes: ticket sales and check-in, guest list management, VIP table reservations, drink orders, Partner communication campaigns, audience statistics.
• Data categories: identity, contact details, order and attendance data, declarative demographic data.
• Data subjects: the Partner's customers, attendees, and guests.
• Duration: for as long as the Partner uses the platform.

**3. Instructions**
Yuno processes this data only on the Partner's documented instructions; configuring and using platform features constitutes instructions. When the Partner connects an AI assistant of its choice to its Console (Yuno connector for AI assistants), this is an instruction to send that assistant the data the Partner selected (statistics, and customer records only if the Partner ticked it); the assistant's provider is not a sub-processor of Yuno but a recipient designated by the Partner, who can cut this access at any time from its Console. Through this connection, the assistant may also save in the Console email drafts and signup pages (as drafts, or as a proposed change to an already published page) prepared at the Partner's request; nothing is sent or published without an action of the Partner in its Console. Yuno informs the Partner if, in its opinion, an instruction infringes the GDPR.

**4. Confidentiality and Security**
Persons authorized to process the data are bound by confidentiality obligations. Yuno implements appropriate technical and organizational measures (Article 32 GDPR): encryption in transit (HTTPS/TLS), per-venue data isolation (row level security), role-based access control, strong authentication (MFA), security logging.

**5. Sub-Processors**
The Partner grants general authorization for the following sub-processors: Supabase (database hosting), Stripe (payments), Resend (email delivery), Octopush (SMS delivery, French company, data hosted in France), OpenAI (Console Assistant, when the Partner uses it), Mapbox (maps), Cloudflare (site delivery), PostHog (product analytics, EU hosting). Yuno informs the Partner of any intended change (addition or replacement), giving the Partner the opportunity to raise reasonable objections, and imposes equivalent obligations on its sub-processors.

**6. Assistance**
Taking into account the nature of the processing, Yuno assists the Partner with appropriate technical and organizational measures in responding to data subject requests (access, rectification, erasure, objection, restriction, portability), and assists with impact assessments and prior consultation obligations where applicable.

**7. Data Breaches**
Yuno notifies the Partner of any personal data breach affecting them without undue delay after becoming aware of it, with the information needed for possible notification to the supervisory authority and data subjects.

**8. Return and Deletion**
At the end of the services, Yuno deletes or returns to the Partner, at the Partner's choice, the data processed on its behalf, and destroys existing copies, unless legally required to retain them.

**9. Audit**
Yuno makes available the information necessary to demonstrate compliance with this agreement and allows audits, limited to one audit per twelve-month period, with reasonable thirty days' notice, at the Partner's expense, during business hours, and without access to other partners' data.

**10. Transfers Outside the EU**
Data is hosted in the European Union. Some sub-processors (notably Stripe, Resend, Cloudflare, Mapbox, OpenAI) may process data outside the EU, governed by the European Commission's Standard Contractual Clauses or any other recognized transfer mechanism.

**11. Applicable Law**
French law. This agreement prevails over the Professional Terms and the Yuno CRM Terms with respect to the protection of data processed on behalf of the Partner.

**12. Yuno CRM chapter**
This chapter applies to a Partner using Yuno CRM (crm.yunoapp.eu). It supplements articles 1 to 11 and prevails over them for Yuno CRM.

**12.1 Processing entrusted**
On the Partner's instructions, Yuno:
• imports and updates, read-only, the data of the ticketing the Partner connects (that ticketing is itself the Partner's provider), and that of the files it imports;
• keeps its contact base and its register of agreements and unsubscriptions;
• produces its statistics, segments and analyses, including the profiling described in article 12.4;
• sends its emails and SMS, measures their delivery, opens and clicks, and applies unsubscriptions and STOPs;
• hosts its sign-up pages, tracked links and automations;
• answers its questions in the Console Assistant, and passes its data to the AI assistant it connects itself (article 3).

**12.2 Data and data subjects**
Data subjects: the Partner's buyers, guests, attendees and contacts.
Data: identity and contact details (first name, last name, email, phone); data passed on by the ticketing or files (age or year of birth, gender, town, postcode, country); purchases and attendance (nights, prices, amounts, sales channel, scanned entry, invitations); agreements, unsubscriptions and their proofs; interactions with messages and pages (delivery, open, click, sign-up); inferred data (hypotheses, "Chance of coming" level and its reasons, segment membership, distance to the venue computed from the postcode).
No card data is processed. No special category of data (article 9 GDPR) is requested or sought by Yuno.

**12.3 Instructions**
Connecting a ticketing, importing a file, creating a segment, a campaign, an automation or a page are documented instructions. The analysis described in article 12.4 is part of the service chosen by the Partner; it can exclude any person from it on their customer card.

**12.4 Profiling on the Partner's behalf**
Yuno CRM computes, for the Partner's account only and from its data only:
• "What brings them": hypotheses tested on the Partner's past nights (artists, music genre, format, series, day, buying habits, distance), shown on a customer's card as facts observed in their purchases, with the hypothesis's status on the account;
• "Chance of coming": a level (high, medium, low) of chance of buying for an upcoming night, with its main reasons, computed by a statistical model specific to the Partner's account, fitted every night on the nights of its last twelve months and deleted with the account;
• "Who to target": groups suggested for a night, with a control group drawn at random and not contacted.
Yuno undertakes to:
• never link a person's data across two accounts;
• use neither people's gender nor the opens and clicks measured in their emails for these computations;
• train no shared model on personal data, and pass no personal data to an AI provider for these computations;
• show no individual percentage, and show the reasons for each level;
• include no hypothesis or level in any export;
• take no decision: these estimates help the Partner choose the recipients and timing of its messages; they produce no legal effect and do not significantly affect people within the meaning of article 22 GDPR;
• apply the exclusion of a person ("Exclude from profiling"): their profile, estimates and history are deleted, then they are no longer computed; their address is kept in an exclusion list for that sole purpose;
• delete profiles and estimates with the person, with the ticketing connection, with the account, and at the end of the retention period chosen by the Partner.

**12.5 The Partner's own obligations**
The Partner, as controller:
• informs people (articles 13 and 14 GDPR) at the latest with the first message, including about the profiling, its logic and their right to object, presented separately; a template sits in the appendix to the Yuno CRM Terms;
• has a legal basis for each purpose: documented legitimate interest for the analysis and segmentation; prior agreement or existing customer relationship for its sends (article L. 34-5 of the French Postal and Electronic Communications Code), an agreement for emails not covering SMS; the recipient's agreement, where required, to the individual measurement of opens and clicks (article 82 of the French Data Protection Act; CNIL recommendation no. 2026-042 of 12 March 2026);
• warrants that its contract with its ticketing allows it to pass its data to Yuno;
• handles any objection, to marketing as to profiling, without delay and without asking for a reason;
• does not use the estimates to set a price, grant or refuse a discount, a presale or entry, nor to target minors or infer article 9 GDPR data, in particular from the theme of a night;
• sets a retention period (Settings › Data);
• carries out the article 35 impact assessment when required; on request, Yuno provides a template impact assessment and balancing test suited to Yuno CRM.

**12.6 Anonymous statistics (authorised reuse)**
By accepting this agreement, the Partner authorises Yuno in writing to reuse the data processed on its behalf for the following sole purpose: producing aggregated counts used to tune the thresholds of Yuno CRM's analysis rules for all its users. This reuse, compatible with the original purpose (it improves the very service the Partner uses, with no consequence for people), takes place under these conditions:
• only counts leave the account (for example "number of returns tested", "number of matching choices", "number expected by chance"), per analysis family and per quarter;
• no personal data or identifier (email address or its hash, name, phone, person identifier), no commercial information of the Partner (night title, artist, town);
• any count covering fewer than ten people is removed at source; people excluded from profiling are not included;
• counts are attached to a random key specific to the account, destroyed with it;
• a shared result is only published from five contributing accounts, none weighing more than half of the total;
• analysis rules change only after human approval by Yuno;
• no personal data trains a model or is passed to an AI system for this purpose;
• the account holder can withdraw this authorisation at any time from Settings › Data; its counts are then deleted;
• the demo account never contributes.
For this reuse, Yuno acts as controller, on the basis of its legitimate interest in improving its service; it documents the assessment of the anonymous nature of the counts and keeps it available to the Partner and the CNIL.

**12.7 Yuno CRM sub-processors**
Supabase (hosting, European Union), Cloudflare (site delivery, short links), Resend (emails), Octopush (SMS, France), Stripe (billing of the subscription, without data of the Partner's customers), OpenAI (Console Assistant, when the Partner uses it: its question and the data needed for the answer, with no reuse to train a model). The connected ticketing is not a sub-processor of Yuno: it is the Partner's provider and the source of the data.

**12.8 Breaches, term and end**
Yuno notifies the Partner of any data breach concerning it without undue delay, and no later than 48 hours after becoming aware of it.
Data is processed as long as the account exists. While paused, it stays readable and exportable by the Partner. Without reactivation, the account is closed 12 months after the end of the subscription or trial, after warning the account holder at least 30 days before. On closing, or on the Partner's request, Yuno deletes its data within 30 days, and from backups no later than 90 days after; the Partner can export it beforehand.`
    },
    es: {
      title: 'Acuerdo de Encargo de Tratamiento (DPA)',
      content: `Versión del 8 de octubre de 2026

**1. Objeto y roles**
Este acuerdo regula, conforme al artículo 28 del RGPD, los tratamientos de datos personales que Yuno (operada por WOMBER, SIREN 995 130 747, 25 avenue Mercure, 31130 Quint-Fonsegrives, Francia) realiza por cuenta de los establecimientos y organizadores asociados (el « Socio »). Para los datos de los clientes finales del Socio (participantes, invitados, compradores), el Socio es el responsable del tratamiento y Yuno actúa como encargado. Para la gestión de cuentas profesionales, la facturación, la seguridad de la plataforma y la mejora del servicio, Yuno actúa como responsable independiente (ver la Política de Privacidad). Este acuerdo forma parte integrante de las Condiciones Pro y de las Condiciones de Yuno CRM (yunoapp.eu/legal/cgv-crm).

**2. Tratamientos cubiertos**
• Naturaleza y finalidades: venta y control de entradas, gestión de guest lists, reservas de mesas VIP, pedidos de bebidas, campañas de comunicación del Socio, estadísticas de audiencia.
• Categorías de datos: identidad, datos de contacto, datos de pedido y asistencia, datos demográficos declarativos.
• Interesados: clientes, participantes e invitados del Socio.
• Duración: mientras el Socio utilice la plataforma.

**3. Instrucciones**
Yuno trata estos datos únicamente siguiendo instrucciones documentadas del Socio; la configuración y el uso de las funcionalidades de la plataforma constituyen instrucciones. La conexión, por parte del Socio, de un asistente de IA de su elección a su Consola (conector de Yuno para asistentes de IA) constituye una instrucción de transmitir a ese asistente los datos que el Socio ha elegido (estadísticas, y fichas de clientes solo si lo ha marcado); el proveedor de ese asistente no es un subencargado de Yuno sino un destinatario designado por el Socio, que puede cortar este acceso en cualquier momento desde su Consola. Mediante esta conexión, el asistente también puede guardar en la Consola borradores de email y páginas de registro (en borrador, o como propuesta de cambio de una página ya publicada) preparados a petición del Socio; no se envía ni se publica nada sin una acción del Socio en su Consola. Yuno informa al Socio si, en su opinión, una instrucción infringe el RGPD.

**4. Confidencialidad y seguridad**
Las personas autorizadas a tratar los datos están sujetas a obligaciones de confidencialidad. Yuno aplica las medidas técnicas y organizativas apropiadas (artículo 32 RGPD): cifrado en tránsito (HTTPS/TLS), aislamiento de datos por establecimiento (row level security), control de acceso por rol, autenticación reforzada (MFA), registro de seguridad.

**5. Subencargados**
El Socio autoriza de forma general los siguientes subencargados: Supabase (alojamiento de base de datos), Stripe (pagos), Resend (envío de emails), Octopush (envío de SMS, empresa francesa, datos alojados en Francia), OpenAI (Asistente de la Consola, cuando el Socio lo usa), Mapbox (mapas), Cloudflare (distribución del sitio), PostHog (analítica de uso, alojamiento en la UE). Yuno informa al Socio de cualquier cambio previsto (adición o sustitución), dándole la posibilidad de presentar objeciones razonables, e impone a sus subencargados obligaciones equivalentes a este acuerdo.

**6. Asistencia**
Teniendo en cuenta la naturaleza del tratamiento, Yuno ayuda al Socio, mediante medidas técnicas y organizativas apropiadas, a responder a las solicitudes de ejercicio de derechos de los interesados (acceso, rectificación, supresión, oposición, limitación, portabilidad), y le asiste en sus obligaciones de evaluación de impacto y consulta previa cuando proceda.

**7. Violaciones de datos**
Yuno notifica al Socio cualquier violación de datos personales que le afecte sin dilación indebida tras tener conocimiento de ella, con la información útil para la posible notificación a la autoridad de control y a los interesados.

**8. Destino de los datos**
Al término de los servicios, Yuno suprime o devuelve al Socio, a su elección, los datos tratados por su cuenta, y destruye las copias existentes, salvo obligación legal de conservación.

**9. Auditoría**
Yuno pone a disposición del Socio la información necesaria para demostrar el cumplimiento de este acuerdo y permite la realización de auditorías, con el límite de una auditoría por período de doce meses, con un preaviso razonable de treinta días, a cargo del Socio, en horario laboral y sin acceso a los datos de otros socios.

**10. Transferencias fuera de la UE**
Los datos se alojan en la Unión Europea. Algunos subencargados (en particular Stripe, Resend, Cloudflare, Mapbox, OpenAI) pueden realizar tratamientos fuera de la UE, regulados por las cláusulas contractuales tipo de la Comisión Europea o cualquier otro mecanismo de transferencia reconocido.

**11. Derecho aplicable**
Derecho francés. Este acuerdo prevalece sobre las Condiciones Pro y las Condiciones de Yuno CRM en lo relativo a la protección de los datos tratados por cuenta del Socio.

**12. Capítulo Yuno CRM**
Este capítulo se aplica al Socio que usa Yuno CRM (crm.yunoapp.eu). Completa los artículos 1 a 11 y prevalece sobre ellos en lo relativo a Yuno CRM.

**12.1 Tratamientos encargados**
Siguiendo las instrucciones del Socio, Yuno:
• importa y actualiza, en modo de solo lectura, los datos de la ticketera que el Socio conecta (esa ticketera es a su vez proveedor del Socio), y los de los archivos que importa;
• mantiene su base de contactos y su registro de acuerdos y bajas;
• elabora sus estadísticas, segmentos y análisis, incluido el perfilado descrito en el artículo 12.4;
• envía sus e-mails y SMS, mide su entrega, aperturas y clics, y aplica las bajas y los STOP;
• aloja sus páginas de registro, enlaces de seguimiento y automatizaciones;
• responde a sus preguntas en el Asistente de la Consola, y transmite sus datos al asistente de IA que él mismo conecta (artículo 3).

**12.2 Datos e interesados**
Interesados: compradores, invitados, asistentes y contactos del Socio.
Datos: identidad y datos de contacto (nombre, apellidos, e-mail, teléfono); datos transmitidos por la ticketera o los archivos (edad o año de nacimiento, género, ciudad, código postal, país); compras y asistencia (noches, tarifas, importes, canal de compra, entrada escaneada, invitaciones); acuerdos, bajas y sus pruebas; interacciones con los mensajes y las páginas (entrega, apertura, clic, registro); datos deducidos (hipótesis, nivel de «Probabilidad de venir» y sus motivos, pertenencia a un segmento, distancia al local calculada a partir del código postal).
No se trata ningún dato de tarjeta. Yuno no solicita ni busca ninguna categoría especial de datos (artículo 9 del RGPD).

**12.3 Instrucciones**
La conexión de una ticketera, la importación de un archivo y la creación de un segmento, una campaña, una automatización o una página constituyen instrucciones documentadas. El análisis descrito en el artículo 12.4 forma parte del servicio elegido por el Socio; este puede excluir a cualquier persona desde su ficha de cliente.

**12.4 Perfilado por cuenta del Socio**
Yuno CRM calcula, solo para la cuenta del Socio y solo con sus datos:
• «Lo que les hace venir»: hipótesis probadas con las noches pasadas del Socio (artistas, género musical, formato, serie, día, hábitos de compra, distancia), mostradas en la ficha de un cliente como hechos observados en sus compras, con el estado de la hipótesis en la cuenta;
• «Probabilidad de venir»: un nivel (alta, media, baja) de probabilidad de comprar para una próxima noche, con sus principales motivos, calculado por un modelo estadístico propio de la cuenta del Socio, ajustado cada noche con las noches de sus últimos doce meses y borrado con la cuenta;
• «A quién dirigirse»: grupos propuestos para una noche, con un grupo de control sorteado y no contactado.
Yuno se compromete a:
• no vincular nunca los datos de una persona entre dos cuentas;
• no usar para estos cálculos ni el género de las personas ni las aperturas y clics medidos en sus e-mails;
• no entrenar ningún modelo común con datos de personas y no transmitir ningún dato personal a un proveedor de IA para estos cálculos;
• no mostrar ningún porcentaje individual y mostrar los motivos de cada nivel;
• no incluir ninguna hipótesis ni nivel en una exportación;
• no tomar ninguna decisión: estas estimaciones ayudan al Socio a elegir los destinatarios y el momento de sus mensajes; no producen efectos jurídicos ni afectan de forma significativa a las personas en el sentido del artículo 22 del RGPD;
• aplicar la exclusión de una persona («Excluir del perfilado»): su perfil, sus estimaciones y su historial se borran y deja de calcularse; su dirección se guarda en una lista de exclusión, con ese único fin;
• borrar perfiles y estimaciones con la persona, con la conexión a la ticketera, con la cuenta y al vencer el plazo de conservación elegido por el Socio.

**12.5 Obligaciones propias del Socio**
El Socio, responsable del tratamiento:
• informa a las personas (artículos 13 y 14 del RGPD) a más tardar con el primer mensaje, incluido el perfilado, su lógica y su derecho a oponerse, presentado por separado; en el anexo de las Condiciones de Yuno CRM figura un modelo;
• dispone de una base jurídica para cada finalidad: interés legítimo documentado para el análisis y la segmentación; acuerdo previo o relación de cliente existente para sus envíos (artículo L. 34-5 del Código de correos y comunicaciones electrónicas francés), sin que el acuerdo para e-mails valga para SMS; acuerdo del destinatario, cuando se exija, para la medición individual de aperturas y clics (artículo 82 de la ley francesa de protección de datos; recomendación de la CNIL n.º 2026-042 del 12 de marzo de 2026);
• garantiza que su contrato con su ticketera le permite transmitir sus datos a Yuno;
• atiende toda oposición, a la prospección como al perfilado, sin demora y sin pedir justificación;
• no usa las estimaciones para fijar un precio, conceder o denegar un descuento, una preventa o la entrada, ni para dirigirse a menores o deducir datos del artículo 9 del RGPD, en particular a partir de la temática de una noche;
• fija un plazo de conservación (Ajustes › Datos);
• realiza la evaluación de impacto del artículo 35 cuando se exija; Yuno le facilita, si lo pide, un modelo de evaluación de impacto y de ponderación adaptado a Yuno CRM.

**12.6 Estadísticas anónimas (reutilización autorizada)**
Al aceptar este acuerdo, el Socio autoriza por escrito a Yuno a reutilizar los datos tratados por su cuenta con la única finalidad siguiente: producir recuentos agregados destinados a ajustar los umbrales de las reglas de análisis de Yuno CRM para todos sus usuarios. Esta reutilización, compatible con la finalidad original (mejora el mismo servicio que usa el Socio, sin ninguna consecuencia para las personas), se realiza en las siguientes condiciones:
• solo salen de la cuenta recuentos (por ejemplo, «número de vueltas probadas», «número de elecciones coincidentes», «número esperado al azar»), por familia de análisis y por trimestre;
• ningún dato personal ni identificador (dirección de e-mail o su huella, nombre, teléfono, identificador de persona), ninguna información comercial del Socio (título de noche, artista, ciudad);
• todo recuento sobre menos de diez personas se suprime en origen; las personas excluidas del perfilado no entran;
• los recuentos se vinculan a una clave aleatoria propia de la cuenta, destruida con ella;
• un resultado común solo se publica a partir de cinco cuentas contribuyentes, sin que ninguna represente más de la mitad del total;
• las reglas de análisis solo cambian tras una validación humana de Yuno;
• ningún dato de persona entrena un modelo ni se transmite a un sistema de IA con esta finalidad;
• el titular de la cuenta puede retirar esta autorización en cualquier momento en Ajustes › Datos; sus recuentos se borran entonces;
• la cuenta de demostración nunca contribuye.
Para esta reutilización, Yuno actúa como responsable del tratamiento, sobre la base de su interés legítimo en mejorar su servicio; documenta la evaluación del carácter anónimo de los recuentos y la pone a disposición del Socio y de la CNIL.

**12.7 Subencargados de Yuno CRM**
Supabase (alojamiento, Unión Europea), Cloudflare (distribución del sitio, enlaces cortos), Resend (e-mails), Octopush (SMS, Francia), Stripe (facturación de la suscripción, sin datos de los clientes del Socio), OpenAI (Asistente de la Consola, cuando el Socio lo usa: su pregunta y los datos necesarios para la respuesta, sin reutilización para entrenar un modelo). La ticketera conectada no es un subencargado de Yuno: es el proveedor del Socio y la fuente de los datos.

**12.8 Violaciones, duración y fin**
Yuno notifica al Socio toda violación de datos que le afecte sin dilación indebida, y a más tardar 48 horas después de tener conocimiento de ella.
Los datos se tratan mientras exista la cuenta. En pausa, siguen legibles y exportables por el Socio. Sin reactivación, la cuenta se cierra 12 meses después del final de la suscripción o de la prueba, tras avisar al titular con al menos 30 días de antelación. Al cierre, o a petición del Socio, Yuno suprime sus datos en 30 días, y de las copias de seguridad a más tardar 90 días después; el Socio puede exportarlos antes.`
    }
  },

  'privacy': {
    fr: {
      title: 'Politique de Confidentialité',
      content: `Dernière mise à jour : 8 octobre 2026

Cette politique explique quelles données Yuno collecte, pourquoi, avec qui elles sont partagées et quels sont vos droits. Elle s'applique au site yunoapp.eu et aux applications mobiles Yuno et Yuno Pro.

**1. Responsable du traitement**
WOMBER – 25 avenue Mercure, 31130 Quint-Fonsegrives, France – contact@yunoapp.eu

**2. Données collectées**
• Compte & identité : nom, prénom, email, téléphone, ville (optionnelle), photo de profil (si ajoutée), langue préférée
• Âge (déclaratif) : date de naissance / confirmation de majorité — Yuno est réservé aux 18 ans et plus
• Connexion via Apple ou Google : identifiant transmis par le service choisi (nous ne recevons jamais votre mot de passe Apple/Google)
• Commandes & réservations : billets, tables VIP (acompte, minimum de consommation), boissons, inscriptions guest list, remboursements, factures
• Fidélité & préférences : points de fidélité, favoris, préférences musicales (quiz de goûts)
• Localisation : traitée sur votre appareil (avec votre autorisation système) pour afficher les clubs et soirées proches ; la ville retenue est mémorisée, Yuno ne conserve pas d'historique de vos positions
• Notifications push : jeton d'appareil (Apple APNs / Google FCM), supprimé si vous désactivez les notifications
• Assistant IA : contenu des conversations avec l'assistant Yuno
• Caméra (app Pro / staff) : utilisée localement pour scanner les QR codes ; aucune image n'est enregistrée ni transmise
• Liens de promotion : si vous ouvrez Yuno via le lien d'un promoteur ou partenaire, l'identifiant du lien est mémorisé pour attribuer la vente
• Données techniques & sécurité : logs, type d'appareil, adresse IP
• Preuves d'acceptation légale : version des conditions acceptées, horodatage, adresse IP
• Cookies & traceurs : voir la Politique Cookies (yunoapp.eu/legal/cookies) — la mesure d'audience anonyme de Yuno est exemptée de consentement (CNIL, lignes directrices du 4 juillet 2025 : statistiques agrégées, finalité de mesure seule, traceur de 13 mois au plus, conservation 25 mois au plus, aucun rattachement à votre compte sans votre accord) ; PostHog et tout traceur marketing ne sont chargés qu'avec votre consentement

**3. Finalités & bases légales**
• Fournir le service (compte, commandes, QR codes, guest lists) : exécution du contrat
• Paiements, factures et comptabilité : exécution du contrat & obligation légale
• Vérification de la majorité (18+) : obligation légale & intérêt légitime
• Sécurité de la plateforme / anti-fraude : intérêt légitime
• Support client : exécution du contrat / intérêt légitime
• Notifications push & localisation : autorisations système que vous accordez et pouvez révoquer à tout moment dans les réglages de votre appareil
• Personnalisation (« Pour toi », recommandations) & statistiques internes : intérêt légitime — désactivable dans Réglages → Recommandations personnalisées
• Attribution des ventes aux promoteurs/partenaires : intérêt légitime (rémunération des partenaires)
• Emails et SMS marketing, newsletter : consentement, retirable à tout moment (lien de désinscription, STOP)
• Mesure d'audience anonyme de Yuno (visites de pages, tunnel d'achat, sans rattachement à votre compte) : intérêt légitime, exemptée de consentement (CNIL) ; rattachement à votre compte et PostHog : consentement
• Publicité (pixel Meta et API Conversions du club, de l'organisateur ou de Yuno) : consentement, retirable à tout moment via le menu Cookies. Pour ces données, le club ou l'organisateur concerné et Meta Platforms Ireland Ltd sont responsables conjoints (art. 26 RGPD) ; Yuno agit pour leur compte, ne transmet que des données hachées, et conserve la preuve de votre réponse pour chaque commande

**4. Destinataires**
Yuno ne vend jamais vos données. Elles ne sont partagées qu'avec :
• Les clubs et organisateurs concernés par vos achats (commande, identité nécessaire à l'entrée, QR) ; pour une guest list via promoteur, le club et l'équipe concernés voient votre inscription
• Statistiques de goûts pour les clubs et organisateurs : si vous êtes venu chez eux, vos préférences musicales (quiz de goûts) et les genres des soirées où vous êtes allé sur Yuno peuvent entrer dans des statistiques AGRÉGÉES de leur communauté. Elles ne sont jamais présentées personne par personne, et un genre n'est affiché que s'il réunit au moins 10 personnes. Désactivable dans Réglages → Recommandations personnalisées
• Assistants IA choisis par un club ou un organisateur : si un club ou un organisateur chez qui vous êtes venu connecte son propre assistant IA (par exemple Claude, ChatGPT, Gemini ou Le Chat) à sa Console Yuno, cet assistant lit ses statistiques ; il ne reçoit votre identité (nom, email, historique d'achat chez ce club ou cet organisateur) que si ce professionnel l'a explicitement autorisé. Ce transfert se fait sur instruction du professionnel, qui en est responsable ; le fournisseur de l'assistant traite ces données selon ses propres conditions. Yuno n'utilise pas vos données pour entraîner une IA
• Stripe (paiements — vos données bancaires sont traitées directement par Stripe et ne transitent jamais par les serveurs de Yuno)
• Supabase (hébergement backend — chiffrement en transit HTTPS/TLS)
• Cloudflare (diffusion sécurisée du site)
• Google (polices de caractères Google Fonts : votre navigateur les télécharge depuis les serveurs de Google, qui reçoivent votre adresse IP)
• PostHog (mesure d'audience du site et des apps, hébergée dans l'UE, uniquement après votre consentement sur le web)
• Mapbox (affichage cartographique des clubs)
• Resend (emails transactionnels : confirmations, billets)
• Octopush (SMS, lorsque vous y avez consenti ; société française, données hébergées en France)
• OpenAI (assistant conversationnel et moteur de recommandations : les questions posées à l'assistant et des descriptions d'événements/préférences musicales sont transmises à OpenAI pour générer réponses et suggestions)
• Apple et Google (livraison des notifications push, connexion Sign in, cartes Wallet le cas échéant)
• Sous-traitants techniques strictement nécessaires

**5. Durées de conservation**
• Données de commandes et factures : 5 ans (preuve, litiges, obligations comptables)
• Support : 2 ans après le dernier contact
• Logs de sécurité : 12 mois
• Preuves d'acceptation légale : 5 ans
• Jeton de notification push : supprimé à la désactivation des notifications ou à la suppression du compte
• Compte inactif : 24 mois puis suppression/anonymisation (sauf obligations légales)

**6. Vos droits**
Vous disposez des droits d'accès, de rectification, d'effacement, d'opposition, de limitation et de portabilité, ainsi que du droit de retirer votre consentement à tout moment et de définir des directives sur le sort de vos données après votre décès.
Contact : contact@yunoapp.eu — nous répondons sous 30 jours.
Réclamation : CNIL (cnil.fr) ou l'autorité de protection des données de votre pays de résidence.

**7. Supprimer votre compte**
Vous pouvez supprimer votre compte directement dans l'app : Profil → Réglages → Supprimer mon compte. La suppression est immédiate et irréversible (profil, favoris, points de fidélité). Les justificatifs que la loi impose de conserver (factures, commandes) sont gardés pendant la durée légale puis supprimés.

**8. Sécurité**
Mesures techniques et organisationnelles : contrôles d'accès et cloisonnement des permissions par rôle, chiffrement en transit (HTTPS/TLS), authentification sécurisée avec double authentification disponible, politique de mots de passe renforcée, journalisation de sécurité.

**9. Accès administrateur**
L'opérateur de la plateforme dispose d'un accès aux données de gestion des établissements partenaires (performances, commandes, événements) pour assurer le bon fonctionnement du service et le support. Cet accès est fondé sur l'intérêt légitime de l'opérateur et encadré par des mesures de sécurité appropriées.

**10. Mineurs**
Yuno est réservé aux personnes majeures (18+). Nous ne collectons pas sciemment de données de mineurs ; tout compte identifié comme appartenant à un mineur est supprimé.

**11. Personnalisation & décisions automatisées**
La sélection « Pour toi » et les suggestions de soirées reposent sur vos goûts musicaux, vos favoris et votre historique pour ordonner l'affichage. Ce profilage n'a aucun effet juridique sur vous et se désactive à tout moment dans Réglages → Recommandations personnalisées. Yuno ne prend aucune décision entièrement automatisée produisant des effets juridiques.

**12. Transferts hors UE**
Certains sous-traitants — notamment Stripe (paiements), OpenAI (assistant IA), Apple et Google (notifications) — peuvent impliquer des transferts de données hors de l'Union Européenne, encadrés par les clauses contractuelles types de la Commission européenne ou le Data Privacy Framework, conformément au RGPD. Supabase, Mapbox, Resend et Cloudflare utilisent des infrastructures conformes aux normes européennes de protection des données.

**13. Modifications**
Cette politique peut évoluer avec le service. En cas de changement substantiel, vous serez informé dans l'app ou par email. La date de dernière mise à jour figure en haut de cette page.

**14. Yuno CRM : quand un club ou un organisateur utilise Yuno pour vous écrire**
Des clubs et des organisateurs utilisent Yuno CRM pour gérer leur relation avec les personnes qui achètent leurs billets, y compris sur une autre billetterie (Shotgun par exemple). Pour ces données, le club ou l'organisateur est responsable de traitement : il décide de ce qu'il en fait et répond de vos demandes. Yuno agit pour son compte, comme sous-traitant (yunoapp.eu/legal/dpa), et ne vend jamais ces données.
• Données : celles que la billetterie de l'organisateur lui transmet (nom, e-mail, téléphone, âge, genre, ville, code postal, pays s'ils ont été demandés, billets, entrées), celles que vous donnez sur ses pages d'inscription, et vos réactions à ses messages (remise, ouverture, clic).
• Analyse : l'organisateur peut faire calculer par Yuno, sur ses seules données, ce qui semble faire venir son public (artistes, styles, jours, habitudes d'achat, distance) et une estimation de vos chances de revenir, pour choisir à qui il écrit et quand. Cette estimation n'utilise ni votre genre ni l'ouverture de vos e-mails, n'a aucun effet juridique et ne conditionne ni votre entrée ni le prix de vos billets. Les données d'un organisateur ne sont jamais rapprochées de celles d'un autre.
• Vos droits : adressez-vous à l'organisateur (son identité figure dans chacun de ses messages). Vous pouvez vous opposer à cette analyse et à ses messages, sans justification, vous désinscrire à tout moment (lien en bas de chaque e-mail, STOP par SMS), et demander l'accès, la rectification ou l'effacement de vos données. Si vous écrivez à Yuno (contact@yunoapp.eu), nous transmettons votre demande à l'organisateur concerné et l'aidons à y répondre.
• Statistiques anonymes : avec l'autorisation de chaque organisateur, Yuno tire de leurs comptes des comptages agrégés (par exemple « nombre de retours testés »), sans aucune donnée personnelle ni comptage portant sur moins de dix personnes, pour améliorer les règles d'analyse de Yuno CRM. Pour cette opération, Yuno est responsable de traitement, sur la base de son intérêt légitime ; les personnes exclues de l'analyse par l'organisateur n'y entrent pas.`
    },
    en: {
      title: 'Privacy Policy',
      content: `Last updated: 8 October 2026

This policy explains what data Yuno collects, why, who it is shared with, and what your rights are. It applies to yunoapp.eu and to the Yuno and Yuno Pro mobile apps.

**1. Data Controller**
WOMBER – 25 avenue Mercure, 31130 Quint-Fonsegrives, France – contact@yunoapp.eu

**2. Data Collected**
• Account & identity: last name, first name, email, phone, city (optional), profile picture (if added), preferred language
• Age (declarative): date of birth / confirmation of legal age — Yuno is restricted to ages 18 and over
• Sign-in via Apple or Google: identifier provided by the chosen service (we never receive your Apple/Google password)
• Orders & bookings: tickets, VIP tables (deposit, minimum spend), drinks, guest list registrations, refunds, invoices
• Loyalty & preferences: loyalty points, favorites, music preferences (taste quiz)
• Location: processed on your device (with your system permission) to show nearby clubs and parties; the selected city is remembered, Yuno keeps no history of your positions
• Push notifications: device token (Apple APNs / Google FCM), deleted if you disable notifications
• AI assistant: content of your conversations with the Yuno assistant
• Camera (Pro / staff app): used locally to scan QR codes; no image is recorded or transmitted
• Promotion links: if you open Yuno through a promoter or partner link, the link identifier is remembered to attribute the sale
• Technical & security data: logs, device type, IP address
• Legal acceptance records: version of accepted terms, timestamp, IP address
• Cookies & trackers: see the Cookie Policy (yunoapp.eu/legal/cookies) — Yuno's anonymous audience measurement is exempt from consent (CNIL guidelines of 4 July 2025: aggregated statistics, measurement purpose only, tracker of 13 months at most, kept 25 months at most, never linked to your account without your agreement); PostHog and any marketing tracker are only loaded with your consent

**3. Purposes & Legal Bases**
• Providing the service (account, orders, QR codes, guest lists): contract performance
• Payments, invoices and accounting: contract performance & legal obligation
• Age verification (18+): legal obligation & legitimate interest
• Platform security / anti-fraud: legitimate interest
• Customer support: contract performance / legitimate interest
• Push notifications & location: system permissions you grant and can revoke anytime in your device settings
• Personalization ("For You", recommendations) & internal statistics: legitimate interest — can be turned off in Settings → Personalized recommendations
• Attributing sales to promoters/partners: legitimate interest (partner compensation)
• Marketing emails and SMS, newsletter: consent, withdrawable at any time (unsubscribe link, STOP)
• Yuno's anonymous audience measurement (page views, purchase funnel, not linked to your account): legitimate interest, exempt from consent (CNIL); linking to your account and PostHog: consent
• Advertising (Meta pixel and Conversions API of the club, the organizer or Yuno): consent, withdrawable at any time via the Cookies menu. For that data, the club or organizer concerned and Meta Platforms Ireland Ltd are joint controllers (GDPR art. 26); Yuno acts on their behalf, only transmits hashed data, and keeps proof of your answer for every order

**4. Recipients**
Yuno never sells your data. It is only shared with:
• The clubs and organizers involved in your purchases (order, identity needed at the door, QR); for a guest list joined through a promoter, the relevant club and team see your registration
• Taste statistics for clubs and organizers: if you went to their events, your music preferences (taste quiz) and the genres of the events you attended on Yuno may be included in AGGREGATED statistics about their community. They are never shown person by person, and a genre is only displayed when it gathers at least 10 people. You can turn this off in Settings → Personalized recommendations
• AI assistants chosen by a club or organizer: if a club or organizer whose events you attended connects its own AI assistant (for example Claude, ChatGPT, Gemini or Le Chat) to its Yuno Console, that assistant reads its statistics; it only receives your identity (name, email, purchase history with that club or organizer) if that professional explicitly allowed it. This transfer happens on the professional's instruction, who is responsible for it; the assistant's provider processes this data under its own terms. Yuno does not use your data to train any AI
• Stripe (payments — your card details are processed directly by Stripe and never pass through Yuno's servers)
• Supabase (backend hosting — encryption in transit via HTTPS/TLS)
• Cloudflare (secure site delivery)
• Google (Google Fonts typefaces: your browser downloads them from Google's servers, which receive your IP address)
• PostHog (site and app usage analytics, hosted in the EU, only after your consent on the web)
• Mapbox (map display of clubs)
• Resend (transactional emails: confirmations, tickets)
• Octopush (SMS, when you have consented; French company, data hosted in France)
• OpenAI (conversational assistant and recommendation engine: questions you ask the assistant, and event descriptions/music preferences, are sent to OpenAI to generate answers and suggestions)
• Apple and Google (push notification delivery, Sign-in, Wallet passes where applicable)
• Strictly necessary technical subcontractors

**5. Retention Periods**
• Order data and invoices: 5 years (proof, disputes, accounting obligations)
• Support: 2 years after last contact
• Security logs: 12 months
• Legal acceptance records: 5 years
• Push notification token: deleted when you disable notifications or delete your account
• Inactive account: 24 months, then deletion/anonymization (unless legal obligations apply)

**6. Your Rights**
You have the rights of access, rectification, erasure, objection, restriction and portability, as well as the right to withdraw your consent at any time and to set directives on what happens to your data after your death.
Contact: contact@yunoapp.eu — we reply within 30 days.
Complaint: CNIL (cnil.fr) or the data protection authority of your country of residence.

**7. Deleting Your Account**
You can delete your account directly in the app: Profile → Settings → Delete my account. Deletion is immediate and irreversible (profile, favorites, loyalty points). Records the law requires us to keep (invoices, orders) are retained for the legal period and then deleted.

**8. Security**
Technical and organizational measures: access controls and role-based permission isolation, encryption in transit (HTTPS/TLS), secure authentication with two-factor authentication available, enforced password policy, security logging.

**9. Administrator Access**
The platform operator has access to partner venues' management data (performance, orders, events) to keep the service running and provide support. This access is based on the operator's legitimate interest and protected by appropriate security measures.

**10. Minors**
Yuno is restricted to adults (18+). We do not knowingly collect data from minors; any account identified as belonging to a minor is deleted.

**11. Personalization & Automated Decisions**
The "For You" selection and party suggestions rely on your music tastes, favorites and history to order what you see. This profiling has no legal effect on you and can be turned off anytime in Settings → Personalized recommendations. Yuno makes no fully automated decision producing legal effects.

**12. Transfers Outside the EU**
Some sub-processors — notably Stripe (payments), OpenAI (AI assistant), Apple and Google (notifications) — may involve data transfers outside the European Union, governed by the European Commission's standard contractual clauses or the Data Privacy Framework, in accordance with GDPR. Supabase, Mapbox, Resend and Cloudflare use infrastructure compliant with European data protection standards.

**13. Changes**
This policy may evolve with the service. In case of substantial change, you will be informed in the app or by email. The last update date appears at the top of this page.

**14. Yuno CRM: when a club or organizer uses Yuno to write to you**
Clubs and organizers use Yuno CRM to manage their relationship with the people who buy their tickets, including on another ticketing platform (Shotgun, for example). For this data, the club or organizer is the controller: it decides what it does with it and answers your requests. Yuno acts on its behalf, as processor (yunoapp.eu/legal/dpa), and never sells this data.
• Data: what the organizer's ticketing passes on to it (name, email, phone, age, gender, town, postcode, country where asked, tickets, entries), what you give on its sign-up pages, and how you react to its messages (delivery, open, click).
• Analysis: the organizer can have Yuno compute, from its data only, what seems to bring its audience (artists, styles, days, buying habits, distance) and an estimate of your chance of coming back, to choose who it writes to and when. This estimate uses neither your gender nor the opening of your emails, has no legal effect, and conditions neither your entry nor the price of your tickets. One organizer's data is never linked with another's.
• Your rights: contact the organizer (its identity appears in each of its messages). You can object to this analysis and to its messages without giving a reason, unsubscribe at any time (link at the bottom of each email, STOP by SMS), and ask for access to, rectification or erasure of your data. If you write to Yuno (contact@yunoapp.eu), we pass your request to the organizer concerned and help it answer.
• Anonymous statistics: with each organizer's authorisation, Yuno draws aggregated counts from their accounts (for example "number of returns tested"), with no personal data and no count covering fewer than ten people, to improve Yuno CRM's analysis rules. For this operation, Yuno is the controller, on the basis of its legitimate interest; people the organizer excluded from the analysis are not included.`
    },
    es: {
      title: 'Política de Privacidad',
      content: `Última actualización: 8 de octubre de 2026

Esta política explica qué datos recoge Yuno, por qué, con quién se comparten y cuáles son tus derechos. Se aplica a yunoapp.eu y a las apps móviles Yuno y Yuno Pro.

**1. Responsable del tratamiento**
WOMBER – 25 avenue Mercure, 31130 Quint-Fonsegrives, Francia – contact@yunoapp.eu

**2. Datos recogidos**
• Cuenta e identidad: apellido, nombre, email, teléfono, ciudad (opcional), foto de perfil (si la añades), idioma preferido
• Edad (declarativa): fecha de nacimiento / confirmación de mayoría de edad — Yuno está reservado a mayores de 18 años
• Inicio de sesión con Apple o Google: identificador transmitido por el servicio elegido (nunca recibimos tu contraseña de Apple/Google)
• Pedidos y reservas: entradas, mesas VIP (depósito, gasto mínimo), bebidas, inscripciones en guest lists, reembolsos, facturas
• Fidelidad y preferencias: puntos de fidelidad, favoritos, preferencias musicales (quiz de gustos)
• Ubicación: procesada en tu dispositivo (con tu permiso del sistema) para mostrar clubs y fiestas cercanas; se memoriza la ciudad elegida, Yuno no conserva ningún historial de tus posiciones
• Notificaciones push: token del dispositivo (Apple APNs / Google FCM), eliminado si desactivas las notificaciones
• Asistente IA: contenido de tus conversaciones con el asistente Yuno
• Cámara (app Pro / personal): usada localmente para escanear códigos QR; no se graba ni se transmite ninguna imagen
• Enlaces de promoción: si abres Yuno a través del enlace de un promotor o socio, el identificador del enlace se memoriza para atribuir la venta
• Datos técnicos y de seguridad: logs, tipo de dispositivo, dirección IP
• Pruebas de aceptación legal: versión de las condiciones aceptadas, marca de tiempo, dirección IP
• Cookies y rastreadores: ver la Política de Cookies (yunoapp.eu/legal/cookies) — la medición de audiencia anónima de Yuno está exenta de consentimiento (directrices CNIL del 4 de julio de 2025: estadísticas agregadas, finalidad de medición únicamente, rastreador de 13 meses como máximo, conservación de 25 meses como máximo, nunca vinculada a tu cuenta sin tu acuerdo); PostHog y cualquier rastreador de marketing solo se cargan con tu consentimiento

**3. Finalidades y bases legales**
• Prestar el servicio (cuenta, pedidos, códigos QR, guest lists): ejecución del contrato
• Pagos, facturas y contabilidad: ejecución del contrato y obligación legal
• Verificación de la mayoría de edad (18+): obligación legal e interés legítimo
• Seguridad de la plataforma / antifraude: interés legítimo
• Soporte al cliente: ejecución del contrato / interés legítimo
• Notificaciones push y ubicación: permisos del sistema que concedes y puedes revocar en cualquier momento en los ajustes de tu dispositivo
• Personalización ("Para ti", recomendaciones) y estadísticas internas: interés legítimo — desactivable en Ajustes → Recomendaciones personalizadas
• Atribución de ventas a promotores/socios: interés legítimo (remuneración de socios)
• Emails y SMS de marketing, newsletter: consentimiento, retirable en cualquier momento (enlace de baja, STOP)
• Medición de audiencia anónima de Yuno (páginas vistas, embudo de compra, sin vincular a tu cuenta): interés legítimo, exenta de consentimiento (CNIL); vinculación a tu cuenta y PostHog: consentimiento
• Publicidad (píxel de Meta y API de conversiones del club, del organizador o de Yuno): consentimiento, retirable en cualquier momento desde el menú Cookies. Para esos datos, el club u organizador implicado y Meta Platforms Ireland Ltd son corresponsables (art. 26 RGPD); Yuno actúa por su cuenta, solo transmite datos cifrados con hash y conserva la prueba de tu respuesta en cada pedido

**4. Destinatarios**
Yuno nunca vende tus datos. Solo se comparten con:
• Los clubs y organizadores implicados en tus compras (pedido, identidad necesaria en la puerta, QR); si te apuntas a una guest list a través de un promotor, el club y el equipo implicados ven tu inscripción
• Estadísticas de gustos para clubs y organizadores: si has ido a sus eventos, tus preferencias musicales (quiz de gustos) y los géneros de los eventos a los que has ido en Yuno pueden formar parte de estadísticas AGREGADAS de su comunidad. Nunca se muestran persona por persona, y un género solo aparece si reúne al menos 10 personas. Puedes desactivarlo en Ajustes → Recomendaciones personalizadas
• Asistentes de IA elegidos por un club u organizador: si un club u organizador a cuyas fiestas has ido conecta su propio asistente de IA (por ejemplo Claude, ChatGPT, Gemini o Le Chat) a su Consola Yuno, ese asistente lee sus estadísticas; solo recibe tu identidad (nombre, email, historial de compras con ese club u organizador) si ese profesional lo ha autorizado expresamente. Esta transferencia se hace por instrucción del profesional, que es responsable de ella; el proveedor del asistente trata estos datos según sus propias condiciones. Yuno no utiliza tus datos para entrenar ninguna IA
• Stripe (pagos — tus datos bancarios los procesa directamente Stripe y nunca pasan por los servidores de Yuno)
• Supabase (alojamiento backend — cifrado en tránsito HTTPS/TLS)
• Cloudflare (distribución segura del sitio)
• Google (tipografías Google Fonts: tu navegador las descarga desde los servidores de Google, que reciben tu dirección IP)
• PostHog (analítica de uso del sitio y de las apps, alojada en la UE, solo tras tu consentimiento en la web)
• Mapbox (visualización cartográfica de los clubs)
• Resend (emails transaccionales: confirmaciones, entradas)
• Octopush (SMS, cuando lo has consentido; empresa francesa, datos alojados en Francia)
• OpenAI (asistente conversacional y motor de recomendaciones: las preguntas al asistente y descripciones de eventos/preferencias musicales se envían a OpenAI para generar respuestas y sugerencias)
• Apple y Google (entrega de notificaciones push, inicio de sesión, tarjetas Wallet cuando aplique)
• Subencargados técnicos estrictamente necesarios

**5. Plazos de conservación**
• Datos de pedidos y facturas: 5 años (prueba, litigios, obligaciones contables)
• Soporte: 2 años después del último contacto
• Logs de seguridad: 12 meses
• Pruebas de aceptación legal: 5 años
• Token de notificaciones push: eliminado al desactivar las notificaciones o al eliminar la cuenta
• Cuenta inactiva: 24 meses y luego eliminación/anonimización (salvo obligaciones legales)

**6. Tus derechos**
Tienes derecho de acceso, rectificación, supresión, oposición, limitación y portabilidad, así como el derecho a retirar tu consentimiento en cualquier momento y a dar instrucciones sobre el destino de tus datos tras tu fallecimiento.
Contacto: contact@yunoapp.eu — respondemos en un plazo de 30 días.
Reclamación: CNIL (cnil.fr, autoridad del responsable en Francia) o la autoridad de protección de datos de tu país de residencia (en España, la AEPD).

**7. Eliminar tu cuenta**
Puedes eliminar tu cuenta directamente en la app: Perfil → Ajustes → Eliminar mi cuenta. La eliminación es inmediata e irreversible (perfil, favoritos, puntos de fidelidad). Los justificantes que la ley nos obliga a conservar (facturas, pedidos) se guardan durante el plazo legal y luego se eliminan.

**8. Seguridad**
Medidas técnicas y organizativas: controles de acceso y aislamiento de permisos por rol, cifrado en tránsito (HTTPS/TLS), autenticación segura con doble factor disponible, política de contraseñas reforzada, registro de seguridad.

**9. Acceso de administrador**
El operador de la plataforma tiene acceso a los datos de gestión de los establecimientos asociados (rendimiento, pedidos, eventos) para garantizar el buen funcionamiento del servicio y el soporte. Este acceso se basa en el interés legítimo del operador y está protegido por medidas de seguridad apropiadas.

**10. Menores**
Yuno está reservado a personas adultas (18+). No recogemos conscientemente datos de menores; cualquier cuenta identificada como perteneciente a un menor será eliminada.

**11. Personalización y decisiones automatizadas**
La selección "Para ti" y las sugerencias de fiestas se basan en tus gustos musicales, tus favoritos y tu historial para ordenar lo que ves. Este perfilado no tiene ningún efecto jurídico sobre ti y puede desactivarse en cualquier momento en Ajustes → Recomendaciones personalizadas. Yuno no toma ninguna decisión totalmente automatizada con efectos jurídicos.

**12. Transferencias fuera de la UE**
Algunos subencargados — en particular Stripe (pagos), OpenAI (asistente IA), Apple y Google (notificaciones) — pueden implicar transferencias de datos fuera de la Unión Europea, reguladas por las cláusulas contractuales tipo de la Comisión Europea o el Data Privacy Framework, de conformidad con el RGPD. Supabase, Mapbox, Resend y Cloudflare utilizan infraestructuras conformes con los estándares europeos de protección de datos.

**13. Modificaciones**
Esta política puede evolucionar con el servicio. En caso de cambio sustancial, se te informará en la app o por email. La fecha de última actualización figura en la parte superior de esta página.

**14. Yuno CRM: cuando una discoteca o un organizador usa Yuno para escribirle**
Discotecas y organizadores usan Yuno CRM para gestionar su relación con las personas que compran sus entradas, también en otra ticketera (Shotgun, por ejemplo). Para estos datos, la discoteca o el organizador es el responsable del tratamiento: decide qué hace con ellos y responde a sus solicitudes. Yuno actúa por su cuenta, como encargado (yunoapp.eu/legal/dpa), y nunca vende estos datos.
• Datos: los que la ticketera del organizador le transmite (nombre, e-mail, teléfono, edad, género, ciudad, código postal, país si se pidieron, entradas, accesos), los que usted facilita en sus páginas de registro y sus reacciones a sus mensajes (entrega, apertura, clic).
• Análisis: el organizador puede hacer que Yuno calcule, solo con sus datos, lo que parece hacer venir a su público (artistas, estilos, días, hábitos de compra, distancia) y una estimación de su probabilidad de volver, para elegir a quién escribe y cuándo. Esta estimación no usa ni su género ni la apertura de sus e-mails, no tiene efectos jurídicos y no condiciona ni su entrada ni el precio de sus entradas. Los datos de un organizador nunca se vinculan con los de otro.
• Sus derechos: diríjase al organizador (su identidad figura en cada uno de sus mensajes). Puede oponerse a este análisis y a sus mensajes sin justificarlo, darse de baja en cualquier momento (enlace al final de cada e-mail, STOP por SMS) y solicitar el acceso, la rectificación o la supresión de sus datos. Si escribe a Yuno (contact@yunoapp.eu), transmitimos su solicitud al organizador correspondiente y le ayudamos a responder.
• Estadísticas anónimas: con la autorización de cada organizador, Yuno obtiene de sus cuentas recuentos agregados (por ejemplo, «número de vueltas probadas»), sin ningún dato personal ni recuento sobre menos de diez personas, para mejorar las reglas de análisis de Yuno CRM. Para esta operación, Yuno es responsable del tratamiento, sobre la base de su interés legítimo; las personas que el organizador excluyó del análisis no entran.`
    }
  },

  'cookies': {
    fr: {
      title: 'Politique Cookies',
      content: `**1. Principe**
Yuno utilise des cookies/traceurs nécessaires au fonctionnement (session, sécurité, préférences). La mesure d'audience anonyme de Yuno (identifiant de visite yuno_visitor_id, 13 mois au plus, jamais rattaché à votre compte sans votre accord) est exemptée de consentement selon les lignes directrices de la CNIL du 4 juillet 2025 : elle ne sert qu'à des statistiques agrégées, sans croisement ni suivi entre sites, et n'est transmise à aucun tiers. Les autres cookies non nécessaires (PostHog, marketing) ne sont déposés qu'après consentement.

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

**Cookies analytiques (mesure d'audience)** :
• Sans consentement (exemption CNIL, mesure d'audience anonyme), Yuno dépose un identifiant de visite (yuno_visitor_id, 13 mois au plus) et des indicateurs de fréquentation « live » pour mesurer, de façon anonyme, comment les clubs et soirées sont consultés ; ces données ne sont jamais rattachées à votre compte sans votre accord. Après votre consentement seulement, Yuno les rattache à votre compte et charge PostHog (mesure d'audience hébergée dans l'UE, cookie et stockage ph_*, 1 an) pour comprendre comment le site et l'app sont utilisés : pages vues, clics, parcours. Si vous êtes connecté, ces mesures sont reliées à l'identifiant interne de votre compte, jamais à votre email ni à votre téléphone. Aucun autre cookie analytique tiers n'est utilisé. Vous pouvez retirer ce consentement à tout moment via le menu Cookies.

**Cookies publicitaires (Meta)** :
• Uniquement après votre consentement « Publicité (Meta) », les pages publiques chargent le pixel Meta du club, de l'organisateur ou de Yuno, qui dépose les cookies _fbp (identifiant navigateur, 90 jours) et _fbc (identifiant de clic publicitaire) sur yunoapp.eu. Vos consultations de soirées, ouvertures du tunnel d'achat, achats et inscriptions guest list sont alors transmis à Meta Platforms Ireland Ltd, y compris depuis nos serveurs (API Conversions), sous forme hachée. Un refus efface ces cookies et n'envoie rien, même côté serveur. Rien n'est envoyé depuis l'app mobile Yuno. Politique de Meta : facebook.com/privacy/policy.`
    },
    en: {
      title: 'Cookie Policy',
      content: `**1. Principle**
Yuno uses cookies/trackers necessary for operation (session, security, preferences). Yuno's anonymous audience measurement (visit identifier yuno_visitor_id, 13 months at most, never linked to your account without your agreement) is exempt from consent under the CNIL guidelines of 4 July 2025: it only produces aggregated statistics, with no cross-referencing or cross-site tracking, and is shared with no third party. Other non-essential cookies (PostHog, marketing) are only placed after consent.

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

**Analytical Cookies (audience measurement)**:
• Without consent (CNIL exemption, anonymous audience measurement), Yuno stores a visit identifier (yuno_visitor_id, 13 months at most) and "live" attendance indicators to anonymously measure how clubs and parties are viewed; this data is never linked to your account without your agreement. Only after your consent does Yuno link it to your account and load PostHog (EU-hosted product analytics, ph_* cookie and storage, 1 year) to understand how the site and app are used: pages viewed, clicks, journeys. When you are signed in, these measurements are linked to your account's internal identifier, never to your email or phone number. No other third-party analytical cookies are used. You can withdraw this consent at any time via the Cookies menu.

**Advertising Cookies (Meta)**:
• Only after your "Advertising (Meta)" consent, public pages load the Meta pixel of the club, the organizer or Yuno, which sets the _fbp (browser identifier, 90 days) and _fbc (ad click identifier) cookies on yunoapp.eu. Your event page views, checkout openings, purchases and guest list sign-ups are then transmitted to Meta Platforms Ireland Ltd, including from our servers (Conversions API), in hashed form. A refusal deletes those cookies and sends nothing, server-side included. Nothing is sent from the Yuno mobile app. Meta's policy: facebook.com/privacy/policy.`
    },
    es: {
      title: 'Política de Cookies',
      content: `**1. Principio**
Yuno utiliza cookies/rastreadores necesarios para el funcionamiento (sesión, seguridad, preferencias). La medición de audiencia anónima de Yuno (identificador de visita yuno_visitor_id, 13 meses como máximo, nunca vinculado a tu cuenta sin tu acuerdo) está exenta de consentimiento según las directrices de la CNIL del 4 de julio de 2025: solo produce estadísticas agregadas, sin cruces ni seguimiento entre sitios, y no se comparte con terceros. Las demás cookies no necesarias (PostHog, marketing) solo se instalan tras el consentimiento.

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

**Cookies analíticas (medición de audiencia)**:
• Sin consentimiento (exención CNIL, medición de audiencia anónima), Yuno guarda un identificador de visita (yuno_visitor_id, 13 meses como máximo) e indicadores de afluencia «live» para medir, de forma anónima, cómo se ven los clubs y las fiestas; estos datos nunca se vinculan a tu cuenta sin tu acuerdo. Solo tras tu consentimiento, Yuno los vincula a tu cuenta y carga PostHog (analítica de uso alojada en la UE, cookie y almacenamiento ph_*, 1 año) para entender cómo se usan el sitio y la app: páginas vistas, clics, recorridos. Si has iniciado sesión, estas mediciones se vinculan al identificador interno de tu cuenta, nunca a tu email ni a tu teléfono. No se utilizan otras cookies analíticas de terceros. Puedes retirar este consentimiento en cualquier momento desde el menú Cookies.

**Cookies publicitarias (Meta)**:
• Solo tras tu consentimiento «Publicidad (Meta)», las páginas públicas cargan el píxel de Meta del club, del organizador o de Yuno, que instala las cookies _fbp (identificador de navegador, 90 días) y _fbc (identificador de clic publicitario) en yunoapp.eu. Tus visitas a fiestas, aperturas del proceso de compra, compras e inscripciones a guest lists se transmiten entonces a Meta Platforms Ireland Ltd, también desde nuestros servidores (API de conversiones), en forma cifrada con hash. Un rechazo borra esas cookies y no envía nada, tampoco desde el servidor. Nada se envía desde la app móvil de Yuno. Política de Meta: facebook.com/privacy/policy.`
    }
  }
};

export const legalSections: { key: LegalSection; icon: string }[] = [
  { key: 'mentions-legales', icon: 'FileText' },
  { key: 'cgu', icon: 'ScrollText' },
  { key: 'cgv-utilisateurs', icon: 'ShoppingBag' },
  { key: 'cgv-clubs', icon: 'Building2' },
  { key: 'confidentialite', icon: 'Lock' },
  { key: 'dpa', icon: 'Database' },
  { key: 'privacy', icon: 'Shield' },
  { key: 'cookies', icon: 'Cookie' },
];
