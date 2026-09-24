/**
 * Codes promo (plan Shotgun, lot F) — Console Club (`/owner/promo-codes`) et
 * Console Organisateur (`/organizer-app/promo-codes`), même page.
 *
 * Un code se pose sur une soirée ou sur toutes, en % ou en euros, pour les
 * billets et/ou les tables, avec un quota et des dates. La liste montre ce
 * que chaque code a fait vendre (`get_promo_codes`) ; la remise elle-même est
 * décidée par le serveur au paiement (`claim_promo_code`).
 */
import { useCallback, useEffect, useMemo, useState } from 'react';
import { Check, Copy, Link2, Loader2, Plus, Tag, Trash2 } from 'lucide-react';
import { toast } from 'sonner';
import { supabase } from '@/integrations/supabase/client';
import { useLanguage } from '@/contexts/LanguageContext';
import { useVenueContext } from '@/hooks/useVenueContext';
import { OwnerPageSkeleton } from '@/components/DashboardSkeleton';
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Switch } from '@/components/ui/switch';
import { UpdatedAt } from '@/components/analytics/kit';
import { KIT, useNumberFormat } from '@/components/analytics/kitFormat';
import { EmptyNote, ReportCard, Segmented } from '@/components/event-report/ui';
import { INNER_BG } from '@/components/event-report/tokens';
import { PUBLIC_BASE_URL } from '@/lib/native';
import { normalizePromoCode, type PromoPillar } from '@/lib/promoCode';

interface PromoCodeRow {
  id: string;
  code: string;
  label: string | null;
  eventId: string | null;
  eventTitle: string | null;
  eventStartAt: string | null;
  discountType: 'percentage' | 'fixed';
  discountValue: number;
  appliesTo: PromoPillar[];
  maxUses: number | null;
  startsAt: string | null;
  endsAt: string | null;
  isActive: boolean;
  uses: number;
  held: number;
  tickets: number;
  tables: number;
  discountGiven: number;
  revenue: number | null;
}

interface ScopeEvent { id: string; title: string; start_at: string }

const inputStyle: React.CSSProperties = {
  background: INNER_BG, border: `1px solid ${KIT.BORDER}`, borderRadius: 10,
  color: KIT.T1, fontSize: 13, padding: '9px 12px', width: '100%', outline: 'none',
};
const labelStyle: React.CSSProperties = {
  display: 'block', color: KIT.T3, fontSize: 11, fontWeight: 600,
  textTransform: 'uppercase', letterSpacing: '0.07em', marginBottom: 6,
};

