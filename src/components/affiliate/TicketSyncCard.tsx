import { useCallback, useEffect, useState } from 'react';
import { RefreshCw, Loader2, Link2 } from 'lucide-react';
import { supabase } from '@/integrations/supabase/client';
import { useToast } from '@/hooks/use-toast';
import { useLanguage } from '@/contexts/LanguageContext';
import { AffButton, Toggle, POS, WARN, T1, T2, T3, BORDER, INNER_BG } from '@/components/affiliate/affiliate-ui';

type Run = {
  ran_at: string;
  links_filled: number;
  one_offs_created: number;
  todo: Array<{ date: string; name: string }> | null;
};

// Synchro des liens billetterie depuis les comptes promoteur Whan
// (edge `affiliate-ticket-sync`, cron 18 h Madrid). Ne s'affiche que pour un
// affilié qui a des comptes déclarés dans affiliate_ticket_sources.
export function TicketSyncCard({ affiliateId, onSynced }: { affiliateId: string; onSynced: () => void }) {
  const { t, language } = useLanguage();
  const { toast } = useToast();
  const [accounts, setAccounts] = useState<string[]>([]);
  const [lastRun, setLastRun] = useState<Run | null>(null);
  const [running, setRunning] = useState(false);
  const [oneOffs, setOneOffs] = useState(false);

  const load = useCallback(async () => {
    const [{ data: sources }, { data: runs }] = await Promise.all([
      supabase.from('affiliate_ticket_sources').select('label, account_slug, create_one_offs')
        .eq('affiliate_id', affiliateId).eq('is_active', true).order('priority'),
      supabase.from('affiliate_ticket_sync_runs').select('ran_at, links_filled, one_offs_created, todo')
        .eq('affiliate_id', affiliateId).order('ran_at', { ascending: false }).limit(1),
    ]);
    setAccounts((sources ?? []).map((s) => s.label || s.account_slug));
    setOneOffs((sources ?? []).some((s) => s.create_one_offs));
    setLastRun(((runs ?? [])[0] as Run | undefined) ?? null);
  }, [affiliateId]);

  useEffect(() => { load(); }, [load]);

  const runNow = async () => {
    setRunning(true);
    try {
      const { data, error } = await supabase.functions.invoke('affiliate-ticket-sync', { body: { mode: 'sync' } });
      if (error) throw error;
      const result = Object.values((data?.results ?? {}) as Record<string, { applied?: { links?: number } }>)[0];
      const n = result?.applied?.links ?? 0;
      toast({ title: (n === 1 ? t('aff.ticketSync.doneOne') : t('aff.ticketSync.doneMany')).replace('{count}', String(n)) });
      await load();
      onSynced();
    } catch (err) {
      toast({ title: t('aff.ticketSync.error'), description: err instanceof Error ? err.message : undefined, variant: 'destructive' });
    } finally {
      setRunning(false);
    }
  };

  // Soirées ponctuelles : une soirée Whan hors série est créée seule.
  const toggleOneOffs = async () => {
    const next = !oneOffs;
    setOneOffs(next);
    const { error } = await supabase.rpc('set_affiliate_ticket_one_offs', { p_enabled: next });
    if (error) {
      setOneOffs(!next);
      toast({ title: t('aff.ticketSync.error'), description: error.message, variant: 'destructive' });
    }
  };

  if (accounts.length === 0) return null;

  const locale = language === 'fr' ? 'fr-FR' : language === 'es' ? 'es-ES' : 'en-GB';
  const todo = lastRun?.todo ?? [];
  const when = lastRun
    ? new Date(lastRun.ran_at).toLocaleString(locale, { weekday: 'short', day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' })
    : null;

  return (
    <div className="flex flex-wrap items-center gap-3 rounded-2xl px-4 py-3.5"
      style={{ background: INNER_BG, border: `1px solid ${BORDER}` }}>
      <Link2 className="h-4 w-4 flex-none" style={{ color: T2 }} />
      <div className="flex-1 min-w-[220px]" style={{ fontSize: 12.5, lineHeight: 1.5 }}>
        <p style={{ color: T1, fontWeight: 600 }}>
          {t('aff.ticketSync.title').replace('{accounts}', accounts.join(' → '))}
        </p>
        <p style={{ color: T3 }}>
          {when
            ? (
              <>
                {t('aff.ticketSync.lastRun').replace('{when}', when)}{' '}
                <span style={{ color: POS }}>
                  {(lastRun!.links_filled === 1 ? t('aff.ticketSync.linksOne') : t('aff.ticketSync.linksMany')).replace('{count}', String(lastRun!.links_filled))}
                </span>
                {lastRun!.one_offs_created > 0 && (
                  <span style={{ color: POS }}>
                    {' · '}{(lastRun!.one_offs_created === 1 ? t('aff.ticketSync.oneOffsOne') : t('aff.ticketSync.oneOffsMany')).replace('{count}', String(lastRun!.one_offs_created))}
                  </span>
                )}
                {todo.length > 0 && (
                  <span style={{ color: WARN }}>
                    {' · '}{(todo.length === 1 ? t('aff.ticketSync.todoOne') : t('aff.ticketSync.todoMany')).replace('{count}', String(todo.length))}
                  </span>
                )}
              </>
            )
            : t('aff.ticketSync.never')}
        </p>
      </div>
      <label className="flex items-center gap-2 cursor-pointer" style={{ fontSize: 12, color: T2 }}>
        <Toggle checked={oneOffs} onChange={toggleOneOffs} />
        {t('aff.ticketSync.oneOffsToggle')}
      </label>
      <AffButton variant="ghost" size="sm" onClick={runNow} disabled={running}>
        {running ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <RefreshCw className="h-3.5 w-3.5" />}
        {running ? t('aff.ticketSync.running') : t('aff.ticketSync.runNow')}
      </AffButton>
    </div>
  );
}
