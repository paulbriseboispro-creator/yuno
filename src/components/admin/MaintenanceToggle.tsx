import { useState } from 'react';
import { useMaintenanceMode } from '@/hooks/useMaintenanceMode';
import { useLanguage } from '@/contexts/LanguageContext';
import { toast } from 'sonner';
import { Lock, Unlock, AlertTriangle, Users, Save, Eye, EyeOff, Key } from 'lucide-react';

// ─── Yuno Design Tokens ───────────────────────────────────────────────────────
const RED        = '#E8192C';
const POS        = '#34D399';
const NEG        = '#FF5C63';
const T1         = 'rgba(255,255,255,0.96)';
const T2         = 'rgba(255,255,255,0.58)';
const T3         = 'rgba(255,255,255,0.36)';
const BORDER     = 'rgba(255,255,255,0.085)';
const F_BORDER   = 'rgba(255,255,255,0.055)';
const INNER_BG   = 'rgba(255,255,255,0.032)';
const CARD_BG    = 'linear-gradient(180deg,rgba(255,255,255,.045) 0%,rgba(255,255,255,.008) 100%),#0a0a0c';
const CARD_SHADOW = '0 1px 0 rgba(255,255,255,.05) inset,0 18px 40px -28px rgba(0,0,0,.9)';

const inputStyle: React.CSSProperties = {
  background: INNER_BG, border: `1px solid ${BORDER}`, borderRadius: 10,
  color: T1, fontSize: 13, padding: '9px 12px', width: '100%', outline: 'none',
};

const btnStyle: React.CSSProperties = {
  display: 'inline-flex', alignItems: 'center', gap: 6, padding: '9px 14px',
  borderRadius: 10, background: INNER_BG, border: `1px solid ${BORDER}`,
  color: T2, fontSize: 12.5, fontWeight: 560, cursor: 'pointer',
};

