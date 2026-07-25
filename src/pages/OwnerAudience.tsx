import { Link } from 'react-router-dom';
import { Send } from 'lucide-react';
import { useOwnerVenueContext } from '@/contexts/OwnerVenueContext';
import { useLanguage } from '@/contexts/LanguageContext';
import { AudienceDashboard } from '@/components/audience/AudienceDashboard';

export default function OwnerAudience() {
  const { venueId } = useOwnerVenueContext();
  const { language } = useLanguage();
  const t = (fr: string, en: string, es: string) => (language === 'fr' ? fr : language === 'es' ? es : en);
  if (!venueId) return null;
  return (
    <div className="p-4 sm:p-6 max-w-6xl mx-auto">
      <AudienceDashboard
        subject={{ type: 'venue', id: venueId }}
        actions={
          <Link
            to="/owner/push"
            className="inline-flex items-center gap-2 rounded-full px-4 py-2 text-[13px] font-semibold transition-opacity hover:opacity-90"
            style={{ background: '#E8192C', color: '#fff' }}
          >
            <Send className="w-4 h-4" />
            {t('Notifier mes abonnés', 'Notify my subscribers', 'Notificar a mis suscriptores')}
          </Link>
        }
      />
    </div>
  );
}
