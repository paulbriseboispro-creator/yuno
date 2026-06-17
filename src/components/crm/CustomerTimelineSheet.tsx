import { useEffect, useState } from 'react';
import { translate } from '@/i18n/orgTranslate';
import { supabase } from '@/integrations/supabase/client';
import { Sheet, SheetContent, SheetHeader, SheetTitle } from '@/components/ui/sheet';
import { Badge } from '@/components/ui/badge';
import { Ticket, Wine, Crown, ScanLine, CreditCard, MapPin, Sparkles, Loader2, ShieldAlert, FileText, Download } from 'lucide-react';
import { format } from 'date-fns';
import { fr as frLocale, enUS } from 'date-fns/locale';
import { useLanguage } from '@/contexts/LanguageContext';
import { ageFromBirthDate, type MinorDoc } from '@/lib/minorTicketDocs';

interface Props {
  open: boolean;
  onClose: () => void;
  email: string;
  name?: string;
  organizerUserId?: string;
  venueId?: string;
}

interface ActivityItem {
  ts: string;
  type: 'ticket' | 'table' | 'order' | 'scan' | 'visit' | 'other';
  label: string;
  amount?: number;
  eventTitle?: string;
}

const TYPE_META: Record<ActivityItem['type'], { icon: any; cls: string }> = {
  ticket: { icon: Ticket, cls: 'bg-blue-500/15 text-blue-400 border-blue-500/30' },
  table: { icon: Crown, cls: 'bg-yellow-500/15 text-yellow-400 border-yellow-500/30' },
  order: { icon: Wine, cls: 'bg-purple-500/15 text-purple-400 border-purple-500/30' },
  scan: { icon: ScanLine, cls: 'bg-emerald-500/15 text-emerald-400 border-emerald-500/30' },
  visit: { icon: MapPin, cls: 'bg-muted text-muted-foreground' },
  other: { icon: Sparkles, cls: 'bg-muted text-muted-foreground' },
};

