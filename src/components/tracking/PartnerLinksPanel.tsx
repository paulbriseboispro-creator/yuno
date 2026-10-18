/**
 * PartnerLinksPanel — l'onglet « Partenaires » des liens d'une soirée.
 *
 * Une ligne par partenaire (promoteur, DJ, ami…) : ses clics, ventes, CA et
 * conversion — les MÊMES chiffres que get_tracked_link_stats, donc que sa page
 * publique — et de quoi lui transmettre son lien et sa page de stats.
 */
import { useMemo, useState } from 'react';
import { BarChart3, Check, Copy, ExternalLink, MoreHorizontal, Pencil, RefreshCw, Send, Trash2, Users } from 'lucide-react';
import { toast } from 'sonner';
import { supabase } from '@/integrations/supabase/client';
import { useLanguage } from '@/contexts/LanguageContext';
import { Button } from '@/components/ui/button';
import {
  DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuSeparator, DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription,
  AlertDialogFooter, AlertDialogHeader, AlertDialogTitle,
} from '@/components/ui/alert-dialog';
import { buildPartnerShare, contactKindOf, partnerConversion, partnerInitial } from '@/lib/partnerLinks';
import { PARTNER_LANGUAGE_NAMES } from '@/lib/partnerLinkWords';
import type { PartnerLinkRow } from './PartnerLinkDialog';

export interface PartnerStatsRow extends PartnerLinkRow {
  clicks: number;
  conversions: number;
  revenue: number | null;
  is_active: boolean;
}

interface Props {
  rows: PartnerStatsRow[];
  eventTitle?: string | null;
  formatMoney: (n: number) => string;
  onCreate: () => void;
  onEdit: (row: PartnerStatsRow) => void;
  onChanged: () => void;
}

