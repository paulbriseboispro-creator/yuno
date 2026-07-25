import { Link } from 'react-router-dom';
import { Send } from 'lucide-react';
import { useAuth } from '@/hooks/useAuth';
import { useLanguage } from '@/contexts/LanguageContext';
import { AudienceDashboard } from '@/components/audience/AudienceDashboard';

export default function OrgAppAudience() {
  const { user } = useAuth();
  const { language } = useLanguage();
  const t = (fr: string, en: string, es: string) => (language === 'fr' ? fr : language === 'es' ? es : en);
  if (!user?.id) return null;
  return (
    <div className="p-4 sm:p-6 max-w-6xl mx-auto">
      <AudienceDashboard
        subject={{ type: 'organizer', id: user.id }}
        actions={
          <Link
            to="/organizer-app/campaigns"
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
