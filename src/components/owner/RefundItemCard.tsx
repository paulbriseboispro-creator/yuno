import { Checkbox } from '@/components/ui/checkbox';
import { Badge } from '@/components/ui/badge';
import { useLanguage } from '@/contexts/LanguageContext';
import { ShoppingBag, Ticket, Crown, AlertTriangle } from 'lucide-react';

export interface RefundableItem {
  id: string;
  type: 'order' | 'ticket' | 'table_reservation';
  email: string;
  name?: string;
  amount: number; // total price
  serviceFee: number;
  stripeFee: number;
  clubReceived: number; // amount - serviceFee
  createdAt: string;
  hasPaymentIntent: boolean;
  details?: string;
}

interface RefundItemCardProps {
  item: RefundableItem;
  selected: boolean;
  onToggle: (id: string) => void;
}

export function RefundItemCard({ item, selected, onToggle }: RefundItemCardProps) {
  const { t } = useLanguage();

  const typeIcons = {
    order: <ShoppingBag className="h-4 w-4" />,
    ticket: <Ticket className="h-4 w-4" />,
    table_reservation: <Crown className="h-4 w-4" />,
  };

  const typeLabels = {
    order: t('refund.typeOrder'),
    ticket: t('refund.typeTicket'),
    table_reservation: t('refund.typeTable'),
  };

  const typeColors = {
    order: 'bg-blue-500/10 text-blue-400 border-blue-500/30',
    ticket: 'bg-purple-500/10 text-purple-400 border-purple-500/30',
    table_reservation: 'bg-amber-500/10 text-amber-400 border-amber-500/30',
  };

  return (
    <div
      className={`flex items-start gap-3 p-3 rounded-lg border transition-colors cursor-pointer ${
        selected ? 'border-primary/50 bg-primary/5' : 'border-border hover:border-border/80'
      }`}
      onClick={() => onToggle(item.id)}
    >
      <Checkbox checked={selected} className="mt-1" />
      
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-2 mb-1">
          <Badge variant="outline" className={`text-xs ${typeColors[item.type]}`}>
            {typeIcons[item.type]}
            <span className="ml-1">{typeLabels[item.type]}</span>
          </Badge>
          {!item.hasPaymentIntent && (
            <Badge variant="outline" className="text-xs bg-yellow-500/10 text-yellow-400 border-yellow-500/30">
              <AlertTriangle className="h-3 w-3 mr-1" />
              {t('refund.noStripeId')}
            </Badge>
          )}
        </div>
        <p className="text-sm font-medium truncate">{item.name || item.email}</p>
        {item.details && <p className="text-xs text-muted-foreground truncate">{item.details}</p>}
        <p className="text-xs text-muted-foreground">{item.email}</p>
        <div className="flex items-center gap-3 mt-1">
          <span className="text-xs text-muted-foreground">
            {t('refund.clubReceived')}: <span className="font-medium text-foreground">{item.clubReceived.toFixed(2)} €</span>
          </span>
          <span className="text-xs text-muted-foreground">
            {t('refund.stripeFees')}: <span className="font-medium text-orange-400">{item.stripeFee.toFixed(2)} €</span>
          </span>
        </div>
      </div>
      
      <span className="text-sm font-semibold whitespace-nowrap">{item.clubReceived.toFixed(2)} €</span>
    </div>
  );
}
