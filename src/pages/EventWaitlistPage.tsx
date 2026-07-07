import { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { useEventRoute } from '@/hooks/useEventRoute';
import { ArrowLeft, Bell, User, CheckCircle2, Loader2, Sparkles } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { supabase } from '@/integrations/supabase/client';
import { useLanguage } from '@/contexts/LanguageContext';
import { toast } from 'sonner';
import { motion } from 'framer-motion';
import { cn } from '@/lib/utils';

export default function EventWaitlistPage() {
  const { eventId, basePath } = useEventRoute();
  const navigate = useNavigate();
  const { t } = useLanguage();

  const [eventTitle, setEventTitle] = useState('');
  const [loading, setLoading] = useState(true);
  const [submitting, setSubmitting] = useState(false);
  const [registered, setRegistered] = useState(false);
  const [position, setPosition] = useState<number | null>(null);

  // Auth state
  const [user, setUser] = useState<{ id: string; email: string; firstName?: string; lastName?: string } | null>(null);

  // Show in orders toggle (default true)
  const [showInOrders, setShowInOrders] = useState(true);

  // Guest signup fields (shown when not logged in)
  const [guestName, setGuestName] = useState('');
  const [guestEmail, setGuestEmail] = useState('');

  useEffect(() => {
    fetchData();
  }, [eventId]);

  const fetchData = async () => {
    try {
      // Fetch event title
      const { data: ev } = await supabase
        .from('events')
        .select('title')
        .eq('id', eventId!)
        .single();
      if (ev) setEventTitle(ev.title);

      // Fetch auth user
      const { data: { user: authUser } } = await supabase.auth.getUser();
      if (authUser) {
        const { data: profile } = await supabase
          .from('profiles')
          .select('first_name, last_name')
          .eq('id', authUser.id)
          .single();

        setUser({
          id: authUser.id,
          email: authUser.email || '',
          firstName: profile?.first_name || undefined,
          lastName: profile?.last_name || undefined,
        });

        // Check if already registered (by user_id OR email)
        const normalizedEmail = authUser.email?.toLowerCase().trim();
        const filters = [`user_id.eq.${authUser.id}`];
        if (normalizedEmail) filters.push(`email.eq.${normalizedEmail}`);

        const { data: existing } = await supabase
          .from('event_waitlist')
          .select('id, user_id')
          .eq('event_id', eventId!)
          .or(filters.join(','))
          .maybeSingle();

        if (existing) {
          // Link user_id if entry exists by email but missing user_id
          if (!existing.user_id) {
            await supabase
              .from('event_waitlist')
              .update({ user_id: authUser.id })
              .eq('id', existing.id);
          }
          setRegistered(true);
          const { count } = await supabase
            .from('event_waitlist')
            .select('*', { count: 'exact', head: true })
            .eq('event_id', eventId!);
          setPosition(count || 1);
        }
      }
    } catch (err) {
      console.error(err);
    } finally {
      setLoading(false);
    }
  };

  const handleSignup = async () => {
    if (!user) {
      navigate(`/auth?redirect=${basePath}/waitlist`);
      return;
    }

    setSubmitting(true);
    try {
      const { error } = await supabase
        .from('event_waitlist')
        .insert({
          event_id: eventId!,
          email: user.email.toLowerCase().trim(),
          full_name: [user.firstName, user.lastName].filter(Boolean).join(' ') || null,
          user_id: user.id,
          show_in_orders: showInOrders,
        });

      if (error) {
        if (error.code === '23505') {
          toast.info(t('waitlist.alreadyRegistered'));
          setRegistered(true);
          return;
        }
        throw error;
      }

      const { count } = await supabase
        .from('event_waitlist')
        .select('*', { count: 'exact', head: true })
        .eq('event_id', eventId!);
      setPosition(count || 1);
      setRegistered(true);
      toast.success(t('waitlist.registered'));

      // Send confirmation email (fire-and-forget)
      supabase.functions.invoke('notify-event-waitlist', {
        body: { eventId, type: 'confirmation', email: user.email.toLowerCase().trim() },
      }).catch(() => {});
    } catch (err) {
      console.error(err);
      toast.error(t('common.error'));
    } finally {
      setSubmitting(false);
    }
  };

  // Guest signup — no account needed. RLS allows anon inserts into event_waitlist.
  const handleGuestSignup = async () => {
    const email = guestEmail.trim().toLowerCase();
    if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) {
      toast.error(t('waitlist.invalidEmail'));
      return;
    }
    setSubmitting(true);
    try {
      const { error } = await supabase
        .from('event_waitlist')
        .insert({
          event_id: eventId!,
          email,
          full_name: guestName.trim() || null,
          user_id: null,
          show_in_orders: false,
        });

      if (error) {
        if (error.code === '23505') {
          toast.info(t('waitlist.alreadyRegistered'));
          setRegistered(true);
          return;
        }
        throw error;
      }

      setRegistered(true);
      toast.success(t('waitlist.registered'));

      // Confirmation email (fire-and-forget)
      supabase.functions.invoke('notify-event-waitlist', {
        body: { eventId, type: 'confirmation', email },
      }).catch(() => {});
    } catch (err) {
      console.error(err);
      toast.error(t('common.error'));
    } finally {
      setSubmitting(false);
    }
  };

  if (loading) {
    return (
      <div className="min-h-screen bg-background flex items-center justify-center">
        <Loader2 className="h-8 w-8 animate-spin text-primary" />
      </div>
    );
  }

  if (registered) {
    return (
      <div className="min-h-screen bg-background">
        <div className="p-4">
          <button onClick={() => navigate(-1)} className="flex items-center gap-2 text-muted-foreground hover:text-foreground transition-colors">
            <ArrowLeft className="h-5 w-5" />
          </button>
        </div>
        <motion.div
          initial={{ opacity: 0, scale: 0.95 }}
          animate={{ opacity: 1, scale: 1 }}
          className="flex flex-col items-center justify-center px-6 pt-20 text-center space-y-4"
        >
          <div className="h-16 w-16 rounded-full bg-primary/10 flex items-center justify-center">
            <CheckCircle2 className="h-8 w-8 text-primary" />
          </div>
          <h1 className="text-2xl font-bold">{t('waitlist.youAreRegistered')}</h1>
          {position && (
            <p className="text-muted-foreground">
              {t('waitlist.position')} <span className="font-bold text-foreground">#{position}</span>
            </p>
          )}
          <p className="text-sm text-muted-foreground max-w-xs">{t('waitlist.notifyWhenAvailable')}</p>
          <Button variant="outline" className="mt-6" onClick={() => navigate(`${basePath}`, { state: { eventId } })}>
            {t('common.back')}
          </Button>
        </motion.div>
      </div>
    );
  }

  const showInOrdersToggle = (
    <div className="rounded-xl border border-border/30 bg-surface p-4">
      <p className="text-sm font-medium mb-3">{t('waitlist.showInOrders')}</p>
      <div className="flex gap-3">
        <button
          type="button"
          onClick={() => setShowInOrders(true)}
          className={cn(
            'flex-1 rounded-lg border-2 py-2.5 text-sm font-semibold transition-all',
            showInOrders
              ? 'border-primary bg-primary/10 text-primary'
              : 'border-border/30 text-muted-foreground hover:border-border/50'
          )}
        >
          ✅ {t('waitlist.showInOrdersYes')}
        </button>
        <button
          type="button"
          onClick={() => setShowInOrders(false)}
          className={cn(
            'flex-1 rounded-lg border-2 py-2.5 text-sm font-semibold transition-all',
            !showInOrders
              ? 'border-primary bg-primary/10 text-primary'
              : 'border-border/30 text-muted-foreground hover:border-border/50'
          )}
        >
          ❌ {t('waitlist.showInOrdersNo')}
        </button>
      </div>
    </div>
  );

  return (
    <div className="min-h-screen bg-background">
      {/* Header */}
      <div className="p-4">
        <button onClick={() => navigate(-1)} className="flex items-center gap-2 text-muted-foreground hover:text-foreground transition-colors">
          <ArrowLeft className="h-5 w-5" />
        </button>
      </div>

      <div className="px-5 space-y-6">
        {/* Title */}
        <motion.div initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} className="space-y-2">
          <div className="flex items-center gap-2">
            <Bell className="h-5 w-5 text-primary" />
            <h1 className="text-xl font-bold">{t('waitlist.pageTitle')}</h1>
          </div>
          <p className="text-sm text-muted-foreground">{eventTitle}</p>
          <p className="text-xs text-muted-foreground">{t('waitlist.pageSubtitle')}</p>
        </motion.div>

        {/* Show in orders toggle — only meaningful for logged-in users */}
        {user && showInOrdersToggle}

        {/* Account section */}
        <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} className="space-y-4">
          {user ? (
            <>
              <div className="rounded-xl border border-border/30 bg-surface p-4 space-y-2">
                <div className="flex items-center gap-3">
                  <div className="h-10 w-10 rounded-full bg-primary/10 flex items-center justify-center">
                    <User className="h-5 w-5 text-primary" />
                  </div>
                  <div>
                    <p className="font-semibold text-sm">
                      {[user.firstName, user.lastName].filter(Boolean).join(' ') || user.email}
                    </p>
                    <p className="text-xs text-muted-foreground">{user.email}</p>
                  </div>
                </div>
              </div>
              <Button onClick={handleSignup} disabled={submitting} className="w-full h-12 text-base font-semibold">
                {submitting ? <Loader2 className="h-5 w-5 animate-spin mr-2" /> : <Sparkles className="h-5 w-5 mr-2" />}
                {t('waitlist.signUpWithYuno')}
              </Button>
            </>
          ) : (
            <div className="space-y-3">
              <input
                type="text"
                value={guestName}
                onChange={(e) => setGuestName(e.target.value)}
                placeholder={t('waitlist.guestNamePlaceholder')}
                className="w-full rounded-xl border border-border/30 bg-surface px-4 h-12 text-sm outline-none focus:border-primary/50 transition-colors"
              />
              <input
                type="email"
                inputMode="email"
                autoComplete="email"
                value={guestEmail}
                onChange={(e) => setGuestEmail(e.target.value)}
                placeholder={t('waitlist.guestEmailPlaceholder')}
                className="w-full rounded-xl border border-border/30 bg-surface px-4 h-12 text-sm outline-none focus:border-primary/50 transition-colors"
              />
              <Button
                onClick={handleGuestSignup}
                disabled={submitting || !guestEmail.trim()}
                className="w-full h-12 text-base font-semibold"
              >
                {submitting ? <Loader2 className="h-5 w-5 animate-spin mr-2" /> : <Bell className="h-5 w-5 mr-2" />}
                {t('waitlist.joinButton')}
              </Button>
              <button
                onClick={() => navigate(`/auth?redirect=${basePath}/waitlist`)}
                className="w-full text-center text-xs text-muted-foreground hover:text-foreground transition-colors pt-1"
              >
                {t('waitlist.orLogin')}
              </button>
            </div>
          )}
        </motion.div>
      </div>
    </div>
  );
}