function Toggle({ on, disabled, onChange }: { on: boolean; disabled?: boolean; onChange: (v: boolean) => void }) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={on}
      disabled={disabled}
      onClick={() => onChange(!on)}
      className="relative flex-none transition-all duration-200"
      style={{
        width: 46, height: 26, borderRadius: 13, cursor: disabled ? 'not-allowed' : 'pointer',
        background: on ? RED : 'rgba(255,255,255,0.1)',
        border: `1px solid ${on ? 'rgba(232,25,44,0.5)' : BORDER}`,
        opacity: disabled ? 0.5 : 1,
      }}
    >
      <span
        className="absolute top-1/2 transition-all duration-200"
        style={{
          width: 20, height: 20, borderRadius: '50%', background: '#fff',
          transform: 'translateY(-50%)', left: on ? 22 : 2,
          boxShadow: '0 2px 6px rgba(0,0,0,0.4)',
        }}
      />
    </button>
  );
}

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
    if (result.success) toast.success(enabled ? t('maintenance.toggleEnabled') : t('maintenance.toggleDisabled'));
    else toast.error(t('maintenance.errorPrefix') + result.error);
  };

  const handleSaveMessage = async () => {
    setUpdating(true);
    const result = await toggleMaintenanceMode(isMaintenanceMode, customMessage);
    setUpdating(false);
    if (result.success) toast.success(t('maintenance.messageUpdated'));
    else toast.error(t('maintenance.errorPrefix') + result.error);
  };

  const handleSavePassword = async () => {
    if (!newPassword.trim()) { toast.error(t('maintenance.passwordEmpty')); return; }
    setUpdating(true);
    const result = await updatePassword(newPassword.trim());
    setUpdating(false);
    if (result.success) toast.success(t('maintenance.passwordUpdated'));
    else toast.error(t('maintenance.errorPrefix') + result.error);
  };

  const cardBase: React.CSSProperties = {
    background: CARD_BG,
    border: `1px solid ${isMaintenanceMode ? 'rgba(255,92,99,0.3)' : BORDER}`,
    borderRadius: 18, boxShadow: CARD_SHADOW, padding: 22, overflow: 'hidden',
  };

  if (loading) {
    return (
      <div style={cardBase}>
        <div className="h-8 w-8 animate-spin rounded-full border-2 mx-auto" style={{ borderColor: `${BORDER} ${BORDER} ${BORDER} ${RED}` }} />
      </div>
    );
  }

  return (
    <div style={cardBase}>
      {/* Header */}
      <div className="flex items-center justify-between gap-3">
        <div className="flex items-center gap-3 min-w-0">
          <div
            className="flex h-9 w-9 items-center justify-center rounded-xl flex-none"
            style={isMaintenanceMode
              ? { background: 'rgba(255,92,99,0.1)', border: '1px solid rgba(255,92,99,0.25)' }
              : { background: 'rgba(52,211,153,0.1)', border: '1px solid rgba(52,211,153,0.25)' }}
          >
            {isMaintenanceMode
              ? <Lock className="h-4 w-4" style={{ color: NEG }} />
              : <Unlock className="h-4 w-4" style={{ color: POS }} />}
          </div>
          <div className="min-w-0">
            <div className="flex items-center gap-2">
              <h3 style={{ color: T1, fontSize: 15.5, fontWeight: 600, letterSpacing: '-0.01em' }}>{t('maintenance.title')}</h3>
              {isMaintenanceMode && (
                <span style={{ background: 'rgba(255,92,99,0.12)', border: '1px solid rgba(255,92,99,0.3)', color: NEG, fontSize: 10, fontWeight: 600, padding: '2px 8px', borderRadius: 999, textTransform: 'uppercase', letterSpacing: '0.05em' }}>
                  {t('maintenance.active')}
                </span>
              )}
            </div>
            <p style={{ color: T3, fontSize: 11.5, marginTop: 2 }}>{t('maintenance.lockDesc')}</p>
          </div>
        </div>
        <Toggle on={isMaintenanceMode} disabled={updating} onChange={handleToggle} />
      </div>

      {/* Active warning */}
      {isMaintenanceMode && (
        <div className="flex items-start gap-2.5 mt-4 p-3 rounded-xl" style={{ background: 'rgba(255,92,99,0.08)', border: '1px solid rgba(255,92,99,0.2)' }}>
          <AlertTriangle className="h-4 w-4 flex-none mt-0.5" style={{ color: NEG }} />
          <p style={{ color: 'rgba(255,140,145,0.95)', fontSize: 12.5, lineHeight: 1.5 }}>{t('maintenance.warningMsg')}</p>
        </div>
      )}

      {/* Password */}
      <div className="mt-5">
        <label className="flex items-center gap-2 mb-2" style={{ color: T2, fontSize: 12.5, fontWeight: 560 }}>
          <Key className="h-3.5 w-3.5" style={{ color: RED }} />
          {t('maintenance.passwordLabel')}
        </label>
        <div className="flex gap-2">
          <div className="relative flex-1">
            <input
              type={showPassword ? 'text' : 'password'}
              value={newPassword}
              onChange={(e) => setNewPassword(e.target.value)}
              placeholder={t('maintenance.passwordPlaceholder')}
              style={{ ...inputStyle, paddingRight: 38 }}
            />
            <button
              type="button"
              onClick={() => setShowPassword(!showPassword)}
              className="absolute right-3 top-1/2 -translate-y-1/2 transition-colors cursor-pointer"
              style={{ color: T3 }}
            >
              {showPassword ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
            </button>
          </div>
          <button
            onClick={handleSavePassword}
            disabled={updating || newPassword === maintenancePassword}
            style={{ ...btnStyle, padding: '9px 12px', opacity: (updating || newPassword === maintenancePassword) ? 0.5 : 1 }}
          >
            <Save className="h-4 w-4" />
          </button>
        </div>
        <p style={{ color: T3, fontSize: 11, marginTop: 6 }}>{t('maintenance.passwordHint')}</p>
      </div>

      {/* Message */}
      <div className="mt-5">
        <label className="block mb-2" style={{ color: T2, fontSize: 12.5, fontWeight: 560 }}>{t('maintenance.messageLabel')}</label>
        <textarea
          value={customMessage}
          onChange={(e) => setCustomMessage(e.target.value)}
          placeholder={t('maintenance.messagePlaceholder')}
          rows={3}
          style={{ ...inputStyle, resize: 'none', lineHeight: 1.5 }}
        />
        <button
          onClick={handleSaveMessage}
          disabled={updating || customMessage === message}
          style={{ ...btnStyle, marginTop: 8, opacity: (updating || customMessage === message) ? 0.5 : 1 }}
        >
          <Save className="h-4 w-4" />
          {t('maintenance.saveMessage')}
        </button>
      </div>

      {/* Footer */}
      <div className="mt-5 pt-4" style={{ borderTop: `1px solid ${F_BORDER}` }}>
        <button
          onClick={() => window.open('/admin/waitlist', '_blank')}
          className="inline-flex items-center gap-2 cursor-pointer transition-colors"
          style={{ color: T3, fontSize: 12.5, fontWeight: 500, background: 'transparent', border: 'none', padding: 0 }}
        >
          <Users className="h-4 w-4" />
          {t('maintenance.viewWaitlist')}
        </button>
      </div>
    </div>
  );
}
