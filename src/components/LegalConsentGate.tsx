// Rattrapage clickwrap pour les pros EXISTANTS : les nouveaux acceptent les
// conditions pro + l'engagement de confidentialité au signup / via lien
// d'onboarding, mais les comptes créés avant n'ont jamais rien accepté.
//
// Cette modale bloque l'espace pro tant que la version courante des conditions
// n'est pas acceptée (une seule fois par version — cf. LEGAL_VERSIONS).
//
// Sécurité de déploiement : hasAcceptedLegal est fail-open (true sur erreur),
// donc si la migration legal_acceptances n'est pas encore appliquée, la modale
// ne s'affiche pas et le dashboard reste utilisable.

import { useEffect, useState } from 'react';
import { Check, ScrollText, Loader2 } from 'lucide-react';
import { useAuth } from '@/hooks/useAuth';
import { useLanguage } from '@/contexts/LanguageContext';
import { isPreviewActive } from '@/contexts/PreviewModeContext';
import { hasAcceptedLegal, recordLegalAcceptance } from '@/lib/legal';
import { legalContent } from '@/data/legalContent';

const RED = '#E8192C';

export function LegalConsentGate() {
  const { user } = useAuth();
  const { t, language } = useLanguage();
  const [needed, setNeeded] = useState(false);
  const [checked, setChecked] = useState(false);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    // Jamais en mode aperçu démo (lecture seule : l'écriture serait bloquée
    // et le prospect a déjà accepté l'engagement sur la porte d'entrée).
    if (!user || isPreviewActive()) return;
    let active = true;
    (async () => {
      const ok = await hasAcceptedLegal('terms_pro');
      if (active && !ok) setNeeded(true);
    })();
    return () => { active = false; };
  }, [user?.id]); // eslint-disable-line react-hooks/exhaustive-deps

  if (!needed) return null;

  const accept = async () => {
    if (!checked || saving) return;
    setSaving(true);
    const email = user?.email ?? undefined;
    const context = { surface: 'consent_gate' };
    await recordLegalAcceptance({
      docType: 'terms_pro',
      docContent: legalContent['cgv-clubs'][language].content,
      email,
      context,
    });
    await recordLegalAcceptance({
      docType: 'confidentiality',
      docContent: legalContent['confidentialite'][language].content,
      email,
      context,
    });
    setNeeded(false);
    setSaving(false);
  };

  return (
    <div
      className="fixed inset-0 z-[100] flex items-center justify-center px-4"
      style={{ background: 'rgba(0,0,0,0.72)', backdropFilter: 'blur(6px)' }}
    >
      <div
        className="w-full max-w-[440px] rounded-2xl p-7"
        style={{
          background: 'linear-gradient(180deg,rgba(255,255,255,.05) 0%,rgba(255,255,255,.012) 100%),#0a0a0c',
          border: '1px solid rgba(255,255,255,0.09)',
          boxShadow: '0 1px 0 rgba(255,255,255,.05) inset,0 30px 60px -30px rgba(0,0,0,.9)',
        }}
      >
        <span
          className="flex h-11 w-11 items-center justify-center rounded-xl mb-4"
          style={{ background: 'rgba(232,25,44,0.12)' }}
        >
          <ScrollText className="h-5 w-5" style={{ color: RED }} />
        </span>

        <h2 className="text-lg font-bold text-white mb-1.5">{t('legal.updateTitle')}</h2>
        <p className="text-sm leading-relaxed text-white/50 mb-5">{t('legal.updateBody')}</p>

        <button
          type="button"
          onClick={() => setChecked(!checked)}
          className="flex items-start gap-2.5 w-full text-left mb-5"
        >
          <span
            className="shrink-0 h-[18px] w-[18px] rounded-[4px] border flex items-center justify-center transition-colors mt-[1px]"
            style={{
              background: checked ? RED : 'transparent',
              borderColor: checked ? RED : 'rgba(255,255,255,0.25)',
            }}
          >
            {checked && <Check className="h-3 w-3 text-white" strokeWidth={3} />}
          </span>
          <span className="text-xs leading-snug text-white/50">
            {t('legal.proPre')}{' '}
            <a
              href="/legal/cgv-clubs"
              target="_blank"
              rel="noopener noreferrer"
              className="underline"
              style={{ color: RED }}
              onClick={(e) => e.stopPropagation()}
            >
              {t('legal.proTerms')}
            </a>{' '}
            {t('legal.proMid')}<a
              href="/legal/confidentialite"
              target="_blank"
              rel="noopener noreferrer"
              className="underline"
              style={{ color: RED }}
              onClick={(e) => e.stopPropagation()}
            >
              {t('legal.proConf')}
            </a>
          </span>
        </button>

        <button
          type="button"
          onClick={accept}
          disabled={!checked || saving}
          className="inline-flex w-full items-center justify-center gap-2 rounded-xl py-3 text-[14px] font-semibold transition"
          style={{
            background: RED,
            color: '#fff',
            boxShadow: `0 0 22px -8px ${RED}`,
            opacity: !checked || saving ? 0.55 : 1,
            cursor: !checked || saving ? 'not-allowed' : 'pointer',
          }}
        >
          {saving && <Loader2 className="h-4 w-4 animate-spin" />}
          {t('legal.updateAccept')}
        </button>
      </div>
    </div>
  );
}