export default function PromoCodes() {
  const { t } = useLanguage();
  const { n, eur, locale } = useNumberFormat();
  const { venueId, organizerUserId, scope, loading: scopeLoading } = useVenueContext();
  const isOrg = scope === 'organizer';
  const ready = isOrg ? !!organizerUserId : !!venueId;

  const [rows, setRows] = useState<PromoCodeRow[] | null>(null);
  const [money, setMoney] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [fetchedAt, setFetchedAt] = useState<Date | null>(null);
  const [events, setEvents] = useState<ScopeEvent[]>([]);
  const [open, setOpen] = useState(false);
  const [copied, setCopied] = useState<string | null>(null);

  const load = useCallback(async () => {
    if (!ready) return;
    const { data, error: rpcError } = await supabase.rpc('get_promo_codes' as never, (isOrg
      ? { p_organizer_user_id: organizerUserId }
      : { p_venue_id: venueId }) as never);
    const res = data as { ok: boolean; reason?: string; money?: boolean; codes?: PromoCodeRow[] } | null;
    if (rpcError || !res?.ok) {
      setError(res?.reason === 'forbidden' ? 'forbidden' : 'error');
      setRows([]);
      return;
    }
    setError(null);
    setMoney(!!res.money);
    setRows(res.codes ?? []);
    setFetchedAt(new Date());
  }, [ready, isOrg, organizerUserId, venueId]);

  useEffect(() => { void load(); }, [load]);

  // Soirées de la portée (à venir et récentes) pour viser une soirée précise.
  useEffect(() => {
    if (!ready) return;
    const since = new Date(Date.now() - 24 * 3600e3).toISOString();
    let q = supabase.from('events').select('id, title, start_at').is('cancelled_at', null).gte('start_at', since);
    q = isOrg
      ? q.or(`organizer_user_id.eq.${organizerUserId},partner_organizer_id.eq.${organizerUserId}`)
      : q.or(`venue_id.eq.${venueId},partner_venue_id.eq.${venueId}`);
    q.order('start_at', { ascending: true }).limit(60).then(({ data }) => setEvents((data ?? []) as ScopeEvent[]));
  }, [ready, isOrg, organizerUserId, venueId]);

  const dateFmt = useMemo(() => new Intl.DateTimeFormat(locale, { day: 'numeric', month: 'short', year: '2-digit' }), [locale]);

  const toggle = async (row: PromoCodeRow, next: boolean) => {
    setRows((rs) => rs?.map((r) => (r.id === row.id ? { ...r, isActive: next } : r)) ?? rs);
    const { error: upErr } = await supabase.from('promo_codes' as never).update({ is_active: next } as never).eq('id', row.id);
    if (upErr) {
      toast.error(t('pc.saveError'));
      void load();
    }
  };

  const remove = async (row: PromoCodeRow) => {
    if (!window.confirm(t('pc.deleteConfirm').replace('{code}', row.code))) return;
    const { error: delErr } = await supabase.from('promo_codes' as never).delete().eq('id', row.id);
    if (delErr) toast.error(t('pc.saveError'));
    else { toast.success(t('pc.deleted')); void load(); }
  };

  const copy = async (key: string, text: string) => {
    try {
      await navigator.clipboard.writeText(text);
      setCopied(key);
      setTimeout(() => setCopied(null), 1600);
    } catch {
      toast.error(t('pc.copyError'));
    }
  };

  if (scopeLoading || !ready) return <OwnerPageSkeleton />;

  return (
    <div className="min-h-screen pb-16" style={{ background: 'var(--sf-000000)' }}>
      <div className="relative z-10 mx-auto max-w-[1340px] space-y-5 px-4 py-6 sm:px-6">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="flex items-center gap-3">
            <div className="flex h-9 w-9 flex-none items-center justify-center rounded-xl" style={{ background: 'rgba(232,25,44,0.1)', border: '1px solid rgba(232,25,44,0.2)' }}>
              <Tag className="h-4 w-4" style={{ color: KIT.RED }} />
            </div>
            <div>
              <h1 style={{ color: KIT.T1, fontSize: 'clamp(22px,3vw,28px)', fontWeight: 700, letterSpacing: '-0.025em', lineHeight: 1.1 }}>{t('pc.title')}</h1>
              <p style={{ color: KIT.T3, fontSize: 12.5, marginTop: 3 }}>{t('pc.subtitle')}</p>
            </div>
          </div>
          <button
            type="button"
            onClick={() => setOpen(true)}
            className="inline-flex items-center gap-2 rounded-xl px-4 py-2.5 text-[13px] font-semibold"
            style={{ background: KIT.RED, color: '#fff' }}
          >
            <Plus className="h-4 w-4" /> {t('pc.new')}
          </button>
        </div>

        <ReportCard>
          <div className="mb-3 flex items-center justify-between gap-3">
            <h2 style={{ color: KIT.T1, fontSize: 14.5, fontWeight: 600 }}>{t('pc.listTitle')}</h2>
            <UpdatedAt at={fetchedAt} />
          </div>
          {rows === null ? (
            <div className="flex justify-center py-10"><Loader2 className="h-6 w-6 animate-spin" style={{ color: KIT.T3 }} /></div>
          ) : error ? (
            <EmptyNote text={t(error === 'forbidden' ? 'pc.forbidden' : 'pc.loadError')} />
          ) : rows.length === 0 ? (
            <div className="py-10 text-center">
              <Tag className="mx-auto mb-2 h-8 w-8" style={{ color: 'rgb(var(--ink)/0.12)' }} />
              <p style={{ color: KIT.T2, fontSize: 13.5 }}>{t('pc.empty')}</p>
              <p className="mx-auto mt-1 max-w-[52ch]" style={{ color: KIT.T3, fontSize: 12.5 }}>{t('pc.emptyHint')}</p>
            </div>
          ) : (
            <div className="space-y-2.5">
              {rows.map((r) => {
                const link = r.eventId ? `${PUBLIC_BASE_URL}/event/${r.eventId}?promo=${encodeURIComponent(r.code)}` : null;
                const discountLabel = r.discountType === 'percentage'
                  ? `-${new Intl.NumberFormat(locale, { style: 'percent', maximumFractionDigits: 2 }).format(r.discountValue / 100)}`
                  : `-${eur(r.discountValue)}${r.appliesTo.includes('tickets') ? ` ${t('pc.perTicket')}` : ''}`;
                return (
                  <div key={r.id} className="rounded-xl p-3.5" style={{ background: INNER_BG, border: `1px solid ${KIT.BORDER}`, opacity: r.isActive ? 1 : 0.6 }}>
                    <div className="flex flex-wrap items-start justify-between gap-3">
                      <div className="min-w-0">
                        <div className="flex flex-wrap items-center gap-2">
                          <span className="font-mono text-[15px] font-bold tracking-wide" style={{ color: KIT.T1 }}>{r.code}</span>
                          <span className="rounded-full px-2 py-0.5 text-[11px] font-semibold" style={{ background: 'rgba(52,211,153,0.1)', color: 'var(--acc-34d399)' }}>{discountLabel}</span>
                          <span className="text-[11.5px]" style={{ color: KIT.T3 }}>
                            {r.appliesTo.map((p) => t(`pc.pillar.${p}`)).join(' + ')}
                          </span>
                        </div>
                        <p className="mt-1 text-[12px]" style={{ color: KIT.T3 }}>
                          {r.eventTitle
                            ? `${r.eventTitle}${r.eventStartAt ? ` · ${dateFmt.format(new Date(r.eventStartAt))}` : ''}`
                            : t('pc.allEvents')}
                          {r.endsAt && ` · ${t('pc.until').replace('{date}', dateFmt.format(new Date(r.endsAt)))}`}
                          {r.label && ` · ${r.label}`}
                        </p>
                      </div>
                      <div className="flex items-center gap-2">
                        <button type="button" onClick={() => void copy(`c-${r.id}`, r.code)} title={t('pc.copyCode')} aria-label={t('pc.copyCode')}
                          className="rounded-lg p-2" style={{ color: KIT.T2, border: `1px solid ${KIT.BORDER}` }}>
                          {copied === `c-${r.id}` ? <Check className="h-3.5 w-3.5" style={{ color: 'var(--acc-34d399)' }} /> : <Copy className="h-3.5 w-3.5" />}
                        </button>
                        {link && (
                          <button type="button" onClick={() => void copy(`l-${r.id}`, link)} title={t('pc.copyLink')} aria-label={t('pc.copyLink')}
                            className="rounded-lg p-2" style={{ color: KIT.T2, border: `1px solid ${KIT.BORDER}` }}>
                            {copied === `l-${r.id}` ? <Check className="h-3.5 w-3.5" style={{ color: 'var(--acc-34d399)' }} /> : <Link2 className="h-3.5 w-3.5" />}
                          </button>
                        )}
                        {r.uses === 0 && r.held === 0 && (
                          <button type="button" onClick={() => void remove(r)} title={t('pc.delete')} aria-label={t('pc.delete')}
                            className="rounded-lg p-2" style={{ color: KIT.T3, border: `1px solid ${KIT.BORDER}` }}>
                            <Trash2 className="h-3.5 w-3.5" />
                          </button>
                        )}
                        <Switch checked={r.isActive} onCheckedChange={(v) => void toggle(r, v)} aria-label={t('pc.active')} />
                      </div>
                    </div>
                    <div className="mt-3 grid grid-cols-2 gap-3 sm:grid-cols-4">
                      <Mini label={t('pc.col.uses')} value={r.maxUses ? `${n(r.uses)} / ${n(r.maxUses)}` : n(r.uses)} sub={r.held > 0 ? t('pc.held').replace('{n}', n(r.held)) : undefined} />
                      <Mini label={t('pc.col.sold')} value={[r.tickets > 0 ? t('pc.ticketsN').replace('{n}', n(r.tickets)) : null, r.tables > 0 ? t('pc.tablesN').replace('{n}', n(r.tables)) : null].filter(Boolean).join(' · ') || '—'} />
                      <Mini label={t('pc.col.discount')} value={r.discountGiven > 0 ? eur(r.discountGiven) : '—'} />
                      {money && <Mini label={t('pc.col.revenue')} value={(r.revenue ?? 0) > 0 ? eur(r.revenue ?? 0) : '—'} />}
                    </div>
                  </div>
                );
              })}
            </div>
          )}
          <p className="mt-4" style={{ color: KIT.T3, fontSize: 11.5, lineHeight: 1.5 }}>{t('pc.footnote')}</p>
        </ReportCard>
      </div>

      <PromoCodeDialog
        open={open}
        onClose={() => setOpen(false)}
        onCreated={() => { setOpen(false); void load(); }}
        scope={isOrg ? { organizerUserId } : { venueId }}
        events={events}
      />
    </div>
  );
}

