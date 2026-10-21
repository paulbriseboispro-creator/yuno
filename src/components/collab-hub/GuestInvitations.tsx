import { useCallback, useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { toast } from 'sonner';
import { Building2, Check, ChevronRight, Loader2, Mail, Users } from 'lucide-react';
import { useLanguage } from '@/contexts/LanguageContext';
import { translate } from '@/i18n/orgTranslate';
import { supabase } from '@/integrations/supabase/client';
import { OrgButton, OrgSectionLabel, POS, T1, T2, T3, BORDER, INNER_BG } from '@/components/org-ui';
import type { CoorgScope } from '@/lib/coorg';
import { guestErrorCode, guestErrorText, guestUiWords, listGuestPasses, sendGuestPassEmail, toGuestSpaceLanguage, type GuestPassRow } from '@/lib/guestSpace';

type Side = 'venue' | 'organizer';
interface Item { eventId: string; eventTitle: string; startAt: string; pass: GuestPassRow }

/**
 * Suivi des invitations « Invité » (club ou organisation sans compte) depuis le
 * hub Collaborations : envoyée → ouverte → rattachée à un compte, avec le
 * bouton Renvoyer. Avant, ce suivi n'existait que sur la page Co-organisation
 * de chaque soirée : le hub disait « aucune soirée à plusieurs » alors qu'une
 * invitation était partie. Se tait quand il n'y a aucune invitation vivante.
 */
export function GuestInvitations({ side, scope }: { side: Side; scope: CoorgScope | null }) {
  const { language } = useLanguage();
  const t = (fr: string, en: string, es: string) => translate(language, fr, en, es);
  const w = guestUiWords(toGuestSpaceLanguage(language, 'fr'));
  const [items, setItems] = useState<Item[] | null>(null);
  const [busy, setBusy] = useState<string | null>(null);

  const load = useCallback(async () => {
    if (!scope) { setItems([]); return; }
    let q = supabase.from('events').select('id, title, start_at').gte('end_at', new Date().toISOString()).eq('is_active', true).order('start_at');
    q = scope.venueId ? q.eq('venue_id', scope.venueId) : q.eq('organizer_user_id', scope.organizerUserId as string);
    const { data: events } = await q;
    const lists = await Promise.all((events ?? []).map(async (e) => {
      try {
        const r = await listGuestPasses(e.id);
        return r.passes.filter((p) => !p.revoked).map((pass): Item => ({ eventId: e.id, eventTitle: e.title, startAt: e.start_at, pass }));
      } catch {
        return []; // pas partie principale de niveau ≥ 2 : la RPC refuse, on se tait
      }
    }));
    setItems(lists.flat());
  }, [scope]);

  useEffect(() => { void load(); }, [load]);

  if (!items || items.length === 0) return null;

  const resend = async (p: GuestPassRow) => {
    setBusy(p.id);
    try {
      await sendGuestPassEmail(p.id);
      toast.success(w('guestSpace.org.sent'));
      await load();
    } catch (err) {
      toast.error(guestErrorText(guestErrorCode(err), w));
    } finally {
      setBusy(null);
    }
  };

  const fmt = new Intl.DateTimeFormat(language === 'fr' ? 'fr-FR' : language === 'es' ? 'es-ES' : 'en-GB', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' });
  const coorgHref = (id: string) => (side === 'venue' ? `/owner/coorg/${id}` : `/organizer-app/coorg/${id}`);

  return (
    <section>
      <div className="mb-2">
        <OrgSectionLabel>{t('Invitations « Invité »', 'Guest invitations', 'Invitaciones «Invitado»')} ({items.length})</OrgSectionLabel>
      </div>
      <div className="grid gap-2.5 xl:grid-cols-2">
        {items.map(({ eventId, eventTitle, startAt, pass: p }) => {
          const Icon = p.guest_kind === 'venue' ? Building2 : Users;
          const steps = [
            { done: p.email_sent_count > 0 || p.contact_phone != null, label: t('Envoyée', 'Sent', 'Enviada'), at: p.email_sent_at },
            { done: p.opened_count > 0, label: t('Ouverte', 'Opened', 'Abierta'), at: p.first_opened_at },
            { done: p.claim_status != null, label: t('Compte rattaché', 'Account linked', 'Cuenta vinculada'), at: p.claimed_at },
          ];
          return (
            <div key={p.id} className="space-y-2.5 rounded-xl px-3.5 py-3" style={{ background: INNER_BG, border: `1px solid ${BORDER}` }}>
              <div className="flex items-center gap-2.5">
                <Icon className="h-4 w-4 flex-none" style={{ color: T3 }} />
                <div className="min-w-0 flex-1">
                  <p className="truncate" style={{ color: T1, fontSize: 13.5, fontWeight: 600 }}>{p.guest_name}</p>
                  <p className="truncate" style={{ color: T3, fontSize: 11.5 }}>{eventTitle} · {fmt.format(new Date(startAt))}{p.contact_email ? ` · ${p.contact_email}` : ''}</p>
                </div>
                <Link to={coorgHref(eventId)} className="flex-none" aria-label={t('Ouvrir la soirée', 'Open event', 'Abrir evento')} style={{ color: T3 }}>
                  <ChevronRight className="h-4 w-4" />
                </Link>
              </div>
              <div className="flex flex-wrap items-center gap-x-4 gap-y-1">
                {steps.map((s) => (
                  <span key={s.label} className="flex items-center gap-1.5" style={{ color: s.done ? POS : T3, fontSize: 12, fontWeight: s.done ? 600 : 500 }}>
                    {s.done ? <Check className="h-3.5 w-3.5" /> : <span className="inline-block h-3.5 w-3.5 rounded-full" style={{ border: `1.5px solid ${BORDER}` }} />}
                    {s.label}
                    {s.done && s.at && <span style={{ color: T3, fontWeight: 400 }}>{fmt.format(new Date(s.at))}</span>}
                  </span>
                ))}
              </div>
              {p.contact_email && (
                <div className="flex items-center gap-2">
                  <OrgButton size="sm" variant="secondary" disabled={busy !== null} onClick={() => void resend(p)}>
                    {busy === p.id ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Mail className="h-3.5 w-3.5" />}
                    {p.email_sent_count > 0 ? w('guestSpace.org.resend') : w('guestSpace.org.sendEmail')}
                  </OrgButton>
                  {p.email_sent_count > 1 && <span style={{ color: T2, fontSize: 11.5 }}>×{p.email_sent_count}</span>}
                </div>
              )}
            </div>
          );
        })}
      </div>
    </section>
  );
}
