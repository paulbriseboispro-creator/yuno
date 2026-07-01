import { useState } from 'react';
import { translate } from '@/i18n/orgTranslate';
import { supabase } from '@/integrations/supabase/client';
import { useLanguage } from '@/contexts/LanguageContext';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { toast } from 'sonner';
import { Loader2, BellRing } from 'lucide-react';

// Liste d'attente tables VIP : quand une zone/pack est complète, le client se met en
// attente plutôt que de partir ; le club peut le recontacter à la première annulation.
// Écrit dans vip_table_waitlist (RLS : insert public autorisé).

interface Props {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  venueId: string;
  eventId?: string | null;
  zoneId?: string | null;
  packId?: string | null;
  defaultName?: string;
  defaultEmail?: string;
  defaultPhone?: string;
  guestCount?: number;
}

const inputCls = 'h-11 rounded-lg bg-[#1F1F22] border-white/[0.08] text-white placeholder:text-[#5A5A5E] focus-visible:ring-0 focus-visible:border-primary/50';

export function VipTableWaitlistDialog({
  open, onOpenChange, venueId, eventId, zoneId, packId,
  defaultName = '', defaultEmail = '', defaultPhone = '', guestCount = 1,
}: Props) {
  const { language } = useLanguage();
  const tt = (fr: string, en: string, es?: string) => translate(language, fr, en, es);
  const [name, setName] = useState(defaultName);
  const [email, setEmail] = useState(defaultEmail);
  const [phone, setPhone] = useState(defaultPhone);
  const [submitting, setSubmitting] = useState(false);

  const submit = async () => {
    if (!email.trim() && !phone.trim()) {
      toast.error(tt('Email ou téléphone requis', 'Email or phone required', 'Email o teléfono requerido'));
      return;
    }
    setSubmitting(true);
    try {
      const { data: { user } } = await supabase.auth.getUser();
      const { error } = await supabase.from('vip_table_waitlist').insert({
        venue_id: venueId,
        event_id: eventId ?? null,
        zone_id: zoneId ?? null,
        pack_id: packId ?? null,
        user_id: user?.id ?? null,
        email: email.trim() || null,
        full_name: name.trim() || null,
        phone: phone.trim() || null,
        guest_count: guestCount || 1,
        status: 'waiting',
      });
      if (error) throw error;
      toast.success(tt('Vous êtes sur la liste d\'attente', 'You\'re on the waitlist', 'Estás en la lista de espera'));
      onOpenChange(false);
    } catch (e) {
      console.error('Waitlist insert failed:', e);
      toast.error(tt('Échec', 'Failed', 'Error'));
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="bg-[#0f0f12] border-white/[0.08] text-white">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <BellRing className="h-5 w-5 text-primary" />
            {tt('Liste d\'attente table', 'Table waitlist', 'Lista de espera de mesa')}
          </DialogTitle>
        </DialogHeader>
        <p className="text-[13px] text-white/60 -mt-1">
          {tt(
            'Complet pour l\'instant. Laissez vos coordonnées : le club vous recontacte dès qu\'une table se libère.',
            'Full for now. Leave your details: the club will reach out as soon as a table frees up.',
            'Completo por ahora. Deja tus datos: el club te contactará en cuanto se libere una mesa.',
          )}
        </p>
        <div className="space-y-2.5 mt-1">
          <Input className={inputCls} placeholder={tt('Nom complet', 'Full name', 'Nombre completo')} value={name} onChange={e => setName(e.target.value)} />
          <Input className={inputCls} placeholder="Email" type="email" value={email} onChange={e => setEmail(e.target.value)} />
          <Input className={inputCls} placeholder={tt('Téléphone', 'Phone', 'Teléfono')} value={phone} onChange={e => setPhone(e.target.value)} />
        </div>
        <button
          type="button"
          onClick={submit}
          disabled={submitting}
          className="w-full h-12 mt-2 rounded-full flex items-center justify-center gap-2 font-semibold text-sm text-white bg-primary transition-all hover:brightness-110 active:scale-[0.98] disabled:opacity-40"
        >
          {submitting ? <Loader2 className="h-5 w-5 animate-spin" /> : <BellRing className="h-4 w-4" />}
          {tt('Me prévenir', 'Notify me', 'Avisarme')}
        </button>
      </DialogContent>
    </Dialog>
  );
}
