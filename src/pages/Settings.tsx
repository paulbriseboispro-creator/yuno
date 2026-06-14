import { useState, useEffect } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { ArrowLeft, User, Lock, Globe, LogOut, MapPin, Shield, FileText, ScrollText, ShoppingBag, Building2, Cookie, Bell, BellOff, Smartphone, Loader2, Mail, Trophy } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Separator } from '@/components/ui/separator';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from '@/components/ui/dialog';
import { supabase } from '@/integrations/supabase/client';
import { usePushNotifications } from '@/hooks/usePushNotifications';
import { toast } from 'sonner';
import { useLanguage } from '@/contexts/LanguageContext';
import { useAuth } from '@/hooks/useAuth';
import { useNightlifeProfile } from '@/hooks/useNightlifeProfile';
import { legalContent, type LegalSection } from '@/data/legalContent';

export default function Settings() {
  const { t, language, setLanguage } = useLanguage();
  const navigate = useNavigate();
  const [searchParams, setSearchParams] = useSearchParams();
  const { user } = useAuth();
  const { profile, updateProfile } = useNightlifeProfile();
  
  const [editMode, setEditMode] = useState(false);
  const [saving, setSaving] = useState(false);
  const [mfaEnabled, setMfaEnabled] = useState(false);
  const [isOwner, setIsOwner] = useState(false);

  // Email change state
  const [emailChangeLoading, setEmailChangeLoading] = useState(false);
  const [showNewEmailDialog, setShowNewEmailDialog] = useState(false);
  const [newEmailRequestId, setNewEmailRequestId] = useState<string | null>(null);
  const [newEmail, setNewEmail] = useState('');
  const [submittingNewEmail, setSubmittingNewEmail] = useState(false);

  const [formData, setFormData] = useState({
    first_name: '',
    last_name: '',
    city: '',
    birth_date: ''
  });

  useEffect(() => {
    if (profile) {
      setFormData({
        first_name: profile.first_name || '',
        last_name: profile.last_name || '',
        city: profile.city || '',
        birth_date: profile.birth_date || ''
      });
    }
  }, [profile]);

  useEffect(() => {
    if (user) {
      fetchMfaStatus();
      checkOwnerRole();
    }
  }, [user]);

  // Handle email change token from URL
  useEffect(() => {
    const token = searchParams.get('email_change_token');
    if (token) {
      handleEmailChangeToken(token);
      // Clean URL
      searchParams.delete('email_change_token');
      setSearchParams(searchParams, { replace: true });
    }
  }, [searchParams]);

  const handleEmailChangeToken = async (token: string) => {
    try {
      const { data, error } = await supabase.functions.invoke('verify-email-change', {
        body: { token },
      });
      if (error) throw error;
      if (data?.error) throw new Error(data.error);

      if (data?.status === 'pending_new_email') {
        setNewEmailRequestId(data.request_id);
        setShowNewEmailDialog(true);
        toast.success(t('profile.emailChangeVerified'));
      } else if (data?.status === 'completed') {
        toast.success(t('profile.emailChangeComplete'));
        // Reload to refresh profile
        window.location.reload();
      }
    } catch (error: any) {
      toast.error(error.message || t('profile.emailChangeError'));
    }
  };

  const handleRequestEmailChange = async () => {
    setEmailChangeLoading(true);
    try {
      const { data, error } = await supabase.functions.invoke('request-email-change', {
        body: { origin: window.location.origin },
      });
      if (error) throw error;
      if (data?.error) throw new Error(data.error);
      toast.success(t('profile.emailChangeRequested'));
    } catch (error: any) {
      toast.error(error.message || t('profile.emailChangeError'));
    } finally {
      setEmailChangeLoading(false);
    }
  };

  const handleSubmitNewEmail = async () => {
    if (!newEmail.trim() || !newEmailRequestId) return;
    setSubmittingNewEmail(true);
    try {
      const { data, error } = await supabase.functions.invoke('submit-new-email', {
        body: {
          request_id: newEmailRequestId,
          new_email: newEmail.trim(),
          origin: window.location.origin,
        },
      });
      if (error) throw error;
      if (data?.error) throw new Error(data.error);
      setShowNewEmailDialog(false);
      setNewEmail('');
      toast.success(t('profile.newEmailSent'));
    } catch (error: any) {
      toast.error(error.message || t('profile.emailChangeError'));
    } finally {
      setSubmittingNewEmail(false);
    }
  };

  const fetchMfaStatus = async () => {
    try {
      const { data } = await supabase.from('profiles').select('mfa_enabled').eq('id', user?.id).single();
      if (data) setMfaEnabled(data.mfa_enabled || false);
    } catch (e) { /* ignore */ }
  };

  const checkOwnerRole = async () => {
    try {
      const { data } = await supabase.from('user_roles').select('role').eq('user_id', user?.id).eq('role', 'owner');
      setIsOwner((data && data.length > 0) || false);
    } catch (e) { /* ignore */ }
  };

  const formatDisplayDate = (dateStr: string | null) => {
    if (!dateStr) return '—';
    return new Date(dateStr).toLocaleDateString(language === 'fr' ? 'fr-FR' : language === 'es' ? 'es-ES' : 'en-US');
  };

  const handleSave = async () => {
    setSaving(true);
    const result = await updateProfile(formData);
    setSaving(false);
    if (result.success) {
      toast.success(t('profile.saved'));
      setEditMode(false);
    } else {
      toast.error(t('profile.saveError'));
    }
  };

  const handleResetPassword = async () => {
    try {
      const email = profile?.email || user?.email || '';
      const { error } = await supabase.auth.resetPasswordForEmail(email, {
        redirectTo: `${window.location.origin}/auth`
      });
      if (error) throw error;
      toast.success(t('profile.resetEmailSent'));
    } catch {
      toast.error(t('profile.resetError'));
    }
  };

  const handleDisableMFA = async () => {
    if (!confirm(t('profile.confirmDisable2FA') || 'Un email de vérification sera envoyé pour confirmer la désactivation. Continuer ?')) return;
    try {
      const { data, error } = await supabase.functions.invoke('mfa-disable', { body: { action: 'request' } });
      if (error) throw error;
      if (data?.error) throw new Error(data.error);
      toast.success('📧 Email de vérification envoyé ! Vérifie ta boîte mail pour confirmer.');
    } catch (error: any) {
      toast.error(error.message || t('profile.mfaError'));
    }
  };

  const handleSignOut = async () => {
    await supabase.auth.signOut();
    navigate('/');
  };

  const languageLabels: Record<string, { label: string; flag: string }> = {
    fr: { label: 'Français', flag: '🇫🇷' },
    en: { label: 'English', flag: '🇬🇧' },
    es: { label: 'Español', flag: '🇪🇸' }
  };

  const legalLinks: { key: LegalSection; icon: React.ReactNode }[] = [
    { key: 'mentions-legales', icon: <FileText className="h-4 w-4" /> },
    { key: 'cgu', icon: <ScrollText className="h-4 w-4" /> },
    { key: 'cgv-utilisateurs', icon: <ShoppingBag className="h-4 w-4" /> },
    { key: 'cgv-clubs', icon: <Building2 className="h-4 w-4" /> },
    { key: 'privacy', icon: <Shield className="h-4 w-4" /> },
    { key: 'cookies', icon: <Cookie className="h-4 w-4" /> },
  ];

  function NotificationCard() {
    const { isSupported, isSubscribed, permission, isLoading, isiOS, isPWA, subscribe, unsubscribe } = usePushNotifications();

    const handleEnable = async () => {
      try {
        await subscribe();
        toast.success(t('notifications.enabled'));
      } catch (error: any) {
        if (error.message === 'Permission denied') {
          // User denied the system prompt
        } else {
          toast.error(error.message || t('notifications.error'));
        }
      }
    };

    const handleDisable = async () => {
      try {
        await unsubscribe();
        toast.success(t('notifications.disabled'));
      } catch (error: any) {
        toast.error(error.message || t('notifications.error'));
      }
    };

    if (isiOS && !isPWA) {
      return (
        <Card className="border-border/50">
          <CardContent className="p-4 space-y-3">
            <div className="flex items-center gap-2 text-sm font-medium text-muted-foreground">
              <Smartphone className="h-4 w-4" />
              {t('notifications.title')}
            </div>
            <p className="text-xs text-muted-foreground">{t('notifications.iosInstall')}</p>
          </CardContent>
        </Card>
      );
    }

    if (permission === 'denied') {
      return (
        <Card className="border-border/50">
          <CardContent className="p-4 space-y-3">
            <div className="flex items-center gap-2 text-sm font-medium text-muted-foreground">
              <BellOff className="h-4 w-4" />
              {t('notifications.title')}
            </div>
            <p className="text-xs text-muted-foreground">
              {language === 'fr' 
                ? 'Désactivé — réactive les notifications dans Réglages iOS > Safari / Yuno.'
                : language === 'es'
                ? 'Desactivado — reactiva las notificaciones en Ajustes iOS > Safari / Yuno.'
                : 'Disabled — re-enable notifications in iOS Settings > Safari / Yuno.'}
            </p>
          </CardContent>
        </Card>
      );
    }

    if (!isSupported) {
      return (
        <Card className="border-border/50">
          <CardContent className="p-4 space-y-3">
            <div className="flex items-center gap-2 text-sm font-medium text-muted-foreground">
              <BellOff className="h-4 w-4" />
              {t('notifications.title')}
            </div>
            <p className="text-xs text-muted-foreground">{t('notifications.notSupported')}</p>
          </CardContent>
        </Card>
      );
    }

    if (isSubscribed) {
      return (
        <Card className="border-border/50">
          <CardContent className="p-4 space-y-3">
            <div className="flex items-center gap-2 text-sm font-medium text-primary">
              <Bell className="h-4 w-4" />
              {t('notifications.title')}
            </div>
            <div className="flex items-center justify-between">
              <span className="text-sm text-foreground">
                {language === 'fr' ? 'Notifications activées' : language === 'es' ? 'Notificaciones activadas' : 'Notifications enabled'}
              </span>
              <Button variant="outline" size="sm" onClick={handleDisable} disabled={isLoading} className="text-xs">
                {isLoading ? <Loader2 className="h-3 w-3 animate-spin" /> : (language === 'fr' ? 'Désactiver' : language === 'es' ? 'Desactivar' : 'Disable')}
              </Button>
            </div>
          </CardContent>
        </Card>
      );
    }

    return (
      <Card className="border-border/50">
        <CardContent className="p-4 space-y-3">
          <div className="flex items-center gap-2 text-sm font-medium text-muted-foreground">
            <BellOff className="h-4 w-4" />
            {t('notifications.title')}
          </div>
          <Button onClick={handleEnable} disabled={isLoading} className="w-full rounded-xl h-11 text-sm font-semibold">
            {isLoading ? <Loader2 className="h-4 w-4 animate-spin mr-2" /> : <Bell className="h-4 w-4 mr-2" />}
            {language === 'fr' ? 'Activer les notifications' : language === 'es' ? 'Activar notificaciones' : 'Enable notifications'}
          </Button>
        </CardContent>
      </Card>
    );
  }

  return (
    <div className="min-h-screen bg-background pb-12">
      <header className="sticky top-0 z-40 border-b border-border/40 bg-surface/80 backdrop-blur-md">
        <div className="mx-auto flex h-14 max-w-3xl items-center gap-3 px-3">
          <Button variant="ghost" size="icon" onClick={() => navigate('/profile')} className="h-9 w-9">
            <ArrowLeft className="h-4 w-4" />
          </Button>
          <h1 className="text-base font-semibold flex-1">{t('profile.settings')}</h1>
        </div>
      </header>

      <div className="mx-auto max-w-3xl p-3 sm:p-4 space-y-4">
        {/* Personal Information */}
        <Card className="border-border/50">
          <CardContent className="p-4 space-y-4">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2 text-sm font-medium text-muted-foreground">
                <User className="h-4 w-4" />
                {t('profile.personalInfo')}
              </div>
              {!editMode && (
                <Button variant="ghost" size="sm" onClick={() => setEditMode(true)}>
                  {t('profile.edit')}
                </Button>
              )}
            </div>

            {editMode ? (
              <div className="space-y-3">
                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <Label htmlFor="first_name" className="text-xs">{t('profile.firstName')}</Label>
                    <Input id="first_name" value={formData.first_name} onChange={(e) => setFormData(p => ({ ...p, first_name: e.target.value }))} className="mt-1" />
                  </div>
                  <div>
                    <Label htmlFor="last_name" className="text-xs">{t('profile.lastName')}</Label>
                    <Input id="last_name" value={formData.last_name} onChange={(e) => setFormData(p => ({ ...p, last_name: e.target.value }))} className="mt-1" />
                  </div>
                </div>
                <div>
                  <Label htmlFor="city" className="text-xs">{t('profile.city')}</Label>
                  <div className="relative mt-1">
                    <MapPin className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
                    <Input id="city" value={formData.city} onChange={(e) => setFormData(p => ({ ...p, city: e.target.value }))} className="pl-9" placeholder="Paris" />
                  </div>
                </div>
                <div>
                  <Label htmlFor="birth_date" className="text-xs">{t('profile.birthDate')}</Label>
                  <Input id="birth_date" type="date" value={formData.birth_date} onChange={(e) => setFormData(p => ({ ...p, birth_date: e.target.value }))} className="mt-1" max={new Date().toISOString().split('T')[0]} />
                </div>
                <div className="flex gap-2">
                  <Button onClick={handleSave} disabled={saving} size="sm">
                    {saving ? t('profile.saving') : t('profile.save')}
                  </Button>
                  <Button variant="outline" size="sm" onClick={() => setEditMode(false)}>
                    {t('profile.cancel')}
                  </Button>
                </div>
              </div>
            ) : (
              <div className="space-y-2 text-sm">
                <div className="flex justify-between py-2">
                  <span className="text-muted-foreground">{t('profile.name')}</span>
                  <span className="font-medium">{profile?.first_name} {profile?.last_name}</span>
                </div>
                <div className="flex justify-between py-2">
                  <span className="text-muted-foreground">{t('profile.city')}</span>
                  <span className="font-medium">{profile?.city || '—'}</span>
                </div>
                <div className="flex justify-between py-2">
                  <span className="text-muted-foreground">{t('profile.birthDate')}</span>
                  <span className="font-medium">{formatDisplayDate(profile?.birth_date || null)}</span>
                </div>
                <div className="flex justify-between py-2">
                  <span className="text-muted-foreground">{t('profile.email')}</span>
                  <span className="font-medium truncate max-w-[180px]">{profile?.email || user?.email}</span>
                </div>
                <Button
                  variant="outline"
                  size="sm"
                  className="w-full mt-2"
                  onClick={handleRequestEmailChange}
                  disabled={emailChangeLoading}
                >
                  {emailChangeLoading ? (
                    <Loader2 className="h-3 w-3 animate-spin mr-2" />
                  ) : (
                    <Mail className="h-3 w-3 mr-2" />
                  )}
                  {t('profile.changeEmail')}
                </Button>
              </div>
            )}
          </CardContent>
        </Card>

        {/* Security */}
        <Card className="border-border/50">
          <CardContent className="p-4 space-y-3">
            <div className="flex items-center gap-2 text-sm font-medium text-muted-foreground">
              <Lock className="h-4 w-4" />
              {t('profile.security')}
            </div>
            <Button variant="outline" className="w-full justify-start" onClick={handleResetPassword}>
              {t('profile.changePassword')}
            </Button>
            {mfaEnabled && (
              <Button variant="outline" className="w-full justify-start" onClick={handleDisableMFA}>
                <Shield className="h-4 w-4 mr-2" />
                {t('profile.disableMFA')}
              </Button>
            )}
            {isOwner && !mfaEnabled && (
              <Button variant="outline" className="w-full justify-start" onClick={() => navigate('/mfa-setup')}>
                <Shield className="h-4 w-4 mr-2" />
                {t('profile.enableMFA')}
              </Button>
            )}
          </CardContent>
        </Card>

        {/* Notifications */}
        <NotificationCard />

        {/* Preferences */}
        <Card className="border-border/50">
          <CardContent className="p-4 space-y-3">
            <div className="flex items-center gap-2 text-sm font-medium text-muted-foreground">
              <Globe className="h-4 w-4" />
              {t('profile.preferences')}
            </div>
            <div className="flex items-center justify-between">
              <span className="text-sm">{t('profile.language')}</span>
              <Select value={language} onValueChange={(val) => setLanguage(val as 'en' | 'fr' | 'es')}>
                <SelectTrigger className="w-[140px]">
                  <SelectValue>
                    {languageLabels[language].flag} {languageLabels[language].label}
                  </SelectValue>
                </SelectTrigger>
                <SelectContent>
                  {Object.entries(languageLabels).map(([code, { label, flag }]) => (
                    <SelectItem key={code} value={code}>
                      {flag} {label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </CardContent>
        </Card>

        {/* Leaderboard Privacy */}
        <Card className="border-border/50">
          <CardContent className="p-4 space-y-3">
            <div className="flex items-center gap-2 text-sm font-medium text-muted-foreground">
              <Trophy className="h-4 w-4" />
              {language === 'fr' ? 'Classement & Visibilité' : language === 'es' ? 'Clasificación & Visibilidad' : 'Leaderboard & Visibility'}
            </div>
            <div className="flex items-center justify-between">
              <div>
                <span className="text-sm">{language === 'fr' ? 'Apparence dans les classements' : language === 'es' ? 'Apariencia en rankings' : 'Leaderboard display'}</span>
                <p className="text-xs text-muted-foreground mt-0.5">
                  {language === 'fr' ? 'Contrôlez comment votre nom apparaît' : 'Control how your name appears'}
                </p>
              </div>
              <Select 
                value={profile?.leaderboard_visibility || 'public'} 
                onValueChange={async (val) => {
                  await updateProfile({ leaderboard_visibility: val });
                  toast.success(language === 'fr' ? 'Préférence mise à jour' : 'Preference updated');
                }}
              >
                <SelectTrigger className="w-[140px]">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="public">{language === 'fr' ? 'Public' : 'Public'}</SelectItem>
                  <SelectItem value="anonymous">{language === 'fr' ? 'Anonyme' : 'Anonymous'}</SelectItem>
                  <SelectItem value="hidden">{language === 'fr' ? 'Masqué' : 'Hidden'}</SelectItem>
                </SelectContent>
              </Select>
            </div>
          </CardContent>
        </Card>

        {/* Legal */}
        <Card className="border-border/50">
          <CardContent className="p-4 space-y-2">
            <div className="flex items-center gap-2 text-sm font-medium text-muted-foreground mb-2">
              <FileText className="h-4 w-4" />
              {t('settings.legalInfo')}
            </div>
            {legalLinks.map(({ key, icon }) => (
              <Button
                key={key}
                variant="ghost"
                className="w-full justify-start gap-3 h-11 text-sm font-normal"
                onClick={() => navigate(`/legal/${key}`)}
              >
                {icon}
                {legalContent[key][language].title}
              </Button>
            ))}
          </CardContent>
        </Card>

        <Separator />

        {/* Sign Out */}
        <Button variant="destructive" className="w-full" onClick={handleSignOut}>
          <LogOut className="h-4 w-4 mr-2" />
          {t('profile.signOut')}
        </Button>
      </div>

      {/* New Email Dialog */}
      <Dialog open={showNewEmailDialog} onOpenChange={setShowNewEmailDialog}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{t('profile.enterNewEmail')}</DialogTitle>
            <DialogDescription>
              {t('profile.enterNewEmailDesc')}
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-4 pt-2">
            <div>
              <Label htmlFor="new_email" className="text-xs">{t('profile.newEmail')}</Label>
              <Input
                id="new_email"
                type="email"
                value={newEmail}
                onChange={(e) => setNewEmail(e.target.value)}
                placeholder="new@example.com"
                className="mt-1"
              />
            </div>
            <div className="flex gap-2 justify-end">
              <Button variant="outline" onClick={() => setShowNewEmailDialog(false)}>
                {t('profile.cancel')}
              </Button>
              <Button onClick={handleSubmitNewEmail} disabled={submittingNewEmail || !newEmail.trim()}>
                {submittingNewEmail ? <Loader2 className="h-4 w-4 animate-spin mr-2" /> : null}
                {t('profile.confirmNewEmail')}
              </Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}
