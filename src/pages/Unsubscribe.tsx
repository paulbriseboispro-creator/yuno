import { useEffect, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { supabase } from '@/integrations/supabase/client';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { Mail, CheckCircle2, Loader2 } from 'lucide-react';

export default function Unsubscribe() {
  const [params] = useSearchParams();
  const token = params.get('token');
  const [info, setInfo] = useState<{ scope_name?: string; venue_name?: string; email?: string; already_unsubscribed?: boolean } | null>(null);
  const [loading, setLoading] = useState(true);
  const [done, setDone] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!token) { setError('Lien invalide'); setLoading(false); return; }
    supabase.functions.invoke('unsubscribe-newsletter', { body: { token, action: 'preview' } })
      .then(({ data, error }) => {
        if (error || !data?.found) setError('Lien invalide ou expiré');
        else { setInfo(data); if (data.already_unsubscribed) setDone(true); }
      })
      .finally(() => setLoading(false));
  }, [token]);

  const confirm = async () => {
    setLoading(true);
    const { data, error } = await supabase.functions.invoke('unsubscribe-newsletter', { body: { token, action: 'unsubscribe' } });
    setLoading(false);
    if (error || !data?.success) setError('Erreur lors du désabonnement');
    else setDone(true);
  };

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
              <h1 className="text-xl font-bold mb-2">Vous êtes désabonné</h1>
              <p className="text-muted-foreground">Vous ne recevrez plus de newsletters de {info?.scope_name || info?.venue_name}.</p>
            </>
          ) : (
            <>
              <Mail className="w-12 h-12 mx-auto mb-4 text-primary" />
              <h1 className="text-xl font-bold mb-2">Confirmer le désabonnement</h1>
              <p className="text-muted-foreground mb-6">
                Vous vous désabonnez de la newsletter de <strong>{info?.scope_name || info?.venue_name}</strong> pour l'adresse <strong>{info?.email}</strong>.
              </p>
              <Button onClick={confirm} className="w-full">Me désabonner</Button>
            </>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
