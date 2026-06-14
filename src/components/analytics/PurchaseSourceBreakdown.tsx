import { useEffect, useState } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { TrendingUp, Building2, Megaphone, Compass, Link as LinkIcon, UserPlus, Music } from 'lucide-react';
import { useLanguage } from '@/contexts/LanguageContext';

type SourceCount = {
  venue_profile: number;
  organizer_profile: number;
  dj_profile: number;
  explore: number;
  promoter: number;
  direct: number;
  unknown: number;
};

const EMPTY: SourceCount = {
  venue_profile: 0,
  organizer_profile: 0,
  dj_profile: 0,
  explore: 0,
  promoter: 0,
  direct: 0,
  unknown: 0,
};

interface Props {
  eventId: string;
  /** Optional title override */
  title?: string;
}

const SOURCE_META: Record<keyof SourceCount, { labelFr: string; labelEn: string; icon: any; color: string }> = {
  venue_profile:     { labelFr: 'Profil club',         labelEn: 'Club page',        icon: Building2,  color: 'text-blue-400' },
  organizer_profile: { labelFr: 'Profil organisateur', labelEn: 'Organizer page',   icon: Megaphone,  color: 'text-fuchsia-400' },
  dj_profile:        { labelFr: 'Profil DJ',           labelEn: 'DJ page',          icon: Music,      color: 'text-amber-400' },
  explore:           { labelFr: 'Explorer',            labelEn: 'Explore',          icon: Compass,    color: 'text-emerald-400' },
  promoter:          { labelFr: 'Lien promoteur',      labelEn: 'Promoter link',    icon: UserPlus,   color: 'text-pink-400' },
  direct:            { labelFr: 'Lien direct',         labelEn: 'Direct link',      icon: LinkIcon,   color: 'text-muted-foreground' },
  unknown:           { labelFr: 'Source inconnue',     labelEn: 'Unknown',          icon: LinkIcon,   color: 'text-muted-foreground' },
};

export function PurchaseSourceBreakdown({ eventId, title }: Props) {
  const { language } = useLanguage();
  const [tickets, setTickets] = useState<SourceCount>(EMPTY);
  const [tables, setTables] = useState<SourceCount>(EMPTY);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!eventId) return;
    let cancelled = false;

    (async () => {
      setLoading(true);
      const [{ data: ticketRows }, { data: tableRows }] = await Promise.all([
        supabase
          .from('tickets')
          .select('purchase_source, quantity')
          .eq('event_id', eventId)
          .eq('status', 'paid'),
        supabase
          .from('table_reservations')
          .select('purchase_source')
          .eq('event_id', eventId)
          .in('status', ['paid', 'confirmed']),
      ]);

      if (cancelled) return;

      const tCount = { ...EMPTY };
      (ticketRows || []).forEach((r: any) => {
        const key = (r.purchase_source as keyof SourceCount) || 'unknown';
        if (key in tCount) tCount[key] += r.quantity || 1;
        else tCount.unknown += r.quantity || 1;
      });

      const rCount = { ...EMPTY };
      (tableRows || []).forEach((r: any) => {
        const key = (r.purchase_source as keyof SourceCount) || 'unknown';
        if (key in rCount) rCount[key] += 1;
        else rCount.unknown += 1;
      });

      setTickets(tCount);
      setTables(rCount);
      setLoading(false);
    })();

    return () => {
      cancelled = true;
    };
  }, [eventId]);

  const totalTickets = Object.values(tickets).reduce((a, b) => a + b, 0);
  const totalTables = Object.values(tables).reduce((a, b) => a + b, 0);

  if (!loading && totalTickets === 0 && totalTables === 0) {
    return null;
  }

  const renderRow = (key: keyof SourceCount, count: number, total: number) => {
    if (count === 0) return null;
    const meta = SOURCE_META[key];
    const Icon = meta.icon;
    const pct = total > 0 ? Math.round((count / total) * 100) : 0;
    return (
      <div key={key} className="flex items-center gap-3">
        <Icon className={`h-4 w-4 shrink-0 ${meta.color}`} />
        <div className="flex-1 min-w-0">
          <div className="flex items-center justify-between text-xs">
            <span className="text-foreground/90 truncate">
              {language === 'fr' ? meta.labelFr : meta.labelEn}
            </span>
            <span className="tabular-nums text-muted-foreground">
              {count} <span className="opacity-60">· {pct}%</span>
            </span>
          </div>
          <div className="h-1.5 mt-1 rounded-full bg-white/5 overflow-hidden">
            <div
              className="h-full bg-primary/70"
              style={{ width: `${pct}%` }}
            />
          </div>
        </div>
      </div>
    );
  };

  const orderedKeys: (keyof SourceCount)[] = [
    'venue_profile', 'organizer_profile', 'dj_profile', 'promoter', 'explore', 'direct', 'unknown',
  ];

  return (
    <Card className="bg-card/50 backdrop-blur border-white/10">
      <CardHeader className="pb-3">
        <CardTitle className="text-sm flex items-center gap-2">
          <TrendingUp className="h-4 w-4 text-primary" />
          {title || (language === 'fr' ? 'Sources d\'acquisition' : 'Acquisition sources')}
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-5">
        {loading ? (
          <p className="text-xs text-muted-foreground">…</p>
        ) : (
          <>
            {totalTickets > 0 && (
              <div>
                <p className="text-[11px] uppercase tracking-wider text-muted-foreground mb-2">
                  {language === 'fr' ? `Billets vendus (${totalTickets})` : `Tickets sold (${totalTickets})`}
                </p>
                <div className="space-y-2.5">
                  {orderedKeys.map((k) => renderRow(k, tickets[k], totalTickets))}
                </div>
              </div>
            )}
            {totalTables > 0 && (
              <div>
                <p className="text-[11px] uppercase tracking-wider text-muted-foreground mb-2">
                  {language === 'fr' ? `Tables réservées (${totalTables})` : `Tables booked (${totalTables})`}
                </p>
                <div className="space-y-2.5">
                  {orderedKeys.map((k) => renderRow(k, tables[k], totalTables))}
                </div>
              </div>
            )}
          </>
        )}
      </CardContent>
    </Card>
  );
}
