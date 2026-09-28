import { useCallback, useEffect, useState } from 'react';
import { toast } from 'sonner';
import { Copy, Link2, Loader2 } from 'lucide-react';
import { OrgButton, OrgCard, OrgSectionLabel, T1, T2, T3, BORDER, INNER_BG } from '@/components/org-ui';
import {
  getEventPartyLinks, ensureEventPartyLink, coorgErrorCode, eur, type PartyLinksState,
} from '@/lib/coorg';
import { PUBLIC_BASE_URL } from '@/lib/native';
import { capturePosthog } from '@/lib/posthog';
import { PartyAvatar, PartyRolePill, useCoorgT, useCoorgErrorText } from './coorgUi';

/**
 * « Qui fait vendre ? » — un lien de vente suivi PAR PARTIE de la soirée.
 * Chaque partie partage SON lien à son public ; les ventes passées par ce
 * lien lui sont attribuées (clics, billets, tables, guest list, CA pour qui
 * voit l'argent). C'est une attribution, jamais un partage d'argent : l'argent
 * suit l'accord et son décompte.
 */
export function CoorgSalesLinksCard({ eventId, canCreate }: { eventId: string; canCreate: boolean }) {
  const { t, language } = useCoorgT();
  const errText = useCoorgErrorText();
  const [st, setSt] = useState<PartyLinksState | null>(null);
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    try {
      setSt(await getEventPartyLinks(eventId));
    } catch (err) {
      console.warn('[coorg] liens de vente', err);
      setSt(null);
    }
  }, [eventId]);
  useEffect(() => { void load(); }, [load]);

  if (!st?.ok || !st.parties || st.parties.length < 2) return null;
  const rows = st.parties;
  const mine = rows.find((r) => r.mine);
  const urlOf = (code: string) => `${PUBLIC_BASE_URL}/l/${code}`;

  const copy = async (code: string) => {
    try {
      await navigator.clipboard.writeText(urlOf(code));
      toast.success(t('Lien copié', 'Link copied', 'Enlace copiado'));
    } catch {
      toast.error(urlOf(code));
    }
  };

  const create = async () => {
    setBusy(true);
    try {
      const r = await ensureEventPartyLink(eventId, mine?.party ?? null);
      if (!r?.ok) throw new Error(r?.reason ?? 'forbidden');
      capturePosthog('coorg_party_link_created', { event_id: eventId });
      await load();
      if (r.code) await copy(r.code);
    } catch (err) {
      toast.error(errText(coorgErrorCode(err)));
    } finally {
      setBusy(false);
    }
  };

  return (
    <OrgCard className="p-5">
      <div className="flex flex-wrap items-center gap-2">
        <Link2 className="h-4 w-4" style={{ color: T2 }} />
        <OrgSectionLabel>{t('Qui fait vendre', 'Who drives sales', 'Quién vende')}</OrgSectionLabel>
      </div>
      <p className="mt-1" style={{ color: T3, fontSize: 12, lineHeight: 1.5 }}>
        {t(
          'Chaque partie a son lien de vente. Partage le tien à ton public : les ventes qui passent par lui te sont attribuées. L’argent, lui, suit toujours l’accord.',
          'Each party has its own sales link. Share yours with your audience: sales that come through it are credited to you. The money always follows the agreement.',
          'Cada parte tiene su enlace de venta. Comparte el tuyo con tu público: las ventas que pasan por él se te atribuyen. El dinero siempre sigue el acuerdo.',
        )}
      </p>

      {mine && canCreate && (
        <div className="mt-3 flex flex-wrap items-center gap-2 rounded-xl p-3" style={{ background: INNER_BG }}>
          {mine.code && mine.active ? (
            <>
              <code className="min-w-0 flex-1 truncate" style={{ color: T1, fontSize: 12.5 }}>{urlOf(mine.code)}</code>
              <OrgButton size="sm" variant="secondary" onClick={() => void copy(mine.code!)}>
                <Copy className="h-3.5 w-3.5" /> {t('Copier mon lien', 'Copy my link', 'Copiar mi enlace')}
              </OrgButton>
            </>
          ) : (
            <>
              <span className="min-w-0 flex-1" style={{ color: T2, fontSize: 12.5 }}>
                {t('Tu n’as pas encore ton lien de vente.', 'You don’t have your sales link yet.', 'Aún no tienes tu enlace de venta.')}
              </span>
              <OrgButton size="sm" variant="primary" onClick={() => void create()} disabled={busy}>
                {busy ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Link2 className="h-3.5 w-3.5" />}
                {t('Créer mon lien', 'Create my link', 'Crear mi enlace')}
              </OrgButton>
            </>
          )}
        </div>
      )}

      <div className="mt-3 overflow-x-auto rounded-xl" style={{ border: `1px solid ${BORDER}` }}>
        <table className="w-full min-w-[520px]" style={{ fontSize: 12.5 }}>
          <thead>
            <tr style={{ background: INNER_BG, color: T3, fontSize: 11, fontWeight: 600 }}>
              <th className="px-3 py-2 text-left">{t('Partie', 'Party', 'Parte')}</th>
              <th className="px-2 py-2 text-right">{t('Clics', 'Clicks', 'Clics')}</th>
              <th className="px-2 py-2 text-right">{t('Billets', 'Tickets', 'Entradas')}</th>
              <th className="px-2 py-2 text-right">{t('Tables', 'Tables', 'Mesas')}</th>
              <th className="px-2 py-2 text-right">{t('Guest list', 'Guest list', 'Guest list')}</th>
              {st.money && <th className="px-3 py-2 text-right">{t('CA', 'Revenue', 'Ingresos')}</th>}
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => (
              <tr key={r.party} style={{ borderTop: `1px solid ${BORDER}` }}>
                <td className="px-3 py-2">
                  <div className="flex items-center gap-2">
                    <PartyAvatar name={r.name} url={r.avatar_url} kind={r.kind} size={26} />
                    <div className="min-w-0">
                      <p className="truncate" style={{ color: T1, fontWeight: 600 }}>
                        {r.name}{r.mine ? ` · ${t('toi', 'you', 'tú')}` : ''}
                      </p>
                      <div className="mt-0.5 flex items-center gap-1.5">
                        <PartyRolePill role={r.role} access={r.access} kind={r.kind} />
                        {!r.has_link && <span style={{ color: T3, fontSize: 11 }}>{t('pas de lien', 'no link', 'sin enlace')}</span>}
                      </div>
                    </div>
                  </div>
                </td>
                <td className="px-2 py-2 text-right" style={{ color: T2 }}>{r.clicks}</td>
                <td className="px-2 py-2 text-right" style={{ color: T1 }}>{r.tickets}</td>
                <td className="px-2 py-2 text-right" style={{ color: T1 }}>{r.tables}</td>
                <td className="px-2 py-2 text-right" style={{ color: T1 }}>{r.guests}</td>
                {st.money && <td className="px-3 py-2 text-right" style={{ color: T1, fontWeight: 600 }}>{eur(r.revenue ?? 0, language)}</td>}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {st.money && (
        <p className="mt-2" style={{ color: T3, fontSize: 11.5 }}>
          {t('CA club : hors frais de service Yuno et assurance, remboursements déduits.',
            'Club revenue: excluding Yuno service fees and insurance, refunds deducted.',
            'Ingresos del club: sin gastos de servicio de Yuno ni seguro, reembolsos descontados.')}
        </p>
      )}
    </OrgCard>
  );
}
