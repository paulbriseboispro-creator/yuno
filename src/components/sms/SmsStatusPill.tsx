import { CheckCircle2, Clock, Loader2, Pause, XCircle, Send, CheckCheck, Ban } from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { useLanguage } from '@/contexts/LanguageContext';
import { cn } from '@/lib/utils';

const META: Record<string, { key: string; cls: string; icon: React.ReactNode }> = {
  draft:       { key: 'smsCampaigns.statusDraft',     cls: 'bg-zinc-800 text-zinc-300',            icon: <Clock className="h-3 w-3" /> },
  scheduled:   { key: 'smsCampaigns.statusScheduled', cls: 'bg-amber-900/60 text-amber-300',       icon: <Clock className="h-3 w-3" /> },
  sending:     { key: 'smsCampaigns.statusSending',   cls: 'bg-blue-900/60 text-blue-300',         icon: <Loader2 className="h-3 w-3 animate-spin" /> },
  paused:      { key: 'smsc.status.paused',           cls: 'bg-amber-900/60 text-amber-300',       icon: <Pause className="h-3 w-3" /> },
  sent:        { key: 'smsCampaigns.statusSent',      cls: 'bg-emerald-900/60 text-emerald-300',   icon: <CheckCircle2 className="h-3 w-3" /> },
  failed:      { key: 'smsCampaigns.statusFailed',    cls: 'bg-rose-900/60 text-rose-300',         icon: <XCircle className="h-3 w-3" /> },
  cancelled:   { key: 'smsCampaigns.statusCancelled', cls: 'bg-zinc-800 text-zinc-400',            icon: <Ban className="h-3 w-3" /> },
  // Statuts d'un destinataire
  pending:     { key: 'smsc.rstatus.pending',         cls: 'bg-zinc-800 text-zinc-300',            icon: <Clock className="h-3 w-3" /> },
  delivered:   { key: 'smsc.rstatus.delivered',       cls: 'bg-emerald-900/60 text-emerald-300',   icon: <CheckCheck className="h-3 w-3" /> },
  undelivered: { key: 'smsc.rstatus.undelivered',     cls: 'bg-rose-900/60 text-rose-300',         icon: <XCircle className="h-3 w-3" /> },
  skipped:     { key: 'smsc.rstatus.skipped',         cls: 'bg-zinc-800 text-zinc-400',            icon: <Ban className="h-3 w-3" /> },
};

export function SmsStatusPill({ status, small }: { status: string; small?: boolean }) {
  const { t } = useLanguage();
  const m = META[status] ?? { key: '', cls: 'bg-zinc-800 text-zinc-300', icon: <Send className="h-3 w-3" /> };
  // « sent » pour un destinataire = remis à l'opérateur, en attente d'accusé.
  const label = m.key ? t(status === 'sent' && small ? 'smsc.rstatus.sent' : m.key) : status;
  return (
    <Badge className={cn('flex shrink-0 items-center gap-1', small ? 'px-1.5 py-0 text-[10px]' : 'text-xs', m.cls)}>
      {m.icon}{label}
    </Badge>
  );
}