export function CustomerTimelineSheet({ open, onClose, email, name, organizerUserId, venueId }: Props) {
  const { language } = useLanguage();
  const tt = (fr: string, en: string, es?: string) => translate(language, fr, en, es);
  const dateLocale = language === 'fr' ? frLocale : enUS;
  const [items, setItems] = useState<ActivityItem[]>([]);
  const [loading, setLoading] = useState(false);
  const [minorDoc, setMinorDoc] = useState<MinorDoc | null>(null);

  useEffect(() => {
    if (!open || !email) return;
    let cancelled = false;
    (async () => {
      setLoading(true);
      try {
        const lc = email.toLowerCase();

        // Resolve scoped events
        let eventIds: string[] = [];
        const eventTitles = new Map<string, string>();
        if (organizerUserId) {
          const { data: events } = await supabase
            .from('events')
            .select('id, title')
            .or(`organizer_user_id.eq.${organizerUserId},partner_organizer_id.eq.${organizerUserId}`);
          eventIds = (events ?? []).map((e: any) => e.id);
          (events ?? []).forEach((e: any) => eventTitles.set(e.id, e.title));
        } else if (venueId) {
          const { data: events } = await supabase
            .from('events')
            .select('id, title')
            .or(`venue_id.eq.${venueId},partner_venue_id.eq.${venueId}`);
          eventIds = (events ?? []).map((e: any) => e.id);
          (events ?? []).forEach((e: any) => eventTitles.set(e.id, e.title));
        }

        // Minor-ticket record for this buyer (across the scoped events).
        if (eventIds.length > 0) {
          const { data: minorRows } = await supabase
            .from('minor_ticket_docs' as any)
            .select('birth_date, doc_url, doc_name, created_at')
            .in('event_id', eventIds)
            .ilike('buyer_email', lc)
            .order('created_at', { ascending: false })
            .limit(1);
          const mr = (minorRows as any[])?.[0];
          if (!cancelled) setMinorDoc(mr ? { birthDate: mr.birth_date ?? null, docUrl: mr.doc_url ?? null, docName: mr.doc_name ?? null } : null);
        } else if (!cancelled) {
          setMinorDoc(null);
        }

        const list: ActivityItem[] = [];

        if (eventIds.length > 0) {
          const [ticketsRes, tablesRes] = await Promise.all([
            supabase.from('tickets')
              .select('total_price, created_at, event_id, scanned_at, quantity')
              .in('event_id', eventIds)
              .ilike('user_email', lc)
              .order('created_at', { ascending: false })
              .limit(100),
            supabase.from('table_reservations')
              .select('total_price, created_at, event_id')
              .in('event_id', eventIds)
              .ilike('user_email', lc)
              .order('created_at', { ascending: false })
              .limit(50),
          ]);
          (ticketsRes.data ?? []).forEach((t: any) => {
            list.push({
              ts: t.created_at,
              type: 'ticket',
              label: tt(`${t.quantity ?? 1} billet(s)`, `${t.quantity ?? 1} ticket(s)`, `${t.quantity ?? 1} entrada(s)`),
              amount: Number(t.total_price ?? 0),
              eventTitle: eventTitles.get(t.event_id),
            });
            if (t.scanned_at) {
              list.push({
                ts: t.scanned_at,
                type: 'scan',
                label: tt('Scanné à l\'entrée', 'Scanned at entry'),
                eventTitle: eventTitles.get(t.event_id),
              });
            }
          });
          (tablesRes.data ?? []).forEach((t: any) => {
            list.push({
              ts: t.created_at,
              type: 'table',
              label: tt('Table VIP réservée', 'VIP table booked'),
              amount: Number(t.total_price ?? 0),
              eventTitle: eventTitles.get(t.event_id),
            });
          });
        }

        // Drinks orders if venue context
        if (venueId) {
          const { data: orders } = await supabase
            .from('orders')
            .select('total, created_at, event_id, items')
            .eq('venue_id', venueId)
            .ilike('user_email', lc)
            .eq('status', 'paid')
            .order('created_at', { ascending: false })
            .limit(50);
          (orders ?? []).forEach((o: any) => {
            const itemCount = Array.isArray(o.items) ? o.items.length : 0;
            list.push({
              ts: o.created_at,
              type: 'order',
              label: tt(`Commande de ${itemCount} produit(s)`, `Order of ${itemCount} item(s)`, `Pedido de ${itemCount} producto(s)`),
              amount: Number(o.total ?? 0),
              eventTitle: o.event_id ? eventTitles.get(o.event_id) : undefined,
            });
          });
        }

        list.sort((a, b) => (a.ts < b.ts ? 1 : -1));
        if (!cancelled) setItems(list);
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => { cancelled = true; };
  }, [open, email, organizerUserId, venueId]);

  return (
    <Sheet open={open} onOpenChange={(v) => !v && onClose()}>
      <SheetContent side="right" className="w-full sm:max-w-md overflow-y-auto bg-background/95 backdrop-blur-xl border-l border-white/5">
        <SheetHeader className="text-left">
          <SheetTitle>{name || email.split('@')[0]}</SheetTitle>
          <p className="text-xs text-muted-foreground">{email} · {tt('Historique d\'activité', 'Activity history')}</p>
        </SheetHeader>
        {minorDoc && (
          <div className="mt-5 rounded-xl p-3.5 space-y-2.5" style={{ background: 'rgba(232,25,44,0.06)', border: '1px solid rgba(232,25,44,0.25)' }}>
            <p className="flex items-center gap-1.5 text-[11px] font-bold uppercase tracking-wider" style={{ color: '#FF7A80' }}>
              <ShieldAlert className="w-3.5 h-3.5" />
              {tt('Client mineur', 'Minor customer')}
            </p>
            {minorDoc.birthDate && (
              <p className="text-xs text-muted-foreground">
                {tt('Né(e) le', 'Born on')} {format(new Date(minorDoc.birthDate), 'dd/MM/yyyy', { locale: dateLocale })}
                {ageFromBirthDate(minorDoc.birthDate) != null && <span> · {ageFromBirthDate(minorDoc.birthDate)} {tt('ans', 'yo')}</span>}
              </p>
            )}
            {minorDoc.docUrl ? (
              <a href={minorDoc.docUrl} target="_blank" rel="noopener noreferrer" download
                className="flex items-center gap-2.5 rounded-lg border border-white/10 bg-white/[0.03] px-3 py-2.5 hover:bg-white/[0.06] transition">
                <FileText className="h-4 w-4 shrink-0 text-primary" />
                <span className="flex-1 truncate text-sm text-foreground">{minorDoc.docName || tt('Document signé', 'Signed document')}</span>
                <Download className="h-4 w-4 shrink-0 text-muted-foreground" />
              </a>
            ) : (
              <p className="text-xs text-muted-foreground">{tt('Aucun document', 'No document provided')}</p>
            )}
          </div>
        )}
        <div className="mt-6">
          {loading ? (
            <div className="flex items-center justify-center py-16 text-muted-foreground">
              <Loader2 className="h-5 w-5 animate-spin" />
            </div>
          ) : items.length === 0 ? (
            <div className="text-center py-16 text-muted-foreground text-sm">
              {tt('Aucune activité trouvée.', 'No activity found.')}
            </div>
          ) : (
            <div className="relative pl-6 space-y-4">
              <div className="absolute left-2 top-2 bottom-2 w-px bg-gradient-to-b from-primary/40 via-primary/10 to-transparent" />
              {items.map((it, i) => {
                const meta = TYPE_META[it.type];
                const Icon = meta.icon;
                return (
                  <div key={i} className="relative">
                    <div className="absolute -left-[22px] top-1 w-4 h-4 rounded-full bg-background border border-primary/40 flex items-center justify-center">
                      <Icon className="h-2.5 w-2.5 text-primary" />
                    </div>
                    <div className="rounded-xl border border-white/5 bg-white/[0.02] p-3 hover:bg-white/[0.04] transition">
                      <div className="flex items-start justify-between gap-2">
                        <div>
                          <Badge variant="outline" className={`${meta.cls} text-[10px] mb-1`}>
                            {it.label}
                          </Badge>
                          {it.eventTitle && (
                            <div className="text-xs text-foreground/80 mt-0.5">{it.eventTitle}</div>
                          )}
                        </div>
                        {it.amount !== undefined && it.amount > 0 && (
                          <div className="text-sm font-semibold text-primary whitespace-nowrap">
                            {it.amount.toFixed(0)} €
                          </div>
                        )}
                      </div>
                      <div className="text-[11px] text-muted-foreground mt-2 flex items-center gap-1">
                        <CreditCard className="h-3 w-3" />
                        {format(new Date(it.ts), 'PPp', { locale: dateLocale })}
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>
      </SheetContent>
    </Sheet>
  );
}
