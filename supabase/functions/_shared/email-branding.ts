/**
 * Shared email branding and localization utilities for Yuno
 * Provides consistent Yuno branding across all customer-facing emails
 */

export type EmailLanguage = 'en' | 'es' | 'fr';

// Email translations for all customer-facing content
export const emailTranslations: Record<EmailLanguage, Record<string, string>> = {
  en: {
    // General
    'email.poweredBy': 'Powered by',
    'email.yourNightlifeCompanion': 'Your nightlife companion',
    'email.downloadApp': 'Download the app',
    'email.viewInApp': 'View in Yuno',
    'email.needHelp': 'Need help?',
    'email.contactUs': 'Contact us',
    'email.unsubscribe': 'Unsubscribe',
    'email.allRightsReserved': 'All rights reserved',
    
    // Order confirmation
    'order.confirmed': 'Order confirmed! 🎉',
    'order.greeting': 'Hey',
    'order.orderConfirmed': 'Your order has been confirmed and is being prepared at',
    'order.address': 'Address',
    'order.orderDetails': 'Order details',
    'order.article': 'Item',
    'order.qty': 'Qty',
    'order.price': 'Price',
    'order.total': 'Total',
    'order.yourQRCode': 'Your QR Code',
    'order.orderNumber': 'Order #',
    'order.howToCollect': '📋 How to collect your order',
    'order.step1Title': 'Wait for notification:',
    'order.step1Desc': "You'll be notified when your order is ready.",
    'order.step2Title': 'Go to the bar:',
    'order.step2Desc': 'Head to the pickup point at',
    'order.step3Title': 'Show your QR code:',
    'order.step3Desc': 'Present this QR code to staff.',
    'order.step4Title': 'Enjoy!',
    'order.step4Desc': 'Pick up your order and enjoy! 🍹',
    'order.tip': '💡 Tip:',
    'order.tipContent': 'Keep this email or screenshot your QR code for quick access!',
    'order.thanks': 'Thanks for your order! 🙏',
    
    // Ticket confirmation
    'ticket.confirmedSubject': '🎟️ Ticket confirmed - {eventTitle}',
    'ticket.confirmedTitle': 'Ticket confirmed! 🎉',
    'ticket.greeting': 'Hey',
    'ticket.body': 'Your ticket for <strong>{eventTitle}</strong> at <strong>{venueName}</strong> is confirmed.',
    'ticket.eventDate': 'Date',
    'ticket.ticketType': 'Ticket type',
    'ticket.quantity': 'Quantity',
    'ticket.totalPrice': 'Total paid',
    'ticket.yourQRCode': 'Your QR Code',
    'ticket.reference': 'Reference',
    'ticket.showAtEntry': 'Show this QR code at the entrance to access the event.',
    'ticket.howToEnter': '📋 How to enter',
    'ticket.enterStep1Title': 'Save your ticket:',
    'ticket.enterStep1Desc': 'Keep this email or screenshot your QR code.',
    'ticket.enterStep2Title': 'Go to the venue:',
    'ticket.enterStep2Desc': 'Head to the entrance of',
    'ticket.enterStep3Title': 'Show your QR code:',
    'ticket.enterStep3Desc': 'Present it to the bouncer for scanning.',
    'ticket.enterStep4Title': 'Enjoy the night!',
    'ticket.enterStep4Desc': 'You\'re in! Have an amazing time 🎶',
    'ticket.guestClaimTitle': 'Retrieve your ticket',
    'ticket.guestClaimDesc': 'Access your ticket anytime by entering your reference and name.',
    'ticket.guestClaimCta': 'Find my ticket',
    'vip.guestClaimTitle': 'Retrieve your reservation',
    'vip.guestClaimDesc': 'Access your VIP table anytime by entering your reference and name.',
    'vip.guestClaimCta': 'Find my reservation',
    'ticket.guestFinalize': 'Create an account to save all your tickets and earn loyalty points.',
    'ticket.guestFinalizeCta': 'Create my account',
    'ticket.thanks': 'See you there! 🎉',
    'ticket.teamSign': '— The Yuno team',
    
    // Post-visit notification
    'postVisit.thanks': 'Thanks for visiting',
    'postVisit.pointsEarnedToday': 'Points Earned Today',
    'postVisit.fromSpent': 'From €{amount} spent',
    'postVisit.yourBalance': 'Your Balance',
    'postVisit.points': 'points',
    'postVisit.yourTier': 'Your Tier',
    'postVisit.member': 'member',
    'postVisit.spendMore': 'Spend €{amount} more to reach',
    'postVisit.almostThere': "You're almost at",
    'postVisit.redeemPoints': 'Redeem your points for exclusive rewards!',
    'postVisit.viewRewards': 'View My Rewards',
    'postVisit.seeYouNext': 'See you next time at',
    
    // Auth emails
    'auth.welcome': 'Welcome',
    'auth.confirmEmail': 'Confirm your email',
    'auth.thanksForSignup': 'Thanks for signing up on Yuno.',
    'auth.clickToConfirm': 'To confirm your email address and activate your account, click the button below:',
    'auth.confirmButton': 'Confirm my email →',
    'auth.buttonNotWork': "If the button doesn't work, copy and paste this link in your browser:",
    'auth.ignoreIfNotYou': "If you didn't create an account, you can ignore this email.",
    'auth.passwordReset': 'Password Reset',
    'auth.passwordResetRequest': 'You requested to reset your password.',
    'auth.clickToReset': 'Click the button below to create a new password:',
    'auth.resetButton': 'Reset my password →',
    'auth.ignoreIfNotRequested': "If you didn't request this reset, you can ignore this email.",
    
    // Event recap
    'recap.subject': 'Your night at {venueName} 🌙',
    
    // Waitlist / Private List
    'waitlist.confirmationSubject': '✅ You\'re on the Private List - {eventTitle}',
    'waitlist.confirmationTitle': 'Registration confirmed!',
    'waitlist.confirmationGreeting': 'Hey {name},',
    'waitlist.confirmationBody': 'You\'re registered for the Private List for <strong>{eventTitle}</strong> by {venueName}.',
    'waitlist.confirmationNote': 'We\'ll send you an email as soon as ticket sales open.',
    'waitlist.openingSubject': '🎉 Tickets are now on sale - {eventTitle}',
    'waitlist.openingTitle': 'Tickets are live!',
    'waitlist.openingBody': 'Tickets for <strong>{eventTitle}</strong> are now available.',
    'waitlist.openingPriority': 'As a Private List member, you have priority access!',
    'waitlist.buyTickets': 'Buy my tickets',
    'waitlist.teamSign': '— The Yuno team',
    
    // Event update
    'eventUpdate.subject': '⚠️ Event updated - {eventTitle}',
    'eventUpdate.title': 'Event update',
    'eventUpdate.greeting': 'Hey{name},',
    'eventUpdate.body': 'The event <strong>{eventTitle}</strong> at <strong>{venueName}</strong> has been updated.',
    'eventUpdate.whatChanged': 'What changed:',
    'eventUpdate.viewEvent': 'View event',
    'eventUpdate.teamSign': '— The Yuno team',
    'eventUpdate.timeChanged': '🕐 Time changed',
    'eventUpdate.djChanged': '🎧 DJ lineup changed',
    'eventUpdate.detailsChanged': '📝 Details updated',
    'eventUpdate.from': 'Before',
    'eventUpdate.to': 'After',
    
    // Refund
    'refund.subject': '💸 Refund confirmed - {amount}€',
    'refund.title': 'Refund confirmed',
    'refund.body': '<strong>{venueName}</strong> has processed your refund.',
    'refund.amount': 'Refund amount',
    'refund.event': 'Event',
    'refund.reason': 'Reason',
    'refund.itemType': 'Item',
    'refund.delay': 'The refund will appear on your account within 5 to 10 business days. Yuno service fees are non-refundable.',
    'refund.typeOrder': 'Drink order',
    'refund.typeTicket': 'Ticket',
    'refund.typeTable': 'VIP Table',
    
    // VIP confirmation
    'vip.requestReceivedSubject': '✅ VIP request received - {eventTitle}',
    'vip.requestReceivedTitle': 'Request received!',
    'vip.requestReceivedBody': 'Your VIP table request for <strong>{eventTitle}</strong> at <strong>{venueName}</strong> has been received.',
    'vip.requestReceivedNote': "We'll confirm your placement shortly.",
    'vip.confirmedSubject': '🎉 VIP table confirmed - {eventTitle}',
    'vip.confirmedTitle': 'Table confirmed!',
    'vip.confirmedBody': 'Your VIP table for <strong>{eventTitle}</strong> at <strong>{venueName}</strong> is confirmed.',
    'vip.zone': 'Zone',
    'vip.minimumSpend': 'Minimum spend',
    'vip.modifiedSubject': '⚠️ VIP table modified - {eventTitle}',
    'vip.modifiedTitle': 'Table modified',
    'vip.modifiedBody': 'Your VIP table reservation for <strong>{eventTitle}</strong> has been modified.',
    'vip.refusedSubject': '❌ VIP request declined - {eventTitle}',
    'vip.refusedTitle': 'Request declined',
    'vip.refusedBody': 'Unfortunately, your VIP table request for <strong>{eventTitle}</strong> at <strong>{venueName}</strong> could not be confirmed.',
    'vip.refusedNote': 'Please contact the venue for more information.',
    'vip.viewReservation': 'View my reservation',
    'vip.teamSign': '— The Yuno team',
    
    // Upsell
    'upsell.subject': '🔥 Upgrade your night at {eventTitle}',
    'upsell.title': 'Make your night even better',
    'upsell.greeting': 'Hey{name},',
    'upsell.body': 'Your ticket for <strong>{eventTitle}</strong> at <strong>{venueName}</strong> is confirmed! Want to level up?',
    'upsell.upgradeVip': '🥂 Upgrade to VIP',
    'upsell.upgradeVipDesc': 'Skip the line, get a reserved table, and enjoy premium service.',
    'upsell.preorderDrinks': '🍸 Pre-order drinks',
    'upsell.preorderDrinksDesc': 'Save time at the bar — order now and pick up on arrival.',
    'upsell.ctaVip': 'Book VIP Table',
    'upsell.ctaDrinks': 'Order Drinks',
    'upsell.teamSign': '— The Yuno team',
    
    // Low ticket
    'lowTicket.subject': '🔥 Almost sold out — {eventTitle}',
    'lowTicket.title': 'Selling fast!',
    'lowTicket.body': '<strong>{eventTitle}</strong> at <strong>{venueName}</strong> is almost sold out. Only <strong>{remaining}</strong> tickets left!',
    'lowTicket.cta': 'Get your ticket',
    'lowTicket.teamSign': '— The Yuno team',
    'lowTicket.ownerSubject': '📊 Low ticket alert — {eventTitle}',
    'lowTicket.ownerBody': '<strong>{eventTitle}</strong> has <strong>{sold}/{total}</strong> tickets sold ({percent}%). Almost sold out!',
    
    // Pre-night checklist
    'checklist.subject': '🎉 Tonight: {eventTitle}',
    'checklist.title': "You're going out tonight!",
    'checklist.greeting': 'Hey{name},',
    'checklist.body': 'Get ready for <strong>{eventTitle}</strong> at <strong>{venueName}</strong>.',
    'checklist.qrTitle': 'Your QR Code',
    'checklist.qrNote': 'Show this at the entrance',
    'checklist.doorsOpen': 'Doors open',
    'checklist.address': 'Address',
    'checklist.dressCode': 'Dress code',
    'checklist.viewEvent': 'View event',
    'checklist.teamSign': '— The Yuno team',
    
    // Next event recommendation
    'nextEvent.subject': '🎶 Your next night out',
    'nextEvent.title': 'Events picked for you',
    'nextEvent.body': "Based on your past nights, we think you'll love these upcoming events.",
    'nextEvent.on': 'on',
    'nextEvent.at': 'at',
    'nextEvent.getTickets': 'Get tickets',
    'nextEvent.teamSign': '— The Yuno team',
    
    // Missed you
    'missed.subject': '😢 You missed {eventTitle}',
    'missed.title': 'You missed it!',
    'missed.body': '<strong>{eventTitle}</strong> at <strong>{venueName}</strong> was amazing. Here\'s what happened:',
    'missed.attendees': 'attendees',
    'missed.nextEvent': 'Next event',
    'missed.cta': "Don't miss the next one",
    'missed.teamSign': '— The Yuno team',
    
    // Owner night summary
    'nightSummary.subject': '📊 Night summary — {eventTitle}',
    'nightSummary.title': 'Night summary',
    'nightSummary.revenue': 'Revenue',
    'nightSummary.orders': 'Orders',
    'nightSummary.tickets': 'Tickets sold',
    'nightSummary.tables': 'VIP Tables',
    'nightSummary.topProducts': 'Top products',
    'nightSummary.incidents': 'Incidents',
    'nightSummary.none': 'None',
    'nightSummary.viewDashboard': 'View dashboard',
    'nightSummary.teamSign': '— Yuno Analytics',
    
    // Owner weekly report
    'weeklyReport.subject': '📈 Weekly report — {venueName}',
    'weeklyReport.title': 'Weekly performance',
    'weeklyReport.period': 'Period',
    'weeklyReport.totalRevenue': 'Total revenue',
    'weeklyReport.totalOrders': 'Total orders',
    'weeklyReport.totalTickets': 'Tickets sold',
    'weeklyReport.totalTables': 'Tables booked',
    'weeklyReport.topEvent': 'Top event',
    'weeklyReport.newCustomers': 'New customers',
    'weeklyReport.viewDashboard': 'View dashboard',
    'weeklyReport.teamSign': '— Yuno Analytics',
    
    // Invoice
    'invoice.sectionTitle': '🧾 Your Invoice',
    'invoice.description': 'Download your invoice for this purchase.',
    'invoice.downloadCta': 'Download Invoice',
  },
  
  es: {
    // General
    'email.poweredBy': 'Desarrollado por',
    'email.yourNightlifeCompanion': 'Tu compañero de vida nocturna',
    'email.downloadApp': 'Descargar la app',
    'email.viewInApp': 'Ver en Yuno',
    'email.needHelp': '¿Necesitas ayuda?',
    'email.contactUs': 'Contáctanos',
    'email.unsubscribe': 'Cancelar suscripción',
    'email.allRightsReserved': 'Todos los derechos reservados',
    
    // Order confirmation
    'order.confirmed': '¡Pedido confirmado! 🎉',
    'order.greeting': 'Hola',
    'order.orderConfirmed': 'Tu pedido ha sido confirmado y está siendo preparado en',
    'order.address': 'Dirección',
    'order.orderDetails': 'Detalles del pedido',
    'order.article': 'Artículo',
    'order.qty': 'Cant.',
    'order.price': 'Precio',
    'order.total': 'Total',
    'order.yourQRCode': 'Tu código QR',
    'order.orderNumber': 'Pedido #',
    'order.howToCollect': '📋 Cómo recoger tu pedido',
    'order.step1Title': 'Espera la notificación:',
    'order.step1Desc': 'Serás notificado cuando tu pedido esté listo.',
    'order.step2Title': 'Ve al bar:',
    'order.step2Desc': 'Dirígete al punto de recogida en',
    'order.step3Title': 'Muestra tu código QR:',
    'order.step3Desc': 'Presenta este código QR al personal.',
    'order.step4Title': '¡Disfruta!',
    'order.step4Desc': '¡Recoge tu pedido y disfruta! 🍹',
    'order.tip': '💡 Consejo:',
    'order.tipContent': '¡Guarda este email o haz captura de pantalla del código QR para acceso rápido!',
    'order.thanks': '¡Gracias por tu pedido! 🙏',
    
    // Ticket confirmation
    'ticket.confirmedSubject': '🎟️ Entrada confirmada - {eventTitle}',
    'ticket.confirmedTitle': '¡Entrada confirmada! 🎉',
    'ticket.greeting': 'Hola',
    'ticket.body': 'Tu entrada para <strong>{eventTitle}</strong> en <strong>{venueName}</strong> está confirmada.',
    'ticket.eventDate': 'Fecha',
    'ticket.ticketType': 'Tipo de entrada',
    'ticket.quantity': 'Cantidad',
    'ticket.totalPrice': 'Total pagado',
    'ticket.yourQRCode': 'Tu código QR',
    'ticket.reference': 'Referencia',
    'ticket.showAtEntry': 'Muestra este código QR en la entrada para acceder al evento.',
    'ticket.howToEnter': '📋 Cómo entrar',
    'ticket.enterStep1Title': 'Guarda tu entrada:',
    'ticket.enterStep1Desc': 'Guarda este email o haz captura de tu código QR.',
    'ticket.enterStep2Title': 'Ve al lugar:',
    'ticket.enterStep2Desc': 'Dirígete a la entrada de',
    'ticket.enterStep3Title': 'Muestra tu código QR:',
    'ticket.enterStep3Desc': 'Preséntalo al portero para que lo escanee.',
    'ticket.enterStep4Title': '¡Disfruta la noche!',
    'ticket.enterStep4Desc': '¡Estás dentro! Pásala increíble 🎶',
    'ticket.guestClaimTitle': 'Recupera tu entrada',
    'ticket.guestClaimDesc': 'Accede a tu entrada en cualquier momento con tu referencia y nombre.',
    'ticket.guestClaimCta': 'Encontrar mi entrada',
    'vip.guestClaimTitle': 'Recupera tu reserva',
    'vip.guestClaimDesc': 'Accede a tu mesa VIP en cualquier momento con tu referencia y nombre.',
    'vip.guestClaimCta': 'Encontrar mi reserva',
    'ticket.guestFinalize': 'Crea una cuenta para guardar tus entradas y ganar puntos de fidelidad.',
    'ticket.guestFinalizeCta': 'Crear mi cuenta',
    'ticket.thanks': '¡Nos vemos allí! 🎉',
    'ticket.teamSign': '— El equipo Yuno',
    
    // Post-visit notification
    'postVisit.thanks': 'Gracias por visitarnos',
    'postVisit.pointsEarnedToday': 'Puntos Ganados Hoy',
    'postVisit.fromSpent': 'De €{amount} gastados',
    'postVisit.yourBalance': 'Tu Saldo',
    'postVisit.points': 'puntos',
    'postVisit.yourTier': 'Tu Nivel',
    'postVisit.member': 'miembro',
    'postVisit.spendMore': 'Gasta €{amount} más para alcanzar',
    'postVisit.almostThere': 'Casi llegas a',
    'postVisit.redeemPoints': '¡Canjea tus puntos por recompensas exclusivas!',
    'postVisit.viewRewards': 'Ver Mis Recompensas',
    'postVisit.seeYouNext': '¡Hasta la próxima en',
    
    // Auth emails
    'auth.welcome': 'Bienvenido',
    'auth.confirmEmail': 'Confirma tu email',
    'auth.thanksForSignup': 'Gracias por registrarte en Yuno.',
    'auth.clickToConfirm': 'Para confirmar tu dirección de email y activar tu cuenta, haz clic en el botón de abajo:',
    'auth.confirmButton': 'Confirmar mi email →',
    'auth.buttonNotWork': 'Si el botón no funciona, copia y pega este enlace en tu navegador:',
    'auth.ignoreIfNotYou': 'Si no creaste una cuenta, puedes ignorar este email.',
    'auth.passwordReset': 'Restablecer contraseña',
    'auth.passwordResetRequest': 'Solicitaste restablecer tu contraseña.',
    'auth.clickToReset': 'Haz clic en el botón de abajo para crear una nueva contraseña:',
    'auth.resetButton': 'Restablecer mi contraseña →',
    'auth.ignoreIfNotRequested': 'Si no solicitaste este restablecimiento, puedes ignorar este email.',
    
    // Event recap
    'recap.subject': 'Tu noche en {venueName} 🌙',
    
    // Waitlist / Private List
    'waitlist.confirmationSubject': '✅ Estás en la Lista Privada - {eventTitle}',
    'waitlist.confirmationTitle': '¡Inscripción confirmada!',
    'waitlist.confirmationGreeting': 'Hola {name},',
    'waitlist.confirmationBody': 'Estás inscrito(a) en la Lista Privada para <strong>{eventTitle}</strong> por {venueName}.',
    'waitlist.confirmationNote': 'Te enviaremos un email cuando la venta de entradas esté abierta.',
    'waitlist.openingSubject': '🎉 La venta de entradas está abierta - {eventTitle}',
    'waitlist.openingTitle': '¡Las entradas están disponibles!',
    'waitlist.openingBody': 'Las entradas para <strong>{eventTitle}</strong> ya están disponibles.',
    'waitlist.openingPriority': '¡Como miembro de la Lista Privada, tienes acceso prioritario!',
    'waitlist.buyTickets': 'Comprar mis entradas',
    'waitlist.teamSign': '— El equipo Yuno',
    
    // Event update
    'eventUpdate.subject': '⚠️ Evento actualizado - {eventTitle}',
    'eventUpdate.title': 'Actualización del evento',
    'eventUpdate.greeting': 'Hola{name},',
    'eventUpdate.body': 'El evento <strong>{eventTitle}</strong> en <strong>{venueName}</strong> ha sido actualizado.',
    'eventUpdate.whatChanged': 'Qué cambió:',
    'eventUpdate.viewEvent': 'Ver evento',
    'eventUpdate.teamSign': '— El equipo Yuno',
    'eventUpdate.timeChanged': '🕐 Horario cambiado',
    'eventUpdate.djChanged': '🎧 Lineup de DJs cambiado',
    'eventUpdate.detailsChanged': '📝 Detalles actualizados',
    'eventUpdate.from': 'Antes',
    'eventUpdate.to': 'Después',
    
    // Refund
    'refund.subject': '💸 Reembolso confirmado - {amount}€',
    'refund.title': 'Reembolso confirmado',
    'refund.body': '<strong>{venueName}</strong> ha procesado tu reembolso.',
    'refund.amount': 'Monto reembolsado',
    'refund.event': 'Evento',
    'refund.reason': 'Razón',
    'refund.itemType': 'Artículo',
    'refund.delay': 'El reembolso aparecerá en tu cuenta en 5 a 10 días hábiles. Las tarifas de servicio de Yuno no son reembolsables.',
    'refund.typeOrder': 'Pedido de bebidas',
    'refund.typeTicket': 'Entrada',
    'refund.typeTable': 'Mesa VIP',
    
    // VIP confirmation
    'vip.requestReceivedSubject': '✅ Solicitud VIP recibida - {eventTitle}',
    'vip.requestReceivedTitle': '¡Solicitud recibida!',
    'vip.requestReceivedBody': 'Tu solicitud de mesa VIP para <strong>{eventTitle}</strong> en <strong>{venueName}</strong> ha sido recibida.',
    'vip.requestReceivedNote': 'Confirmaremos tu ubicación en breve.',
    'vip.confirmedSubject': '🎉 Mesa VIP confirmada - {eventTitle}',
    'vip.confirmedTitle': '¡Mesa confirmada!',
    'vip.confirmedBody': 'Tu mesa VIP para <strong>{eventTitle}</strong> en <strong>{venueName}</strong> está confirmada.',
    'vip.zone': 'Zona',
    'vip.minimumSpend': 'Gasto mínimo',
    'vip.modifiedSubject': '⚠️ Mesa VIP modificada - {eventTitle}',
    'vip.modifiedTitle': 'Mesa modificada',
    'vip.modifiedBody': 'Tu reserva de mesa VIP para <strong>{eventTitle}</strong> ha sido modificada.',
    'vip.refusedSubject': '❌ Solicitud VIP rechazada - {eventTitle}',
    'vip.refusedTitle': 'Solicitud rechazada',
    'vip.refusedBody': 'Lamentablemente, tu solicitud de mesa VIP para <strong>{eventTitle}</strong> en <strong>{venueName}</strong> no pudo ser confirmada.',
    'vip.refusedNote': 'Por favor, contacta al venue para más información.',
    'vip.viewReservation': 'Ver mi reserva',
    'vip.teamSign': '— El equipo Yuno',
    
    // Upsell
    'upsell.subject': '🔥 Mejora tu noche en {eventTitle}',
    'upsell.title': 'Haz tu noche aún mejor',
    'upsell.greeting': 'Hola{name},',
    'upsell.body': 'Tu entrada para <strong>{eventTitle}</strong> en <strong>{venueName}</strong> está confirmada. ¿Quieres subir de nivel?',
    'upsell.upgradeVip': '🥂 Pasa a VIP',
    'upsell.upgradeVipDesc': 'Sin colas, mesa reservada y servicio premium.',
    'upsell.preorderDrinks': '🍸 Pre-ordena bebidas',
    'upsell.preorderDrinksDesc': 'Ahorra tiempo en el bar — pide ahora y recoge al llegar.',
    'upsell.ctaVip': 'Reservar mesa VIP',
    'upsell.ctaDrinks': 'Pedir bebidas',
    'upsell.teamSign': '— El equipo Yuno',
    
    // Low ticket
    'lowTicket.subject': '🔥 Casi agotado — {eventTitle}',
    'lowTicket.title': '¡Se agotan rápido!',
    'lowTicket.body': '<strong>{eventTitle}</strong> en <strong>{venueName}</strong> casi está agotado. ¡Solo quedan <strong>{remaining}</strong> entradas!',
    'lowTicket.cta': 'Comprar entrada',
    'lowTicket.teamSign': '— El equipo Yuno',
    'lowTicket.ownerSubject': '📊 Alerta entradas — {eventTitle}',
    'lowTicket.ownerBody': '<strong>{eventTitle}</strong> tiene <strong>{sold}/{total}</strong> entradas vendidas ({percent}%). ¡Casi agotado!',
    
    // Pre-night checklist
    'checklist.subject': '🎉 Esta noche: {eventTitle}',
    'checklist.title': '¡Sales esta noche!',
    'checklist.greeting': 'Hola{name},',
    'checklist.body': 'Prepárate para <strong>{eventTitle}</strong> en <strong>{venueName}</strong>.',
    'checklist.qrTitle': 'Tu código QR',
    'checklist.qrNote': 'Muéstralo en la entrada',
    'checklist.doorsOpen': 'Apertura de puertas',
    'checklist.address': 'Dirección',
    'checklist.dressCode': 'Código de vestimenta',
    'checklist.viewEvent': 'Ver evento',
    'checklist.teamSign': '— El equipo Yuno',
    
    // Next event recommendation
    'nextEvent.subject': '🎶 Tu próxima salida',
    'nextEvent.title': 'Eventos para ti',
    'nextEvent.body': 'Basándonos en tus noches pasadas, creemos que te encantarán estos eventos.',
    'nextEvent.on': 'el',
    'nextEvent.at': 'en',
    'nextEvent.getTickets': 'Comprar entradas',
    'nextEvent.teamSign': '— El equipo Yuno',
    
    // Missed you
    'missed.subject': '😢 Te perdiste {eventTitle}',
    'missed.title': '¡Te lo perdiste!',
    'missed.body': '<strong>{eventTitle}</strong> en <strong>{venueName}</strong> fue increíble. Esto es lo que pasó:',
    'missed.attendees': 'asistentes',
    'missed.nextEvent': 'Próximo evento',
    'missed.cta': 'No te pierdas el siguiente',
    'missed.teamSign': '— El equipo Yuno',
    
    // Owner night summary
    'nightSummary.subject': '📊 Resumen de la noche — {eventTitle}',
    'nightSummary.title': 'Resumen de la noche',
    'nightSummary.revenue': 'Ingresos',
    'nightSummary.orders': 'Pedidos',
    'nightSummary.tickets': 'Entradas vendidas',
    'nightSummary.tables': 'Mesas VIP',
    'nightSummary.topProducts': 'Productos top',
    'nightSummary.incidents': 'Incidentes',
    'nightSummary.none': 'Ninguno',
    'nightSummary.viewDashboard': 'Ver dashboard',
    'nightSummary.teamSign': '— Yuno Analytics',
    
    // Owner weekly report
    'weeklyReport.subject': '📈 Informe semanal — {venueName}',
    'weeklyReport.title': 'Rendimiento semanal',
    'weeklyReport.period': 'Período',
    'weeklyReport.totalRevenue': 'Ingresos totales',
    'weeklyReport.totalOrders': 'Pedidos totales',
    'weeklyReport.totalTickets': 'Entradas vendidas',
    'weeklyReport.totalTables': 'Mesas reservadas',
    'weeklyReport.topEvent': 'Mejor evento',
    'weeklyReport.newCustomers': 'Nuevos clientes',
    'weeklyReport.viewDashboard': 'Ver dashboard',
    'weeklyReport.teamSign': '— Yuno Analytics',
    
    // Invoice
    'invoice.sectionTitle': '🧾 Tu factura',
    'invoice.description': 'Descarga la factura de esta compra.',
    'invoice.downloadCta': 'Descargar factura',
  },
  
  fr: {
    // General
    'email.poweredBy': 'Propulsé par',
    'email.yourNightlifeCompanion': 'Ton compagnon de soirée',
    'email.downloadApp': 'Télécharger l\'app',
    'email.viewInApp': 'Voir dans Yuno',
    'email.needHelp': 'Besoin d\'aide ?',
    'email.contactUs': 'Contacte-nous',
    'email.unsubscribe': 'Se désabonner',
    'email.allRightsReserved': 'Tous droits réservés',
    
    // Order confirmation
    'order.confirmed': 'Commande confirmée ! 🎉',
    'order.greeting': 'Salut',
    'order.orderConfirmed': 'Ta commande a été confirmée et est en préparation chez',
    'order.address': 'Adresse',
    'order.orderDetails': 'Détails de la commande',
    'order.article': 'Article',
    'order.qty': 'Qté',
    'order.price': 'Prix',
    'order.total': 'Total',
    'order.yourQRCode': 'Ton QR Code',
    'order.orderNumber': 'Commande #',
    'order.howToCollect': '📋 Comment récupérer ta commande',
    'order.step1Title': 'Attends la notification :',
    'order.step1Desc': 'Tu seras notifié quand ta commande est prête.',
    'order.step2Title': 'Va au bar :',
    'order.step2Desc': 'Dirige-toi vers le point de retrait de',
    'order.step3Title': 'Montre ton QR code :',
    'order.step3Desc': 'Présente ce QR code au staff.',
    'order.step4Title': 'Profite !',
    'order.step4Desc': 'Récupère ta commande et enjoy ! 🍹',
    'order.tip': '💡 Astuce :',
    'order.tipContent': 'Garde cet email ou fais une capture d\'écran de ton QR code pour un accès rapide !',
    'order.thanks': 'Merci pour ta commande ! 🙏',
    
    // Ticket confirmation
    'ticket.confirmedSubject': '🎟️ Billet confirmé - {eventTitle}',
    'ticket.confirmedTitle': 'Billet confirmé ! 🎉',
    'ticket.greeting': 'Salut',
    'ticket.body': 'Ton billet pour <strong>{eventTitle}</strong> chez <strong>{venueName}</strong> est confirmé.',
    'ticket.eventDate': 'Date',
    'ticket.ticketType': 'Type de billet',
    'ticket.quantity': 'Quantité',
    'ticket.totalPrice': 'Total payé',
    'ticket.yourQRCode': 'Ton QR Code',
    'ticket.reference': 'Référence',
    'ticket.showAtEntry': 'Montre ce QR code à l\'entrée pour accéder à l\'événement.',
    'ticket.howToEnter': '📋 Comment entrer',
    'ticket.enterStep1Title': 'Sauvegarde ton billet :',
    'ticket.enterStep1Desc': 'Garde cet email ou fais une capture de ton QR code.',
    'ticket.enterStep2Title': 'Rends-toi sur place :',
    'ticket.enterStep2Desc': 'Dirige-toi vers l\'entrée de',
    'ticket.enterStep3Title': 'Montre ton QR code :',
    'ticket.enterStep3Desc': 'Présente-le au videur pour qu\'il le scanne.',
    'ticket.enterStep4Title': 'Profite de ta soirée !',
    'ticket.enterStep4Desc': 'T\'es dedans ! Passe une soirée de folie 🎶',
    'ticket.guestClaimTitle': 'Retrouve ton billet',
    'ticket.guestClaimDesc': 'Accède à ton billet à tout moment avec ta référence et ton nom.',
    'ticket.guestClaimCta': 'Retrouver mon billet',
    'vip.guestClaimTitle': 'Retrouve ta réservation',
    'vip.guestClaimDesc': 'Accède à ta table VIP à tout moment avec ta référence et ton nom.',
    'vip.guestClaimCta': 'Retrouver ma réservation',
    'ticket.guestFinalize': 'Crée un compte pour sauvegarder tes billets et gagner des points fidélité.',
    'ticket.guestFinalizeCta': 'Créer mon compte',
    'ticket.thanks': 'On se retrouve là-bas ! 🎉',
    'ticket.teamSign': '— L\'équipe Yuno',
    
    // Post-visit notification
    'postVisit.thanks': 'Merci pour ta visite',
    'postVisit.pointsEarnedToday': 'Points Gagnés Aujourd\'hui',
    'postVisit.fromSpent': 'Sur €{amount} dépensés',
    'postVisit.yourBalance': 'Ton Solde',
    'postVisit.points': 'points',
    'postVisit.yourTier': 'Ton Statut',
    'postVisit.member': 'membre',
    'postVisit.spendMore': 'Dépense encore €{amount} pour atteindre',
    'postVisit.almostThere': 'Tu y es presque pour',
    'postVisit.redeemPoints': 'Échange tes points contre des récompenses exclusives !',
    'postVisit.viewRewards': 'Voir Mes Récompenses',
    'postVisit.seeYouNext': 'À bientôt chez',
    
    // Auth emails
    'auth.welcome': 'Bienvenue',
    'auth.confirmEmail': 'Confirme ton email',
    'auth.thanksForSignup': 'Merci de t\'être inscrit sur Yuno.',
    'auth.clickToConfirm': 'Pour confirmer ton adresse email et activer ton compte, clique sur le bouton ci-dessous :',
    'auth.confirmButton': 'Confirmer mon email →',
    'auth.buttonNotWork': 'Si le bouton ne fonctionne pas, copie et colle ce lien dans ton navigateur :',
    'auth.ignoreIfNotYou': 'Si tu n\'as pas créé de compte, tu peux ignorer cet email.',
    'auth.passwordReset': 'Réinitialisation du mot de passe',
    'auth.passwordResetRequest': 'Tu as demandé à réinitialiser ton mot de passe.',
    'auth.clickToReset': 'Clique sur le bouton ci-dessous pour créer un nouveau mot de passe :',
    'auth.resetButton': 'Réinitialiser mon mot de passe →',
    'auth.ignoreIfNotRequested': 'Si tu n\'as pas demandé cette réinitialisation, tu peux ignorer cet email.',
    
    // Event recap
    'recap.subject': 'Ta soirée chez {venueName} 🌙',
    
    // Waitlist / Private List
    'waitlist.confirmationSubject': '✅ Tu es inscrit(e) - {eventTitle}',
    'waitlist.confirmationTitle': 'Inscription confirmée !',
    'waitlist.confirmationGreeting': 'Bonjour {name},',
    'waitlist.confirmationBody': 'Tu es bien inscrit(e) à la Liste Privée pour <strong>{eventTitle}</strong> par {venueName}.',
    'waitlist.confirmationNote': 'On t\'enverra un email dès que la billetterie sera ouverte.',
    'waitlist.openingSubject': '🎉 La billetterie est ouverte - {eventTitle}',
    'waitlist.openingTitle': 'La billetterie est ouverte !',
    'waitlist.openingBody': 'Les billets pour <strong>{eventTitle}</strong> sont maintenant disponibles.',
    'waitlist.openingPriority': 'En tant que membre de la Liste Privée, tu as un accès prioritaire !',
    'waitlist.buyTickets': 'Acheter mes billets',
    'waitlist.teamSign': '— L\'équipe Yuno',
    
    // Event update
    'eventUpdate.subject': '⚠️ Événement mis à jour - {eventTitle}',
    'eventUpdate.title': 'Mise à jour de l\'événement',
    'eventUpdate.greeting': 'Salut{name},',
    'eventUpdate.body': 'L\'événement <strong>{eventTitle}</strong> chez <strong>{venueName}</strong> a été mis à jour.',
    'eventUpdate.whatChanged': 'Ce qui a changé :',
    'eventUpdate.viewEvent': 'Voir l\'événement',
    'eventUpdate.teamSign': '— L\'équipe Yuno',
    'eventUpdate.timeChanged': '🕐 Horaire modifié',
    'eventUpdate.djChanged': '🎧 Lineup DJ modifié',
    'eventUpdate.detailsChanged': '📝 Détails mis à jour',
    'eventUpdate.from': 'Avant',
    'eventUpdate.to': 'Après',
    
    // Refund
    'refund.subject': '💸 Remboursement confirmé - {amount}€',
    'refund.title': 'Remboursement confirmé',
    'refund.body': '<strong>{venueName}</strong> a procédé à ton remboursement.',
    'refund.amount': 'Montant remboursé',
    'refund.event': 'Événement',
    'refund.reason': 'Raison',
    'refund.itemType': 'Article',
    'refund.delay': 'Le remboursement apparaîtra sur ton compte sous 5 à 10 jours ouvrés. Les frais de service Yuno ne sont pas remboursables.',
    'refund.typeOrder': 'Commande de boissons',
    'refund.typeTicket': 'Billet',
    'refund.typeTable': 'Table VIP',
    
    // VIP confirmation
    'vip.requestReceivedSubject': '✅ Demande VIP reçue - {eventTitle}',
    'vip.requestReceivedTitle': 'Demande reçue !',
    'vip.requestReceivedBody': 'Ta demande de table VIP pour <strong>{eventTitle}</strong> chez <strong>{venueName}</strong> a bien été reçue.',
    'vip.requestReceivedNote': 'Nous confirmerons ton placement très bientôt.',
    'vip.confirmedSubject': '🎉 Table VIP confirmée - {eventTitle}',
    'vip.confirmedTitle': 'Table confirmée !',
    'vip.confirmedBody': 'Ta table VIP pour <strong>{eventTitle}</strong> chez <strong>{venueName}</strong> est confirmée.',
    'vip.zone': 'Zone',
    'vip.minimumSpend': 'Minimum de consommation',
    'vip.modifiedSubject': '⚠️ Table VIP modifiée - {eventTitle}',
    'vip.modifiedTitle': 'Table modifiée',
    'vip.modifiedBody': 'Ta réservation de table VIP pour <strong>{eventTitle}</strong> a été modifiée.',
    'vip.refusedSubject': '❌ Demande VIP refusée - {eventTitle}',
    'vip.refusedTitle': 'Demande refusée',
    'vip.refusedBody': 'Malheureusement, ta demande de table VIP pour <strong>{eventTitle}</strong> chez <strong>{venueName}</strong> n\'a pas pu être confirmée.',
    'vip.refusedNote': 'N\'hésite pas à contacter le club pour plus d\'informations.',
    'vip.viewReservation': 'Voir ma réservation',
    'vip.teamSign': '— L\'équipe Yuno',
    
    // Upsell
    'upsell.subject': '🔥 Améliore ta soirée à {eventTitle}',
    'upsell.title': 'Rends ta soirée encore meilleure',
    'upsell.greeting': 'Salut{name},',
    'upsell.body': 'Ton billet pour <strong>{eventTitle}</strong> chez <strong>{venueName}</strong> est confirmé ! Envie de passer au niveau supérieur ?',
    'upsell.upgradeVip': '🥂 Passe en VIP',
    'upsell.upgradeVipDesc': 'Coupe-file, table réservée et service premium.',
    'upsell.preorderDrinks': '🍸 Pré-commande tes boissons',
    'upsell.preorderDrinksDesc': 'Gagne du temps au bar — commande maintenant et récupère en arrivant.',
    'upsell.ctaVip': 'Réserver une table VIP',
    'upsell.ctaDrinks': 'Commander des boissons',
    'upsell.teamSign': '— L\'équipe Yuno',
    
    // Low ticket
    'lowTicket.subject': '🔥 Presque sold out — {eventTitle}',
    'lowTicket.title': 'Ça part vite !',
    'lowTicket.body': '<strong>{eventTitle}</strong> chez <strong>{venueName}</strong> est presque complet. Plus que <strong>{remaining}</strong> billets !',
    'lowTicket.cta': 'Prendre mon billet',
    'lowTicket.teamSign': '— L\'équipe Yuno',
    'lowTicket.ownerSubject': '📊 Alerte billets — {eventTitle}',
    'lowTicket.ownerBody': '<strong>{eventTitle}</strong> a <strong>{sold}/{total}</strong> billets vendus ({percent}%). Presque complet !',
    
    // Pre-night checklist
    'checklist.subject': '🎉 Ce soir : {eventTitle}',
    'checklist.title': 'Tu sors ce soir !',
    'checklist.greeting': 'Salut{name},',
    'checklist.body': 'Prépare-toi pour <strong>{eventTitle}</strong> chez <strong>{venueName}</strong>.',
    'checklist.qrTitle': 'Ton QR Code',
    'checklist.qrNote': 'Montre-le à l\'entrée',
    'checklist.doorsOpen': 'Ouverture des portes',
    'checklist.address': 'Adresse',
    'checklist.dressCode': 'Dress code',
    'checklist.viewEvent': 'Voir l\'événement',
    'checklist.teamSign': '— L\'équipe Yuno',
    
    // Next event recommendation
    'nextEvent.subject': '🎶 Ta prochaine sortie',
    'nextEvent.title': 'Événements pour toi',
    'nextEvent.body': 'D\'après tes soirées passées, on pense que tu vas adorer ces événements.',
    'nextEvent.on': 'le',
    'nextEvent.at': 'chez',
    'nextEvent.getTickets': 'Prendre mes billets',
    'nextEvent.teamSign': '— L\'équipe Yuno',
    
    // Missed you
    'missed.subject': '😢 Tu as raté {eventTitle}',
    'missed.title': 'Tu l\'as raté !',
    'missed.body': '<strong>{eventTitle}</strong> chez <strong>{venueName}</strong> était incroyable. Voilà ce qui s\'est passé :',
    'missed.attendees': 'participants',
    'missed.nextEvent': 'Prochain événement',
    'missed.cta': 'Ne rate pas le prochain',
    'missed.teamSign': '— L\'équipe Yuno',
    
    // Owner night summary
    'nightSummary.subject': '📊 Bilan de soirée — {eventTitle}',
    'nightSummary.title': 'Bilan de soirée',
    'nightSummary.revenue': 'Chiffre d\'affaires',
    'nightSummary.orders': 'Commandes',
    'nightSummary.tickets': 'Billets vendus',
    'nightSummary.tables': 'Tables VIP',
    'nightSummary.topProducts': 'Top produits',
    'nightSummary.incidents': 'Incidents',
    'nightSummary.none': 'Aucun',
    'nightSummary.viewDashboard': 'Voir le dashboard',
    'nightSummary.teamSign': '— Yuno Analytics',
    
    // Owner weekly report
    'weeklyReport.subject': '📈 Rapport hebdo — {venueName}',
    'weeklyReport.title': 'Performance hebdomadaire',
    'weeklyReport.period': 'Période',
    'weeklyReport.totalRevenue': 'CA total',
    'weeklyReport.totalOrders': 'Commandes totales',
    'weeklyReport.totalTickets': 'Billets vendus',
    'weeklyReport.totalTables': 'Tables réservées',
    'weeklyReport.topEvent': 'Meilleur événement',
    'weeklyReport.newCustomers': 'Nouveaux clients',
    'weeklyReport.viewDashboard': 'Voir le dashboard',
    'weeklyReport.teamSign': '— Yuno Analytics',
    
    // Invoice
    'invoice.sectionTitle': '🧾 Ta facture',
    'invoice.description': 'Télécharge la facture de cet achat.',
    'invoice.downloadCta': 'Télécharger la facture',
  }
};

