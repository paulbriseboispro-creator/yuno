// Forme de la réponse du chemin Stripe de create-table-checkout. Le front garde `receiptToken` sous
// `reservationId` (localStorage) : sans `reservationId`, l'acheteur sans compte ne revoit jamais son QR.
export function stripeCheckoutResponseBody(args: {
  reservationId: string;
  sessionId: string;
  url: string | null;
  receiptToken: string;
}) {
  return {
    success: true,
    reservationId: args.reservationId,
    sessionId: args.sessionId,
    url: args.url,
    receiptToken: args.receiptToken,
  };
}
