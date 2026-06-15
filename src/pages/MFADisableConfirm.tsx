import { useState, useEffect } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { Shield, CheckCircle, XCircle, Loader2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { supabase } from '@/integrations/supabase/client';

export default function MFADisableConfirm() {
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const token = searchParams.get('token');
  
  const [status, setStatus] = useState<'loading' | 'success' | 'error'>('loading');
  const [errorMessage, setErrorMessage] = useState('');

  useEffect(() => {
    if (!token) {
      setStatus('error');
      setErrorMessage('Lien invalide — aucun token trouvé.');
      return;
    }
    confirmDisable();
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  const confirmDisable = async () => {
    try {
      const { data, error } = await supabase.functions.invoke('mfa', {
        body: { action: 'disable-confirm', token },
      });

      if (error) {
        // supabase.functions.invoke wraps non-2xx as FunctionsHttpError
        // Try to extract the JSON error message
        const msg = typeof error === 'object' && 'message' in error ? error.message : String(error);
        throw new Error(msg);
      }
      
      if (data?.error) throw new Error(data.error);

      setStatus('success');
    } catch (err: any) {
      console.error('MFA disable error:', err);
      setStatus('error');
      setErrorMessage(err.message || 'Une erreur est survenue.');
    }
  };

  return (
    <div className="min-h-screen bg-background flex items-center justify-center p-4" style={{ position: 'relative', zIndex: 50 }}>
      <Card className="max-w-md w-full border-border/50">
        <CardContent className="p-8 text-center space-y-6">
          {status === 'loading' && (
            <>
              <Loader2 className="h-12 w-12 animate-spin text-primary mx-auto" />
              <h1 className="text-xl font-semibold">Désactivation en cours…</h1>
              <p className="text-muted-foreground text-sm">
                Nous vérifions ton lien et désactivons la 2FA.
              </p>
            </>
          )}

          {status === 'success' && (
            <>
              <div className="p-4 rounded-full bg-primary/10 w-fit mx-auto">
                <CheckCircle className="h-12 w-12 text-primary" />
              </div>
              <h1 className="text-xl font-semibold">2FA désactivée ✅</h1>
              <p className="text-muted-foreground text-sm">
                L'authentification à deux facteurs a été désactivée avec succès.
                Tu vas maintenant pouvoir reconfigurer ta 2FA.
              </p>
              <Button onClick={() => navigate('/mfa-setup')} className="w-full">
                <Shield className="h-4 w-4 mr-2" />
                Configurer la 2FA →
              </Button>
              <Button variant="outline" onClick={() => navigate('/settings')} className="w-full">
                Retour aux paramètres
              </Button>
            </>
          )}

          {status === 'error' && (
            <>
              <div className="p-4 rounded-full bg-destructive/10 w-fit mx-auto">
                <XCircle className="h-12 w-12 text-destructive" />
              </div>
              <h1 className="text-xl font-semibold">Erreur</h1>
              <p className="text-muted-foreground text-sm">
                {errorMessage}
              </p>
              <Button onClick={() => navigate('/settings')} className="w-full">
                Retour aux paramètres
              </Button>
            </>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
