import { useEffect, useState } from 'react';
import { toast } from 'sonner';
import { Loader2, Search, Send, Users } from 'lucide-react';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from '@/components/ui/dialog';
import { Switch } from '@/components/ui/switch';
import { OrgButton, OrgTabs, DarkInput, DarkTextarea, FieldLabel, T1, T2, T3, BORDER, INNER_BG } from '@/components/org-ui';
import {
  searchCoorgPartners, inviteEventCohost, coorgErrorCode,
  type CoorgPartnerCandidate, type CohostAccess,
} from '@/lib/coorg';
import { PartyAvatar, useCoorgT, useCoorgErrorText } from './coorgUi';
import { capturePosthog } from '@/lib/posthog';

/**
 * Inviter un co-hôte (organisateur ou club) sur une soirée. Recherche dans
 * l'annuaire Yuno ; l'invité doit avoir un compte pro — comme chez Shotgun,
 * et parce qu'un consentement CRM ne se partage qu'avec une structure nommée.
 */
export function CoorgInviteDialog({ open, onOpenChange, eventId, onInvited, prefill }: {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  eventId: string;
  onInvited: () => void;
  /** Partenaire déjà connu (carnet d'adresses) : saute la recherche. */
  prefill?: CoorgPartnerCandidate | null;
}) {
  const { t } = useCoorgT();
  const errText = useCoorgErrorText();
  const [query, setQuery] = useState('');
  const [results, setResults] = useState<CoorgPartnerCandidate[]>([]);
  const [searching, setSearching] = useState(false);
  const [picked, setPicked] = useState<CoorgPartnerCandidate | null>(null);
  const [access, setAccess] = useState<CohostAccess>('editor');
  const [shareCrm, setShareCrm] = useState(true);
  const [message, setMessage] = useState('');
  const [sending, setSending] = useState(false);

  useEffect(() => {
    if (!open) return;
    setPicked(prefill ?? null);
    setQuery('');
    setResults([]);
    setAccess('editor');
    setShareCrm(true);
    setMessage('');
  }, [open, prefill]);

  useEffect(() => {
    const q = query.trim();
    if (q.length < 2) { setResults([]); return; }
    let cancelled = false;
    setSearching(true);
    const h = setTimeout(async () => {
      try {
        const rows = await searchCoorgPartners(q);
        if (!cancelled) setResults(rows ?? []);
      } catch {
        if (!cancelled) setResults([]);
      } finally {
        if (!cancelled) setSearching(false);
      }
    }, 250);
    return () => { cancelled = true; clearTimeout(h); };
  }, [query]);

  const send = async () => {
    if (!picked) return;
    setSending(true);
    try {
      await inviteEventCohost({
        eventId,
        organizerUserId: picked.kind === 'org' ? picked.id : null,
        venueId: picked.kind === 'venue' ? picked.id : null,
        access, shareCrm, message: message.trim() || undefined,
      });
      capturePosthog('coorg_cohost_invited', { event_id: eventId, cohost_kind: picked.kind, access });
      toast.success(t('Invitation envoyée', 'Invitation sent', 'Invitación enviada'));
      onInvited();
      onOpenChange(false);
    } catch (err) {
      toast.error(errText(coorgErrorCode(err)));
    } finally {
      setSending(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle>{t('Inviter un co-organisateur', 'Invite a co-organizer', 'Invitar a un coorganizador')}</DialogTitle>
          <DialogDescription>
            {t(
              'Un organisateur ou un club qui a un compte Yuno. Il verra la soirée dans sa Console dès qu’il accepte.',
              'An organizer or a club with a Yuno account. They see the event in their Console as soon as they accept.',
              'Un organizador o un club con cuenta Yuno. Verá el evento en su Consola en cuanto acepte.',
            )}
          </DialogDescription>
        </DialogHeader>

        {!picked ? (
          <div className="space-y-3">
            <div className="relative">
              <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2" style={{ color: T3 }} />
              <DarkInput
                value={query}
                onChange={setQuery}
                placeholder={t('Nom de l’orga ou du club, ville…', 'Organizer or club name, city…', 'Nombre del organizador o club, ciudad…')}
                className="pl-9"
              />
            </div>
            <div className="max-h-72 space-y-1.5 overflow-y-auto">
              {searching && (
                <div className="flex justify-center py-6"><Loader2 className="h-4 w-4 animate-spin" style={{ color: T3 }} /></div>
              )}
              {!searching && query.trim().length >= 2 && results.length === 0 && (
                <p className="py-6 text-center" style={{ color: T3, fontSize: 12.5 }}>
                  {t(
                    'Personne sous ce nom. Ton partenaire doit d’abord ouvrir son compte pro Yuno.',
                    'No one by that name. Your partner needs a Yuno pro account first.',
                    'Nadie con ese nombre. Tu socio necesita primero una cuenta pro de Yuno.',
                  )}
                </p>
              )}
              {results.map((r) => (
                <button
                  key={`${r.kind}:${r.id}`}
                  type="button"
                  onClick={() => setPicked(r)}
                  className="flex w-full items-center gap-3 rounded-xl px-3 py-2.5 text-left transition-colors hover:bg-[rgb(var(--ink)/0.05)]"
                  style={{ border: `1px solid ${BORDER}` }}
                >
                  <PartyAvatar name={r.name} url={r.avatar_url} kind={r.kind} />
                  <div className="min-w-0 flex-1">
                    <p className="truncate" style={{ color: T1, fontSize: 13.5, fontWeight: 600 }}>{r.name}</p>
                    <p className="truncate" style={{ color: T3, fontSize: 11.5 }}>
                      {r.kind === 'venue' ? t('Club', 'Club', 'Club') : t('Organisateur', 'Organizer', 'Organizador')}
                      {r.city ? ` · ${r.city}` : ''}
                      {r.followers > 0 ? ` · ${r.followers} ${t('abonnés', 'followers', 'seguidores')}` : ''}
                    </p>
                  </div>
                </button>
              ))}
            </div>
          </div>
        ) : (
          <div className="space-y-4">
            <div className="flex items-center gap-3 rounded-xl p-3" style={{ background: INNER_BG, border: `1px solid ${BORDER}` }}>
              <PartyAvatar name={picked.name} url={picked.avatar_url} kind={picked.kind} />
              <div className="min-w-0 flex-1">
                <p className="truncate" style={{ color: T1, fontSize: 14, fontWeight: 600 }}>{picked.name}</p>
                <p style={{ color: T3, fontSize: 11.5 }}>
                  {picked.kind === 'venue' ? t('Club', 'Club', 'Club') : t('Organisateur', 'Organizer', 'Organizador')}
                </p>
              </div>
              {!prefill && (
                <OrgButton size="sm" variant="ghost" onClick={() => setPicked(null)}>
                  {t('Changer', 'Change', 'Cambiar')}
                </OrgButton>
              )}
            </div>

            <div>
              <FieldLabel>{t('Accès à la soirée', 'Access to the event', 'Acceso al evento')}</FieldLabel>
              <OrgTabs
                size="sm"
                value={access}
                onChange={(v) => setAccess(v as CohostAccess)}
                tabs={[
                  { value: 'editor', label: t('Édition', 'Editor', 'Edición') },
                  { value: 'viewer', label: t('Lecture', 'Viewer', 'Lectura') },
                ]}
              />
              <p className="mt-1.5" style={{ color: T3, fontSize: 11.5, lineHeight: 1.45 }}>
                {access === 'editor'
                  ? t(
                    'Habille la soirée, gère billets, tables et guest list, voit ventes et analyses. Ne touche jamais aux parties, au partage d’argent ni à la visibilité.',
                    'Dresses the event, runs tickets, tables and guest list, sees sales and analytics. Never touches parties, money split or visibility.',
                    'Viste el evento, gestiona entradas, mesas y lista, ve ventas y análisis. Nunca toca las partes, el reparto ni la visibilidad.',
                  )
                  : t(
                    'Voit la soirée, ses ventes et ses analyses dans sa Console, sans rien modifier.',
                    'Sees the event, its sales and analytics in their Console, without changing anything.',
                    'Ve el evento, sus ventas y análisis en su Consola, sin modificar nada.',
                  )}
              </p>
            </div>

            <label className="flex items-start gap-3 rounded-xl p-3" style={{ background: INNER_BG, border: `1px solid ${BORDER}` }}>
              <Switch checked={shareCrm} onCheckedChange={setShareCrm} className="mt-0.5" />
              <span>
                <span className="flex items-center gap-1.5" style={{ color: T1, fontSize: 13, fontWeight: 600 }}>
                  <Users className="h-3.5 w-3.5" /> {t('CRM partagé', 'Shared CRM', 'CRM compartido')}
                </span>
                <span className="mt-0.5 block" style={{ color: T2, fontSize: 11.5, lineHeight: 1.45 }}>
                  {t(
                    'La case d’inscription du checkout nommera aussi ce co-hôte : chaque client qui la coche entre dans sa base, et la soirée est annoncée à ses abonnés.',
                    'The checkout opt-in will also name this co-host: every customer who ticks it joins their list, and the event is announced to their followers.',
                    'La casilla del checkout nombrará también a este coanfitrión: cada cliente que la marque entra en su base, y el evento se anuncia a sus seguidores.',
                  )}
                </span>
              </span>
            </label>

            <div>
              <FieldLabel>{t('Message (facultatif)', 'Message (optional)', 'Mensaje (opcional)')}</FieldLabel>
              <DarkTextarea value={message} onChange={setMessage} rows={2}
                placeholder={t('On la fait ensemble ?', 'Shall we do it together?', '¿La hacemos juntos?')} />
            </div>

            <div className="flex justify-end gap-2">
              <OrgButton variant="ghost" onClick={() => onOpenChange(false)}>{t('Annuler', 'Cancel', 'Cancelar')}</OrgButton>
              <OrgButton variant="primary" onClick={send} disabled={sending}>
                {sending ? <Loader2 className="h-4 w-4 animate-spin" /> : <Send className="h-4 w-4" />}
                {t('Envoyer l’invitation', 'Send invitation', 'Enviar invitación')}
              </OrgButton>
            </div>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}
