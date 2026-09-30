/**
 * Le deuxième (et dernier) niveau (spec §3.4) : un panneau latéral avec le
 * tableau complet et son export CSV. Sur téléphone il monte du bas.
 */
import type { ReactNode } from 'react';
import { Sheet, SheetContent, SheetHeader, SheetTitle } from '@/components/ui/sheet';
import { useLanguage } from '@/contexts/LanguageContext';
import { deliverCsv, type CsvCell } from '@/lib/analytics/an3Csv';
import { A3Button } from './an3Ui';
import { A3 } from './an3Tokens';

export interface DrawerTable { header: string[]; rows: CsvCell[][]; filename: string; render?: (cell: CsvCell, col: number, row: number) => ReactNode }

export function DetailDrawer({ open, onOpenChange, title, table, children }: {
  open: boolean; onOpenChange: (o: boolean) => void; title: string; table?: DrawerTable; children?: ReactNode;
}) {
  const { t } = useLanguage();
  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent side="right" className="w-full sm:max-w-xl overflow-y-auto p-0" style={{ background: 'var(--sf-0a0a0c)', color: A3.t1, borderColor: A3.border }}>
        <SheetHeader className="px-5 pt-5 pb-3 flex-row items-center justify-between gap-3 space-y-0">
          <SheetTitle className="text-[15px] font-semibold" style={{ color: A3.t1 }}>{title}</SheetTitle>
          {table && (
            <A3Button small onClick={() => { void deliverCsv(table.filename, table.header, table.rows, title); }}>{t('an3.export.csv')}</A3Button>
          )}
        </SheetHeader>
        <div className="px-5 pb-8">
          {children}
          {table && (
            <div className="overflow-x-auto -mx-1">
              <table className="w-full text-[12.5px] tabular-nums" style={{ borderCollapse: 'separate', borderSpacing: 0 }}>
                <thead>
                  <tr>
                    {table.header.map((h, i) => (
                      <th key={i} className={`py-2 px-2 font-semibold text-[10.5px] uppercase tracking-[0.06em] ${i === 0 ? 'text-left' : 'text-right'}`} style={{ color: A3.t3, borderBottom: `1px solid ${A3.border}` }}>{h}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {table.rows.map((r, ri) => (
                    <tr key={ri}>
                      {r.map((c, ci) => (
                        <td key={ci} className={`py-2 px-2 ${ci === 0 ? 'text-left' : 'text-right'}`} style={{ color: ci === 0 ? A3.t1 : A3.t2, borderBottom: `1px solid ${A3.faint}` }}>
                          {table.render ? table.render(c, ci, ri) : (c === null || c === undefined ? '—' : String(c))}
                        </td>
                      ))}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      </SheetContent>
    </Sheet>
  );
}
