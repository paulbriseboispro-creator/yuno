import { useEffect, useState } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { useLanguage } from '@/contexts/LanguageContext';
import { translate } from '@/i18n/orgTranslate';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Ticket, Sparkles, Plus, Loader2, ArrowRight } from 'lucide-react';
import { toast } from 'sonner';
import { OrgButton, OrgPill, RED, T1, T3, BORDER, INNER_BG } from '@/components/org-ui';

interface PresetRound {
  name: string;
  price: number;
  maxTickets?: number | null;
  lastTicketsThreshold?: number | null;
  includesDrink?: boolean;
  entryDeadline?: string | null;
}

interface ClubPreset {
  id: string;
  name: string;
  rounds: PresetRound[];
  ticket_type: string | null;
  selling_mode: string | null;
  includes_drink: boolean | null;
  drink_deadline_type: string | null;
  drink_deadline_hours: number | null;
  drink_cutoff_time: string | null;
}

interface Props {
  eventId: string;
  open: boolean;
  onOpenChange: (v: boolean) => void;
  /** Go to the full ticketing page (create from scratch). */
  onCreate: () => void;
  /** Called after a club template is applied + ticketing enabled. */
  onActivated?: () => void;
}

/**
 * Co-event ticketing activation. Two paths: create your own ticketing (redirect
 * to the unified ticketing page), or quick-add one of the partner club's saved
 * templates (preview the rounds, apply in one click → ticketing goes live).
 */
