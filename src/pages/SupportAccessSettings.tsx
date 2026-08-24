// Accès assisté Yuno — page de consentement du pro.
//
// C'est la page qui transforme « Paul rentre dans mon compte » en « j'ai
// autorisé Yuno, pour 7 jours, sur ma configuration, et je vois tout ce qui a
// été fait ». Trois blocs, dans cet ordre : la demande en attente (décision),
// ce que l'accès permet et interdit (contrat), le journal (preuve).
//
// Servie sur /owner/support-access, /manager/support-access et
// /organizer-app/support-access — la même page pour les trois dashboards, comme
// OwnerSupportRequest.

import { useCallback, useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useLanguage } from '@/contexts/LanguageContext';
import { useDashboardMode } from '@/contexts/DashboardModeContext';
import { supabase } from '@/integrations/supabase/client';
import { useAuth } from '@/hooks/useAuth';
import {
  ArrowLeft, LifeBuoy, ShieldCheck, ShieldOff, Loader2, Check, X,
  CalendarClock, FileText, Lock,
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent,
  AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle,
} from '@/components/ui/alert-dialog';
import { cn } from '@/lib/utils';
import { toast } from 'sonner';
import { format } from 'date-fns';
import { fr, es, enUS } from 'date-fns/locale';

interface GrantRow {
  id: string;
  status: string;
  scope: string;
  reason: string | null;
  approved_at: string | null;
  revoked_at: string | null;
  expires_at: string;
  created_at: string;
}

interface SessionRow {
  id: string;
  status: string;
  created_at: string;
  ended_at: string | null;
  expires_at: string;
}

interface AuditRow {
  id: string;
  action: string;
  table_name: string | null;
  created_at: string;
}

// Libellé lisible d'une action journalisée. Le journal doit se lire sans
// connaître le schéma : « Liste d'invités modifiée », pas « update guest_lists ».
const TABLE_LABELS: Record<string, string> = {
  events: 'supportAccess.obj.events',
  guest_lists: 'supportAccess.obj.guestLists',
  guest_list_entries: 'supportAccess.obj.guests',
  guest_list_invites: 'supportAccess.obj.invites',
  guest_list_templates: 'supportAccess.obj.templates',
  table_packs: 'supportAccess.obj.tablePacks',
  venue_floor_plans: 'supportAccess.obj.floorPlan',
  organizer_profiles: 'supportAccess.obj.orgProfile',
  tracked_links: 'supportAccess.obj.links',
};

