import { useState } from 'react';
import { Lock, Eye, EyeOff, Loader2, QrCode as QrCodeIcon, Sparkles, Bell } from 'lucide-react';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Button } from '@/components/ui/button';
import { useLanguage } from '@/contexts/LanguageContext';
import { useGuestSignup } from '@/hooks/useGuestSignup';
import { useExistingAccountCheck } from '@/hooks/useExistingAccountCheck';
import { ExistingAccountNotice } from '@/components/account/ExistingAccountNotice';

interface GuestAccountUnlockProps {
  /** Email porté par l'inscription — c'est lui, et lui seul, qui crée le compte. */
  email: string;
  /** Nom saisi à l'inscription, découpé en prénom / nom sur le profil créé. */
  fullName?: string;
  /** Inscription à rattacher au compte une fois créé. */
  entryId: string;
  /** Le vrai QR, montré flouté sous le cadenas : on verrouille, on ne cache pas. */
  qrImage?: string;
  /** Retour de connexion qui rattache l'inscription (`?link=<entryId>`). */
  relinkBackUrl: string;
  /** L'email de confirmation est-il réellement parti ? Décide de la phrase de secours. */
  emailSent?: boolean | null;
  onCreated: () => void;
}

/**
 * Le QR de la guest list, derrière un mot de passe.
 *
 * Une inscription guest list arrive par un lien privé, sans paiement et sans
 * compte : c'est le plus gros flux d'inconnus de Yuno, et jusqu'ici il repartait
 * inconnu. Le mot de passe est donc demandé AVANT le QR, pas proposé après —
 * c'est la seule marche du parcours où la contrepartie est évidente pour la
 * personne (son QR, ses places suivantes, son historique).
 *
 * Trois garde-fous pour que ce ne soit jamais un cul-de-sac :
 *   - le QR est AUSSI parti par email (la phrase le dit, et ne le dit que si le
 *     serveur a confirmé l'envoi) ;
 *   - un email qui a déjà un compte ne se voit pas demander un mot de passe que
 *     `auth.signUp` refuserait : la connexion prend la place, et `?link=`
 *     rattache l'inscription au retour ;
 *   - la place, elle, est acquise quoi qu'il arrive — rien ici ne la remet en jeu.
 */
