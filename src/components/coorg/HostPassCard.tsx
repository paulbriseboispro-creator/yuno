import { useCallback, useEffect, useMemo, useState } from 'react';
import { toast } from 'sonner';
import { Building2, Copy, ExternalLink, Loader2, Mail, MessageCircle, Plus, Power, UserPlus } from 'lucide-react';
import { Switch } from '@/components/ui/switch';
import { OrgCard, OrgButton, OrgPill, OrgSectionLabel, OrgTabs, DarkInput, RED, T1, T2, T3, BORDER, INNER_BG } from '@/components/org-ui';
import { supabase } from '@/integrations/supabase/client';
import { inviteEventCohost, coorgErrorCode } from '@/lib/coorg';
import { capturePosthog } from '@/lib/posthog';
import {
  createHostPass, hostPassErrorCode, hostPassErrorText, hostPassLanguageForEvent, hostPassLocale, hostPassShareText,
  hostPassUiWords, hostPassUrl, hostPassWhatsappUrl, listHostPasses, sendHostPassEmail, toHostPassLanguage,
  updateHostPass, type HostPassLanguage, type HostPassRow,
} from '@/lib/hostPass';
import { useCoorgErrorText, useCoorgT } from './coorgUi';

/**
 * « Club hôte » (nom à nommer) sur la page Co-organisation : le club qui
 * accueille la soirée suit une page privée /h/<jeton>, sans compte. Ici
 * l'organisateur crée l'accès, l'envoie (email ou WhatsApp), voit s'il est
 * ouvert, coupe le CA ou l'accès, et ajoute le club en Partenaire quand il a
 * ouvert son compte. Réservé aux parties principales niveau ≥ 2 (la RPC refuse
 * sinon, la carte se tait).
 */