/**
 * Get translation for a specific key and language
 */
export function t(key: string, lang: EmailLanguage = 'en', replacements?: Record<string, string | number>): string {
  let text = emailTranslations[lang]?.[key] || emailTranslations['en'][key] || key;
  
  if (replacements) {
    Object.entries(replacements).forEach(([k, v]) => {
      text = text.replace(new RegExp(`\\{${k}\\}`, 'g'), String(v));
    });
  }
  
  return text;
}

/**
 * Generate Yuno branded email header with subtle but recognizable branding
 */
export function generateYunoBrandHeader(lang: EmailLanguage = 'en'): string {
  return `
    <!-- Yuno Brand Header - Subtle but Present -->
    <table width="100%" cellpadding="0" cellspacing="0" style="margin-bottom: 4px;">
      <tr>
        <td style="text-align: center; padding: 16px 0 8px;">
          <table cellpadding="0" cellspacing="0" style="margin: 0 auto;">
            <tr>
              <td style="vertical-align: middle;">
                <div style="width: 32px; height: 32px; background: linear-gradient(135deg, #dc2626 0%, #b91c1c 100%); border-radius: 8px; display: inline-block; text-align: center; line-height: 32px;">
                  <span style="color: #fff; font-weight: 800; font-size: 14px;">Y</span>
                </div>
              </td>
              <td style="vertical-align: middle; padding-left: 10px;">
                <span style="color: #666; font-size: 11px; text-transform: uppercase; letter-spacing: 1.5px;">${t('email.poweredBy', lang)}</span>
                <span style="color: #dc2626; font-weight: 700; font-size: 13px; margin-left: 4px;">YUNO</span>
              </td>
            </tr>
          </table>
        </td>
      </tr>
    </table>
  `;
}

