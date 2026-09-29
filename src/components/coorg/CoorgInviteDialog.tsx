import { useEffect, useState } from 'react';
import { toast } from 'sonner';
import { Loader2, Mail, Search, Send, Users } from 'lucide-react';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from '@/components/ui/dialog';
import { Switch } from '@/components/ui/switch';
import { OrgButton, OrgTabs, DarkInput, DarkTextarea, FieldLabel, T1, T2, T3, BORDER, INNER_BG } from '@/components/org-ui';
import {
  searchCoorgPartners, inviteEventCohost, inviteCohostByEmail, coorgErrorCode,
  type CoorgPartnerCandidate, type CohostAccess,
} from '@/lib/coorg';
import { PartyAvatar, useCoorgT, useCoorgErrorText } from './coorgUi';
import { capturePosthog } from '@/lib/posthog';

/**
 * Inviter un co-hôte (organisateur ou club) sur une soirée. Deux portes :
 *   • « Sur Yuno » — recherche dans l'annuaire des structures qui ont un compte ;
 *   • « Par email » — une structure qui n'a PAS encore de compte : elle reçoit
 *     un lien, crée son compte avec CETTE adresse et rejoint la soirée (son
 *     espace organisateur est créé à l'acceptation). Le consentement CRM reste
 *     nommé : la case du checkout ne la nomme qu'une fois qu'elle a accepté.
 */
