// Assistants IA — brancher ChatGPT, Claude, Gemini ou Le Chat sur les chiffres
// Yuno (serveur MCP, docs/MCP.md), et garder la main dessus.
//
// Même famille que la page Accès assisté : un accès à TON compte, accordé par
// toi, révocable, journalisé. Quatre blocs dans cet ordre : l'adresse et le pas
// à pas (agir), les questions qu'on peut poser (donner envie), les IA
// connectées avec leur journal et le bouton couper (contrôler), le contrat
// (ce qu'une IA peut et ne peut pas faire).
//
// Servie sur /owner/ai-assistants, /manager/ai-assistants et
// /organizer-app/ai-assistants. Le propriétaire d'un club / fondateur d'une
// organisation voit aussi les IA connectées par son équipe et peut les couper
// (mcp_my_connections / mcp_revoke_connection).

import { useCallback, useEffect, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { ArrowLeft, Bot, Check, Copy, ExternalLink, Loader2, Lock, ShieldCheck, ShieldOff, Sparkles, History } from 'lucide-react';
import { format } from 'date-fns';
import { enUS, es, fr } from 'date-fns/locale';
import { toast } from 'sonner';
import { useLanguage } from '@/contexts/LanguageContext';
import { useDashboardMode } from '@/contexts/DashboardModeContext';
import { supabase } from '@/integrations/supabase/client';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent,
  AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle,
} from '@/components/ui/alert-dialog';
import { cn } from '@/lib/utils';
import {
  MCP_CLIENT_GUIDES, MCP_EXAMPLE_QUESTIONS, MCP_SERVER_URL, MCP_TOOL_LABEL_KEYS,
  type McpActivityRow, type McpClientId, type McpConnection,
} from '@/lib/mcp';

function CopyField({ value, label }: { value: string; label: string }) {
  const { t } = useLanguage();
  const [copied, setCopied] = useState(false);
  const copy = async () => {
    try {
      await navigator.clipboard.writeText(value);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1600);
    } catch {
      toast.error(t('aiSettings.copyFailed'));
    }
  };
  return (
    <div className="flex items-center gap-2 rounded-lg border border-border bg-background/60 p-1.5 pl-3">
      <code className="flex-1 min-w-0 truncate text-sm font-mono" aria-label={label}>{value}</code>
      <Button size="sm" variant="secondary" onClick={copy} className="shrink-0">
        {copied ? <Check className="w-4 h-4 mr-1.5" /> : <Copy className="w-4 h-4 mr-1.5" />}
        {copied ? t('aiMcp.copied') : t('aiMcp.copy')}
      </Button>
    </div>
  );
}

