import { useCallback, useEffect, useState } from 'react';
import { Bot, Plug, ShieldAlert, TriangleAlert, Users, Wrench, Zap, Store } from 'lucide-react';
import { supabase } from '@/integrations/supabase/client';
import { useLanguage } from '@/contexts/LanguageContext';
import { Card, DistRow, EmptyState, Pill, Reveal, SectionHeading, Stat, T1, T3, F_BORDER } from '@/components/admin/ui';
import { deltaPct, fmtMs, fmtNum, fmtRelative } from '@/lib/adminFormat';

/**
 * Connecteur IA (serveur MCP, docs/MCP.md) — l'adoption vue par le super
 * admin, sous la consommation OpenAI de /admin/ai : ce sont les IA des PROS
 * (Claude, ChatGPT…) qui lisent leurs chiffres, Yuno ne paie aucun token.
 * Un seul appel : admin_mcp_usage (démo exclue par défaut).
 */

interface McpUsage {
  totals: {
    active_connections: number; connected_users: number; customers_level: number; new_connections: number;
    revoked: number; security_revocations: number; calls: number; prev_calls: number; errors: number;
    active_users: number; avg_ms: number | null;
  };
  by_tool: { tool: string; n: number; errors: number; avg_ms: number | null }[];
  by_client: { client: string; connections: number; calls: number }[];
  by_space: { space: string; name: string; calls: number }[];
  recent_errors: { tool: string; error: string | null; status: string; at: string }[];
}

export function AdminMcpUsage({ from, to, includeDemo }: { from: Date; to: Date; includeDemo: boolean }) {
  const { t, language } = useLanguage();
  const [data, setData] = useState<McpUsage | null>(null);
  const [failed, setFailed] = useState(false);

  const load = useCallback(async () => {
    const { data: d, error } = await supabase.rpc('admin_mcp_usage' as never, {
      p_from: from.toISOString(), p_to: to.toISOString(), p_include_demo: includeDemo,
    } as never);
    if (error) setFailed(true); else { setFailed(false); setData(d as unknown as McpUsage); }
  }, [from, to, includeDemo]);
  useEffect(() => { load(); }, [load]);

  if (failed || !data) return null;
  const tot = data.totals;
  const maxTool = Math.max(...data.by_tool.map((x) => x.n), 1);
  const maxClient = Math.max(...data.by_client.map((x) => x.calls), 1);
  const maxSpace = Math.max(...data.by_space.map((x) => x.calls), 1);

  return (
    <>
      <SectionHeading label={t('adm.mcp.title')} icon={Plug} accent />
      <p style={{ color: T3, fontSize: 12.5, marginTop: -6 }}>{t('adm.mcp.subtitle')}</p>
      {tot.active_connections === 0 && tot.calls === 0 ? (
        <Card><EmptyState icon={Plug} text={t('adm.mcp.empty')} /></Card>
      ) : (
        <>
          <Reveal>
            <div className="grid grid-cols-2 md:grid-cols-3 xl:grid-cols-6 gap-3">
              <Stat label={t('adm.mcp.connections')} value={fmtNum(tot.active_connections, language)} icon={Plug} highlight
                sub={t('adm.mcp.newN').replace('{n}', fmtNum(tot.new_connections, language))} />
              <Stat label={t('adm.mcp.users')} value={fmtNum(tot.connected_users, language)} icon={Users}
                sub={t('adm.mcp.activeN').replace('{n}', fmtNum(tot.active_users, language))} />
              <Stat label={t('adm.mcp.calls')} value={fmtNum(tot.calls, language)} icon={Zap}
                delta={deltaPct(tot.calls, tot.prev_calls)} deltaVs={t('adm.common.vsPrev')} />
              <Stat label={t('adm.mcp.customersLevel')} value={fmtNum(tot.customers_level, language)} icon={Bot}
                sub={t('adm.mcp.customersHint')} />
              <Stat label={t('adm.mcp.errors')} value={fmtNum(tot.errors, language)} icon={TriangleAlert}
                tone={tot.errors > 0 ? 'neg' : undefined} sub={tot.avg_ms != null ? t('adm.mcp.avg').replace('{v}', fmtMs(tot.avg_ms, language)) : undefined} />
              <Stat label={t('adm.mcp.security')} value={fmtNum(tot.security_revocations, language)} icon={ShieldAlert}
                tone={tot.security_revocations > 0 ? 'neg' : undefined}
                sub={t('adm.mcp.revokedN').replace('{n}', fmtNum(tot.revoked, language))} />
            </div>
          </Reveal>
          <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
            <Reveal delay={0.05}>
              <Card title={t('adm.mcp.byTool')} icon={Wrench}>
                {data.by_tool.length === 0 ? <EmptyState text={t('adm.common.noData')} /> : data.by_tool.map((x) => (
                  <DistRow key={x.tool} label={<code style={{ color: T1 }}>{x.tool}</code>}
                    value={fmtNum(x.n, language)}
                    sub={`${x.avg_ms != null ? fmtMs(x.avg_ms, language) : '—'}${x.errors ? ` · ${fmtNum(x.errors, language)} ✕` : ''}`}
                    pct={(x.n / maxTool) * 100} />
                ))}
              </Card>
            </Reveal>
            <Reveal delay={0.1}>
              <Card title={t('adm.mcp.byClient')} icon={Bot}>
                {data.by_client.length === 0 ? <EmptyState text={t('adm.common.noData')} /> : data.by_client.map((x) => (
                  <DistRow key={x.client} label={x.client} value={fmtNum(x.calls, language)}
                    sub={t('adm.mcp.connectionsN').replace('{n}', fmtNum(x.connections, language))} pct={(x.calls / maxClient) * 100} />
                ))}
              </Card>
            </Reveal>
            <Reveal delay={0.15}>
              <Card title={t('adm.mcp.bySpace')} icon={Store}>
                {data.by_space.length === 0 ? <EmptyState text={t('adm.common.noData')} /> : data.by_space.map((x) => (
                  <DistRow key={x.space} label={x.name} value={fmtNum(x.calls, language)} pct={(x.calls / maxSpace) * 100} />
                ))}
              </Card>
            </Reveal>
          </div>
          {data.recent_errors.length > 0 && (
            <Reveal delay={0.2}>
              <Card title={t('adm.mcp.recentErrors')} icon={TriangleAlert} accent>
                {data.recent_errors.map((e, i) => (
                  <div key={i} className="flex items-center justify-between gap-3 py-2" style={{ borderBottom: `1px solid ${F_BORDER}` }}>
                    <span className="flex items-center gap-2 min-w-0">
                      <code style={{ color: T1, fontSize: 12.5 }}>{e.tool}</code>
                      <Pill size="xs" tone="neg">{e.error ?? e.status}</Pill>
                    </span>
                    <span className="tabular-nums" style={{ color: T3, fontSize: 11 }}>{fmtRelative(e.at, language)}</span>
                  </div>
                ))}
              </Card>
            </Reveal>
          )}
        </>
      )}
    </>
  );
}
