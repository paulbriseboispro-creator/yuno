import { Link } from 'react-router-dom';
import { Send, Loader2 } from 'lucide-react';
import { useAgency } from '@/hooks/useAgency';
import { useLanguage } from '@/contexts/LanguageContext';
import { AudienceDashboard } from '@/components/audience/AudienceDashboard';
import { AgencyEventBreakdown } from '@/components/audience/AgencyEventBreakdown';

/**
 * Abonnés de l'agence RP. Réutilise le dashboard audience polymorphe (subject
 * 'agency') — mêmes stats segmentées que les owners (croissance, démographie,
 * sources, portée push, revenu abonnés scopé agence via les contrats) — puis la
 * ventilation « par soirée » propre aux RP.
 */
export default function AgencyAudience() {
  const { agency, loading } = useAgency();
  const { language } = useLanguage();
  const t = (fr: string, en: string, es: string) => (language === 'fr' ? fr : language === 'es' ? es : en);

  if (loading) {
    return <div className="flex justify-center py-16"><Loader2 className="w-6 h-6 animate-spin" style={{ color: 'rgba(255,255,255,0.36)' }} /></div>;
  }
  if (!agency?.id) return null;

  return (
    <div className="py-4 space-y-4">
      <AudienceDashboard
        subject={{ type: 'agency', id: agency.id }}
        actions={
          <Link
            to="/agency-app/push"
            className="inline-flex items-center gap-2 rounded-full px-4 py-2 text-[13px] font-semibold transition-opacity hover:opacity-90"
            style={{ background: '#E8192C', color: '#fff' }}
          >
            <Send className="w-4 h-4" />
            {t('Notifier mes abonnés', 'Notify my subscribers', 'Notificar a mis suscriptores')}
          </Link>
        }
      />
      <AgencyEventBreakdown agencyId={agency.id} />
    </div>
  );
}
