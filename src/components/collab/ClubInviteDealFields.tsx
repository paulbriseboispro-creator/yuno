import { useEffect, useMemo, useState } from 'react';
import { CalendarClock, Euro } from 'lucide-react';
import { supabase } from '@/integrations/supabase/client';
import { useLanguage } from '@/contexts/LanguageContext';
import { translate } from '@/i18n/orgTranslate';
import {
  DEFAULT_TIERS, RemunerationModeSwitch, TieredRemunerationEditor, type RemunerationMode,
} from '@/components/collab/TieredRemunerationEditor';
import { SettlementModeSwitch } from '@/components/collab/SettlementModeSwitch';
import { tieredPillarBlocks, validateTiers, withSettlement } from '@/lib/splitRules';
import type { CollabRemuneration, CollabSettlement, PartnershipSplitRules } from '@/hooks/useOrganizerPartnerships';
import { DarkInput, FieldLabel, T1, T3 } from '@/components/org-ui';

export interface ClubInviteDeal {
  eventId: string | null;
  rules: PartnershipSplitRules | null;
  lang: 'fr' | 'en' | 'es';
  invalid: boolean;
}

/**
 * Le DEAL d'une invitation club → organisateur externe (miroir de
 * InviteClubTab côté organisateur) : la soirée du club, les conditions (par
 * pilier ou barème) et « Répartir via Stripe ? » Oui / Non. L'organisateur lit
 * tout dans l'email et sur la page d'atterrissage ; le contrat s'ouvre
 * pré-signé par le club dès qu'il accepte.
 */