/**
 * Generate Yuno branded email footer with call to action
 */
export function generateYunoBrandFooter(lang: EmailLanguage = 'en', venueName?: string): string {
  const year = new Date().getFullYear();
  
  return `
    <!-- Yuno Brand Footer -->
    <table width="100%" cellpadding="0" cellspacing="0" style="margin-top: 32px; border-top: 1px solid rgba(255,255,255,0.08); padding-top: 24px;">
      <tr>
        <td style="text-align: center;">
          <!-- Yuno Value Proposition -->
          <table cellpadding="0" cellspacing="0" style="margin: 0 auto 20px;">
            <tr>
              <td style="text-align: center;">
                <div style="width: 40px; height: 40px; background: linear-gradient(135deg, #dc2626 0%, #b91c1c 100%); border-radius: 10px; margin: 0 auto 12px; text-align: center; line-height: 40px;">
                  <span style="color: #fff; font-weight: 800; font-size: 18px;">Y</span>
                </div>
                <p style="color: #fff; font-weight: 600; font-size: 14px; margin: 0 0 4px;">YUNO</p>
                <p style="color: #888; font-size: 12px; margin: 0;">${t('email.yourNightlifeCompanion', lang)}</p>
              </td>
            </tr>
          </table>
          
          <!-- App Link -->
          <table cellpadding="0" cellspacing="0" style="margin: 0 auto 20px;">
            <tr>
              <td>
                <a href="https://yunoapp.eu" 
                   style="display: inline-block; background: rgba(220, 38, 38, 0.1); border: 1px solid rgba(220, 38, 38, 0.3); color: #dc2626; text-decoration: none; padding: 10px 24px; border-radius: 8px; font-weight: 500; font-size: 13px;">
                  ${t('email.viewInApp', lang)}
                </a>
              </td>
            </tr>
          </table>
          
          <!-- Copyright -->
          <p style="color: #555; font-size: 11px; margin: 0;">
            © ${year} Yuno. ${t('email.allRightsReserved', lang)}.
          </p>
          ${venueName ? `<p style="color: #444; font-size: 10px; margin: 8px 0 0;">Email envoyé via Yuno pour ${venueName}</p>` : ''}
        </td>
      </tr>
    </table>
  `;
}

