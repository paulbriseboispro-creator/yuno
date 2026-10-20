// En-tête du tunnel d'achat public (billets, tables, guest list) : retour,
// l'étape en mots (« Vos infos · Étape 2 sur 3 ») et la progression en un trait
// rouge posé sur le bord bas. `sticky top-0` : c'est le sélecteur que la règle
// @supports d'index.css cible pour poser l'encoche (en `fixed`, la flèche de
// retour passait sous l'encoche, intouchable sur iPhone).
import { ArrowLeft } from 'lucide-react';
import { useLanguage } from '@/contexts/LanguageContext';

interface CheckoutStepHeaderProps {
  title: string;
  step: number;
  total: number;
  onBack: () => void;
}

export function CheckoutStepHeader({ title, step, total, onBack }: CheckoutStepHeaderProps) {
  const { t } = useLanguage();
  const progress = Math.max(0, Math.min(1, step / total));
  return (
    <header
      className="sticky top-0 z-40"
      style={{ background: 'rgba(10,10,10,0.92)', backdropFilter: 'blur(20px)', WebkitBackdropFilter: 'blur(20px)', borderBottom: '1px solid rgba(255,255,255,0.07)' }}
    >
      <div className="mx-auto flex h-14 max-w-lg items-center gap-3 px-4">
        <button
          type="button"
          aria-label={t('common.back')}
          onClick={onBack}
          className="flex h-10 w-10 shrink-0 items-center justify-center text-white transition-colors hover:bg-white/[0.08]"
          style={{ borderRadius: 4, background: 'rgba(255,255,255,0.045)', border: '1px solid rgba(255,255,255,0.12)' }}
        >
          <ArrowLeft className="h-4 w-4" />
        </button>
        <div className="min-w-0 flex-1 text-center">
          <p className="truncate font-mono text-[11px] font-bold uppercase tracking-[0.10em] text-white">{title}</p>
          <p className="mt-[3px] font-mono text-[10px] uppercase tracking-[0.06em] text-[#9A9A9A]">
            {t('ticketCheckout.stepOf').replace('{n}', String(step)).replace('{total}', String(total))}
          </p>
        </div>
        <span className="w-10 shrink-0" aria-hidden />
      </div>
      <div aria-hidden className="absolute bottom-[-1px] left-0 h-[2px] bg-primary transition-[width] duration-300" style={{ width: `${progress * 100}%` }} />
    </header>
  );
}