export function ClubInviteDealFields({ venueId, onChange }: { venueId: string; onChange: (d: ClubInviteDeal) => void }) {
  const { language } = useLanguage();
  const t = (fr: string, en: string, es: string) => translate(language, fr, en, es);
  const [events, setEvents] = useState<{ id: string; title: string; start_at: string }[]>([]);
  const [eventId, setEventId] = useState('');
  const [mailLang, setMailLang] = useState<'fr' | 'en' | 'es'>(language === 'en' ? 'en' : language === 'es' ? 'es' : 'fr');
  const [remMode, setRemMode] = useState<RemunerationMode>('per_pillar');
  const [ticketsOrg, setTicketsOrg] = useState(100);
  const [tablesOrg, setTablesOrg] = useState(0);
  const [tiered, setTiered] = useState<CollabRemuneration>({ mode: 'tiered_total', tiers: DEFAULT_TIERS, tiers_mode: 'flat' });
  // Un organisateur qui découvre Yuno n'a souvent pas Stripe : « Non » laisse
  // l'une des deux parties encaisser seule et payer l'autre après la soirée.
  const [settlement, setSettlement] = useState<CollabSettlement>({ mode: 'stripe' });

  useEffect(() => {
    if (!venueId) return;
    let active = true;
    // Les soirées du club encore SANS organisateur : l'invité y entre comme partenaire.
    supabase.from('events').select('id, title, start_at')
      .eq('venue_id', venueId).is('organizer_user_id', null).is('partner_organizer_id', null).is('cancelled_at', null)
      .gte('end_at', new Date().toISOString()).order('start_at', { ascending: true }).limit(50)
      .then(({ data }) => { if (active) setEvents((data ?? []) as { id: string; title: string; start_at: string }[]); });
    return () => { active = false; };
  }, [venueId]);

  const split = useMemo<PartnershipSplitRules>(() => remMode === 'tiered_total'
    ? { ...tieredPillarBlocks(null), remuneration: { ...tiered, tiers: [...tiered.tiers].sort((a, b) => a.from - b.from) } }
    : {
      tickets: { organizer_pct: ticketsOrg, venue_pct: 100 - ticketsOrg },
      tables: { organizer_pct: tablesOrg, venue_pct: 100 - tablesOrg },
      drinks: { organizer_pct: 0, venue_pct: 100 },
    }, [remMode, tiered, ticketsOrg, tablesOrg]);
  const invalid = remMode === 'tiered_total' && validateTiers(tiered.tiers) !== null;

  useEffect(() => {
    onChange({
      eventId: eventId || null,
      rules: eventId ? withSettlement(split, settlement) : null,
      lang: mailLang,
      invalid: !!eventId && invalid,
    });
  }, [eventId, split, settlement, mailLang, invalid, onChange]);

  const fmtWhen = (iso: string) => new Date(iso).toLocaleDateString(language === 'en' ? 'en-GB' : language === 'es' ? 'es-ES' : 'fr-FR', { day: 'numeric', month: 'short', year: 'numeric' });

  return (
    <div className="space-y-3">
      <div>
        <FieldLabel>{t("Langue de l'invitation", 'Invitation language', 'Idioma de la invitación')}</FieldLabel>
        <div className="flex gap-2">
          {(['fr', 'en', 'es'] as const).map((l) => (
            <button key={l} type="button" onClick={() => setMailLang(l)}
              className="rounded-lg px-3 py-1.5 text-xs font-medium"
              style={{ background: mailLang === l ? 'rgba(232,25,44,0.14)' : 'rgb(var(--ink)/0.03)', border: `1px solid ${mailLang === l ? 'rgba(232,25,44,0.35)' : 'rgb(var(--ink)/0.085)'}`, color: mailLang === l ? '#E8192C' : T3 }}>
              {l === 'fr' ? 'Français' : l === 'en' ? 'English' : 'Español'}
            </button>
          ))}
        </div>
      </div>
      <div>
        <FieldLabel>{t('Soirée proposée', 'Proposed night', 'Noche propuesta')}</FieldLabel>
        <select value={eventId} onChange={(e) => setEventId(e.target.value)}
          className="h-10 w-full rounded-xl px-3 text-sm outline-none"
          style={{ background: 'rgb(var(--ink)/0.04)', border: '1px solid rgb(var(--ink)/0.085)', color: eventId ? T1 : T3 }}>
          <option value="">{t("Aucune pour l'instant (partenariat seul)", 'None yet (partnership only)', 'Ninguna por ahora (solo la colaboración)')}</option>
          {events.map((ev) => <option key={ev.id} value={ev.id}>{ev.title} · {fmtWhen(ev.start_at)}</option>)}
        </select>
        <p className="mt-1 flex items-center gap-1.5" style={{ color: T3, fontSize: 11.5 }}>
          <CalendarClock className="h-3.5 w-3.5" />
          {t("Avec une soirée, l'organisateur reçoit le contrat pré-signé par ton club et n'a plus qu'à signer.",
            'With a night attached, the organizer receives the contract pre-signed by your club and only has to sign.',
            'Con una noche, el organizador recibe el contrato prefirmado por tu club y solo tiene que firmar.')}
        </p>
      </div>
      {eventId && (
        <div className="space-y-3 rounded-xl p-4" style={{ background: 'rgb(var(--ink)/0.025)', border: '1px solid rgb(var(--ink)/0.085)' }}>
          <div className="flex items-center gap-2">
            <Euro className="h-4 w-4" style={{ color: '#E8192C' }} />
            <span style={{ color: T1, fontSize: 13.5, fontWeight: 600 }}>{t('Conditions financières proposées', 'Proposed financial terms', 'Condiciones financieras propuestas')}</span>
          </div>
          <RemunerationModeSwitch value={remMode} onChange={setRemMode} />
          {remMode === 'tiered_total' ? (
            <TieredRemunerationEditor value={tiered} onChange={setTiered} />
          ) : (
            <div className="grid grid-cols-2 gap-3">
              <div>
                <FieldLabel>{t('Billets — part organisateur (%)', 'Tickets — organizer share (%)', 'Entradas — parte organizador (%)')}</FieldLabel>
                <DarkInput type="number" value={String(ticketsOrg)} onChange={(v) => setTicketsOrg(Math.max(0, Math.min(100, Number(v) || 0)))} />
              </div>
              <div>
                <FieldLabel>{t('Tables VIP — part organisateur (%)', 'VIP tables — organizer share (%)', 'Mesas VIP — parte organizador (%)')}</FieldLabel>
                <DarkInput type="number" value={String(tablesOrg)} onChange={(v) => setTablesOrg(Math.max(0, Math.min(100, Number(v) || 0)))} />
              </div>
              <p className="col-span-2" style={{ color: T3, fontSize: 11.5 }}>
                {t('Boissons : 100 % club (licence alcool). Le club garde le reste de chaque pilier.', 'Drinks: 100% club (alcohol licence). The club keeps the rest of each pillar.', 'Bebidas: 100 % club (licencia de alcohol). El club se queda con el resto de cada pilar.')}
              </p>
            </div>
          )}
          <SettlementModeSwitch value={settlement} onChange={setSettlement} rules={split as unknown as Record<string, unknown>} />
        </div>
      )}
    </div>
  );
}