/**
 * Generate the full email wrapper with Yuno branding
 */
export function wrapEmailWithBranding(content: string, lang: EmailLanguage = 'en', venueName?: string): string {
  return `
    <!DOCTYPE html>
    <html xmlns="http://www.w3.org/1999/xhtml" lang="${lang}" xml:lang="${lang}">
    <head>
      <meta charset="utf-8">
      <meta name="viewport" content="width=device-width, initial-scale=1.0">
      <meta name="color-scheme" content="dark only">
      <meta name="supported-color-schemes" content="dark only">
      <title>Yuno</title>
      <style>
        :root { color-scheme: dark only; supported-color-schemes: dark only; }
        body, .body-wrapper { background-color: #050505 !important; color: #ffffff !important; }
        .dark-bg { background-color: #0a0a0a !important; }
        .dark-outer { background-color: #050505 !important; }
        u + .body-wrapper, #MessageViewBody .body-wrapper { background-color: #050505 !important; }
        @media (prefers-color-scheme: light) {
          body, .body-wrapper, .dark-outer { background-color: #050505 !important; }
          .dark-bg { background-color: #0a0a0a !important; }
          h1, h2, h3, p, span, td { color: #ffffff !important; }
        }
      </style>
    </head>
    <body class="body-wrapper" style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; margin: 0; padding: 20px; background-color: #050505; color: #ffffff;">
      <div class="body-wrapper" style="background-color: #050505;">
      <table width="100%" cellpadding="0" cellspacing="0" class="dark-outer" style="max-width: 600px; margin: 0 auto; background-color: #050505;">
        <tr>
          <td class="dark-outer" style="background-color: #050505;">
            ${generateYunoBrandHeader(lang)}
            
            <!-- Main Content -->
            <table width="100%" cellpadding="0" cellspacing="0">
              <tr>
                <td class="dark-bg" style="background-color: #0a0a0a; border-radius: 16px; overflow: hidden; border: 1px solid rgba(255,255,255,0.05);">
                  ${content}
                </td>
              </tr>
            </table>
            
            ${generateYunoBrandFooter(lang, venueName)}
          </td>
        </tr>
      </table>
      </div>
    </body>
    </html>
  `;
}

/**
 * Escape HTML to prevent injection attacks
 */
export function escapeHtml(str: string | undefined | null): string {
  if (!str) return '';
  return str
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;');
}