export function GuestAccountUnlock({
  email,
  fullName,
  entryId,
  qrImage,
  relinkBackUrl,
  emailSent,
  onCreated,
}: GuestAccountUnlockProps) {
  const { t } = useLanguage();
  const { submitting, error, setError, signup } = useGuestSignup();
  const [password, setPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  // « Cet email a déjà un compte » se dit AVANT de choisir un mot de passe pour
  // rien — la réponse arrive pendant que la personne lit l'écran.
  const { exists: emailHasAccount } = useExistingAccountCheck(email, true);

  const perks: Array<{ Icon: typeof QrCodeIcon; label: string }> = [
    { Icon: QrCodeIcon, label: t('glconf.perkQr') },
    { Icon: Sparkles, label: t('glconf.perkLoyalty') },
    { Icon: Bell, label: t('glconf.perkAlerts') },
  ];

  const handleCreate = () => {
    if (!email || !entryId) return;
    const [firstName, ...rest] = (fullName || '').trim().split(' ');
    signup(
      {
        email,
        firstName: firstName || undefined,
        lastName: rest.join(' ') || undefined,
        purchaseId: entryId,
        purchaseType: 'guestlist',
        existingAccountRedirect: relinkBackUrl,
      },
      password,
      confirmPassword,
      onCreated,
    );
  };

  return (
    <div
      className="border border-white/[0.08] bg-[#141414] p-5"
      style={{ borderRadius: 12 }}
    >
      {/* ── Le QR, verrouillé ──────────────────────────────────────────────
          Il est là, sous le cadenas, flouté. Montrer la récompense au lieu de
          la cacher : la personne sait exactement ce que le mot de passe ouvre. */}
      <div
        role="img"
        aria-label={t('glgate.locked')}
        className="relative mx-auto overflow-hidden"
        style={{ width: 176, height: 176, borderRadius: 12, background: '#0A0A0A' }}
      >
        {qrImage ? (
          <img
            src={qrImage}
            alt=""
            aria-hidden="true"
            className="h-full w-full object-cover"
            style={{ filter: 'blur(10px) grayscale(1) brightness(0.55)', transform: 'scale(1.1)' }}
          />
        ) : (
          <div className="h-full w-full" style={{ background: 'rgba(255,255,255,0.04)' }} />
        )}
        <div className="absolute inset-0 flex flex-col items-center justify-center gap-2.5">
          <span
            className="flex items-center justify-center"
            style={{
              width: 46,
              height: 46,
              borderRadius: 999,
              background: 'rgba(232,25,44,0.16)',
              border: '1px solid rgba(232,25,44,0.45)',
            }}
          >
            <Lock style={{ width: 20, height: 20, color: '#E8192C' }} strokeWidth={2.2} />
          </span>
          <span
            className="font-mono uppercase text-center"
            style={{ fontSize: '9.5px', letterSpacing: '0.12em', color: '#E5E5E5' }}
          >
            {t('glgate.locked')}
          </span>
        </div>
      </div>

      <h3
        className="font-display font-bold text-center"
        style={{
          marginTop: 18,
          fontSize: 'clamp(19px, 4.6vw, 24px)',
          color: '#fff',
          letterSpacing: '-0.02em',
          lineHeight: 1.1,
        }}
      >
        {t('glgate.title')}
      </h3>
      <p
        className="font-sans text-center"
        style={{ marginTop: 8, fontSize: '13.5px', color: '#B9B9BD', lineHeight: 1.5 }}
      >
        {t('glgate.subtitle')}
      </p>

      {/* Email déjà pris : on ne demande PAS un mot de passe que `auth.signUp`
          refusera. La connexion prend toute la place, et `?link=` rattache
          l'inscription dès le retour. */}
      {emailHasAccount ? (
        <ExistingAccountNotice
          className="mt-5"
          variant="panel"
          email={email}
          redirectTo={relinkBackUrl}
          description={t('glconf.existingAccountDesc')}
        />
      ) : (
        <>
          <ul style={{ marginTop: 18, display: 'flex', flexDirection: 'column', gap: 11 }}>
            {perks.map(({ Icon, label }) => (
              <li key={label} className="flex items-center gap-3">
                <span
                  className="flex items-center justify-center flex-shrink-0"
                  style={{
                    width: 30,
                    height: 30,
                    borderRadius: 8,
                    background: 'rgba(232,25,44,0.09)',
                    border: '1px solid rgba(232,25,44,0.22)',
                  }}
                >
                  <Icon style={{ width: 14, height: 14, color: '#E8192C' }} />
                </span>
                <span className="font-sans text-left" style={{ fontSize: '13.5px', color: '#E5E5E5' }}>
                  {label}
                </span>
              </li>
            ))}
          </ul>

          <div style={{ marginTop: 20, display: 'flex', flexDirection: 'column', gap: 12 }}>
            <div className="space-y-1.5">
              <Label htmlFor="glgate-password" className="text-xs text-[#8A8A8E]">
                {t('glgate.password')}
              </Label>
              <div style={{ position: 'relative' }}>
                {/* iOS WebKit garde son état « secure text entry » si on ne fait
                    que basculer type=password->text : la key force le remount
                    pour que la révélation marche aussi en WebView. */}
                <Input
                  id="glgate-password"
                  key={showPassword ? 'glgate-pwd-shown' : 'glgate-pwd-hidden'}
                  className="h-12"
                  type={showPassword ? 'text' : 'password'}
                  value={password}
                  onChange={(e) => { setPassword(e.target.value); if (error) setError(''); }}
                  placeholder={t('finalize.passwordPlaceholder')}
                  autoComplete="new-password"
                  style={{ paddingRight: 48 }}
                />
                <button
                  type="button"
                  onClick={() => setShowPassword((v) => !v)}
                  className="absolute inset-y-0 right-0 flex items-center justify-center transition-colors hover:text-white cursor-pointer"
                  style={{ width: 48, color: '#9A9A9A' }}
                  aria-label={showPassword ? t('glconf.hidePassword') : t('glconf.showPassword')}
                >
                  {showPassword ? <EyeOff style={{ width: 17, height: 17 }} /> : <Eye style={{ width: 17, height: 17 }} />}
                </button>
              </div>
              <p className="font-sans" style={{ fontSize: '11.5px', color: '#5A5A5E' }}>
                {t('glgate.minChars')}
              </p>
            </div>

            <div className="space-y-1.5">
              <Label htmlFor="glgate-confirm" className="text-xs text-[#8A8A8E]">
                {t('glgate.confirm')}
              </Label>
              <Input
                id="glgate-confirm"
                key={showPassword ? 'glgate-confirm-shown' : 'glgate-confirm-hidden'}
                className="h-12"
                type={showPassword ? 'text' : 'password'}
                value={confirmPassword}
                onChange={(e) => { setConfirmPassword(e.target.value); if (error) setError(''); }}
                placeholder={t('finalize.confirmPlaceholder')}
                autoComplete="new-password"
              />
            </div>
          </div>

          {error && (
            <p
              role="alert"
              className="font-sans text-center"
              style={{ fontSize: '13px', color: '#E8192C', marginTop: 12 }}
            >
              {error}
            </p>
          )}

          <Button
            className="w-full h-12 font-semibold mt-4"
            disabled={submitting || !password || !confirmPassword}
            onClick={handleCreate}
          >
            {submitting
              ? <Loader2 className="h-4 w-4 animate-spin" />
              : <><Lock className="h-4 w-4 mr-2" />{t('glgate.cta')}</>}
          </Button>

          <p
            className="font-mono uppercase text-center truncate"
            style={{ fontSize: '10px', color: '#5A5A5E', letterSpacing: '0.06em', marginTop: 12 }}
          >
            {t('glconf.accountFor')} {email}
          </p>
        </>
      )}

      {/* Filet de sécurité : la place est acquise, et le QR est aussi dans la
          boîte mail. On ne le promet que si le serveur a confirmé l'envoi. */}
      <p
        className="font-sans text-center"
        style={{
          marginTop: 14,
          fontSize: '12px',
          color: emailSent === false ? '#F5A524' : '#5A5A5E',
          lineHeight: 1.45,
        }}
      >
        {emailSent === false ? t('glgate.emailBackupFailed') : t('glgate.emailBackup')}
      </p>
    </div>
  );
}
