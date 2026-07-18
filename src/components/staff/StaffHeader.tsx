/**
 * Header partagé des dashboards staff (bar, porte, vestiaire, VIP).
 *
 * Les quatre écrans dupliquaient le même bloc de header à la main, et affichaient
 * un titre de poste statique — « Vestiaire », « Scanner d'Entrées ». Rien qui
 * dise à la personne que c'est SON compte, dans SON club.
 *
 * Ce header dit trois choses en un coup d'œil, dans le noir, à bout de bras :
 *   1. à qui appartient l'écran (avatar/emoji + salutation + nom)
 *   2. quel poste, dans quel club (deuxième ligne)
 *   3. l'accent de couleur choisi par la personne, repris sur tout l'écran
 *
 * Tapoter l'identité ouvre « Mon compte » (/staff/me).
 */

import { useMemo } from 'react';
import { useNavigate } from 'react-router-dom';
import { useLanguage } from '@/contexts/LanguageContext';
import { ProBackButton } from '@/components/pro/ProBackButton';
import { useStaffIdentity } from '@/hooks/useStaffIdentity';
import {
  accentTokens,
  greetingKey,
  staffInitials,
  STAFF_ROLE_DEFS,
  type StaffRole,
} from '@/lib/staffIdentity';

const T1     = 'rgba(255,255,255,0.96)';
const T3     = 'rgba(255,255,255,0.48)';
const BORDER = 'rgba(255,255,255,0.085)';

interface StaffHeaderProps {
  /** Rôle de l'écran courant — un barman qui est aussi videur voit « Barman » ici. */
  role: StaffRole;
  /** Actions à droite (stock, langue, rafraîchir…). */
  actions?: React.ReactNode;
  /**
   * Pastille d'état à côté du nom. `undefined` = pas de pastille.
   * `true` = connecté (vert), `false` = connexion dégradée (accent).
   */
  online?: boolean;
  /** Ligne de contexte qui remplace « poste · club » (ex. titre de l'événement en cours). */
  subtitle?: string;
  /** Classe du bouton retour — les écrans divergeaient sur la taille de cible tactile. */
  backButtonClassName?: string;
}

export function StaffHeader({
  role,
  actions,
  online,
  subtitle,
  backButtonClassName = 'h-11 w-11 flex-none sm:h-9 sm:w-9',
}: StaffHeaderProps) {
  const { t } = useLanguage();
  const navigate = useNavigate();
  const { identity } = useStaffIdentity();

  const def = STAFF_ROLE_DEFS[role];
  const Icon = def.icon;
  const accent = accentTokens(identity?.accent, role);

  // La salutation est calculée au montage : ces écrans restent ouverts toute la
  // nuit, on ne veut pas qu'un re-render la fasse basculer en plein service.
  const greeting = useMemo(() => t(greetingKey()), [t]);

  const name = identity?.name ?? '';
  const roleLabel = identity?.title?.trim() || t(def.labelKey);
  const contextLine = subtitle ?? [roleLabel, identity?.venueName].filter(Boolean).join(' · ');

  return (
    <header
      className="sticky top-0 z-40 backdrop-blur-xl"
      style={{
        background: 'rgba(10,10,12,0.72)',
        borderBottom: `1px solid ${BORDER}`,
        paddingTop: 'env(safe-area-inset-top, 0px)',
      }}
    >
      {/* Halo à l'accent de la personne — la seule touche de couleur du header */}
      <div
        className="pointer-events-none absolute -top-10 left-16 h-24 w-40 rounded-full"
        style={{ background: accent.glow, filter: 'blur(48px)' }}
      />

      <div className="relative mx-auto flex h-14 max-w-7xl items-center justify-between gap-2 px-3 sm:px-4">
        <div className="flex min-w-0 flex-1 items-center gap-1.5 sm:gap-2">
          <ProBackButton className={backButtonClassName} />

          <button
            type="button"
            onClick={() => navigate('/staff/me')}
            className="flex min-w-0 flex-1 items-center gap-2 rounded-xl text-left transition-opacity active:opacity-70"
            aria-label={t('staffid.openAccount')}
          >
            {/* Avatar : photo > emoji > icône du rôle */}
            <div
              className="flex h-9 w-9 flex-none items-center justify-center overflow-hidden rounded-xl"
              style={{ background: accent.soft, border: `1px solid ${accent.ring}` }}
            >
              {identity?.avatarUrl ? (
                <img
                  src={identity.avatarUrl}
                  alt=""
                  className="h-full w-full object-cover"
                  loading="lazy"
                />
              ) : identity?.emoji ? (
                <span style={{ fontSize: 17, lineHeight: 1 }}>{identity.emoji}</span>
              ) : name ? (
                <span style={{ color: accent.solid, fontSize: 12, fontWeight: 700, letterSpacing: '0.02em' }}>
                  {staffInitials(name)}
                </span>
              ) : (
                <Icon className="h-4 w-4" style={{ color: accent.solid }} />
              )}
            </div>

            <div className="min-w-0 flex-1">
              <div className="flex items-center gap-1.5">
                <span
                  className="min-w-0 truncate"
                  style={{ color: T1, fontSize: 14.5, fontWeight: 600, letterSpacing: '-0.01em' }}
                >
                  {name ? `${greeting}, ${name}` : t(def.labelKey)}
                </span>
                {online !== undefined && (
                  <span
                    className="inline-block h-1.5 w-1.5 flex-none rounded-full"
                    style={{ background: online ? 'rgb(52,211,153)' : accent.solid }}
                  />
                )}
              </div>
              {contextLine && (
                <p className="truncate" style={{ color: T3, fontSize: 10.5, marginTop: 1 }}>
                  {contextLine}
                </p>
              )}
            </div>
          </button>
        </div>

        {actions && <div className="flex flex-none items-center gap-1">{actions}</div>}
      </div>
    </header>
  );
}