function Mini({ label, value, sub }: { label: string; value: string; sub?: string }) {
  return (
    <div className="min-w-0">
      <p style={{ color: KIT.T3, fontSize: 10.5, textTransform: 'uppercase', letterSpacing: '0.06em' }}>{label}</p>
      <p className="truncate tabular-nums" style={{ color: KIT.T1, fontSize: 14, fontWeight: 600, marginTop: 2 }}>{value}</p>
      {sub && <p style={{ color: KIT.T3, fontSize: 11 }}>{sub}</p>}
    </div>
  );
}

type DiscountKind = 'percentage' | 'fixed';

function PromoCodeDialog({ open, onClose, onCreated, scope, events }: {
  open: boolean;
  onClose: () => void;
  onCreated: () => void;
  scope: { venueId?: string | null; organizerUserId?: string | null };
  events: ScopeEvent[];
}) {
  const { t } = useLanguage();
  const { locale } = useNumberFormat();
  const [code, setCode] = useState('');
  const [kind, setKind] = useState<DiscountKind>('percentage');
  const [value, setValue] = useState('');
  const [tickets, setTickets] = useState(true);
  const [tables, setTables] = useState(false);
  const [eventId, setEventId] = useState('');
  const [maxUses, setMaxUses] = useState('');
  const [endsAt, setEndsAt] = useState('');
  const [label, setLabel] = useState('');
  const [saving, setSaving] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);

  useEffect(() => {
    if (!open) return;
    setCode(''); setKind('percentage'); setValue(''); setTickets(true); setTables(false);
    setEventId(''); setMaxUses(''); setEndsAt(''); setLabel(''); setFormError(null);
  }, [open]);

  const optionFmt = new Intl.DateTimeFormat(locale, { day: 'numeric', month: 'short' });

  const save = async () => {
    const clean = normalizePromoCode(code);
    const num = Number(value.replace(',', '.'));
    if (!clean) { setFormError(t('pc.err.code')); return; }
    if (!Number.isFinite(num) || num <= 0 || (kind === 'percentage' && num > 100)) { setFormError(t('pc.err.value')); return; }
    if (!tickets && !tables) { setFormError(t('pc.err.pillar')); return; }
    const uses = maxUses.trim() ? Number(maxUses) : null;
    if (uses !== null && (!Number.isInteger(uses) || uses <= 0)) { setFormError(t('pc.err.uses')); return; }
    setSaving(true);
    setFormError(null);
    const { error } = await supabase.from('promo_codes' as never).insert({
      venue_id: scope.venueId ?? null,
      organizer_user_id: scope.organizerUserId ?? null,
      event_id: eventId || null,
      code: clean,
      label: label.trim() || null,
      discount_type: kind,
      discount_value: Math.round(num * 100) / 100,
      applies_to: [...(tickets ? ['tickets'] : []), ...(tables ? ['tables'] : [])],
      max_uses: uses,
      ends_at: endsAt ? new Date(endsAt).toISOString() : null,
    } as never);
    setSaving(false);
    if (error) {
      setFormError(error.code === '23505' ? t('pc.err.duplicate') : t('pc.saveError'));
      return;
    }
    toast.success(t('pc.created').replace('{code}', clean));
    onCreated();
  };

  return (
    <Dialog open={open} onOpenChange={(o) => { if (!o) onClose(); }}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle>{t('pc.new')}</DialogTitle>
          <DialogDescription>{t('pc.dialogHint')}</DialogDescription>
        </DialogHeader>
        <div className="space-y-4">
          <div>
            <label style={labelStyle} htmlFor="pc-code">{t('pc.f.code')}</label>
            <input id="pc-code" value={code} onChange={(e) => setCode(e.target.value.toUpperCase())} placeholder="EARLY20" maxLength={32}
              autoCapitalize="characters" spellCheck={false} style={{ ...inputStyle, fontFamily: 'ui-monospace, monospace', letterSpacing: '0.06em' }} />
          </div>
          <div className="grid grid-cols-[auto,1fr] items-end gap-3">
            <div>
              <span style={labelStyle}>{t('pc.f.discount')}</span>
              <Segmented<DiscountKind> label={t('pc.f.discount')} value={kind} onChange={setKind}
                options={[{ value: 'percentage', label: '%' }, { value: 'fixed', label: '€' }]} />
            </div>
            <input value={value} onChange={(e) => setValue(e.target.value)} inputMode="decimal"
              placeholder={kind === 'percentage' ? '20' : '5'} aria-label={t('pc.f.value')} style={inputStyle} />
          </div>
          <p style={{ color: KIT.T3, fontSize: 11.5, marginTop: -6 }}>{t(kind === 'percentage' ? 'pc.f.percentHint' : 'pc.f.fixedHint')}</p>
          <div>
            <span style={labelStyle}>{t('pc.f.appliesTo')}</span>
            <div className="flex flex-wrap gap-4 text-[13px]" style={{ color: KIT.T1 }}>
              <label className="inline-flex items-center gap-2"><input type="checkbox" checked={tickets} onChange={(e) => setTickets(e.target.checked)} /> {t('pc.pillar.tickets')}</label>
              <label className="inline-flex items-center gap-2"><input type="checkbox" checked={tables} onChange={(e) => setTables(e.target.checked)} /> {t('pc.pillar.tables')}</label>
            </div>
          </div>
          <div>
            <label style={labelStyle} htmlFor="pc-event">{t('pc.f.event')}</label>
            <select id="pc-event" value={eventId} onChange={(e) => setEventId(e.target.value)} style={inputStyle}>
              <option value="">{t('pc.allEvents')}</option>
              {events.map((e) => <option key={e.id} value={e.id}>{e.title} · {optionFmt.format(new Date(e.start_at))}</option>)}
            </select>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label style={labelStyle} htmlFor="pc-uses">{t('pc.f.maxUses')}</label>
              <input id="pc-uses" value={maxUses} onChange={(e) => setMaxUses(e.target.value.replace(/[^0-9]/g, ''))} inputMode="numeric" placeholder={t('pc.f.unlimited')} style={inputStyle} />
            </div>
            <div>
              <label style={labelStyle} htmlFor="pc-ends">{t('pc.f.endsAt')}</label>
              <input id="pc-ends" type="datetime-local" value={endsAt} onChange={(e) => setEndsAt(e.target.value)} style={inputStyle} />
            </div>
          </div>
          <div>
            <label style={labelStyle} htmlFor="pc-label">{t('pc.f.label')}</label>
            <input id="pc-label" value={label} onChange={(e) => setLabel(e.target.value)} maxLength={80} placeholder={t('pc.f.labelPlaceholder')} style={inputStyle} />
          </div>
          {formError && <p role="alert" style={{ color: 'var(--acc-ff5c63)', fontSize: 12.5 }}>{formError}</p>}
          <div className="flex justify-end gap-2 pt-1">
            <button type="button" onClick={onClose} className="rounded-xl px-4 py-2.5 text-[13px] font-medium" style={{ color: KIT.T2, border: `1px solid ${KIT.BORDER}` }}>
              {t('pc.cancel')}
            </button>
            <button type="button" onClick={() => void save()} disabled={saving}
              className="inline-flex items-center gap-2 rounded-xl px-4 py-2.5 text-[13px] font-semibold disabled:opacity-50" style={{ background: KIT.RED, color: '#fff' }}>
              {saving && <Loader2 className="h-4 w-4 animate-spin" />} {t('pc.create')}
            </button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