export default function SupportAccessSettings() {
  const { t, language } = useLanguage();
  const navigate = useNavigate();
  const { basePath } = useDashboardMode();
  const { user } = useAuth();

  const [grants, setGrants] = useState<GrantRow[]>([]);
  const [sessions, setSessions] = useState<SessionRow[]>([]);
  const [audit, setAudit] = useState<AuditRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [acting, setActing] = useState(false);
  const [confirmRevoke, setConfirmRevoke] = useState<string | null>(null);

  const locale = language === 'fr' ? fr : language === 'es' ? es : enUS;

  const load = useCallback(async () => {
    if (!user) return;
    const [g, s, a] = await Promise.all([
      supabase.from('admin_support_grants')
        .select('id, status, scope, reason, approved_at, revoked_at, expires_at, created_at')
        .eq('target_user_id', user.id).order('created_at', { ascending: false }).limit(20),
      supabase.from('admin_support_sessions')
        .select('id, status, created_at, ended_at, expires_at')
        .eq('target_user_id', user.id).order('created_at', { ascending: false }).limit(20),
      supabase.from('admin_support_audit')
        .select('id, action, table_name, created_at')
        .eq('target_user_id', user.id).order('created_at', { ascending: false }).limit(80),
    ]);
    setGrants((g.data as GrantRow[]) ?? []);
    setSessions((s.data as SessionRow[]) ?? []);
    setAudit((a.data as AuditRow[]) ?? []);
    setLoading(false);
  }, [user]);

  useEffect(() => { load(); }, [load]);

  const pending = grants.find((g) => g.status === 'pending' && new Date(g.expires_at) > new Date());
  const active = grants.find((g) => g.status === 'active' && new Date(g.expires_at) > new Date());
  const liveSession = sessions.find((s) => s.status === 'active' && new Date(s.expires_at) > new Date());

  const approve = async (id: string) => {
    setActing(true);
    const { error } = await supabase.rpc('approve_support_grant', { _grant_id: id });
    setActing(false);
    if (error) { toast.error(t('supportAccess.errorGeneric')); return; }
    toast.success(t('supportAccess.approved'));
    load();
  };

  /**
   * Le pro demande lui-même l'aide de Yuno. Le consentement, ici, EST le clic :
   * on ne le redemande pas dans un second écran. Le grant naît donc déjà actif.
   */
  const askForHelp = async () => {
    setActing(true);
    const { error } = await supabase.rpc('request_support_help', {
      _reason: t('supportAccess.askReason'),
    });
    setActing(false);
    if (error) { toast.error(t('supportAccess.errorGeneric')); return; }
    toast.success(t('supportAccess.askDone'));
    load();
  };

  const revoke = async (id: string) => {
    setActing(true);
    const { error } = await supabase.rpc('revoke_support_grant', { _grant_id: id });
    setActing(false);
    setConfirmRevoke(null);
    if (error) { toast.error(t('supportAccess.errorGeneric')); return; }
    toast.success(t('supportAccess.revoked'));
    load();
  };

  const auditLabel = (row: AuditRow): string => {
    if (row.action === 'grant_approved') return t('supportAccess.log.approved');
    if (row.action === 'grant_revoked') return t('supportAccess.log.revoked');
    if (row.action === 'session_opened') return t('supportAccess.log.sessionOpened');
    if (row.action === 'session_ended') return t('supportAccess.log.sessionEnded');
    const obj = row.table_name ? t(TABLE_LABELS[row.table_name] ?? row.table_name) : '';
    const verb =
      row.action === 'insert' ? t('supportAccess.log.created')
      : row.action === 'delete' ? t('supportAccess.log.deleted')
      : t('supportAccess.log.updated');
    return `${verb} · ${obj}`;
  };

  return (
    <div className="min-h-[100dvh] bg-background" style={{ paddingTop: 'env(safe-area-inset-top, 0px)', paddingBottom: 'env(safe-area-inset-bottom, 0px)' }}>
      <div className="sticky top-0 z-30 bg-background/95 backdrop-blur border-b border-border px-4 py-3 flex items-center gap-3" style={{ paddingTop: 'calc(0.75rem + env(safe-area-inset-top, 0px))' }}>
        <button onClick={() => navigate(basePath || '/')} className="text-muted-foreground hover:text-foreground">
          <ArrowLeft className="w-5 h-5" />
        </button>
        <LifeBuoy className="w-5 h-5 text-primary" />
        <h1 className="text-sm font-bold">{t('supportAccess.title')}</h1>
      </div>

      <div className="max-w-2xl mx-auto p-4 sm:p-6 pb-24 space-y-6">
        {loading ? (
          <div className="flex justify-center py-12"><Loader2 className="w-5 h-5 animate-spin text-muted-foreground" /></div>
        ) : (
          <>
            {/* État courant */}
            <div className={cn(
              'rounded-xl border p-4 space-y-3',
              liveSession ? 'border-amber-500/40 bg-amber-500/[0.07]'
                : active ? 'border-emerald-500/30 bg-emerald-500/[0.05]'
                : 'border-border bg-muted/20'
            )}>
              <div className="flex items-start gap-3">
                {liveSession ? <ShieldCheck className="w-5 h-5 text-amber-400 mt-0.5 shrink-0" />
                  : active ? <ShieldCheck className="w-5 h-5 text-emerald-400 mt-0.5 shrink-0" />
                  : <ShieldOff className="w-5 h-5 text-muted-foreground mt-0.5 shrink-0" />}
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-semibold">
                    {liveSession ? t('supportAccess.stateLive')
                      : active ? t('supportAccess.stateActive')
                      : t('supportAccess.stateOff')}
                  </p>
                  <p className="text-xs text-muted-foreground mt-1">
                    {liveSession ? t('supportAccess.stateLiveDesc')
                      : active ? t('supportAccess.stateActiveDesc')
                      : t('supportAccess.stateOffDesc')}
                  </p>
                  {active && (
                    <p className="text-[11px] text-muted-foreground/70 mt-2 flex items-center gap-1.5">
                      <CalendarClock className="w-3 h-3" />
                      {t('supportAccess.expiresOn')} {format(new Date(active.expires_at), 'dd MMM yyyy · HH:mm', { locale })}
                    </p>
                  )}
                </div>
              </div>
              {active && (
                <Button variant="outline" size="sm" className="w-full border-destructive/40 text-destructive hover:bg-destructive/10"
                  onClick={() => setConfirmRevoke(active.id)} disabled={acting}>
                  <ShieldOff className="w-4 h-4 mr-2" />
                  {t('supportAccess.revokeCta')}
                </Button>
              )}
              {/* Cas le plus fréquent : le pro veut qu'on lui monte son compte.
                  Il ouvre la porte lui-même plutôt que d'attendre qu'on frappe. */}
              {!active && !pending && (
                <Button size="sm" className="w-full" onClick={askForHelp} disabled={acting}>
                  {acting ? <Loader2 className="w-4 h-4 mr-2 animate-spin" /> : <LifeBuoy className="w-4 h-4 mr-2" />}
                  {t('supportAccess.askCta')}
                </Button>
              )}
            </div>

            {/* Demande en attente */}
            {pending && (
              <div className="rounded-xl border border-primary/40 bg-primary/[0.06] p-4 space-y-3">
                <div className="flex items-start gap-3">
                  <LifeBuoy className="w-5 h-5 text-primary mt-0.5 shrink-0" />
                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-semibold">{t('supportAccess.pendingTitle')}</p>
                    <p className="text-xs text-muted-foreground mt-1">{t('supportAccess.pendingDesc')}</p>
                    {pending.reason && (
                      <p className="text-xs mt-2 rounded-lg bg-background/60 border border-border p-2 italic">
                        « {pending.reason} »
                      </p>
                    )}
                  </div>
                </div>
                <div className="flex gap-2">
                  <Button size="sm" className="flex-1" onClick={() => approve(pending.id)} disabled={acting}>
                    {acting ? <Loader2 className="w-4 h-4 mr-2 animate-spin" /> : <Check className="w-4 h-4 mr-2" />}
                    {t('supportAccess.acceptCta')}
                  </Button>
                  <Button size="sm" variant="outline" className="flex-1" onClick={() => setConfirmRevoke(pending.id)} disabled={acting}>
                    <X className="w-4 h-4 mr-2" />
                    {t('supportAccess.refuseCta')}
                  </Button>
                </div>
              </div>
            )}

            {/* Le contrat : ce que l'accès permet et interdit */}
            <div className="rounded-xl border border-border bg-muted/20 p-4">
              <h2 className="text-xs uppercase tracking-wider text-muted-foreground mb-3">{t('supportAccess.scopeTitle')}</h2>
              <div className="space-y-2">
                {['scopeCan1', 'scopeCan2', 'scopeCan3'].map((k) => (
                  <p key={k} className="text-xs flex items-start gap-2">
                    <Check className="w-3.5 h-3.5 text-emerald-400 mt-0.5 shrink-0" />
                    <span className="text-muted-foreground">{t(`supportAccess.${k}`)}</span>
                  </p>
                ))}
                <div className="h-px bg-border my-3" />
                {['scopeCant1', 'scopeCant2', 'scopeCant3', 'scopeCant4'].map((k) => (
                  <p key={k} className="text-xs flex items-start gap-2">
                    <Lock className="w-3.5 h-3.5 text-destructive mt-0.5 shrink-0" />
                    <span className="text-muted-foreground">{t(`supportAccess.${k}`)}</span>
                  </p>
                ))}
              </div>
            </div>

            {/* Journal */}
            <div>
              <h2 className="text-xs uppercase tracking-wider text-muted-foreground mb-3 flex items-center gap-2">
                <FileText className="w-3.5 h-3.5" />
                {t('supportAccess.logTitle')}
              </h2>
              {audit.length === 0 ? (
                <p className="text-sm text-muted-foreground text-center py-6">{t('supportAccess.logEmpty')}</p>
              ) : (
                <div className="space-y-1.5">
                  {audit.map((row) => (
                    <div key={row.id} className="flex items-center justify-between gap-3 p-2.5 rounded-lg border border-border bg-muted/20">
                      <p className="text-xs flex-1 min-w-0 truncate">{auditLabel(row)}</p>
                      <span className="text-[10px] text-muted-foreground/60 shrink-0">
                        {format(new Date(row.created_at), 'dd/MM · HH:mm', { locale })}
                      </span>
                    </div>
                  ))}
                </div>
              )}
            </div>

            {/* Historique des autorisations */}
            {grants.length > 0 && (
              <div>
                <h2 className="text-xs uppercase tracking-wider text-muted-foreground mb-3">{t('supportAccess.historyTitle')}</h2>
                <div className="space-y-1.5">
                  {grants.map((g) => (
                    <div key={g.id} className="flex items-center justify-between gap-3 p-2.5 rounded-lg border border-border bg-muted/20">
                      <span className="text-[10px] text-muted-foreground/70">
                        {format(new Date(g.created_at), 'dd MMM yyyy', { locale })}
                      </span>
                      <Badge variant="outline" className="text-[10px]">
                        {t(`supportAccess.status.${g.status}`)}
                      </Badge>
                    </div>
                  ))}
                </div>
              </div>
            )}
          </>
        )}
      </div>

      <AlertDialog open={!!confirmRevoke} onOpenChange={(v) => !v && setConfirmRevoke(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>{t('supportAccess.revokeConfirmTitle')}</AlertDialogTitle>
            <AlertDialogDescription>{t('supportAccess.revokeConfirmDesc')}</AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>{t('common.cancel')}</AlertDialogCancel>
            <AlertDialogAction
              onClick={() => confirmRevoke && revoke(confirmRevoke)}
              className="bg-destructive text-destructive-foreground"
            >
              {t('supportAccess.revokeCta')}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
