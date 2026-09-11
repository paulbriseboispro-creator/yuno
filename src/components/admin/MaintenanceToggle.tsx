import { useEffect, useState } from 'react';
import { useMaintenanceMode } from '@/hooks/useMaintenanceMode';
import { useLanguage } from '@/contexts/LanguageContext';
import { toast } from 'sonner';
import { Eye, EyeOff, Lock, Save, Users } from 'lucide-react';
import { Card, Toggle, Btn, Pill, INPUT_STYLE, LABEL_STYLE, NEG, T3, RED_SOFT_BG, RED_SOFT_BORDER } from '@/components/admin/ui';

/**
 * Interrupteur du mode maintenance (app_settings.maintenance_mode). Le mot de
 * passe de contournement est haché côté serveur (RPC update_maintenance_password)
 * et n'est jamais relu ; le message affiché aux visiteurs se règle ici.
 */
export function MaintenanceToggle() {
  const { t } = useLanguage();
  const { isMaintenanceMode, message, loading, toggleMaintenanceMode, updatePassword } = useMaintenanceMode();
  const [busy, setBusy] = useState(false);
  const [newPassword, setNewPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [customMessage, setCustomMessage] = useState('');
  const [touched, setTouched] = useState(false);

  // Le hook charge le message après le premier rendu : on synchronise le champ
  // tant que l'admin ne l'a pas modifié lui-même, sinon un « Enregistrer »
  // écraserait le message live par une chaîne vide.
  useEffect(() => { if (!touched) setCustomMessage(message ?? ''); }, [message, touched]);

  const handleToggle = async (enabled: boolean) => {
    setBusy(true);
    const result = await toggleMaintenanceMode(enabled, customMessage || undefined);
    setBusy(false);
    if (result.success) toast.success(enabled ? t('maintenance.toggleEnabled') : t('maintenance.toggleDisabled'));
    else toast.error(t('maintenance.errorPrefix') + (result.error ?? ''));
  };
  const handleSaveMessage = async () => {
    setBusy(true);
    const result = await toggleMaintenanceMode(isMaintenanceMode, customMessage);
    setBusy(false);
    if (result.success) { toast.success(t('maintenance.messageUpdated')); setTouched(false); }
    else toast.error(t('maintenance.errorPrefix') + (result.error ?? ''));
  };
  const handleSavePassword = async () => {
    if (!newPassword.trim()) { toast.error(t('maintenance.passwordEmpty')); return; }
    setBusy(true);
    const result = await updatePassword(newPassword.trim());
    setBusy(false);
    if (result.success) { toast.success(t('maintenance.passwordUpdated')); setNewPassword(''); }
    else toast.error(t('maintenance.errorPrefix') + (result.error ?? ''));
  };

  return (
    <Card title={t('maintenance.title')} subtitle={t('maintenance.lockDesc')} icon={Lock} accent={isMaintenanceMode}
      right={<div className="flex items-center gap-2">{isMaintenanceMode && <Pill tone="hot">{t('maintenance.active')}</Pill>}<Toggle checked={isMaintenanceMode} onChange={handleToggle} disabled={loading || busy} /></div>}>
      {isMaintenanceMode && (
        <div className="rounded-xl px-3 py-2.5 mb-4" style={{ background: RED_SOFT_BG, border: `1px solid ${RED_SOFT_BORDER}` }}>
          <p style={{ color: NEG, fontSize: 12.5, lineHeight: 1.5, margin: 0 }}>{t('maintenance.warningMsg')}</p>
        </div>
      )}
      <div className="space-y-4">
        <div>
          <label style={{ ...LABEL_STYLE, display: 'block', marginBottom: 6 }}>{t('maintenance.passwordLabel')}</label>
          <div className="flex gap-2">
            <div className="relative flex-1">
              <input type={showPassword ? 'text' : 'password'} value={newPassword} onChange={(e) => setNewPassword(e.target.value)} placeholder={t('maintenance.passwordPlaceholder')} style={{ ...INPUT_STYLE, paddingRight: 36 }} autoComplete="new-password" />
              <button type="button" onClick={() => setShowPassword((v) => !v)} className="absolute right-2.5 top-1/2 -translate-y-1/2 cursor-pointer" style={{ color: T3 }}>
                {showPassword ? <EyeOff className="w-3.5 h-3.5" /> : <Eye className="w-3.5 h-3.5" />}
              </button>
            </div>
            <Btn onClick={handleSavePassword} disabled={busy || !newPassword.trim()} icon={Save}>{t('adm.common.save')}</Btn>
          </div>
          <p style={{ color: T3, fontSize: 11, marginTop: 6 }}>{t('maintenance.passwordHint')}</p>
        </div>
        <div>
          <label style={{ ...LABEL_STYLE, display: 'block', marginBottom: 6 }}>{t('maintenance.messageLabel')}</label>
          <textarea value={customMessage} onChange={(e) => { setCustomMessage(e.target.value); setTouched(true); }} placeholder={t('maintenance.messagePlaceholder')} rows={3} style={{ ...INPUT_STYLE, resize: 'vertical' }} />
          <div className="flex items-center justify-between gap-2 mt-2 flex-wrap">
            <Btn onClick={handleSaveMessage} disabled={busy || !touched} icon={Save} size="sm">{t('maintenance.saveMessage')}</Btn>
            <Btn to="/admin/links?tab=waitlist" size="sm" variant="subtle" icon={Users}>{t('maintenance.viewWaitlist')}</Btn>
          </div>
        </div>
      </div>
    </Card>
  );
}
