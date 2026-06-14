import { useState } from 'react';
import { Checkbox } from '@/components/ui/checkbox';
import { useLanguage } from '@/contexts/LanguageContext';
import { RefundItemCard, type RefundableItem } from './RefundItemCard';
import { Accordion, AccordionContent, AccordionItem, AccordionTrigger } from '@/components/ui/accordion';
import { User, ChevronDown, ShoppingBag, Ticket, Crown } from 'lucide-react';

export interface CustomerGroup {
  email: string;
  name: string;
  items: RefundableItem[];
  totalClubReceived: number;
}

interface RefundCustomerCardProps {
  group: CustomerGroup;
  selectedIds: Set<string>;
  onToggleItem: (id: string) => void;
  onToggleAll: (email: string, itemIds: string[]) => void;
}

export function RefundCustomerCard({ group, selectedIds, onToggleItem, onToggleAll }: RefundCustomerCardProps) {
  const { t } = useLanguage();

  const itemIds = group.items.map(i => i.id);
  const selectedCount = itemIds.filter(id => selectedIds.has(id)).length;
  const allSelected = selectedCount === itemIds.length;
  const someSelected = selectedCount > 0 && !allSelected;

  const ticketCount = group.items.filter(i => i.type === 'ticket').length;
  const orderCount = group.items.filter(i => i.type === 'order').length;
  const tableCount = group.items.filter(i => i.type === 'table_reservation').length;

  const summary: string[] = [];
  if (ticketCount > 0) summary.push(`${ticketCount} ${t('refund.typeTicket').toLowerCase()}`);
  if (orderCount > 0) summary.push(`${orderCount} ${t('refund.typeOrder').toLowerCase()}`);
  if (tableCount > 0) summary.push(`${tableCount} ${t('refund.typeTable').toLowerCase()}`);

  const handleGlobalToggle = (e: React.MouseEvent) => {
    e.stopPropagation();
    onToggleAll(group.email, itemIds);
  };

  return (
    <div className={`rounded-xl border transition-colors ${
      allSelected ? 'border-primary/50 bg-primary/5' : someSelected ? 'border-primary/30 bg-primary/3' : 'border-border'
    }`}>
      <Accordion type="single" collapsible>
        <AccordionItem value={group.email} className="border-0">
          <div className="flex items-center gap-3 px-3 py-3">
            <div onClick={handleGlobalToggle} className="cursor-pointer">
              <Checkbox
                checked={allSelected}
                className="mt-0"
                data-indeterminate={someSelected}
              />
            </div>
            <div className="flex-1 min-w-0">
              <p className="text-sm font-semibold truncate">{group.name || group.email}</p>
              {group.name && <p className="text-xs text-muted-foreground truncate">{group.email}</p>}
              <p className="text-xs text-muted-foreground mt-0.5">{summary.join(' · ')}</p>
            </div>
            <div className="text-right shrink-0">
              <p className="text-sm font-bold">{group.totalClubReceived.toFixed(2)} €</p>
              <p className="text-[10px] text-muted-foreground">{group.items.length} {t('refund.items')}</p>
            </div>
            <AccordionTrigger className="p-0 hover:no-underline [&>svg]:hidden">
              <ChevronDown className="h-4 w-4 text-muted-foreground shrink-0 transition-transform" />
            </AccordionTrigger>
          </div>
          <AccordionContent className="px-2 pb-2">
            <div className="space-y-1.5">
              {group.items.map(item => (
                <RefundItemCard
                  key={item.id}
                  item={item}
                  selected={selectedIds.has(item.id)}
                  onToggle={onToggleItem}
                />
              ))}
            </div>
          </AccordionContent>
        </AccordionItem>
      </Accordion>
    </div>
  );
}
