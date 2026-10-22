/**
 * La porte du club, dans la fiche client de Yuno Tickets (Console Club et
 * Manager) : bannissement de l'adresse et incidents enregistrés. Ce que la
 * page Clients d'avant faisait déjà (OwnerCustomers), par les mêmes RPC
 * (`staff_ban_customer`, `staff_unban_customer`, porte `can_staff_flag_venue`) ;
 * la lecture vient de la fiche (`tix_client.door`). Rien de tout ça n'existe
 * dans Yuno CRM, qui ne tient pas la porte.
 */
import { useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { Hv } from '@/crm/ui/Hv';
import { useTixT } from '@/tickets/analytics/i18n';
import { Badge, PillButton } from '@/tickets/analytics/kit';
import { useTixCaps, useTixScope } from '@/tickets/clients/scope';
import { useTixToast } from '@/tickets/clients/toast';
import type { ClientCard } from '@/tickets/clients/data/clients';

const KNOWN = ['ban', 'unban', 'warning', 'refund', 'fight', 'drunk', 'theft', 'harassment', 'other'];

export function ClientDoor({ card: c }: { card: ClientCard }) {
  const { t, locale } = useTixT();
  const toast = useTixToast();
  const qc = useQueryClient();
  const { rpc: args, qk } = useTixScope();
  const canEdit = useTixCaps().write;
  const [asking, setAsking] = useState(false);
  const [reason, setReason] = useState('');
  const [busy, setBusy] = useState(false);
  const door = c.door;
  const venueId = args.p_venue_id;
  if (!door || !venueId) return null;

  const fd = (iso: string) => new Date(iso).toLocaleDateString(locale, { day: 'numeric', month: 'short', year: 'numeric' });
  const refresh = () => qc.invalidateQueries({ queryKey: ['tix-cli', qk, 'client', c.email] });

  const ban = async () => {
    if (!reason.trim() || busy) return;
    setBusy(true);
    const { error } = await supabase.rpc('staff_ban_customer', {
      p_venue_id: venueId, p_user_id: null, p_email: c.email, p_reason: reason.trim(),
      p_first_name: c.first_name, p_last_name: c.last_name,
    } as never);
    setBusy(false);
    if (error) { toast(t('ya.cli.door.failed')); return; }
    toast(t('ya.cli.door.banned', { email: c.email }));
    setAsking(false);
    setReason('');
    void refresh();
  };
  const unban = async () => {
    if (busy) return;
    setBusy(true);
    const { error } = await supabase.rpc('staff_unban_customer', {
      p_venue_id: venueId, p_user_id: null, p_email: c.email, p_reason: t('ya.cli.door.manualUnban'),
    } as never);
    setBusy(false);
    if (error) { toast(t('ya.cli.door.failed')); return; }
    toast(t('ya.cli.door.unbanned', { email: c.email }));
    void refresh();
  };

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 12, padding: 18, borderRadius: 20, background: 'var(--ya-card)', boxShadow: 'inset 0 0 0 1px var(--ya-sand-200)' }}>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 10, flexWrap: 'wrap' }}>
        <span style={{ fontSize: 16, fontWeight: 600 }}>{t('ya.cli.door.title')}</span>
        {door.banned ? <Badge tone="todo">{t('ya.cli.door.isBanned')}</Badge> : <Badge tone="done">{t('ya.cli.door.ok')}</Badge>}
      </div>
      {door.banned && (
        <span style={{ fontSize: 14, lineHeight: 1.45, color: 'var(--ya-sand-600)' }}>
          {door.at ? t('ya.cli.door.since', { date: fd(door.at) }) : t('ya.cli.door.isBanned')}
          {door.reason ? ` · ${door.reason}` : ''}
        </span>
      )}
      {door.incidents.length > 0 && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
          {door.incidents.map((i, k) => (
            <div key={`${i.at}-${k}`} style={{ display: 'flex', justifyContent: 'space-between', gap: 10, fontSize: 13.5, lineHeight: 1.4 }}>
              <span style={{ minWidth: 0 }}>
                <b style={{ fontWeight: 600 }}>{t(`ya.cli.door.type.${KNOWN.includes(i.type) ? i.type : 'other'}`)}</b>
                {i.reason ? <span style={{ color: 'var(--ya-sand-600)' }}> · {i.reason}</span> : null}
              </span>
              <span style={{ flex: 'none', color: 'var(--ya-sand-500)', fontVariantNumeric: 'tabular-nums' }}>{fd(i.at)}</span>
            </div>
          ))}
        </div>
      )}
      {canEdit && (door.banned ? (
        <div><PillButton size="sm" onClick={() => void unban()} disabled={busy}>{t('ya.cli.door.unban')}</PillButton></div>
      ) : asking ? (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
          <textarea
            value={reason}
            onChange={(e) => setReason(e.target.value)}
            rows={2}
            placeholder={t('ya.cli.door.reasonPh')}
            aria-label={t('ya.cli.door.reasonPh')}
            style={{ width: '100%', resize: 'vertical', padding: '10px 12px', borderRadius: 12, border: '1px solid var(--ya-sand-200)', background: 'var(--ya-paper)', color: 'var(--ya-ink)', fontSize: 14, lineHeight: 1.45, outline: 'none' }}
          />
          <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
            <PillButton size="sm" tone="danger" onClick={() => void ban()} disabled={busy || !reason.trim()}>{t('ya.cli.door.confirm')}</PillButton>
            <Hv as="button" type="button" onClick={() => { setAsking(false); setReason(''); }} style={{ height: 36, padding: '0 14px', border: 0, borderRadius: 99, background: 'none', color: 'var(--ya-sand-600)', fontSize: 14, fontWeight: 600, cursor: 'pointer' }} hover={{ color: 'var(--ya-ink)' }}>
              {t('ya.cli.door.cancel')}
            </Hv>
          </div>
        </div>
      ) : (
        <div><PillButton size="sm" onClick={() => setAsking(true)}>{t('ya.cli.door.ban')}</PillButton></div>
      ))}
    </div>
  );
}
