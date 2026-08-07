import { useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { format } from 'date-fns';
import { fr as frLoc, es as esLoc, enUS } from 'date-fns/locale';
import { supabase } from '@/integrations/supabase/client';
import { useAgency } from '@/hooks/useAgency';
import { useAgencyData, promoterName } from '@/hooks/useAgencyData';
import { useAgencyEvents } from '@/hooks/useAgencyEvents';
import { useAffiliateShell } from '@/contexts/AffiliateShellContext';
import { useLanguage } from '@/contexts/LanguageContext';
import { translate } from '@/i18n/orgTranslate';
import { toast } from 'sonner';
import {
  Wallet, TrendingUp, Users, Building2,
  ArrowDownLeft, ArrowUpRight, Trophy, UserPlus, Calendar,
  Eye, MousePointerClick, MapPin, BarChart2,
} from 'lucide-react';
import {
  PromoCard, StatTile, SectionLabel, PromoEmpty, PromoAvatar, PromoPill, PromoButton,
  T1, T2, T3, RED, POS, WARN,
} from '@/components/promoter/promoter-ui';

const eur = (n: number) => `${(Number(n) || 0).toFixed(2)} €`;

export default function AgencyDashboard() {
  const { agency } = useAgency();
  const { promoters, conversions, totals, loading, refetch } = useAgencyData(agency?.id ?? null);
  const { events } = useAgencyEvents(agency?.id ?? null, 30);
  const { language } = useLanguage();
  const tt = (fr: string, en: string) => translate(language, fr, en);
  const dateLocale = language === 'fr' ? frLoc : language === 'es' ? esLoc : enUS;
  const navigate = useNavigate();

  // Bras externe (clubs non-Yuno) : trafic 30 jours + taille du catalogue.
  const shell = useAffiliateShell();
  const [ext, setExt] = useState<{ views: number; clicks: number; venues: number; events: number } | null>(null);
  const [extWeek, setExtWeek] = useState<{ id: string; name: string; event_date: string; start_time: string | null; venue_name: string | null }[]>([]);

  useEffect(() => {
    const affiliateId = shell?.affiliateId;
    if (!affiliateId) return;
    let active = true;
    (async () => {
      const since = new Date();
      since.setDate(since.getDate() - 30);
      const today = new Date().toISOString().split('T')[0];
      const [v, c, ven, ev] = await Promise.all([
        supabase.from('affiliate_visitor_sessions')
          .select('id', { count: 'exact', head: true })
          .eq('affiliate_id', affiliateId).eq('is_internal', false)
          .gte('visited_at', since.toISOString()),
        supabase.from('affiliate_clicks')
          .select('id', { count: 'exact', head: true })
          .eq('affiliate_id', affiliateId).eq('is_internal', false)
          .gte('clicked_at', since.toISOString()),
        supabase.from('affiliate_venues')
          .select('id', { count: 'exact', head: true })
          .eq('affiliate_id', affiliateId).eq('is_active', true),
        supabase.from('affiliate_events')
          .select('id', { count: 'exact', head: true })
          .eq('affiliate_id', affiliateId).in('status', ['published', 'featured'])
          .gte('event_date', today),
      ]);
      if (active) {
        setExt({ views: v.count ?? 0, clicks: c.count ?? 0, venues: ven.count ?? 0, events: ev.count ?? 0 });
      }
      // Les 7 prochains jours côté externe, pour le strip unifié.
      const in7 = new Date();
      in7.setDate(in7.getDate() + 7);
      const { data: week } = await supabase
        .from('affiliate_events')
        .select('id, name, event_date, start_time, affiliate_venues(name)')
        .eq('affiliate_id', affiliateId)
        .in('status', ['published', 'featured'])
        .gte('event_date', today)
        .lte('event_date', in7.toISOString().split('T')[0])
        .order('event_date')
        .limit(10);
      if (active) {
        setExtWeek((week ?? []).map((e) => ({
          id: e.id,
          name: e.name,
          event_date: e.event_date,
          start_time: e.start_time,
          venue_name: (Array.isArray(e.affiliate_venues) ? e.affiliate_venues[0] : e.affiliate_venues)?.name ?? null,
        })));
      }
    })();
    return () => { active = false; };
  }, [shell?.affiliateId]);

  // Strip « 7 prochains jours » : les deux modes de distribution, une seule liste.
  const weekAhead = useMemo(() => {
    const limit = new Date();
    limit.setDate(limit.getDate() + 7);
    const yuno = events
      .filter(e => new Date(e.start_at) <= limit)
      .map(e => ({
        key: `y-${e.event_id}`,
        name: e.title,
        when: new Date(e.start_at),
        venue: e.venue_name,
        mode: 'yuno' as const,
        extra: e.assigned_promoter_count,
      }));
    const external = extWeek.map(e => ({
      key: `x-${e.id}`,
      name: e.name,
      // start_time arrive en "HH:MM:SS" (colonne Postgres `time`) : normaliser
      // en "HH:MM" avant de rebâtir l'ISO, sinon "…T23:59:00:00" = Invalid Date
      // et le format() de date-fns throw → tout le cockpit tombe en erreur.
      when: new Date(`${e.event_date}T${(e.start_time ?? '23:00').slice(0, 5)}:00`),
      venue: e.venue_name,
      mode: 'external' as const,
      extra: null as number | null,
    }));
    // Garde-fou : aucune Invalid Date ne doit atteindre format() (un seul throw
    // ferait tomber tout le cockpit agence).
    return [...yuno, ...external]
      .filter(x => !Number.isNaN(x.when.getTime()))
      .sort((a, b) => a.when.getTime() - b.when.getTime())
      .slice(0, 8);
  }, [events, extWeek]);

  const leaderboard = useMemo(() => {
    const byPromoter = new Map<string, number>();
    for (const c of conversions) {
      if (!c.promoter_id) continue;
      byPromoter.set(c.promoter_id, (byPromoter.get(c.promoter_id) || 0) + Number(c.gross_amount || 0));
    }
    return promoters
      .map(p => ({ p, gross: byPromoter.get(p.id) || 0 }))
      .sort((a, b) => b.gross - a.gross)
      .slice(0, 6);
  }, [promoters, conversions]);

  // Le règlement suit désormais le cycle en trois temps (IBAN, référence,
  // accusé de réception) : tout se passe sur l'écran Finance.
  const handleBulkSettle = () => {
    if (totals.payableToPromoters === 0) { toast.info(tt('Rien à régler', 'Nothing to settle')); return; }
    navigate('/agency-app/finance');
  };

  if (loading) {
    return <div className="py-16 text-center" style={{ color: T3, fontSize: 13 }}>{tt('Chargement…', 'Loading…')}</div>;
  }

  return (
    <div className="space-y-4">
      {/* Money strip */}
      <div className="grid grid-cols-2 gap-3">
        <PromoCard>
          <div className="flex items-center gap-2" style={{ color: T3, fontSize: 11, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.06em' }}>
            <ArrowDownLeft className="h-3.5 w-3.5" style={{ color: POS }} />
            {tt('À recevoir des clubs', 'Owed by clubs')}
          </div>
          <p style={{ color: POS, fontSize: 26, fontWeight: 740, letterSpacing: '-0.02em', marginTop: 6 }}>
            {eur(totals.receivableFromClubs)}
          </p>
        </PromoCard>
        <PromoCard>
          <div className="flex items-center gap-2" style={{ color: T3, fontSize: 11, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.06em' }}>
            <ArrowUpRight className="h-3.5 w-3.5" style={{ color: WARN }} />
            {tt('À reverser aux promoteurs', 'Owed to promoters')}
          </div>
          <p style={{ color: WARN, fontSize: 26, fontWeight: 740, letterSpacing: '-0.02em', marginTop: 6 }}>
            {eur(totals.payableToPromoters)}
          </p>
        </PromoCard>
      </div>

      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        <StatTile icon={TrendingUp} value={eur(totals.marginRealized)} label={tt('Marge agence', 'Agency margin')} tone="pos" />
        <StatTile icon={Wallet} value={eur(totals.grossLifetime)} label={tt('Volume total', 'Total volume')} />
        <StatTile icon={Users} value={totals.rosterCount} label={tt('Promoteurs', 'Promoters')} />
        <StatTile icon={Building2} value={totals.activeClubs} label={tt('Clubs actifs', 'Active clubs')} />
      </div>

      {/* Quick actions */}
      <div className="flex gap-2 flex-wrap">
        <PromoButton size="sm" onClick={() => { navigate('/agency-app/promoters'); }}>
          <UserPlus className="h-4 w-4" /> {tt('Inviter un promoteur', 'Invite promoter')}
        </PromoButton>
        <PromoButton
          size="sm"
          variant="secondary"
          onClick={handleBulkSettle}
          disabled={totals.payableToPromoters === 0}
        >
          <Wallet className="h-4 w-4" />
          {tt('Régler les promoteurs', 'Settle promoters')}
        </PromoButton>
        {events.length > 0 && (
          <PromoButton size="sm" variant="secondary" onClick={() => navigate('/agency-app/events')}>
            <Calendar className="h-4 w-4" />
            {events.length} {tt('événement(s) à venir', 'upcoming event(s)')}
          </PromoButton>
        )}
      </div>

      {/* Les 7 prochains jours, tous modes confondus : la semaine en un regard */}
      {weekAhead.length > 0 && (
        <>
          <SectionLabel>{tt('7 prochains jours', 'Next 7 days')}</SectionLabel>
          <PromoCard style={{ padding: 8 }}>
            {weekAhead.map((ev, i) => (
              <button
                key={ev.key}
                onClick={() => navigate(ev.mode === 'yuno' ? '/agency-app/events' : '/affiliate/events')}
                className="flex w-full items-center gap-3 text-left cursor-pointer"
                style={{
                  padding: '9px 8px', background: 'none', border: 'none',
                  borderBottom: i < weekAhead.length - 1 ? '1px solid rgba(255,255,255,0.05)' : undefined,
                }}
              >
                <div className="flex-none text-center" style={{ width: 44 }}>
                  <p style={{ color: T1, fontSize: 13, fontWeight: 700, lineHeight: 1 }}>
                    {format(ev.when, 'd', { locale: dateLocale })}
                  </p>
                  <p style={{ color: T3, fontSize: 9.5, textTransform: 'uppercase' }}>
                    {format(ev.when, 'EEE', { locale: dateLocale })}
                  </p>
                </div>
                <div className="min-w-0 flex-1">
                  <p className="truncate" style={{ color: T1, fontSize: 13.5, fontWeight: 600 }}>{ev.name}</p>
                  <p className="truncate" style={{ color: T3, fontSize: 11 }}>
                    {ev.venue ?? '—'}
                    {ev.mode === 'yuno' && ev.extra != null && ev.extra > 0
                      ? ` · ${ev.extra} ${tt('promoteur(s)', 'promoter(s)')}` : ''}
                  </p>
                </div>
                <PromoPill tone={ev.mode === 'yuno' ? 'red' : 'muted'}>
                  {ev.mode === 'yuno' ? 'Yuno' : tt('Externe', 'External')}
                </PromoPill>
              </button>
            ))}
          </PromoCard>
        </>
      )}

      {/* Bras externe : les clubs hors Yuno, trafic redirigé vers leur billetterie */}
      {ext && (ext.venues > 0 || ext.views > 0 || ext.events > 0) && (
        <>
          <SectionLabel>{tt('Clubs externes · 30 derniers jours', 'External clubs · last 30 days')}</SectionLabel>
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
            <StatTile icon={Eye} value={ext.views.toLocaleString()} label={tt('Vues', 'Views')} tone="pos" />
            <StatTile icon={MousePointerClick} value={ext.clicks.toLocaleString()} label={tt('Clics billetterie', 'Ticket clicks')} />
            <StatTile icon={MapPin} value={ext.venues} label={tt('Clubs partenaires', 'Partner clubs')} />
            <StatTile icon={Calendar} value={ext.events} label={tt('Soirées à venir', 'Upcoming events')} />
          </div>
          <div className="flex gap-2 flex-wrap">
            <PromoButton size="sm" variant="secondary" onClick={() => navigate('/affiliate/analytics')}>
              <BarChart2 className="h-4 w-4" /> {tt('Analytics trafic', 'Traffic analytics')}
            </PromoButton>
            <PromoButton size="sm" variant="secondary" onClick={() => navigate('/affiliate/venues')}>
              <MapPin className="h-4 w-4" /> {tt('Gérer les clubs externes', 'Manage external clubs')}
            </PromoButton>
          </div>
        </>
      )}

      {/* Leaderboard */}
      <SectionLabel>{tt('Classement promoteurs', 'Promoter leaderboard')}</SectionLabel>
      {leaderboard.length === 0 || leaderboard.every(l => l.gross === 0) ? (
        <PromoEmpty
          icon={Trophy}
          title={tt('Pas encore de ventes', 'No sales yet')}
          description={tt("Les performances de vos promoteurs apparaîtront ici.", "Your promoters' performance will show up here.")}
        />
      ) : (
        <PromoCard style={{ padding: 8 }}>
          {leaderboard.map(({ p, gross }, i) => (
            <div
              key={p.id}
              className="flex items-center gap-3"
              style={{ padding: '10px 8px', borderBottom: i < leaderboard.length - 1 ? '1px solid rgba(255,255,255,0.05)' : undefined }}
            >
              <span style={{ color: i === 0 ? RED : T3, fontSize: 13, fontWeight: 700, width: 18, textAlign: 'center' }}>
                {i + 1}
              </span>
              <PromoAvatar src={p.profile_image_url} fallback={promoterName(p).slice(0, 1)} size={34} />
              <div className="min-w-0 flex-1">
                <p className="truncate" style={{ color: T1, fontSize: 13.5, fontWeight: 600 }}>{promoterName(p)}</p>
                <p className="truncate" style={{ color: T3, fontSize: 11 }}>
                  {p.venues?.name || tt('Multi-club', 'Multi-venue')}
                </p>
              </div>
              <span style={{ color: T1, fontSize: 13.5, fontWeight: 680 }}>{eur(gross)}</span>
            </div>
          ))}
        </PromoCard>
      )}
    </div>
  );
}
