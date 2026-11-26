import { useLanguage } from '@/contexts/LanguageContext';
import type { ReceiptPreorder } from '@/lib/tableBottles';

/**
 * Récap de la précommande de bouteilles d'une table (D8) : toujours « à régler sur place ».
 * Ne vit JAMAIS dans « payé en ligne » : rien de ce bloc n'est débité par Yuno.
 */
export function TablePreorderRecap({ preorder, compact = false }: { preorder: ReceiptPreorder | null | undefined; compact?: boolean }) {
  const { t } = useLanguage();
  if (!preorder || preorder.items.length === 0) return null;
  const fmt = (n: number) => `${(Math.round(n * 100) / 100).toFixed(2)} €`;
  const lab = { fontSize: compact ? 9.5 : 10, letterSpacing: '0.06em', color: '#9A9A9A' } as const;
  return (
    <div style={{ padding: compact ? '8px 0 0' : '12px 0', borderTop: '1px solid rgba(255,255,255,0.06)', marginTop: compact ? 8 : 0 }} data-testid="table-preorder-recap">
      <div className="flex justify-between items-baseline gap-3" style={{ marginBottom: 6 }}>
        <span className="font-mono uppercase" style={lab}>{t('tblb.recap.title')}</span>
        <span className="font-mono uppercase" style={{ ...lab, color: '#E8192C' }}>{t('tblb.recap.onSite')}</span>
      </div>
      <ul className="space-y-1">
        {preorder.items.map((i, idx) => (
          <li key={`${i.name}-${idx}`} className="flex justify-between gap-3 text-[13px] text-white/90">
            <span className="min-w-0 truncate">{i.quantity} × {i.name}</span>
            <span className="tabular-nums flex-none text-white/70">{fmt(i.unitPrice * i.quantity)}</span>
          </li>
        ))}
      </ul>
      <div className="flex justify-between items-center" style={{ marginTop: 8 }}>
        <span className="font-mono uppercase" style={lab}>{t('tblb.recap.total')}</span>
        <span className="font-sans font-medium text-white" style={{ fontSize: 14 }}>{fmt(preorder.total)}</span>
      </div>
      <p style={{ fontSize: 11, marginTop: 6, color: '#7A7A7E' }}>{t('tblb.recap.hint')}</p>
    </div>
  );
}