export function HostPassCard({ eventId, eventTitle }: { eventId: string; eventTitle: string }) {
  const { language } = useCoorgT();
  const coorgErr = useCoorgErrorText();
  const w = useMemo(() => hostPassUiWords(language), [language]);
  const [rows, setRows] = useState<HostPassRow[] | null>(null);
  const [canMoney, setCanMoney] = useState(false);
  const [forbidden, setForbidden] = useState(false);
  const [busy, setBusy] = useState<string | null>(null);
  const [open, setOpen] = useState(false);
  const [ev, setEv] = useState<{ location_name: string | null; location_city: string | null; timezone: string | null; venue_id: string | null; partner_venue_id: string | null } | null>(null);
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [phone, setPhone] = useState('');
  const [lang, setLang] = useState<HostPassLanguage>('en');
  const [money, setMoney] = useState(true);

  const load = useCallback(async () => {
    try {
      const r = await listHostPasses(eventId);
      setRows(r.passes);
      setCanMoney(r.canShowRevenue);
      setForbidden(false);
    } catch {
      setForbidden(true);
      setRows([]);
    }
  }, [eventId]);

  useEffect(() => { void load(); }, [load]);
  useEffect(() => {
    supabase.from('events').select('location_name, location_city, timezone, venue_id, partner_venue_id').eq('id', eventId).maybeSingle()
      .then(({ data }) => {
        const e = data as typeof ev;
        setEv(e);
        if (e) {
          setName((n) => n || e.location_name || '');
          setLang(hostPassLanguageForEvent(e.timezone, e.location_city));
        }
      });
  }, [eventId]);

  if (forbidden || rows === null) return null;
  // Un club Yuno est déjà le lieu : il a sa Console, pas besoin d'une page.
  if (ev && (ev.venue_id || ev.partner_venue_id) && rows.length === 0) return null;

  const run = async (key: string, fn: () => Promise<unknown>, ok?: string) => {
    setBusy(key);
    try {
      await fn();
      if (ok) toast.success(ok);
      await load();
    } catch (err) {
      toast.error(hostPassErrorText(hostPassErrorCode(err), w));
    } finally {
      setBusy(null);
    }
  };

  const emailOk = !email.trim() || /^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email.trim());
  const phoneOk = !phone.trim() || phone.replace(/\D/g, '').length >= 6;
  const canCreate = name.trim().length > 0 && (email.trim() || phone.trim()) && emailOk && phoneOk;

  const create = () => run('create', async () => {
    const pass = await createHostPass({
      eventId, venueName: name.trim(), email: email.trim() || null, phone: phone.trim() || null,
      language: lang, showRevenue: canMoney && money,
    });
    capturePosthog('host_pass_created', { event_id: eventId, source: 'coorg_page', show_revenue: pass.show_revenue, channel: email.trim() ? 'email' : 'whatsapp' });
    if (email.trim()) {
      try {
        await sendHostPassEmail(pass.id);
        toast.success(w('hostPass.org.sent'));
      } catch (err) {
        toast.error(hostPassErrorText(hostPassErrorCode(err), w));
      }
    } else {
      toast.success(w('hostPass.org.created'));
      const url = hostPassWhatsappUrl(phone, hostPassShareText(lang, { club: name.trim(), event: eventTitle, page: hostPassUrl(pass.token) }));
      if (url) window.open(url, '_blank', 'noopener');
    }
    setOpen(false); setEmail(''); setPhone('');
  });

  const share = (r: HostPassRow) => {
    const text = hostPassShareText(toHostPassLanguage(r.language), { club: r.venue_name, event: eventTitle, page: hostPassUrl(r.token) });
    const url = hostPassWhatsappUrl(r.contact_phone, text) ?? `https://wa.me/?text=${encodeURIComponent(text)}`;
    window.open(url, '_blank', 'noopener');
    capturePosthog('host_pass_shared', { event_id: eventId, channel: 'whatsapp' });
  };

  const copy = async (r: HostPassRow) => {
    try {
      await navigator.clipboard.writeText(hostPassUrl(r.token));
      toast.success(w('hostPass.org.copied'));
    } catch { /* le lien s'ouvre par « Ouvrir la page » */ }
  };

  const when = (iso: string) => new Intl.DateTimeFormat(hostPassLocale(toHostPassLanguage(language, 'fr')), {
    day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit',
  }).format(new Date(iso));

  return (
    <OrgCard className="p-5">
      <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
        <div>
          <OrgSectionLabel>{w('hostPass.org.cardTitle')}</OrgSectionLabel>
          <p style={{ color: T3, fontSize: 12, marginTop: 2 }}>{w('hostPass.org.cardSub')}</p>
        </div>
        {!open && rows.filter((r) => !r.revoked).length < 3 && (
          <OrgButton size="sm" variant={rows.length ? 'secondary' : 'primary'} onClick={() => setOpen(true)}>
            <Plus className="h-4 w-4" /> {w('hostPass.org.add')}
          </OrgButton>
        )}
      </div>

      {open && (
        <div className="mb-3 space-y-2 rounded-xl p-3" style={{ background: INNER_BG, border: `1px solid ${BORDER}` }}>
          <DarkInput value={name} onChange={setName} placeholder={w('hostPass.org.clubName')} />
          <DarkInput type="email" value={email} onChange={setEmail} placeholder={w('hostPass.org.email')} />
          <DarkInput type="tel" value={phone} onChange={setPhone} placeholder={w('hostPass.org.phone')} />
          <div className="flex flex-wrap items-center gap-x-4 gap-y-2">
            <div className="flex items-center gap-2">
              <span style={{ color: T3, fontSize: 11.5 }}>{w('hostPass.org.language')}</span>
              <OrgTabs size="sm" value={lang} onChange={(v) => setLang(v as HostPassLanguage)}
                tabs={[{ value: 'es', label: 'ES' }, { value: 'fr', label: 'FR' }, { value: 'en', label: 'EN' }]} />
            </div>
            <label className="flex items-center gap-2" style={{ color: canMoney ? T2 : T3, fontSize: 12 }}>
              <Switch checked={canMoney && money} disabled={!canMoney} onCheckedChange={setMoney} />
              {w('hostPass.org.showRevenue')}
            </label>
          </div>
          <p style={{ color: T3, fontSize: 11, lineHeight: 1.45 }}>
            {canMoney ? w('hostPass.org.showRevenueHint') : w('hostPass.org.revenueLocked')} {w('hostPass.org.roleHint')}
          </p>
          <div className="flex gap-2">
            <OrgButton size="sm" variant="primary" disabled={!canCreate || busy === 'create'} onClick={() => void create()}>
              {busy === 'create' ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : email.trim() ? <Mail className="h-3.5 w-3.5" /> : <MessageCircle className="h-3.5 w-3.5" />}
              {email.trim() ? w('hostPass.org.sendEmail') : w('hostPass.org.create')}
            </OrgButton>
            <OrgButton size="sm" variant="ghost" onClick={() => setOpen(false)}>{w('hostPass.org.cancel')}</OrgButton>
          </div>
          {!email.trim() && !phone.trim() && <p style={{ color: T3, fontSize: 11 }}>{w('hostPass.org.contactRequired')}</p>}
        </div>
      )}

      <div className="space-y-2">
        {rows.map((r) => (
          <div key={r.id} className="space-y-2 rounded-xl px-3 py-2.5" style={{ background: INNER_BG, border: `1px solid ${r.revoked ? BORDER : 'rgba(232,25,44,0.25)'}`, opacity: r.revoked ? 0.7 : 1 }}>
            <div className="flex flex-wrap items-center gap-2.5">
              <span className="flex h-[30px] w-[30px] flex-none items-center justify-center rounded-full" style={{ background: 'rgba(232,25,44,0.12)', color: RED }}>
                <Building2 className="h-4 w-4" />
              </span>
              <div className="min-w-0 flex-1">
                <p className="truncate" style={{ color: T1, fontSize: 13.5, fontWeight: 600 }}>{r.venue_name}</p>
                <p className="truncate" style={{ color: T3, fontSize: 11.5 }}>
                  {[r.contact_email, r.contact_phone].filter(Boolean).join(' · ')}
                  {' · '}
                  {r.revoked ? w('hostPass.org.revoked')
                    : r.opened_count === 0 ? w('hostPass.org.neverOpened')
                      : r.opened_count === 1 ? w('hostPass.org.openedOnce', { when: when(r.last_opened_at ?? r.created_at) })
                        : w('hostPass.org.opened', { n: r.opened_count, when: when(r.last_opened_at ?? r.created_at) })}
                </p>
              </div>
              {r.email_sent_count > 0 && <OrgPill tone="default">{w('hostPass.org.emailSent')}</OrgPill>}
            </div>
            {r.link_code && (
              <p style={{ color: T3, fontSize: 11.5 }}>{w('hostPass.org.linkStats', { clicks: r.link_clicks, sales: r.link_sales })}</p>
            )}
            {r.claimed_venue_id && (
              <div className="flex flex-wrap items-center gap-2 rounded-lg px-2.5 py-2" style={{ border: `1px solid ${BORDER}` }}>
                <p className="min-w-0 flex-1" style={{ color: T2, fontSize: 12, lineHeight: 1.45 }}>
                  {r.claimed_is_party
                    ? w('hostPass.org.claimedAccepted', { club: r.claimed_venue_name ?? r.venue_name })
                    : r.claimed_invited
                      ? w('hostPass.org.claimInvited')
                      : w('hostPass.org.claimedPending', { club: r.claimed_venue_name ?? r.venue_name })}
                </p>
                {!r.claimed_is_party && !r.claimed_invited && r.claim_status === 'pending' && (
                  <OrgButton size="sm" variant="primary" disabled={!!busy}
                    onClick={() => {
                      setBusy(`claim:${r.id}`);
                      inviteEventCohost({ eventId, venueId: r.claimed_venue_id, access: 'viewer', shareCrm: false })
                        .then(() => { toast.success(w('hostPass.org.claimInvited')); return load(); })
                        .catch((err) => toast.error(coorgErr(coorgErrorCode(err))))
                        .finally(() => setBusy(null));
                    }}>
                    <UserPlus className="h-3.5 w-3.5" /> {w('hostPass.org.claimInvite')}
                  </OrgButton>
                )}
              </div>
            )}
            {!r.revoked && (
              <div className="flex flex-wrap items-center gap-1.5">
                {r.contact_email && (
                  <OrgButton size="sm" variant="secondary" disabled={!!busy}
                    onClick={() => run(`mail:${r.id}`, () => sendHostPassEmail(r.id), w('hostPass.org.sent'))}>
                    {busy === `mail:${r.id}` ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Mail className="h-3.5 w-3.5" />}
                    {r.email_sent_count > 0 ? w('hostPass.org.resend') : w('hostPass.org.sendEmail')}
                  </OrgButton>
                )}
                <OrgButton size="sm" variant="secondary" onClick={() => share(r)}>
                  <MessageCircle className="h-3.5 w-3.5" /> {w('hostPass.org.whatsapp')}
                </OrgButton>
                <OrgButton size="sm" variant="ghost" onClick={() => void copy(r)}>
                  <Copy className="h-3.5 w-3.5" /> {w('hostPass.org.copy')}
                </OrgButton>
                <a href={hostPassUrl(r.token)} target="_blank" rel="noopener noreferrer"
                  className="inline-flex items-center gap-1.5 px-2 py-1" style={{ color: T2, fontSize: 12, fontWeight: 560 }}>
                  <ExternalLink className="h-3.5 w-3.5" /> {w('hostPass.org.preview')}
                </a>
              </div>
            )}
            <div className="flex flex-wrap items-center justify-between gap-2">
              <label className="flex items-center gap-2" style={{ color: canMoney ? T2 : T3, fontSize: 12 }}>
                <Switch checked={r.show_revenue} disabled={r.revoked || !!busy || (!canMoney && !r.show_revenue)}
                  onCheckedChange={(v) => run(`rev:${r.id}`, () => updateHostPass(r.id, { showRevenue: v }))} />
                {w('hostPass.org.showRevenue')}
              </label>
              <OrgButton size="sm" variant="ghost" disabled={!!busy}
                onClick={() => run(`rv:${r.id}`, () => updateHostPass(r.id, { revoked: !r.revoked }))}>
                <Power className="h-3.5 w-3.5" /> {r.revoked ? w('hostPass.org.reopen') : w('hostPass.org.revoke')}
              </OrgButton>
            </div>
          </div>
        ))}
        {rows.length === 0 && !open && (
          <p style={{ color: T3, fontSize: 12, lineHeight: 1.5 }}>{w('hostPass.org.roleHint')}</p>
        )}
      </div>
    </OrgCard>
  );
}