export function CoorgInviteDialog({ open, onOpenChange, eventId, onInvited, prefill }: {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  eventId: string;
  onInvited: () => void;
  /** Partenaire déjà connu (carnet d'adresses) : saute la recherche. */
  prefill?: CoorgPartnerCandidate | null;
}) {
  const { t, language } = useCoorgT();
  const errText = useCoorgErrorText();
  const [query, setQuery] = useState('');
  const [results, setResults] = useState<CoorgPartnerCandidate[]>([]);
  const [searching, setSearching] = useState(false);
  const [picked, setPicked] = useState<CoorgPartnerCandidate | null>(null);
  const [access, setAccess] = useState<CohostAccess>('viewer');
  const [shareCrm, setShareCrm] = useState(true);
  const [message, setMessage] = useState('');
  const [sending, setSending] = useState(false);
  const [mode, setMode] = useState<'search' | 'email'>('search');
  const [email, setEmail] = useState('');
  const [emailName, setEmailName] = useState('');
  const [mailLang, setMailLang] = useState<'fr' | 'en' | 'es'>('fr');

  useEffect(() => {
    if (!open) return;
    setPicked(prefill ?? null);
    setQuery('');
    setResults([]);
    setAccess('viewer');
    setShareCrm(true);
    setMessage('');
    setMode('search');
    setEmail('');
    setEmailName('');
    setMailLang(language === 'en' ? 'en' : language === 'es' ? 'es' : 'fr');
  }, [open, prefill, language]);

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

  const sendByEmail = async () => {
    if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email.trim())) {
      toast.error(errText('invalid_email'));
      return;
    }
    setSending(true);
    try {
      const r = await inviteCohostByEmail({
        eventId, email: email.trim(), name: emailName.trim() || null, access, shareCrm,
        message: message.trim() || null, lang: mailLang,
      });
      capturePosthog('coorg_cohost_invited', { event_id: eventId, cohost_kind: 'email', access });
      toast.success(r.email_sent
        ? t(`Invitation envoyée à ${email.trim()}`, `Invitation sent to ${email.trim()}`, `Invitación enviada a ${email.trim()}`)
        : t('Invitation enregistrée', 'Invitation saved', 'Invitación guardada'));
      onInvited();
      onOpenChange(false);
    } catch (err) {
      toast.error(errText(coorgErrorCode(err)));
    } finally {
      setSending(false);
    }
  };

  const send = async () => {
    if (mode === 'email') { await sendByEmail(); return; }
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
              'Un organisateur ou un club, sur Yuno ou pas encore. Il voit la soirée dans sa Console dès qu’il accepte.',
              'An organizer or a club, on Yuno or not yet. They see the event in their Console as soon as they accept.',
              'Un organizador o un club, en Yuno o todavía no. Verá el evento en su Consola en cuanto acepte.',
            )}
          </DialogDescription>
        </DialogHeader>

        {!prefill && !picked && (
          <OrgTabs
            size="sm"
            value={mode}
            onChange={(v) => setMode(v as 'search' | 'email')}
            tabs={[
              { value: 'search', label: t('Sur Yuno', 'On Yuno', 'En Yuno') },
              { value: 'email', label: t('Pas encore sur Yuno', 'Not on Yuno yet', 'Aún no en Yuno') },
            ]}
          />
        )}

        {mode === 'email' && !picked && (
          <div className="space-y-3">
            <div>
              <FieldLabel>{t('Email de la structure *', 'Organization email *', 'Email de la estructura *')}</FieldLabel>
              <DarkInput type="email" value={email} onChange={setEmail} placeholder="contact@collectif.fr" />
            </div>
            <div>
              <FieldLabel>{t('Nom de la structure', 'Organization name', 'Nombre de la estructura')}</FieldLabel>
              <DarkInput value={emailName} onChange={setEmailName} placeholder={t('Collectif, asso, club…', 'Collective, association, club…', 'Colectivo, asociación, club…')} />
            </div>
            <div>
              <FieldLabel>{t('Langue de l’email', 'Email language', 'Idioma del email')}</FieldLabel>
              <OrgTabs
                size="sm"
                value={mailLang}
                onChange={(v) => setMailLang(v as 'fr' | 'en' | 'es')}
                tabs={[{ value: 'fr', label: 'Français' }, { value: 'en', label: 'English' }, { value: 'es', label: 'Español' }]}
              />
            </div>
            <p className="flex items-start gap-2" style={{ color: T3, fontSize: 11.5, lineHeight: 1.45 }}>
              <Mail className="mt-0.5 h-3.5 w-3.5 flex-none" />
              {t(
                'Elle reçoit un lien valable 14 jours, crée son compte avec cette adresse et rejoint la soirée. Aucun compte Stripe exigé.',
                'They get a link valid for 14 days, create their account with this address and join the event. No Stripe account required.',
                'Recibe un enlace válido 14 días, crea su cuenta con esta dirección y se une al evento. Sin cuenta de Stripe.',
              )}
            </p>
          </div>
        )}

        {mode !== 'email' && !picked ? (
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
                <div className="py-6 text-center">
                  <p style={{ color: T3, fontSize: 12.5 }}>
                    {t('Personne sous ce nom sur Yuno.', 'No one by that name on Yuno.', 'Nadie con ese nombre en Yuno.')}
                  </p>
                  <OrgButton size="sm" variant="secondary" className="mt-2" onClick={() => { setEmailName(query.trim()); setMode('email'); }}>
                    <Mail className="h-3.5 w-3.5" /> {t('L’inviter par email', 'Invite them by email', 'Invitar por email')}
                  </OrgButton>
                </div>
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
            {picked && (
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
            )}

            <div>
              <FieldLabel>{t('Rôle sur la soirée', 'Role on the event', 'Rol en el evento')}</FieldLabel>
              <OrgTabs
                size="sm"
                value={access}
                onChange={(v) => setAccess(v as CohostAccess)}
                tabs={[
                  { value: 'viewer', label: t('Partenaire', 'Partner', 'Socio') },
                  { value: 'editor', label: t('Co-gestion', 'Co-manager', 'Cogestión') },
                ]}
              />
              <p className="mt-1.5" style={{ color: T3, fontSize: 11.5, lineHeight: 1.45 }}>
                {access === 'editor'
                  ? t(
                    'Tout ce que fait un partenaire, plus : habille la soirée, gère billets, tables et guest list, scanne à la porte. Ne touche jamais aux parties, au partage d’argent ni à la visibilité.',
                    'Everything a partner does, plus: dresses the event, runs tickets, tables and guest list, scans at the door. Never touches parties, money split or visibility.',
                    'Todo lo que hace un socio, y además: viste el evento, gestiona entradas, mesas y lista, escanea en la puerta. Nunca toca las partes, el reparto ni la visibilidad.',
                  )
                  : t(
                    'Suit la soirée depuis sa Console : ventes, analyses, SES ventes et SES liens (lien direct, Instagram, WhatsApp…), emails à sa base. Billets, tables et guest list restent à toi.',
                    'Follows the event from their Console: sales, analytics, THEIR sales and THEIR links (direct link, Instagram, WhatsApp…), emails to their list. Tickets, tables and guest list stay with you.',
                    'Sigue el evento desde su Consola: ventas, análisis, SUS ventas y SUS enlaces (enlace directo, Instagram, WhatsApp…), emails a su base. Entradas, mesas y lista siguen contigo.',
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
