import { useState } from 'react';
import { translate } from '@/i18n/orgTranslate';
import { Sparkles, Loader2, Megaphone } from 'lucide-react';
import { supabase } from '@/integrations/supabase/client';
import { useLanguage } from '@/contexts/LanguageContext';
import { toast } from 'sonner';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';

// Moment de service (idée « bouteille à la table ») : le host programme une parade
// bouteille / cierges ou une annonce pour la table. Enregistré dans vip_service_moments,
// visible ensuite par le staff. Donne du rythme au service et une exécution fiable.

interface Props {
  venueId: string;
  reservationId: string;
  eventId?: string | null;
  disabled?: boolean;
}

const T1 = 'rgba(255,255,255,0.96)';
const T3 = 'rgba(255,255,255,0.36)';
const BORDER = 'rgba(255,255,255,0.085)';

export function VipServiceMomentButton({ venueId, reservationId, eventId, disabled }: Props) {
  const { language } = useLanguage();
  const tt = (fr: string, en: string, es?: string) => translate(language, fr, en, es);
  const [open, setOpen] = useState(false);
  const [sending, setSending] = useState(false);

  const schedule = async (kind: 'bottle_parade' | 'announcement', label: string) => {
    setSending(true);
    try {
      const { data: { user } } = await supabase.auth.getUser();
      const { error } = await supabase.from('vip_service_moments').insert({
        venue_id: venueId,
        table_reservation_id: reservationId,
        event_id: eventId ?? null,
        kind,
        label,
        status: 'scheduled',
        created_by: user?.id ?? null,
      });
      if (error) throw error;
      toast.success(tt('Moment programmé — le staff est prévenu', 'Moment scheduled — staff notified', 'Momento programado — staff avisado'));
      setOpen(false);
    } catch (e) {
      console.error('Error scheduling service moment:', e);
      toast.error(tt('Échec', 'Failed', 'Error'));
    } finally {
      setSending(false);
    }
  };

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <button
          type="button"
          disabled={disabled || sending}
          className="h-11 px-3 rounded-lg flex items-center justify-center gap-1.5 text-[13px] font-semibold transition-colors disabled:opacity-40"
          style={{ background: 'rgba(231,193,90,0.12)', border: '1px solid rgba(231,193,90,0.3)', color: '#E7C15A' }}
        >
          {sending ? <Loader2 className="w-4 h-4 animate-spin" /> : <Sparkles className="w-4 h-4" />}
          {tt('Moment', 'Moment', 'Momento')}
        </button>
      </PopoverTrigger>
      <PopoverContent className="w-64 p-2" align="end" style={{ background: '#0f0f12', border: `1px solid ${BORDER}` }}>
        <div className="text-[10px] uppercase tracking-wide px-1.5 py-1" style={{ color: T3 }}>
          {tt('Programmer un moment', 'Schedule a moment', 'Programar un momento')}
        </div>
        <button
          type="button"
          onClick={() => schedule('bottle_parade', tt('Parade bouteille', 'Bottle parade', 'Desfile de botella'))}
          disabled={sending}
          className="w-full flex items-center gap-2.5 p-2 rounded-lg hover:bg-white/5 text-left"
        >
          <Sparkles className="w-4 h-4 flex-none" style={{ color: '#E7C15A' }} />
          <span className="text-[13px]" style={{ color: T1 }}>{tt('Parade bouteille (cierges)', 'Bottle parade (sparklers)', 'Desfile de botella (bengalas)')}</span>
        </button>
        <button
          type="button"
          onClick={() => schedule('announcement', tt('Annonce table', 'Table announcement', 'Anuncio de mesa'))}
          disabled={sending}
          className="w-full flex items-center gap-2.5 p-2 rounded-lg hover:bg-white/5 text-left"
        >
          <Megaphone className="w-4 h-4 flex-none" style={{ color: T3 }} />
          <span className="text-[13px]" style={{ color: T1 }}>{tt('Annonce table', 'Table announcement', 'Anuncio de mesa')}</span>
        </button>
      </PopoverContent>
    </Popover>
  );
}
