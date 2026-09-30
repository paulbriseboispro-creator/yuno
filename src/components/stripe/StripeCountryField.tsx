import { useId } from 'react';
import { AlertCircle, Globe } from 'lucide-react';
import { useLanguage } from '@/contexts/LanguageContext';
import { translate } from '@/i18n/orgTranslate';
import { DarkSelect, T2, T3 } from '@/components/org-ui';
import type { ConnectCountryChoice } from '@/hooks/useConnectCountry';
import {
  OTHER_CONNECT_COUNTRY,
  connectCountryName,
  connectCountryOptions,
  isSupportedConnectCountry,
} from '@/lib/stripeConnectCountry';

type Audience = 'business' | 'dj';

/**
 * « Pays d'immatriculation », posé AVANT « Activer les paiements » sur les cinq
 * écrans qui ouvrent un compte Stripe (Paiements club et organisateur, les deux
 * guides de configuration, Bookings du DJ). Le pays ne se change plus chez
 * Stripe une fois le compte ouvert : l'écran le dit, et un pays que Yuno ne
 * prend pas en charge (Maroc…) est expliqué au lieu d'être tenté.
 */
export function StripeCountryField({ choice, audience = 'business' }: { choice: ConnectCountryChoice; audience?: Audience }) {
  const { language } = useLanguage();
  const t = (fr: string, en: string, es: string) => translate(language, fr, en, es);
  const id = useId();
  const dj = audience === 'dj';
  const supported = isSupportedConnectCountry(choice.country);
  const options = connectCountryOptions(language, choice.country);

  const prefilledFrom = choice.touched ? null
    : choice.source === 'profile' ? t('Prérempli d\'après ton profil.', 'Prefilled from your profile.', 'Rellenado según tu perfil.')
    : choice.source === 'place' ? (dj
      ? t('Prérempli d\'après ta ville.', 'Prefilled from your city.', 'Rellenado según tu ciudad.')
      : t('Prérempli d\'après votre ville ou votre adresse.', 'Prefilled from your city or address.', 'Rellenado según tu ciudad o dirección.'))
    : choice.source === 'device' ? (dj
      ? t('Prérempli d\'après le fuseau horaire de ton appareil.', 'Prefilled from your device\'s time zone.', 'Rellenado según la zona horaria de tu dispositivo.')
      : t('Prérempli d\'après le fuseau horaire de cet appareil.', 'Prefilled from this device\'s time zone.', 'Rellenado según la zona horaria de este dispositivo.'))
    : null;

  return (
    <div className="space-y-2">
      <label htmlFor={id} className="flex items-center gap-1.5" style={{ color: T2, fontSize: 12, fontWeight: 600 }}>
        <Globe className="h-3.5 w-3.5" style={{ color: T3 }} />
        {dj
          ? t('Ton pays de résidence', 'Your country of residence', 'Tu país de residencia')
          : t('Pays d\'immatriculation', 'Country of registration', 'País de registro')}
      </label>
      <DarkSelect id={id} value={choice.country} onChange={choice.setCountry}>
        {options.map((o) => (
          <option key={o.code} value={o.code} style={{ background: 'var(--sf-0a0a0c)' }}>
            {o.supported ? o.name : `${o.name} (${t('non pris en charge', 'not available', 'no disponible')})`}
          </option>
        ))}
        <option value={OTHER_CONNECT_COUNTRY} style={{ background: 'var(--sf-0a0a0c)' }}>
          {t('Autre pays…', 'Other country…', 'Otro país…')}
        </option>
      </DarkSelect>

      {supported ? (
        <p style={{ color: T3, fontSize: 11.5, lineHeight: 1.5 }}>
          {prefilledFrom && <>{prefilledFrom} </>}
          {dj
            ? t(
              'Stripe te demandera une identité, une adresse et un compte bancaire de ce pays.',
              'Stripe will ask for an ID, an address and a bank account from this country.',
              'Stripe te pedirá una identidad, una dirección y una cuenta bancaria de este país.',
            )
            : t(
              'Le pays où votre structure est immatriculée, ou celui où vous résidez si vous vendez en votre nom. Stripe vous demandera une identité, une adresse et un compte bancaire de ce pays.',
              'The country where your business is registered, or where you live if you sell in your own name. Stripe will ask for an ID, an address and a bank account from this country.',
              'El país donde está registrada tu estructura, o donde resides si vendes a tu nombre. Stripe te pedirá una identidad, una dirección y una cuenta bancaria de este país.',
            )}{' '}
          <strong style={{ color: T2, fontWeight: 600 }}>
            {t(
              'Ce choix est définitif : il ne pourra plus être changé.',
              'This is final: it can\'t be changed later.',
              'Esta elección es definitiva: no se podrá cambiar después.',
            )}
          </strong>
        </p>
      ) : (
        <div
          role="alert"
          className="flex items-start gap-2 rounded-xl p-3"
          style={{ background: 'rgba(252,211,77,0.07)', border: '1px solid rgba(252,211,77,0.22)' }}
        >
          <AlertCircle className="mt-0.5 h-4 w-4 shrink-0" style={{ color: 'var(--acc-fcd34d)' }} />
          <div className="space-y-1">
            <p style={{ color: T2, fontSize: 12.5, fontWeight: 600 }}>
              {t('Paiements en ligne indisponibles', 'Online payments unavailable', 'Pagos online no disponibles')}
              {choice.country !== OTHER_CONNECT_COUNTRY && ` · ${connectCountryName(choice.country, language)}`}
            </p>
            <p style={{ color: T3, fontSize: 12, lineHeight: 1.5 }}>
              {dj
                ? t(
                  'Yuno n\'ouvre de compte de paiement Stripe qu\'aux personnes qui résident dans l\'Union européenne, l\'Espace économique européen, au Royaume-Uni ou en Suisse. Tu peux quand même être booké : le club te règle alors en dehors de Yuno.',
                  'Yuno only opens Stripe payment accounts for people living in the European Union, the European Economic Area, the United Kingdom or Switzerland. You can still be booked: the club then pays you outside Yuno.',
                  'Yuno solo abre cuentas de pago Stripe para personas que residen en la Unión Europea, el Espacio Económico Europeo, el Reino Unido o Suiza. Puedes seguir recibiendo bookings: el club te paga entonces fuera de Yuno.',
                )
                : t(
                  'Yuno n\'ouvre de compte de paiement Stripe qu\'aux structures immatriculées dans l\'Union européenne, l\'Espace économique européen, au Royaume-Uni ou en Suisse. Yuno reste utilisable sans paiement en ligne : guest list, tables réglées sur place, scan à la porte. Si votre structure est aussi immatriculée dans l\'un de ces pays, choisissez-le.',
                  'Yuno only opens Stripe payment accounts for businesses registered in the European Union, the European Economic Area, the United Kingdom or Switzerland. You can still use Yuno without online payments: guest list, tables paid on site, door scanning. If your business is also registered in one of these countries, pick it.',
                  'Yuno solo abre cuentas de pago Stripe para estructuras registradas en la Unión Europea, el Espacio Económico Europeo, el Reino Unido o Suiza. Puedes seguir usando Yuno sin pagos online: guest list, mesas pagadas en el local, escaneo en la puerta. Si tu estructura también está registrada en uno de estos países, elígelo.',
                )}
            </p>
          </div>
        </div>
      )}
    </div>
  );
}

/** « Pays du compte Stripe : Espagne », une fois le compte ouvert (il ne change plus). */
export function StripeAccountCountry({ country }: { country: string | null | undefined }) {
  const { language } = useLanguage();
  if (!country) return null;
  return (
    <p className="flex items-center gap-1.5" style={{ color: T3, fontSize: 11.5 }}>
      <Globe className="h-3.5 w-3.5 shrink-0" />
      {translate(language, 'Pays du compte Stripe : ', 'Stripe account country: ', 'País de la cuenta Stripe: ')}
      {connectCountryName(country, language)}
    </p>
  );
}