export function OrgBilletterieDialog({ eventId, open, onOpenChange, onCreate, onActivated }: Props) {
  const { language } = useLanguage();
  const tt = (fr: string, en: string, es?: string) => translate(language, fr, en, es);
  const [presets, setPresets] = useState<ClubPreset[]>([]);
  const [loading, setLoading] = useState(true);
  const [applyingId, setApplyingId] = useState<string | null>(null);

  useEffect(() => {
    if (!open) return;
    setLoading(true);
    (async () => {
      const { data, error } = await supabase.rpc('get_partner_venue_ticket_presets', { p_event_id: eventId });
      if (error) { setPresets([]); } else { setPresets(((data as any[]) ?? []) as ClubPreset[]); }
      setLoading(false);
    })();
  }, [open, eventId]);

  const priceRange = (rounds: PresetRound[]) => {
    const prices = rounds.map((r) => Number(r.price)).filter((n) => !Number.isNaN(n));
    if (prices.length === 0) return '—';
    const min = Math.min(...prices), max = Math.max(...prices);
    return min === max ? `${min}€` : `${min}–${max}€`;
  };

  const applyPreset = async (preset: ClubPreset) => {
    setApplyingId(preset.id);
    try {
      const mode = preset.selling_mode ?? 'rounds';
      const type = preset.ticket_type ?? 'standard';
      // Replace existing rounds of the same ticket type, then insert the template's.
      const { data: existing } = await supabase
        .from('ticket_rounds').select('id, ticket_type').eq('event_id', eventId);
      const sameType = (existing ?? []).filter((r: any) => (r.ticket_type ?? 'standard') === type).map((r: any) => r.id);
      if (sameType.length > 0) await supabase.from('ticket_rounds').delete().in('id', sameType);

      const rows = (preset.rounds ?? []).map((r, i) => ({
        event_id: eventId,
        name: r.name,
        price: Number(r.price) || 0,
        max_tickets: r.maxTickets ?? 999999,
        last_tickets_threshold: r.lastTicketsThreshold ?? 20,
        position: i,
        is_active: mode === 'simple' ? true : i === 0,
        auto_activate: mode !== 'timed_entry' && mode !== 'simple',
        ticket_type: type,
        includes_drink: r.includesDrink || preset.includes_drink || false,
        drink_deadline_type: (r.includesDrink || preset.includes_drink) ? (preset.drink_deadline_type ?? 'none') : 'none',
        drink_deadline_hours: (r.includesDrink || preset.includes_drink) && preset.drink_deadline_type === 'hours_after_start' ? preset.drink_deadline_hours : null,
        drink_cutoff_time: (r.includesDrink || preset.includes_drink) && preset.drink_deadline_type === 'fixed_time' ? preset.drink_cutoff_time : null,
        entry_deadline: r.entryDeadline ? `${r.entryDeadline}:00` : null,
      }));
      const { error: insErr } = await supabase.from('ticket_rounds').insert(rows);
      if (insErr) throw insErr;

      const update: Record<string, unknown> = { ticketing_enabled: true };
      if (mode === 'timed_entry') update.ticket_selling_mode = 'timed_entry';
      const { error: evErr } = await supabase.from('events').update(update).eq('id', eventId);
      if (evErr) throw evErr;

      toast.success(tt('Billetterie en ligne', 'Ticketing is live'));
      onActivated?.();
      onOpenChange(false);
    } catch (e: any) {
      toast.error(e.message);
    } finally {
      setApplyingId(null);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent style={{ background: '#0a0a0c', border: `1px solid ${BORDER}`, borderRadius: 18, maxWidth: 560 }}>
        <DialogHeader>
          <DialogTitle style={{ color: T1, fontSize: 16, fontWeight: 600 }}>
            {tt('Activer la billetterie', 'Activate ticketing')}
          </DialogTitle>
        </DialogHeader>

        <div className="space-y-4">
          {/* Path 1 — create from scratch */}
          <button
            onClick={onCreate}
            className="flex w-full items-center justify-between rounded-xl p-4 text-left transition-colors"
            style={{ border: `1px solid ${BORDER}`, background: INNER_BG }}
          >
            <div className="flex items-start gap-3">
              <Ticket className="mt-0.5 h-5 w-5 shrink-0" style={{ color: RED }} />
              <div>
                <div style={{ color: T1, fontSize: 13.5, fontWeight: 560 }}>{tt('Créer ma billetterie', 'Create my ticketing')}</div>
                <div style={{ color: T3, fontSize: 11.5 }}>
                  {tt('Tarifs, paliers, présale, liste privée — vous configurez tout.', 'Tiers, rounds, presale, private list — you set it all up.', 'Tarifas, fases, preventa, lista privada — lo configuras todo.')}
                </div>
              </div>
            </div>
            <ArrowRight className="h-4 w-4 shrink-0" style={{ color: T3 }} />
          </button>

          {/* Path 2 — quick-add a club template */}
          <div>
            <div className="mb-2 flex items-center gap-2">
              <Sparkles className="h-4 w-4" style={{ color: RED }} />
              <span style={{ color: T1, fontSize: 13, fontWeight: 560 }}>{tt('Templates du club', 'Club templates')}</span>
            </div>

            {loading ? (
              <div className="flex justify-center py-6"><Loader2 className="h-5 w-5 animate-spin" style={{ color: T3 }} /></div>
            ) : presets.length === 0 ? (
              <p className="rounded-xl p-3" style={{ color: T3, fontSize: 11.5, border: `1px solid ${BORDER}`, background: INNER_BG }}>
                {tt('Le club partenaire n’a pas de template de billetterie.', 'The partner club has no ticketing template.', 'El club no tiene plantilla de venta de entradas.')}
              </p>
            ) : (
              <div className="space-y-2">
                {presets.map((p) => (
                  <div key={p.id} className="rounded-xl p-3" style={{ border: `1px solid ${BORDER}`, background: INNER_BG }}>
                    <div className="flex items-center justify-between gap-3">
                      <div className="min-w-0">
                        <div className="flex items-center gap-2">
                          <span className="truncate" style={{ color: T1, fontSize: 13, fontWeight: 560 }}>{p.name}</span>
                          <OrgPill tone="muted">{p.ticket_type === 'vip' ? 'VIP' : tt('Standard', 'Standard')}</OrgPill>
                        </div>
                        <div className="mt-0.5" style={{ color: T3, fontSize: 11 }}>
                          {(p.rounds?.length ?? 0)} {tt('paliers', 'rounds')} · {priceRange(p.rounds ?? [])}
                        </div>
                        {/* Preview the rounds */}
                        <div className="mt-1.5 flex flex-wrap gap-1">
                          {(p.rounds ?? []).slice(0, 4).map((r, i) => (
                            <span key={i} className="rounded px-1.5 py-0.5" style={{ background: 'rgba(255,255,255,0.05)', color: T3, fontSize: 10.5 }}>
                              {r.name} · {Number(r.price)}€
                            </span>
                          ))}
                          {(p.rounds?.length ?? 0) > 4 && <span style={{ color: T3, fontSize: 10.5 }}>+{(p.rounds?.length ?? 0) - 4}</span>}
                        </div>
                      </div>
                      <OrgButton size="sm" variant="primary" disabled={applyingId === p.id} onClick={() => applyPreset(p)}>
                        {applyingId === p.id ? <Loader2 className="h-4 w-4 animate-spin" /> : <Plus className="h-4 w-4" />}
                        {tt('Ajout rapide', 'Quick add')}
                      </OrgButton>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
