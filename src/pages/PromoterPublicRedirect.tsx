import { lazy } from 'react';

// No redirect — render PromoterHub directly at /promoteur/:promoCode
const PromoterHub = lazy(() => import('./PromoterHub'));

export default function PromoterPublicRedirect() {
  return <PromoterHub />;
}
