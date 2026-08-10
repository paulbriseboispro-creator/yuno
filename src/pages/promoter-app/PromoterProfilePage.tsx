import { useState } from 'react';
import { motion } from 'framer-motion';
import { KeyRound, ChevronRight } from 'lucide-react';
import { supabase } from '@/integrations/supabase/client';
import { useLanguage } from '@/contexts/LanguageContext';
import { translate } from '@/i18n/orgTranslate';
import { usePromoterData } from '@/contexts/PromoterDataContext';
import { PromoterPage, PromoHeading } from '@/components/promoter/promoter-app-shell';
import { PromoterProfileTab } from '@/components/promoter/PromoterProfileTab';
import { ProfilePhotoUpload } from '@/components/ProfilePhotoUpload';
import { ChangePinFlow } from '@/components/ChangePinFlow';
import { T1, T3, BORDER, CARD_BG, CARD_SHADOW, C_FAINT } from '@/components/promoter/promoter-ui';

export default function PromoterProfilePage() {
  const { language } = useLanguage();
  const tt = (fr: string, en: string, es?: string) => translate(language, fr, en, es);
  const { promoter, profiles, refetchProfiles } = usePromoterData();
  const [showChangePinFlow, setShowChangePinFlow] = useState(false);

  if (!promoter) return null;

  if (showChangePinFlow) {
    return <ChangePinFlow onClose={() => setShowChangePinFlow(false)} hasExistingPin={true} />;
  }

  return (
    <PromoterPage maxWidth={720}>
      <PromoHeading
        title={tt('Mon Profil', 'My Profile', 'Mi Perfil')}
        subtitle={tt('Identité, réseaux et coordonnées bancaires', 'Identity, socials and bank details', 'Identidad, redes y datos bancarios')}
      />

      {/* ── Photo (partagée entre toutes les portées) ── */}
      <motion.div initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }}>
        <div className="flex items-center gap-4"
          style={{ background: CARD_BG, border: `1px solid ${BORDER}`, borderRadius: 18, boxShadow: CARD_SHADOW, padding: 18 }}>
          <ProfilePhotoUpload
            currentImageUrl={promoter.profile_image_url}
            onUpload={async (url) => {
              await Promise.all(profiles.map(p =>
                supabase.from('promoters').update({ profile_image_url: url }).eq('id', p.id),
              ));
              refetchProfiles();
            }}
            size="md"
            fallback={promoter.promo_code?.[0] || 'P'}
          />
          <div className="min-w-0">
            <p className="text-sm font-semibold truncate" style={{ color: T1 }}>@{promoter.promo_code}</p>
            <p className="text-xs" style={{ color: T3 }}>
              {tt('Ta photo apparaît sur ton linktree public', 'Your photo shows on your public linktree', 'Tu foto aparece en tu linktree público')}
            </p>
          </div>
        </div>
      </motion.div>

      {/* ── Identité + réseaux + IBAN (composant partagé, inchangé) ── */}
      <motion.div initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.05 }}>
        <PromoterProfileTab promoter={promoter} allPromoterProfiles={profiles} onSaved={refetchProfiles} />
      </motion.div>

      {/* ── Code PIN ── */}
      <motion.div initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.1 }}>
        <button
          onClick={() => setShowChangePinFlow(true)}
          className="w-full flex items-center gap-3 text-left transition-colors hover:bg-white/[0.04] cursor-pointer"
          style={{ background: CARD_BG, border: `1px solid ${BORDER}`, borderRadius: 18, boxShadow: CARD_SHADOW, padding: 18 }}
        >
          <div className="w-9 h-9 flex items-center justify-center rounded-xl flex-none"
            style={{ background: C_FAINT, border: `1px solid ${BORDER}` }}>
            <KeyRound className="h-4 w-4" style={{ color: T1 }} />
          </div>
          <div className="min-w-0 flex-1">
            <p className="text-sm font-semibold" style={{ color: T1 }}>{tt('Modifier mon code PIN', 'Change my PIN', 'Cambiar mi PIN')}</p>
            <p className="text-xs" style={{ color: T3 }}>
              {tt('Le code qui protège ton espace', 'The code that protects your space', 'El código que protege tu espacio')}
            </p>
          </div>
          <ChevronRight className="h-4 w-4 flex-none" style={{ color: T3 }} />
        </button>
      </motion.div>
    </PromoterPage>
  );
}
