import { useState } from 'react';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Switch } from '@/components/ui/switch';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { Badge } from '@/components/ui/badge';
import { useMaintenanceMode } from '@/hooks/useMaintenanceMode';
import { useLanguage } from '@/contexts/LanguageContext';
import { toast } from 'sonner';
import { Lock, Unlock, AlertTriangle, Users, Save, Eye, EyeOff, Key } from 'lucide-react';

export function MaintenanceToggle() {
  const { t } = useLanguage();
  const { isMaintenanceMode, message, maintenancePassword, loading, toggleMaintenanceMode, updatePassword } = useMaintenanceMode();
  const [customMessage, setCustomMessage] = useState(message || '');
  const [newPassword, setNewPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [updating, setUpdating] = useState(false);

  const handleToggle = async (enabled: boolean) => {
    setUpdating(true);
    const result = await toggleMaintenanceMode(enabled, customMessage);
    setUpdating(false);

    if (result.success) {
      toast.success(enabled ? t('maintenance.toggleEnabled') : t('maintenance.toggleDisabled'));
    } else {
      toast.error(t('maintenance.errorPrefix') + result.error);
    }
  };

  const handleSaveMessage = async () => {
    setUpdating(true);
    const result = await toggleMaintenanceMode(isMaintenanceMode, customMessage);
    setUpdating(false);

    if (result.success) {
      toast.success(t('maintenance.messageUpdated'));
    } else {
      toast.error(t('maintenance.errorPrefix') + result.error);
    }
  };

  const handleSavePassword = async () => {
    if (!newPassword.trim()) {
      toast.error(t('maintenance.passwordEmpty'));
      return;
    }

    setUpdating(true);
    const result = await updatePassword(newPassword.trim());
    setUpdating(false);

    if (result.success) {
      toast.success(t('maintenance.passwordUpdated'));
    } else {
      toast.error(t('maintenance.errorPrefix') + result.error);
    }
  };

  if (loading) {
    return (
      <Card>
        <CardContent className="p-6">
          <div className="h-8 w-8 animate-spin rounded-full border-4 border-primary border-t-transparent mx-auto" />
        </CardContent>
      </Card>
    );
  }

  return (
    <Card className={isMaintenanceMode ? 'border-destructive/50' : ''}>
      <CardHeader>
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-3">
            {isMaintenanceMode ? (
              <div className="p-2 rounded-lg bg-destructive/10">
                <Lock className="h-5 w-5 text-destructive" />
              </div>
            ) : (
              <div className="p-2 rounded-lg bg-green-500/10">
                <Unlock className="h-5 w-5 text-green-500" />
              </div>
            )}
            <div>
              <CardTitle className="flex items-center gap-2">
                {t('maintenance.title')}
                {isMaintenanceMode && (
                  <Badge variant="destructive" className="text-xs">
                    {t('maintenance.active')}
                  </Badge>
                )}
              </CardTitle>
              <CardDescription>
                {t('maintenance.lockDesc')}
              </CardDescription>
            </div>
          </div>
          <Switch
            checked={isMaintenanceMode}
            onCheckedChange={handleToggle}
            disabled={updating}
          />
        </div>
      </CardHeader>
      <CardContent className="space-y-4">
        {isMaintenanceMode && (
          <div className="flex items-start gap-2 p-3 rounded-lg bg-destructive/10 border border-destructive/20">
            <AlertTriangle className="h-5 w-5 text-destructive shrink-0 mt-0.5" />
            <p className="text-sm text-destructive">
              {t('maintenance.warningMsg')}
            </p>
          </div>
        )}

        <div className="space-y-2">
          <label className="text-sm font-medium text-foreground flex items-center gap-2">
            <Key className="h-4 w-4 text-primary" />
            {t('maintenance.passwordLabel')}
          </label>
          <div className="flex gap-2">
            <div className="relative flex-1">
              <Input
                type={showPassword ? 'text' : 'password'}
                value={newPassword}
                onChange={(e) => setNewPassword(e.target.value)}
                placeholder={t('maintenance.passwordPlaceholder')}
                className="pr-10"
              />
              <button
                type="button"
                onClick={() => setShowPassword(!showPassword)}
                className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground transition-colors"
              >
                {showPassword ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
              </button>
            </div>
            <Button
              variant="outline"
              size="icon"
              onClick={handleSavePassword}
              disabled={updating || newPassword === maintenancePassword}
            >
              <Save className="h-4 w-4" />
            </Button>
          </div>
          <p className="text-xs text-muted-foreground">
            {t('maintenance.passwordHint')}
          </p>
        </div>

        <div className="space-y-2">
          <label className="text-sm font-medium text-foreground">
            {t('maintenance.messageLabel')}
          </label>
          <Textarea
            value={customMessage}
            onChange={(e) => setCustomMessage(e.target.value)}
            placeholder={t('maintenance.messagePlaceholder')}
            rows={3}
            className="resize-none"
          />
          <Button
            variant="outline"
            size="sm"
            onClick={handleSaveMessage}
            disabled={updating || customMessage === message}
            className="gap-2"
          >
            <Save className="h-4 w-4" />
            {t('maintenance.saveMessage')}
          </Button>
        </div>

        <div className="pt-4 border-t border-border">
          <Button
            variant="ghost"
            size="sm"
            className="gap-2 text-muted-foreground"
            onClick={() => window.open('/admin/waitlist', '_blank')}
          >
            <Users className="h-4 w-4" />
            {t('maintenance.viewWaitlist')}
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}
