import { useEffect, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { supabase } from '@/integrations/supabase/client';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { Mail, CheckCircle2, Loader2 } from 'lucide-react';
import { useLanguage } from '@/contexts/LanguageContext';

export default function Unsubscribe() {
  const { t } = useLanguage();
  const [params] = useSearchParams();
  const token = params.get('token');
  const [info, setInfo] = useState<{ scope_name?: string; venue_name?: string; email?: string; already_unsubscribed?: boolean } | null>(null);
  const [loading, setLoading] = useState(true);
  const [done, setDone] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!token) { setError(t('unsubscribe.invalidLink')); setLoading(false); return; }
    supabase.functions.invoke('unsubscribe-newsletter', { body: { token, action: 'preview' } })
      .then(({ data, error }) => {
        if (error || !data?.found) setError(t('unsubscribe.invalidOrExpired'));
        else { setInfo(data); if (data.already_unsubscribed) setDone(true); }
      })
      .finally(() => setLoading(false));
  }, [token, t]);

  const confirm = async () => {
    setLoading(true);
    const { data, error } = await supabase.functions.invoke('unsubscribe-newsletter', { body: { token, action: 'unsubscribe' } });
    setLoading(false);
    if (error || !data?.success) setError(t('unsubscribe.error'));
    else setDone(true);
  };

  const scopeName = info?.scope_name || info?.venue_name || '';

  return (
    <div className="min-h-screen flex items-center justify-center bg-background p-4">
      <Card className="max-w-md w-full">
        <CardContent className="p-8 text-center">
          {loading ? (
            <Loader2 className="w-8 h-8 mx-auto animate-spin" />
          ) : error ? (
            <>
              <Mail className="w-12 h-12 mx-auto mb-4 text-muted-foreground" />
              <p className="text-destructive">{error}</p>
            </>
          ) : done ? (
            <>
              <CheckCircle2 className="w-12 h-12 mx-auto mb-4 text-green-500" />
              <h1 className="text-xl font-bold mb-2">{t('unsubscribe.doneTitle')}</h1>
              <p className="text-muted-foreground">{t('unsubscribe.doneBody').replace('{name}', scopeName)}</p>
            </>
          ) : (
            <>
              <Mail className="w-12 h-12 mx-auto mb-4 text-primary" />
              <h1 className="text-xl font-bold mb-2">{t('unsubscribe.confirmTitle')}</h1>
              <p className="text-muted-foreground mb-6">
                {t('unsubscribe.confirmBody').replace('{name}', scopeName).replace('{email}', info?.email || '')}
              </p>
              <Button onClick={confirm} className="w-full">{t('unsubscribe.cta')}</Button>
            </>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
