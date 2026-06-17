import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Button } from '@/components/ui/button';
import { Bell } from 'lucide-react';
import { useLanguage } from '@/contexts/LanguageContext';
import { RED, T1, T3, LABEL, INNER_CARD } from './ticketing-ui';
import type { SalesDraft, TicketSalesMode } from './ticketing-types';

interface EventSalesModeSectionProps {
  draft: SalesDraft | undefined;
  onSetMode: (mode: TicketSalesMode) => void;
  onUpdateOption: (patch: Partial<SalesDraft>) => void;
  onSave: () => void;
}

// Per-event sales-mode picker (private / presale / normal) + presale date inputs.
export function EventSalesModeSection({ draft, onSetMode, onUpdateOption, onSave }: EventSalesModeSectionProps) {
  const { t } = useLanguage();
  return (
    <div className="p-3.5 space-y-4" style={INNER_CARD}>
      <div className="space-y-1">
        <div className="flex items-center gap-2">
          <Bell className="h-4 w-4" style={{ color: RED }} />
          <p style={{ color: T1, fontSize: 13.5, fontWeight: 560 }}>{t('tickets.salesMode')}</p>
        </div>
        <p style={{ color: T3, fontSize: 11.5 }}>{t('tickets.salesModeDesc')}</p>
      </div>

      <Select
        value={draft?.mode || 'normal'}
        onValueChange={(value) => onSetMode(value as TicketSalesMode)}
      >
        <SelectTrigger>
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          <SelectItem value="private">{t('tickets.salesMode.private')}</SelectItem>
          <SelectItem value="presale">{t('tickets.salesMode.presale')}</SelectItem>
          <SelectItem value="normal">{t('tickets.salesMode.normal')}</SelectItem>
        </SelectContent>
      </Select>

      {draft?.mode === 'private' && (
        <p style={{ color: T3, fontSize: 11.5 }}>{t('tickets.privateModeHint')}</p>
      )}

      {draft?.mode === 'normal' && (
        <p style={{ color: T3, fontSize: 11.5 }}>{t('tickets.normalModeHint')}</p>
      )}

      {draft?.mode === 'presale' && (
        <div className="space-y-3">
          <p style={{ color: T3, fontSize: 11.5 }}>{t('tickets.presaleModeHint')}</p>
          <div>
            <Label style={{ ...LABEL, fontSize: 10.5 }}>{t('tickets.presaleMembersStart')}</Label>
            <p style={{ color: T3, fontSize: 10, marginTop: 3 }}>{t('tickets.presaleMembersStartDesc')}</p>
            <Input
              type="datetime-local"
              className="mt-1.5"
              value={draft?.presaleStartAt || ''}
              onChange={(e) => onUpdateOption({ presaleStartAt: e.target.value })}
            />
          </div>

          <div>
            <Label style={{ ...LABEL, fontSize: 10.5 }}>{t('tickets.publicSaleStart')}</Label>
            <p style={{ color: T3, fontSize: 10, marginTop: 3 }}>{t('tickets.publicSaleStartDesc')}</p>
            <Input
              type="datetime-local"
              className="mt-1.5"
              value={draft?.publicSaleStartAt || ''}
              onChange={(e) => onUpdateOption({ publicSaleStartAt: e.target.value })}
            />
          </div>
        </div>
      )}

      <Button
        type="button"
        className="w-full"
        onClick={onSave}
        style={{ background: RED, color: '#fff' }}
      >
        {t('common.save')}
      </Button>
    </div>
  );
}
