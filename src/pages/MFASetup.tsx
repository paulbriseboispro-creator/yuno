import { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { motion } from 'framer-motion';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { supabase } from '@/integrations/supabase/client';
import { toast } from 'sonner';
import { Shield, Download, CheckCircle, Loader2, Copy } from 'lucide-react';
import QRCode from 'qrcode';
import { useLanguage } from '@/contexts/LanguageContext';

export default function MFASetup() {
  const navigate = useNavigate();
  const { t } = useLanguage();
  const [loading, setLoading] = useState(false);
  const [step, setStep] = useState<'generate' | 'verify' | 'complete'>('generate');
  const [qrDataUrl, setQrDataUrl] = useState('');
  const [secret, setSecret] = useState('');
  const [code, setCode] = useState('');
  const [recoveryCodes, setRecoveryCodes] = useState<string[]>([]);
  const [userRole, setUserRole] = useState<string>('');

  useEffect(() => {
    checkUserRole();
  }, []);

  const checkUserRole = async () => {
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) {
      navigate('/auth');
      return;
    }

    // Check if user has owner or affiliate role (MFA required for both)
    const { data: roles } = await supabase
      .from('user_roles')
      .select('role')
      .eq('user_id', user.id);

    const isOwner = roles?.some(r => r.role === 'owner');
    const isAffiliate = roles?.some(r => r.role === 'affiliate');

    if (!isOwner && !isAffiliate) {
      toast.error(t('mfa.accessDenied'));
      navigate('/');
      return;
    }

    const detectedRole = isOwner ? 'owner' : 'affiliate';
    setUserRole(detectedRole);

    // Si la 2FA est déjà configurée, ne pas redemander l'activation
    const { data: profile } = await supabase
      .from('profiles')
      .select('mfa_enabled')
      .eq('id', user.id)
      .single();

    if (profile?.mfa_enabled) {
      toast.success(t('mfa.alreadyEnabled'));
      navigate(detectedRole === 'affiliate' ? '/affiliate' : '/owner');
    }
  };

  const generateSecret = async () => {
    setLoading(true);
    try {
      const { data, error } = await supabase.functions.invoke('mfa-generate-secret');

      if (error) throw error;

      const qr = await QRCode.toDataURL(data.otpauthUrl, {
        width: 300,
        margin: 2,
      });

      setQrDataUrl(qr);
      setSecret(data.secret);
      setStep('verify');
    } catch (error: any) {
      console.error('Erreur génération secret:', error);
      toast.error(error.message || t('mfa.incorrectCode'));
    } finally {
      setLoading(false);
    }
  };

  const copySecret = () => {
    navigator.clipboard.writeText(secret);
    toast.success(t('mfa.secretCopied'));
  };

  const formatSecret = (secret: string) => {
    return secret.match(/.{1,4}/g)?.join(' ') || secret;
  };

  const verifySetup = async () => {
    if (!/^\d{6}$/.test(code)) {
      toast.error(t('mfa.invalidCode'));
      return;
    }

    setLoading(true);
    try {
      const { data, error } = await supabase.functions.invoke('mfa-verify-setup', {
        body: { code },
      });

      if (error) throw error;

      setRecoveryCodes(data.recoveryCodes);
      setStep('complete');
      toast.success(t('mfa.activated'));
    } catch (error: any) {
      console.error('Erreur vérification:', error);
      toast.error(error.message || t('mfa.incorrectCode'));
    } finally {
      setLoading(false);
    }
  };

  const downloadRecoveryCodes = () => {
    const text = `Codes de récupération Yuno App\n\n${recoveryCodes.join('\n')}\n\nConservez ces codes en lieu sûr. Chaque code ne peut être utilisé qu'une seule fois.`;
    const blob = new Blob([text], { type: 'text/plain' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = 'yuno-recovery-codes.txt';
    a.click();
    URL.revokeObjectURL(url);
  };

  const finish = () => {
    navigate(userRole === 'affiliate' ? '/affiliate' : '/owner');
  };

  return (
    <div className="min-h-screen bg-background flex items-center justify-center p-4">
      <motion.div
        initial={{ opacity: 0, y: 20 }}
        animate={{ opacity: 1, y: 0 }}
        className="w-full max-w-md"
      >
        <Card className="p-8 border-0 bg-surface shadow-soft">
          <div className="flex items-center gap-3 mb-6">
            <Shield className="h-8 w-8 text-primary" />
            <h1 className="text-2xl font-bold">{t('mfa.title')}</h1>
          </div>

          {step === 'generate' && (
            <div className="space-y-4">
              <p className="text-muted-foreground">
                {t('mfa.description')}
                {userRole === 'owner' && t('mfa.ownerRequired')}
              </p>
              <Button
                onClick={generateSecret}
                disabled={loading}
                className="w-full"
                size="lg"
              >
                {loading ? (
                  <>
                    <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                    {t('mfa.generating')}
                  </>
                ) : (
                  t('mfa.activate')
                )}
              </Button>
            </div>
          )}

          {step === 'verify' && (
            <div className="space-y-6">
              <div className="text-center space-y-4">
                <p className="text-sm text-muted-foreground">
                  {t('mfa.scanQR')}
                </p>
                {qrDataUrl && (
                  <img
                    src={qrDataUrl}
                    alt="QR Code"
                    className="mx-auto rounded-lg"
                  />
                )}
              </div>

              <div className="space-y-3 p-4 bg-muted/50 rounded-lg">
                <p className="text-xs font-medium text-muted-foreground">
                  {t('mfa.manualSetup')}
                </p>
                <div className="flex items-center gap-2">
                  <code className="flex-1 text-xs font-mono bg-background p-3 rounded border">
                    {formatSecret(secret)}
                  </code>
                  <Button
                    onClick={copySecret}
                    variant="outline"
                    size="icon"
                    className="shrink-0"
                  >
                    <Copy className="h-4 w-4" />
                  </Button>
                </div>
                <p className="text-xs text-muted-foreground">
                  {t('mfa.manualInstructions')}
                </p>
              </div>

              <div className="space-y-2">
                <label className="text-sm font-medium">{t('mfa.verificationCode')}</label>
                <Input
                  type="text"
                  inputMode="numeric"
                  pattern="[0-9]*"
                  maxLength={6}
                  placeholder="000000"
                  value={code}
                  onChange={(e) => setCode(e.target.value.replace(/\D/g, ''))}
                  className="text-center text-2xl tracking-widest"
                />
              </div>

              <Button
                onClick={verifySetup}
                disabled={loading || code.length !== 6}
                className="w-full"
                size="lg"
              >
                {loading ? (
                  <>
                    <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                    {t('mfa.verifying')}
                  </>
                ) : (
                  t('mfa.verify')
                )}
              </Button>
            </div>
          )}

          {step === 'complete' && (
            <div className="space-y-6">
              <div className="flex items-center gap-2 text-green-600">
                <CheckCircle className="h-5 w-5" />
                <span className="font-semibold">{t('mfa.activated')}</span>
              </div>

              <div className="space-y-3">
                <p className="text-sm font-medium">{t('mfa.recoveryCodes')}</p>
                <p className="text-xs text-muted-foreground">
                  {t('mfa.recoveryCodesDesc')}
                </p>
                
                <div className="bg-muted rounded-lg p-4 space-y-1 font-mono text-sm">
                  {recoveryCodes.map((code, i) => (
                    <div key={i}>{code}</div>
                  ))}
                </div>

                <Button
                  onClick={downloadRecoveryCodes}
                  variant="outline"
                  className="w-full"
                >
                  <Download className="mr-2 h-4 w-4" />
                  {t('mfa.downloadCodes')}
                </Button>
              </div>

              <Button onClick={finish} className="w-full" size="lg">
                {t('mfa.continue')}
              </Button>
            </div>
          )}
        </Card>
      </motion.div>
    </div>
  );
}
