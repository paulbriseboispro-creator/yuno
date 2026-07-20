import { useState } from 'react';
import { useWalletDetection } from '@/hooks/useWalletDetection';
import { toast } from 'sonner';
import { useLanguage } from '@/contexts/LanguageContext';
import { useAuth } from '@/hooks/useAuth';
import { addToWallet } from '@/lib/wallet';
import { haptics } from '@/lib/haptics';

interface WalletButtonsProps {
  type: 'ticket' | 'table' | 'order';
  id: string;
  /**
   * 'documents' — rangé dans la liste des téléchargements (bas de page).
   * 'hero' — mis en avant juste sous le QR : badge légèrement plus haut,
   * filet clair pour décoller du fond #0A0A0A, et la ligne de bénéfice
   * (hors ligne) qui explique pourquoi cliquer maintenant.
   */
  variant?: 'documents' | 'hero';
}

export function WalletButtons({ type, id, variant = 'documents' }: WalletButtonsProps) {
  const { isAppleDevice } = useWalletDetection();
  const { user } = useAuth();
  const { t } = useLanguage();
  const [loading, setLoading] = useState(false);

  // Apple Wallet uniquement (Google Wallet hors scope), billets + tables VIP.
  // Les commandes boissons auront leur pass storeCard avec la mise à jour de
  // solde en Phase 5 — un pass de solde figé serait pire que pas de pass.
  // Invités sans compte : leur canal pass est le lien de l'email de
  // confirmation (/wallet/issue exige une session).
  if (!isAppleDevice || type === 'order' || !user) {
    return null;
  }

  const handleAddToWallet = async () => {
    if (loading) return;
    setLoading(true);
    haptics.medium();
    try {
      await addToWallet(type, id);
    } catch {
      toast.error(t('confirmation.walletError'));
    } finally {
      setLoading(false);
    }
  };

  const isHero = variant === 'hero';

  // Bouton Apple Wallet — design officiel (badge noir, jamais restylé).
  const badge = (
    <button
      onClick={handleAddToWallet}
      disabled={loading}
      className={`flex items-center justify-center gap-3 w-full bg-black rounded-xl cursor-pointer transition-transform active:scale-[0.98] hover:opacity-90 disabled:opacity-60 ${isHero ? 'h-[58px]' : 'h-14'}`}
      style={isHero ? { border: '1px solid rgba(255,255,255,0.16)' } : undefined}
      aria-label="Add to Apple Wallet"
      aria-busy={loading}
    >
      {loading ? (
        <div className="w-6 h-6 flex items-center justify-center" aria-hidden="true">
          <div className="h-4 w-4 animate-spin rounded-full border-2 border-white/70 border-t-transparent" />
        </div>
      ) : (
        /* Apple Logo */
        <svg viewBox="0 0 24 24" className="w-6 h-6 fill-white" aria-hidden="true">
          <path d="M18.71 19.5c-.83 1.24-1.71 2.45-3.05 2.47-1.34.03-1.77-.79-3.29-.79-1.53 0-2 .77-3.27.82-1.31.05-2.3-1.32-3.14-2.53C4.25 17 2.94 12.45 4.7 9.39c.87-1.52 2.43-2.48 4.12-2.51 1.28-.02 2.5.87 3.29.87.78 0 2.26-1.07 3.81-.91.65.03 2.47.26 3.64 1.98-.09.06-2.17 1.28-2.15 3.81.03 3.02 2.65 4.03 2.68 4.04-.03.07-.42 1.44-1.38 2.83M13 3.5c.73-.83 1.94-1.46 2.94-1.5.13 1.17-.34 2.35-1.04 3.19-.69.85-1.83 1.51-2.95 1.42-.15-1.15.41-2.35 1.05-3.11z"/>
        </svg>
      )}
      <div className="text-left">
        <p className="text-[10px] text-white/80 leading-tight">{t('confirmation.walletAddTo')}</p>
        <p className="text-base font-semibold text-white leading-tight">Apple Wallet</p>
      </div>
    </button>
  );

  if (!isHero) return badge;

  return (
    <div className="w-full mb-5">
      {badge}
      <p
        className="font-mono uppercase text-center mt-2.5"
        style={{ fontSize: '10px', letterSpacing: '0.08em', color: '#9A9A9A' }}
      >
        {t('confirmation.walletHint')}
      </p>
    </div>
  );
}
