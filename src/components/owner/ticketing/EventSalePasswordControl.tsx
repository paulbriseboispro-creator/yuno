import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import { Lock } from 'lucide-react';
import { useLanguage } from '@/contexts/LanguageContext';
import { RED, T1, T3, INNER_CARD } from './ticketing-ui';

interface EventSalePasswordControlProps {
  salePasswordEnabled: boolean;
  passwordDraft: string;
  onPasswordDraftChange: (value: string) => void;
  saving: boolean;
  onSetPassword: (password: string | null) => void;
}

// Per-event password-gated sale control.
export function EventSalePasswordControl({
  salePasswordEnabled,
  passwordDraft,
  onPasswordDraftChange,
  saving,
  onSetPassword,
}: EventSalePasswordControlProps) {
  const { t } = useLanguage();
  return (
    <div className="p-3.5 space-y-3" style={INNER_CARD}>
      <div className="flex items-center justify-between gap-3">
        <div className="flex items-center gap-3 min-w-0">
          <Lock className="h-4 w-4 flex-none" style={{ color: salePasswordEnabled ? RED : T3 }} />
          <div className="min-w-0">
            <p style={{ color: T1, fontSize: 13.5, fontWeight: 560 }}>{t('tickets.salePassword')}</p>
            <p style={{ color: T3, fontSize: 11.5, marginTop: 1 }}>{t('tickets.salePasswordDesc')}</p>
          </div>
        </div>
        {salePasswordEnabled && (
          <span
            className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10.5px] font-semibold shrink-0"
            style={{ background: 'rgba(232,25,44,0.12)', border: `1px solid rgba(232,25,44,0.3)`, color: RED }}
          >
            <Lock className="h-2.5 w-2.5" />
            {t('tickets.salePasswordOn')}
          </span>
        )}
      </div>
      <Input
        type="text"
        autoComplete="off"
        placeholder={salePasswordEnabled ? t('tickets.salePasswordChangePlaceholder') : t('tickets.salePasswordPlaceholder')}
        value={passwordDraft}
        onChange={(e) => onPasswordDraftChange(e.target.value)}
      />
      <div className="flex gap-2">
        <Button
          type="button"
          className="flex-1"
          disabled={saving || !passwordDraft.trim()}
          onClick={() => onSetPassword(passwordDraft.trim())}
          style={{ background: RED, color: '#fff' }}
        >
          {salePasswordEnabled ? t('tickets.salePasswordUpdate') : t('tickets.salePasswordActivate')}
        </Button>
        {salePasswordEnabled && (
          <Button
            type="button"
            variant="outline"
            disabled={saving}
            onClick={() => onSetPassword(null)}
          >
            {t('tickets.salePasswordRemove')}
          </Button>
        )}
      </div>
    </div>
  );
}
