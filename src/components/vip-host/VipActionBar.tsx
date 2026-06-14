import { Button } from '@/components/ui/button';
import { ClipboardList, Plus, BarChart3, Wine, Check, Eye } from 'lucide-react';
import { cn } from '@/lib/utils';
import { useLanguage } from '@/contexts/LanguageContext';

interface VipActionBarProps {
  mode: 'default' | 'selection';
  onOrders: () => void;
  onQuickAdd?: () => void;
  onStats: () => void;
  onAddConso?: () => void;
  onFinish?: () => void;
  onViewDetail?: () => void;
  pendingCount?: number;
}

export function VipActionBar({
  mode,
  onOrders,
  onQuickAdd,
  onStats,
  onAddConso,
  onFinish,
  onViewDetail,
  pendingCount = 0,
}: VipActionBarProps) {
  const { t } = useLanguage();

  return (
    <div className="fixed bottom-0 left-0 right-0 z-50 backdrop-blur" style={{ background: 'rgba(10,10,12,0.92)', borderTop: '1px solid rgba(255,255,255,0.085)', paddingBottom: 'env(safe-area-inset-bottom, 0px)' }}>
      <div className="flex items-center justify-around gap-2 px-4 py-3">
        {mode === 'default' ? (
          <>
            <ActionButton
              icon={
                <div className="relative">
                  <ClipboardList className="w-5 h-5" />
                  {pendingCount > 0 && (
                    <span className="absolute -top-2 -right-2 w-4 h-4 bg-amber-500 text-black text-[9px] font-bold rounded-full flex items-center justify-center">
                      {pendingCount}
                    </span>
                  )}
                </div>
              }
              label={t('vipHost.orders')}
              onClick={onOrders}
              primary
            />
            {onQuickAdd && (
              <ActionButton
                icon={<Plus className="w-5 h-5" />}
                label={t('vipHost.add')}
                onClick={onQuickAdd}
              />
            )}
            <ActionButton
              icon={<BarChart3 className="w-5 h-5" />}
              label={t('vipHost.statsLabel')}
              onClick={onStats}
            />
          </>
        ) : (
          <>
            {onAddConso && (
              <ActionButton
                icon={<Wine className="w-5 h-5" />}
                label={t('vipHost.conso')}
                onClick={onAddConso}
                primary
              />
            )}
            {onFinish && (
              <ActionButton
                icon={<Check className="w-5 h-5" />}
                label={t('vipHost.finish')}
                onClick={onFinish}
              />
            )}
            {onViewDetail && (
              <ActionButton
                icon={<Eye className="w-5 h-5" />}
                label={t('vipHost.detail')}
                onClick={onViewDetail}
              />
            )}
          </>
        )}
      </div>
    </div>
  );
}

interface ActionButtonProps {
  icon: React.ReactNode;
  label: string;
  onClick: () => void;
  primary?: boolean;
}

function ActionButton({ icon, label, onClick, primary }: ActionButtonProps) {
  return (
    <Button
      variant={primary ? 'default' : 'ghost'}
      className={cn(
        'flex-1 flex-col h-auto py-2 gap-1',
        primary && 'bg-primary hover:bg-primary/90'
      )}
      onClick={onClick}
    >
      {icon}
      <span className="text-[10px] font-medium">{label}</span>
    </Button>
  );
}