export default function AiAssistantsSettings() {
  const { t, language } = useLanguage();
  const navigate = useNavigate();
  const { basePath } = useDashboardMode();
  const locale = language === 'fr' ? fr : language === 'es' ? es : enUS;

  const [client, setClient] = useState<McpClientId>('claude');
  const [connections, setConnections] = useState<McpConnection[]>([]);
  const [loading, setLoading] = useState(true);
  const [openLog, setOpenLog] = useState<string | null>(null);
  const [logs, setLogs] = useState<Record<string, McpActivityRow[] | 'loading'>>({});
  const [confirmRevoke, setConfirmRevoke] = useState<McpConnection | null>(null);
  const [acting, setActing] = useState(false);

  const load = useCallback(async () => {
    const { data, error } = await supabase.rpc('mcp_my_connections' as never);
    const r = data as { ok: boolean; connections?: McpConnection[] } | null;
    if (!error && r?.ok) setConnections(r.connections ?? []);
    setLoading(false);
  }, []);

  useEffect(() => { load(); }, [load]);

  const toggleLog = async (id: string) => {
    if (openLog === id) { setOpenLog(null); return; }
    setOpenLog(id);
    if (logs[id] && logs[id] !== 'loading') return;
    setLogs((cur) => ({ ...cur, [id]: 'loading' }));
    const { data } = await supabase.rpc('mcp_connection_activity' as never, { p_grant_id: id, p_limit: 60 } as never);
    const r = data as { ok: boolean; calls?: McpActivityRow[] } | null;
    setLogs((cur) => ({ ...cur, [id]: r?.calls ?? [] }));
  };

  const revoke = async (c: McpConnection) => {
    setActing(true);
    const { data, error } = await supabase.rpc('mcp_revoke_connection' as never, { p_grant_id: c.id } as never);
    setActing(false);
    setConfirmRevoke(null);
    if (error || !(data as { ok?: boolean } | null)?.ok) { toast.error(t('aiSettings.errorGeneric')); return; }
    toast.success(t('aiSettings.revokedToast'));
    load();
  };

  const guide = MCP_CLIENT_GUIDES.find((g) => g.id === client) ?? MCP_CLIENT_GUIDES[0];
  const active = connections.filter((c) => !c.revoked_at);
  // L'historique sert à comprendre une coupure récente, pas à archiver : 8 lignes.
  const past = connections.filter((c) => c.revoked_at).slice(0, 8);
  const fmt = (iso: string, pattern = 'dd MMM yyyy · HH:mm') => format(new Date(iso), pattern, { locale });
  const callsLabel = (n: number) => (n === 1 ? t('aiSettings.callsOne') : t('aiSettings.calls')).replace('{n}', String(n));

  return (
    <div className="min-h-[100dvh] bg-background" style={{ paddingTop: 'env(safe-area-inset-top, 0px)', paddingBottom: 'env(safe-area-inset-bottom, 0px)' }}>
      <div className="sticky top-0 z-30 bg-background/95 backdrop-blur border-b border-border px-4 py-3 flex items-center gap-3" style={{ paddingTop: 'calc(0.75rem + env(safe-area-inset-top, 0px))' }}>
        <button onClick={() => navigate(basePath || '/')} className="text-muted-foreground hover:text-foreground" aria-label={t('common.back')}>
          <ArrowLeft className="w-5 h-5" />
        </button>
        <Bot className="w-5 h-5 text-primary" />
        <h1 className="text-sm font-bold">{t('aiSettings.title')}</h1>
      </div>

      <div className="max-w-2xl mx-auto p-4 sm:p-6 pb-24 space-y-6">
        {/* Agir : l'adresse et le pas à pas */}
        <section className="rounded-xl border border-primary/30 bg-primary/[0.05] p-4 sm:p-5 space-y-4">
          <div>
            <h2 className="text-base font-semibold">{t('aiSettings.heroTitle')}</h2>
            <p className="text-sm text-muted-foreground mt-1.5">{t('aiSettings.heroBody')}</p>
          </div>
          <div className="space-y-1.5">
            <p className="text-[11px] uppercase tracking-wider text-muted-foreground">{t('aiMcp.serverUrl')}</p>
            <CopyField value={MCP_SERVER_URL} label={t('aiMcp.serverUrl')} />
          </div>

          <div>
            <div className="flex flex-wrap gap-1.5" role="tablist" aria-label={t('aiSettings.howTitle')}>
              {MCP_CLIENT_GUIDES.map((g) => (
                <button
                  key={g.id}
                  role="tab"
                  aria-selected={client === g.id}
                  onClick={() => setClient(g.id)}
                  className={cn(
                    'px-3 py-1.5 rounded-full text-xs font-medium border transition-colors',
                    client === g.id ? 'bg-foreground text-background border-foreground' : 'border-border text-muted-foreground hover:text-foreground',
                  )}
                >
                  {g.name}
                </button>
              ))}
            </div>
            <ol className="mt-3 space-y-2.5" role="tabpanel">
              {guide.steps.map((k, i) => (
                <li key={k} className="flex items-start gap-3 text-sm">
                  <span className="shrink-0 w-6 h-6 rounded-full bg-muted text-xs font-semibold flex items-center justify-center">{i + 1}</span>
                  <span className="pt-0.5">{t(k)}</span>
                </li>
              ))}
            </ol>
            {guide.command && <div className="mt-3"><CopyField value={guide.command} label="command" /></div>}
            {guide.note && <p className="text-xs text-muted-foreground mt-3">{t(guide.note)}</p>}
            {client === 'claude' && <p className="text-xs text-muted-foreground mt-3">{t('aiConsent.autoAllowTip')}</p>}
          </div>
        </section>

        {/* Donner envie : ce qu'on peut demander */}
        <section>
          <h2 className="text-xs uppercase tracking-wider text-muted-foreground mb-3 flex items-center gap-2">
            <Sparkles className="w-3.5 h-3.5" />{t('aiSettings.examplesTitle')}
          </h2>
          <div className="grid sm:grid-cols-2 gap-2">
            {MCP_EXAMPLE_QUESTIONS.map((k) => (
              <p key={k} className="text-sm rounded-lg border border-border bg-muted/20 p-3">« {t(k)} »</p>
            ))}
          </div>
        </section>

        {/* Contrôler : les IA connectées */}
        <section>
          <h2 className="text-xs uppercase tracking-wider text-muted-foreground mb-3">{t('aiSettings.connectionsTitle')}</h2>
          {loading ? (
            <div className="flex justify-center py-8"><Loader2 className="w-5 h-5 animate-spin text-muted-foreground" /></div>
          ) : active.length === 0 ? (
            <p className="text-sm text-muted-foreground rounded-xl border border-dashed border-border p-5 text-center">{t('aiSettings.none')}</p>
          ) : (
            <div className="space-y-2">
              {active.map((c) => {
                const log = logs[c.id];
                return (
                  <div key={c.id} className="rounded-xl border border-border bg-muted/20 p-4">
                    <div className="flex items-start gap-3">
                      <ShieldCheck className="w-5 h-5 text-emerald-400 mt-0.5 shrink-0" />
                      <div className="flex-1 min-w-0">
                        <div className="flex flex-wrap items-center gap-2">
                          <p className="text-sm font-semibold">{c.client_name}</p>
                          <Badge variant="outline" className="text-[10px]">
                            {c.level === 'customers' ? t('aiSettings.levelCustomers') : t('aiSettings.levelAnalytics')}
                          </Badge>
                          {c.can_draft && (
                            <Badge variant="outline" className="text-[10px]">{t('aiSettings.drafts')}</Badge>
                          )}
                          {c.can_pages && (
                            <Badge variant="outline" className="text-[10px]">{t('aiSettings.pages')}</Badge>
                          )}
                          {c.can_scenarios && (
                            <Badge variant="outline" className="text-[10px]">{t('aiSettings.scenarios')}</Badge>
                          )}
                        </div>
                        <p className="text-xs text-muted-foreground mt-1">
                          {c.spaces.map((s) => s.name).join(' · ')}
                          {!c.mine && c.person ? ` — ${t('aiSettings.team').replace('{name}', c.person)}` : ''}
                        </p>
                        <p className="text-[11px] text-muted-foreground/80 mt-1.5">
                          {t('aiSettings.connectedOn')} {fmt(c.created_at, 'dd MMM yyyy')}
                          {' · '}
                          {c.last_used_at ? `${t('aiSettings.lastUsed')} ${fmt(c.last_used_at)}` : t('aiSettings.never')}
                          {' · '}{callsLabel(c.calls_count)}
                          {c.drafts_created ? ` · ${c.drafts_created === 1 ? t('aiSettings.draftsCountOne') : t('aiSettings.draftsCount').replace('{n}', String(c.drafts_created))}` : ''}
                          {c.pages_created ? ` · ${c.pages_created === 1 ? t('aiSettings.pagesCountOne') : t('aiSettings.pagesCount').replace('{n}', String(c.pages_created))}` : ''}
                          {c.scenarios_created ? ` · ${c.scenarios_created === 1 ? t('aiSettings.scenariosCountOne') : t('aiSettings.scenariosCount').replace('{n}', String(c.scenarios_created))}` : ''}
                        </p>
                      </div>
                    </div>
                    <div className="flex gap-2 mt-3">
                      <Button variant="outline" size="sm" className="flex-1" onClick={() => toggleLog(c.id)}>
                        <History className="w-4 h-4 mr-1.5" />{t('aiSettings.journal')}
                      </Button>
                      <Button variant="outline" size="sm" className="flex-1 border-destructive/40 text-destructive hover:bg-destructive/10"
                        onClick={() => setConfirmRevoke(c)} disabled={acting}>
                        <ShieldOff className="w-4 h-4 mr-1.5" />{t('aiSettings.revoke')}
                      </Button>
                    </div>
                    {openLog === c.id && (
                      <div className="mt-3 space-y-1.5">
                        {log === 'loading' || log === undefined ? (
                          <div className="flex justify-center py-3"><Loader2 className="w-4 h-4 animate-spin text-muted-foreground" /></div>
                        ) : log.length === 0 ? (
                          <p className="text-xs text-muted-foreground text-center py-3">{t('aiSettings.journalEmpty')}</p>
                        ) : log.map((row, i) => (
                          <div key={i} className="flex items-center justify-between gap-3 p-2 rounded-lg border border-border bg-background/50">
                            <p className="text-xs flex-1 min-w-0 truncate">
                              {MCP_TOOL_LABEL_KEYS[row.tool] ? t(MCP_TOOL_LABEL_KEYS[row.tool]) : row.tool}
                              {row.status !== 'ok' && (
                                <span className="ml-2 text-[10px] text-destructive">{t(`aiSettings.status.${row.status}`)}</span>
                              )}
                            </p>
                            <span className="text-[10px] text-muted-foreground/70 shrink-0">{fmt(row.created_at, 'dd/MM · HH:mm')}</span>
                          </div>
                        ))}
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          )}
          {past.length > 0 && (
            <div className="mt-3 space-y-1.5">
              {past.map((c) => (
                <div key={c.id} className="flex items-center justify-between gap-3 p-2.5 rounded-lg border border-border bg-muted/10">
                  <span className="text-xs text-muted-foreground truncate">{c.client_name} · {c.spaces.map((s) => s.name).join(' · ')}</span>
                  <span className="text-[10px] text-muted-foreground/70 shrink-0">
                    {t('aiSettings.revoked')} {c.revoked_reason ? `(${t(`aiSettings.reason.${c.revoked_reason}`)})` : ''} · {fmt(c.revoked_at!, 'dd MMM')}
                  </span>
                </div>
              ))}
            </div>
          )}
        </section>

        {/* Le contrat */}
        <section className="rounded-xl border border-border bg-muted/20 p-4">
          <h2 className="text-xs uppercase tracking-wider text-muted-foreground mb-3">{t('aiSettings.contractTitle')}</h2>
          <div className="space-y-2">
            {['aiMcp.can1', 'aiMcp.can2', 'aiMcp.can3', 'aiMcp.can4', 'aiMcp.can5', 'aiMcp.can6'].map((k) => (
              <p key={k} className="text-xs flex items-start gap-2">
                <Check className="w-3.5 h-3.5 text-emerald-400 mt-0.5 shrink-0" />
                <span className="text-muted-foreground">{t(k)}</span>
              </p>
            ))}
            <div className="h-px bg-border my-3" />
            {['aiMcp.cant1', 'aiMcp.cant2', 'aiMcp.cant3'].map((k) => (
              <p key={k} className="text-xs flex items-start gap-2">
                <Lock className="w-3.5 h-3.5 text-destructive mt-0.5 shrink-0" />
                <span className="text-muted-foreground">{t(k)}</span>
              </p>
            ))}
          </div>
          <Link to="/ai" target="_blank" className="inline-flex items-center gap-1.5 text-xs text-primary mt-4 hover:underline">
            {t('aiSettings.learnMore')}<ExternalLink className="w-3 h-3" />
          </Link>
        </section>
      </div>

      <AlertDialog open={!!confirmRevoke} onOpenChange={(v) => !v && setConfirmRevoke(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>{t('aiSettings.revokeConfirmTitle').replace('{client}', confirmRevoke?.client_name ?? '')}</AlertDialogTitle>
            <AlertDialogDescription>{t('aiSettings.revokeConfirmDesc')}</AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>{t('common.cancel')}</AlertDialogCancel>
            <AlertDialogAction onClick={() => confirmRevoke && revoke(confirmRevoke)} className="bg-destructive text-destructive-foreground">
              {t('aiSettings.revoke')}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
