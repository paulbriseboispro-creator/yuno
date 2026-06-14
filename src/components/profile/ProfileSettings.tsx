import { useState } from 'react';
import { ChevronDown, ChevronUp, User, Lock, Globe, LogOut, MapPin, Shield, Bell } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Switch } from '@/components/ui/switch';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from '@/components/ui/collapsible';
import { Separator } from '@/components/ui/separator';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { supabase } from '@/integrations/supabase/client';
import { toast } from 'sonner';
import { useLanguage } from '@/contexts/LanguageContext';
import { useNavigate } from 'react-router-dom';
import { usePushNotifications } from '@/hooks/usePushNotifications';

interface ProfileSettingsProps {
  firstName: string | null;
  lastName: string | null;
  city: string | null;
  birthDate: string | null;
  email: string;
  mfaEnabled: boolean;
  showMfaOption: boolean;
  onUpdateProfile: (updates: { first_name?: string; last_name?: string; city?: string; birth_date?: string }) => Promise<{ success: boolean }>;
  onDisableMFA: () => void;
}

export function ProfileSettings({
  firstName,
  lastName,
  city,
  birthDate,
  email,
  mfaEnabled,
  showMfaOption,
  onUpdateProfile,
  onDisableMFA
}: ProfileSettingsProps) {
  const { t, language, setLanguage } = useLanguage();
  const navigate = useNavigate();
  const [isOpen, setIsOpen] = useState(false);
  const [editMode, setEditMode] = useState(false);
  const [saving, setSaving] = useState(false);
  const { isSupported: pushSupported, isSubscribed: pushSubscribed, isLoading: pushLoading, subscribe: pushSubscribe, unsubscribe: pushUnsubscribe, permission: pushPermission, isiOS, isPWA } = usePushNotifications();

  const [formData, setFormData] = useState({
    first_name: firstName || '',
    last_name: lastName || '',
    city: city || '',
    birth_date: birthDate || ''
  });

  const formatDisplayDate = (dateStr: string | null) => {
    if (!dateStr) return '—';
    const date = new Date(dateStr);
    return date.toLocaleDateString('fr-FR');
  };

  const handleSave = async () => {
    setSaving(true);
    const result = await onUpdateProfile(formData);
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
      const { error } = await supabase.auth.resetPasswordForEmail(email, {
        redirectTo: `${window.location.origin}/auth`
      });
      if (error) throw error;
      toast.success(t('profile.resetEmailSent'));
    } catch (error) {
      toast.error(t('profile.resetError'));
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

  return (
    <Card className="border-border/50">
      <Collapsible open={isOpen} onOpenChange={setIsOpen}>
        <CollapsibleTrigger asChild>
          <CardHeader className="cursor-pointer hover:bg-accent/30 transition-colors rounded-t-lg">
            <CardTitle className="text-lg flex items-center justify-between">
              <span className="flex items-center gap-2">
                <span className="text-xl">⚙️</span>
                {t('profile.settings')}
              </span>
              {isOpen ? (
                <ChevronUp className="h-5 w-5 text-muted-foreground" />
              ) : (
                <ChevronDown className="h-5 w-5 text-muted-foreground" />
              )}
            </CardTitle>
          </CardHeader>
        </CollapsibleTrigger>

        <CollapsibleContent>
          <CardContent className="space-y-6 pt-0">
            {/* Personal Information */}
            <div className="space-y-4">
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
                      <Label htmlFor="first_name" className="text-xs">
                        {t('profile.firstName')}
                      </Label>
                      <Input
                        id="first_name"
                        value={formData.first_name}
                        onChange={(e) => setFormData(p => ({ ...p, first_name: e.target.value }))}
                        className="mt-1"
                      />
                    </div>
                    <div>
                      <Label htmlFor="last_name" className="text-xs">
                        {t('profile.lastName')}
                      </Label>
                      <Input
                        id="last_name"
                        value={formData.last_name}
                        onChange={(e) => setFormData(p => ({ ...p, last_name: e.target.value }))}
                        className="mt-1"
                      />
                    </div>
                  </div>
                  <div>
                    <Label htmlFor="city" className="text-xs">
                      {t('profile.city')}
                    </Label>
                    <div className="relative mt-1">
                      <MapPin className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
                      <Input
                        id="city"
                        value={formData.city}
                        onChange={(e) => setFormData(p => ({ ...p, city: e.target.value }))}
                        className="pl-9"
                        placeholder="Paris"
                      />
                    </div>
                  </div>
                  <div>
                    <Label htmlFor="birth_date" className="text-xs">
                      {t('profile.birthDate')}
                    </Label>
                    <Input
                      id="birth_date"
                      type="date"
                      value={formData.birth_date}
                      onChange={(e) => setFormData(p => ({ ...p, birth_date: e.target.value }))}
                      className="mt-1"
                      max={new Date().toISOString().split('T')[0]}
                    />
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
                    <span className="font-medium">{firstName} {lastName}</span>
                  </div>
                  <div className="flex justify-between py-2">
                    <span className="text-muted-foreground">{t('profile.city')}</span>
                    <span className="font-medium">{city || '—'}</span>
                  </div>
                  <div className="flex justify-between py-2">
                    <span className="text-muted-foreground">{t('profile.birthDate')}</span>
                    <span className="font-medium">{formatDisplayDate(birthDate)}</span>
                  </div>
                  <div className="flex justify-between py-2">
                    <span className="text-muted-foreground">{t('profile.email')}</span>
                    <span className="font-medium truncate max-w-[180px]">{email}</span>
                  </div>
                </div>
              )}
            </div>

            <Separator />

            {/* Security */}
            <div className="space-y-3">
              <div className="flex items-center gap-2 text-sm font-medium text-muted-foreground">
                <Lock className="h-4 w-4" />
                {t('profile.security')}
              </div>
              <Button variant="outline" className="w-full justify-start" onClick={handleResetPassword}>
                {t('profile.changePassword')}
              </Button>
              
              {showMfaOption && (
                <Button 
                  variant="outline" 
                  className="w-full justify-start"
                  onClick={() => mfaEnabled ? onDisableMFA() : navigate('/mfa-setup')}
                >
                  <Shield className="h-4 w-4 mr-2" />
                  {mfaEnabled 
                    ? t('profile.disableMFA')
                    : t('profile.enableMFA')
                  }
                </Button>
              )}
            </div>

            <Separator />

            {/* Notifications */}
            <div className="space-y-3">
              <div className="flex items-center gap-2 text-sm font-medium text-muted-foreground">
                <Bell className="h-4 w-4" />
                {t('notifications.title')}
              </div>
              {isiOS && !isPWA ? (
                <p className="text-xs text-muted-foreground">{t('notifications.iosInstall')}</p>
              ) : !pushSupported ? (
                <p className="text-xs text-muted-foreground">{t('notifications.notSupported')}</p>
              ) : pushPermission === 'denied' ? (
                <p className="text-xs text-muted-foreground">{t('notifications.denied')}</p>
              ) : (
                <div className="flex items-center justify-between">
                  <span className="text-sm">{t('notifications.title')}</span>
                  <Switch
                    checked={pushSubscribed}
                    disabled={pushLoading}
                    onCheckedChange={async (checked) => {
                      try {
                        if (checked) {
                          await pushSubscribe();
                          toast.success(t('notifications.enabled'));
                        } else {
                          await pushUnsubscribe();
                          toast.success(t('notifications.disabled'));
                        }
                      } catch {
                        toast.error(t('notifications.error'));
                      }
                    }}
                  />
                </div>
              )}
            </div>

            <Separator />

            {/* Preferences */}
            <div className="space-y-3">
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
            </div>

            <Separator />

            {/* Sign Out */}
            <Button 
              variant="destructive" 
              className="w-full"
              onClick={handleSignOut}
            >
              <LogOut className="h-4 w-4 mr-2" />
              {t('profile.signOut')}
            </Button>
          </CardContent>
        </CollapsibleContent>
      </Collapsible>
    </Card>
  );
}
