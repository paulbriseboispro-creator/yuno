import { useLocation, useNavigate } from 'react-router-dom';
import { LogIn, UserCheck } from 'lucide-react';
import { useLanguage } from '@/contexts/LanguageContext';

interface ExistingAccountNoticeProps {
  /** L'email reconnu — affiché tel quel, c'est la preuve de ce qu'on avance. */
  email: string;
  /**
   * Où revenir une fois connecté. Par défaut : l'URL courante. Les parcours qui
   * doivent rattacher un achat au compte passent leur propre retour (ex. la
   * guest list ajoute `?link=<entryId>`).
   */
  redirectTo?: string;
  /**
   * `hint` : encart discret sous un champ email — l'achat continue sans compte.
   * `panel` : bloc qui REMPLACE le formulaire de création de compte.
   */
  variant?: 'hint' | 'panel';
  /** Phrase adaptée à la surface (une place de guest list ≠ un billet payé). */
  description?: string;
  className?: string;
}

/**
 * « Un compte existe déjà avec cet email. » — dit au moment où l'email est
 * saisi, pas après un mot de passe choisi pour rien.
 *
 * En `hint`, ce n'est qu'une information : personne n'est empêché d'acheter
 * ni de s'inscrire en invité. En `panel`, la création de compte est refusée
 * (elle échouerait de toute façon) et la connexion prend sa place.
 */
export function ExistingAccountNotice({
  email,
  redirectTo,
  variant = 'hint',
  description,
  className,
}: ExistingAccountNoticeProps) {
  const navigate = useNavigate();
  const location = useLocation();
  const { t } = useLanguage();

  const goToLogin = () => {
    const back = redirectTo || `${location.pathname}${location.search}`;
    navigate(`/auth?redirect=${encodeURIComponent(back)}`);
  };

  const isPanel = variant === 'panel';
  const body = description || (isPanel ? t('guest.accountExistsCreateBlocked') : t('guest.accountExistsHint'));

  return (
    <div
      className={className}
      style={{
        border: '1px solid rgba(232,25,44,0.22)',
        background: 'rgba(232,25,44,0.06)',
        borderRadius: 10,
        padding: isPanel ? 20 : 14,
      }}
    >
      <div className="flex items-start gap-3">
        <span
          className="flex items-center justify-center flex-shrink-0"
          style={{ width: 30, height: 30, borderRadius: 8, background: 'rgba(232,25,44,0.12)' }}
        >
          <UserCheck style={{ width: 15, height: 15, color: '#E8192C' }} />
        </span>
        <div className="min-w-0">
          <p
            className="font-display font-bold"
            style={{ fontSize: isPanel ? '16px' : '13.5px', color: '#fff', letterSpacing: '-0.01em', lineHeight: 1.2 }}
          >
            {t('guest.accountExists')}
          </p>
          <p className="font-sans" style={{ fontSize: '12.5px', color: '#B9B9BD', marginTop: 5, lineHeight: 1.45 }}>
            {body}
          </p>
          <p
            className="font-mono uppercase truncate"
            style={{ fontSize: '10px', color: '#8A8A8E', letterSpacing: '0.06em', marginTop: 6 }}
          >
            {email}
          </p>
        </div>
      </div>

      <button
        type="button"
        onClick={goToLogin}
        className="w-full flex items-center justify-center gap-2 font-sans font-semibold transition-colors"
        style={{
          marginTop: 14,
          minHeight: isPanel ? 46 : 40,
          borderRadius: 8,
          background: isPanel ? '#E8192C' : 'transparent',
          border: isPanel ? '1px solid #E8192C' : '1px solid rgba(232,25,44,0.45)',
          color: isPanel ? '#fff' : '#E8192C',
          fontSize: '13.5px',
        }}
      >
        <LogIn style={{ width: 15, height: 15 }} />
        {t('guest.logIn')}
      </button>
    </div>
  );
}