export function PartnerLinksPanel({ rows, eventTitle, formatMoney, onCreate, onEdit, onChanged }: Props) {
  const { t, language } = useLanguage();
  const numLocale = language === 'en' ? 'en-GB' : language;
  const [copied, setCopied] = useState<string | null>(null);
  const [deleting, setDeleting] = useState<PartnerStatsRow | null>(null);

  const totals = useMemo(() => {
    const clicks = rows.reduce((s, r) => s + (r.clicks || 0), 0);
    const sales = rows.reduce((s, r) => s + Number(r.conversions || 0), 0);
    const money = rows.every((r) => r.revenue !== null && r.revenue !== undefined);
    const revenue = money ? rows.reduce((s, r) => s + Number(r.revenue || 0), 0) : null;
    return { clicks, sales, revenue, conv: partnerConversion(sales, clicks) };
  }, [rows]);

  const copy = async (value: string, key: string) => {
    try {
      await navigator.clipboard.writeText(value);
      setCopied(key);
      toast.success(t('tlink.copied'));
      setTimeout(() => setCopied((c) => (c === key ? null : c)), 1500);
    } catch {
      toast.error(t('tlink.copyError'));
    }
  };

  const resetPage = async (row: PartnerStatsRow) => {
    const { error } = await supabase.rpc('reset_partner_link_page', { p_link_id: row.id });
    if (error) { toast.error(t('tlink.saveError')); return; }
    toast.success(t('plink.pageReset'));
    onChanged();
  };

  const remove = async () => {
    if (!deleting) return;
    const { error } = await supabase.from('tracked_links').delete().eq('id', deleting.id);
    setDeleting(null);
    if (error) { toast.error(t('tlink.deleteError')); return; }
    toast.success(t('tlink.deleted'));
    onChanged();
  };

  if (rows.length === 0) {
    return (
      <div className="rounded-xl border border-dashed border-white/10 px-5 py-7 text-center">
        <Users className="mx-auto h-5 w-5 text-white/35" />
        <p className="mx-auto mt-2.5 max-w-sm text-sm leading-relaxed text-white/55">{t('plink.empty')}</p>
        <Button
          onClick={onCreate}
          size="sm"
          className="mt-4 bg-white text-paper hover:bg-white/90"
        >
          {t('plink.add')}
        </Button>
      </div>
    );
  }

  const tiles: { label: string; value: string }[] = [
    { label: t('plink.kpi.clicks'), value: String(totals.clicks) },
    { label: t('plink.kpi.sales'), value: String(totals.sales) },
    ...(totals.revenue !== null ? [{ label: t('plink.kpi.revenue'), value: formatMoney(totals.revenue) }] : []),
    { label: t('plink.kpi.conv'), value: totals.conv === null ? '—' : `${totals.conv.toLocaleString(numLocale)} %` },
  ];

  return (
    <div className="space-y-3">
      {rows.length > 1 && (
        <div className={`grid gap-2 ${tiles.length === 4 ? 'grid-cols-2 sm:grid-cols-4' : 'grid-cols-3'}`}>
          {tiles.map((tile) => (
            <div key={tile.label} className="rounded-xl border border-white/10 bg-white/[0.03] px-3.5 py-2.5">
              <div className="text-[11px] text-white/50">{tile.label}</div>
              <div className="mt-0.5 text-lg font-semibold tabular-nums text-white">{tile.value}</div>
            </div>
          ))}
        </div>
      )}

      <div className="space-y-2.5">
        {rows.map((row) => {
          const share = buildPartnerShare(row, eventTitle);
          const conv = partnerConversion(Number(row.conversions || 0), row.clicks || 0);
          const contactKind = contactKindOf(row.partner_contact);
          return (
            <div
              key={row.id}
              className={`rounded-xl border border-white/10 bg-gradient-to-br from-white/[0.04] to-transparent px-4 py-3.5 transition-colors hover:border-white/20 ${row.is_active ? '' : 'opacity-50'}`}
            >
              <div className="flex flex-wrap items-center gap-x-5 gap-y-2.5">
                <div className="flex min-w-0 items-center gap-3">
                  <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-white/10 text-sm font-semibold text-white/85">
                    {partnerInitial(row.partner_name)}
                  </span>
                  <span className="min-w-0">
                    <span className="block truncate font-semibold text-white">{row.partner_name}</span>
                    <span className="block truncate text-xs text-white/50">{t(`plink.role.${row.partner_role}`)} · /l/{row.code} · <span title={PARTNER_LANGUAGE_NAMES[row.partner_language]}>{row.partner_language.toUpperCase()}</span></span>
                  </span>
                </div>

                <div className="flex min-w-0 flex-wrap items-center gap-x-4 gap-y-1 text-xs text-white/55">
                  <span><span className="font-medium text-white/85">{row.clicks}</span> {t('tlink.clicks')}</span>
                  <span><span className="font-medium text-white/85">{row.conversions}</span> {t('tlink.sales')}</span>
                  {row.revenue !== null && row.revenue !== undefined && (
                    <span><span className="font-medium text-white/85">{formatMoney(Number(row.revenue) || 0)}</span> {t('tlink.revenue')}</span>
                  )}
                  <span className="text-white/35">{conv === null ? '—' : `${conv.toLocaleString(numLocale)} %`} {t('tlink.convRate')}</span>
                </div>

                <div className="ml-auto flex items-center gap-1.5">
                  <button
                    type="button"
                    onClick={() => copy(share.link, `l-${row.id}`)}
                    className="inline-flex h-8 items-center gap-1.5 rounded-lg border border-white/15 px-2.5 text-xs font-medium text-white/75 hover:bg-white/10 hover:text-white"
                  >
                    {copied === `l-${row.id}` ? <Check className="h-3.5 w-3.5 text-emerald-400" /> : <Copy className="h-3.5 w-3.5" />}
                    {t('plink.linkShort')}
                  </button>
                  <button
                    type="button"
                    onClick={() => copy(share.page, `p-${row.id}`)}
                    className="inline-flex h-8 items-center gap-1.5 rounded-lg border border-white/15 px-2.5 text-xs font-medium text-white/75 hover:bg-white/10 hover:text-white"
                  >
                    {copied === `p-${row.id}` ? <Check className="h-3.5 w-3.5 text-emerald-400" /> : <BarChart3 className="h-3.5 w-3.5" />}
                    {t('plink.pageShort')}
                  </button>
                  {share.href ? (
                    <a
                      href={share.href}
                      target="_blank"
                      rel="noreferrer"
                      aria-label={contactKind === 'email' ? t('plink.sendEmail') : t('plink.sendWhatsapp')}
                      title={contactKind === 'email' ? t('plink.sendEmail') : t('plink.sendWhatsapp')}
                      className="inline-flex h-8 w-8 items-center justify-center rounded-lg border border-white/15 text-white/75 hover:bg-white/10 hover:text-white"
                    >
                      <Send className="h-3.5 w-3.5" />
                    </a>
                  ) : (
                    <button
                      type="button"
                      onClick={() => copy(share.message, `m-${row.id}`)}
                      aria-label={t('plink.copyMessage')}
                      title={t('plink.copyMessage')}
                      className="inline-flex h-8 w-8 items-center justify-center rounded-lg border border-white/15 text-white/75 hover:bg-white/10 hover:text-white"
                    >
                      {copied === `m-${row.id}` ? <Check className="h-3.5 w-3.5 text-emerald-400" /> : <Send className="h-3.5 w-3.5" />}
                    </button>
                  )}
                  <DropdownMenu>
                    <DropdownMenuTrigger asChild>
                      <button
                        type="button"
                        aria-label={t('plink.more')}
                        className="inline-flex h-8 w-8 items-center justify-center rounded-lg text-white/55 hover:bg-white/10 hover:text-white"
                      >
                        <MoreHorizontal className="h-4 w-4" />
                      </button>
                    </DropdownMenuTrigger>
                    <DropdownMenuContent align="end" className="min-w-[200px]">
                      <DropdownMenuItem onSelect={() => window.open(share.page, '_blank', 'noopener')}>
                        <ExternalLink className="mr-2 h-4 w-4" />{t('plink.openPage')}
                      </DropdownMenuItem>
                      <DropdownMenuItem onSelect={() => copy(share.message, `m-${row.id}`)}>
                        <Copy className="mr-2 h-4 w-4" />{t('plink.copyMessage')}
                      </DropdownMenuItem>
                      <DropdownMenuItem onSelect={() => onEdit(row)}>
                        <Pencil className="mr-2 h-4 w-4" />{t('plink.edit')}
                      </DropdownMenuItem>
                      <DropdownMenuItem onSelect={() => resetPage(row)}>
                        <RefreshCw className="mr-2 h-4 w-4" />{t('plink.resetPage')}
                      </DropdownMenuItem>
                      <DropdownMenuSeparator />
                      <DropdownMenuItem onSelect={() => setDeleting(row)} className="text-red-500 focus:text-red-500">
                        <Trash2 className="mr-2 h-4 w-4" />{t('tlink.delete')}
                      </DropdownMenuItem>
                    </DropdownMenuContent>
                  </DropdownMenu>
                </div>
              </div>
            </div>
          );
        })}
      </div>

      <p className="text-xs leading-relaxed text-white/45">{t('plink.footnote')}</p>

      <AlertDialog open={!!deleting} onOpenChange={(o) => { if (!o) setDeleting(null); }}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>{t('plink.deleteTitle').replace('{name}', deleting?.partner_name ?? '')}</AlertDialogTitle>
            <AlertDialogDescription>{t('plink.deleteDesc')}</AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>{t('tlink.cancel')}</AlertDialogCancel>
            <AlertDialogAction onClick={remove} className="bg-red-600 text-snow hover:bg-red-600/90">
              {t('tlink.delete')}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
