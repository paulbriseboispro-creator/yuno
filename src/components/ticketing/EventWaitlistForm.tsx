import { useState } from 'react';
import { useLanguage } from '@/contexts/LanguageContext';
import { supabase } from '@/integrations/supabase/client';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Bell, CheckCircle2, Loader2 } from 'lucide-react';
import { toast } from 'sonner';

interface EventWaitlistFormProps {
  eventId: string;
  onSuccess?: () => void;
}

export function EventWaitlistForm({ eventId, onSuccess }: EventWaitlistFormProps) {
  const { t } = useLanguage();
  const [email, setEmail] = useState('');
  const [fullName, setFullName] = useState('');
  const [loading, setLoading] = useState(false);
  const [registered, setRegistered] = useState(false);
  const [position, setPosition] = useState<number | null>(null);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!email) return;

    setLoading(true);
    try {
      // Get current user if authenticated
      const { data: { user } } = await supabase.auth.getUser();

      const { error } = await supabase
        .from('event_waitlist')
        .insert({
          event_id: eventId,
          email: email.toLowerCase().trim(),
          full_name: fullName.trim() || null,
          user_id: user?.id || null,
        });

      if (error) {
        if (error.code === '23505') {
          toast.info(t('waitlist.alreadyRegistered'));
          setRegistered(true);
          return;
        }
        throw error;
      }

      // Get position
      const { count } = await supabase
        .from('event_waitlist')
        .select('*', { count: 'exact', head: true })
        .eq('event_id', eventId);

      setPosition(count || 1);
      setRegistered(true);
      toast.success(t('waitlist.registered'));
      onSuccess?.();
    } catch (err) {
      console.error('Waitlist error:', err);
      toast.error(t('common.error'));
    } finally {
      setLoading(false);
    }
  };

  if (registered) {
    return (
      <div className="rounded-xl border border-primary/30 bg-primary/5 p-6 text-center space-y-3">
        <CheckCircle2 className="h-10 w-10 text-primary mx-auto" />
        <p className="font-semibold text-sm">{t('waitlist.youAreRegistered')}</p>
        {position && (
          <p className="text-xs text-muted-foreground">
            {t('waitlist.position')} #{position}
          </p>
        )}
        <p className="text-xs text-muted-foreground">{t('waitlist.notifyWhenAvailable')}</p>
      </div>
    );
  }

  return (
    <form onSubmit={handleSubmit} className="rounded-xl border border-border/30 bg-surface p-5 space-y-4">
      <div className="flex items-center gap-2 mb-1">
        <Bell className="h-5 w-5 text-primary" />
        <span className="font-bold text-sm">{t('waitlist.joinWaitlist')}</span>
      </div>
      <p className="text-xs text-muted-foreground">{t('waitlist.getNotified')}</p>

      <div className="space-y-3">
        <div>
          <Label htmlFor="wl-name" className="text-xs">{t('waitlist.fullName')}</Label>
          <Input
            id="wl-name"
            value={fullName}
            onChange={e => setFullName(e.target.value)}
            placeholder={t('waitlist.namePlaceholder')}
          />
        </div>
        <div>
          <Label htmlFor="wl-email" className="text-xs">{t('waitlist.email')}</Label>
          <Input
            id="wl-email"
            type="email"
            required
            value={email}
            onChange={e => setEmail(e.target.value)}
            placeholder={t('waitlist.emailPlaceholder')}
          />
        </div>
      </div>

      <Button type="submit" className="w-full" disabled={loading || !email}>
        {loading ? (
          <Loader2 className="h-4 w-4 animate-spin mr-2" />
        ) : (
          <Bell className="h-4 w-4 mr-2" />
        )}
        {t('waitlist.joinWaitlist')}
      </Button>
    </form>
  );
}
