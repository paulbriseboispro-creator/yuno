import { useEffect, useState, type ReactNode } from 'react';
import { Loader2, Mail, Plus, Search, UserRound, X } from 'lucide-react';
import { OrgButton, OrgPill, OrgTabs, DarkInput, RED, T1, T2, T3, BORDER, INNER_BG } from '@/components/org-ui';
import { searchCoorgPartners, type CoorgPartnerCandidate } from '@/lib/coorg';
import {
  allowedRoles, defaultRole, partnerDraftKey, principalKindFor,
  type CollabModeDb, type InviteContext, type InviteRole, type PartnerDraft, type PartnerDraftInput, type YunoSplit,
} from '@/lib/collabInvite';
import { PartyAvatar, useCoorgT } from '@/components/coorg/coorgUi';

const MAX_INVITES = 8;

/**
 * « Avec qui fais-tu cette soirée ? » — le SEUL endroit où l'on met des gens
 * sur une soirée (formulaire de création comme d'édition). Remplace le mode de
 * collaboration, le « club partenaire » (limité aux partenariats actifs) et
 * les « organisations partenaires ».
 *
 * Une recherche unique (clubs ET organisations de Yuno), et en bout de liste
 * « Inviter par email ». Chaque invité porte UN rôle (`collabInvite.ts`) :
 * Lieu / Organisateur, Co-gestion ou Partenaire. Rien ne part avant
 * l'enregistrement de la soirée, et personne ne rejoint sans accepter.
 */
export function EventPartnersField({
  drafts, onChange, ctx, excludeKeys = [], existing, mode, onModeChange,
}: {
  drafts: PartnerDraft[];
  onChange: (d: PartnerDraft[]) => void;
  ctx: InviteContext;
  /** Parties déjà sur la soirée (l'appelant, le lieu déjà rattaché) : jamais proposées. */
  excludeKeys?: string[];
  /** Lignes déjà sur la soirée (édition), dessinées au-dessus des nouvelles invitations. */
  existing?: ReactNode;
  mode: CollabModeDb;
  onModeChange: (m: CollabModeDb) => void;
}) {
  const { t } = useCoorgT();
  const [query, setQuery] = useState('');
  const [results, setResults] = useState<CoorgPartnerCandidate[]>([]);
  const [searching, setSearching] = useState(false);
  const [emailOpen, setEmailOpen] = useState(false);
  const [email, setEmail] = useState('');
  const [emailName, setEmailName] = useState('');
  const [emailKind, setEmailKind] = useState<'org' | 'venue'>('org');

  useEffect(() => {
    const q = query.trim();
    if (q.length < 2) { setResults([]); setSearching(false); return; }
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

  const taken = new Set([...drafts.map(partnerDraftKey), ...excludeKeys]);
  const full = drafts.length >= MAX_INVITES;
  const principalWord = (kind: 'org' | 'venue') => (kind === 'venue'
    ? t('Lieu', 'Venue', 'Lugar')
    : t('Organisateur', 'Organizer', 'Organizador'));

  const add = (d: PartnerDraftInput) => {
    const role = defaultRole(d, ctx, drafts);
    if (!role || taken.has(partnerDraftKey(d))) return;
    onChange([...drafts, { ...d, role } as PartnerDraft]);
    setQuery(''); setResults([]); setEmail(''); setEmailName(''); setEmailOpen(false);
  };
  const setRole = (key: string, role: InviteRole) =>
    onChange(drafts.map((d) => (partnerDraftKey(d) === key ? { ...d, role } : d)));
  const remove = (key: string) => onChange(drafts.filter((d) => partnerDraftKey(d) !== key));

  const emailOk = /^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email.trim());
  const emailClubRoles = allowedRoles({ source: 'email', kind: 'venue' }, ctx, drafts);
  const emailClubBlocked = emailClubRoles.length === 0;
  const kindLabel = (k: 'org' | 'venue') => (k === 'venue' ? t('Club', 'Club', 'Club') : t('Organisation', 'Organization', 'Organización'));

  const roleTabs = (d: PartnerDraft) => allowedRoles(d, ctx, drafts.filter((o) => o !== d)).map((r) => ({
    value: r,
    label: r === 'principal' ? principalWord(d.kind) : r === 'editor' ? t('Co-gestion', 'Co-manager', 'Cogestión') : t('Partenaire', 'Partner', 'Socio'),
  }));

  const roleHint = (d: PartnerDraft): string => {
    if (d.role === 'principal') {
      if (d.kind === 'venue') {
        return d.source === 'email'
          ? t('Son club se crée quand il accepte, puis il accueille la soirée : adresse, bar et porte passent à lui.',
            'Their club is created when they accept, then it hosts the event: address, bar and door move to them.',
            'Su club se crea al aceptar y acoge el evento: dirección, barra y puerta pasan a él.')
          : t('Accueille la soirée dès qu’il accepte : adresse, bar et porte passent à son club.',
            'Hosts the event as soon as they accept: address, bar and door move to their club.',
            'Acoge el evento en cuanto acepta: dirección, barra y puerta pasan a su club.');
      }
      return t('Organise la soirée avec toi dès qu’elle accepte, avec sa propre billetterie si vous le décidez.',
        'Runs the event with you as soon as they accept, with their own ticketing if you decide so.',
        'Organiza el evento contigo en cuanto acepta, con su propia taquilla si lo decidís.');
    }
    return d.role === 'editor'
      ? t('Gère aussi la vente et l’habillage de la soirée.', 'Also runs sales and the event’s look.', 'También gestiona la venta y la imagen del evento.')
      : t('Suit la soirée, ses ventes et ses liens, fait sa promo et ses emails.', 'Follows the event, its sales and links, runs its own promo and emails.', 'Sigue el evento, sus ventas y enlaces, hace su promo y sus emails.');
  };

  const MODES: { value: CollabModeDb; label: string; hint: string }[] = [
    { value: 'co_event', label: t('Co-soirée', 'Co-night', 'Co-noche'), hint: t('Vous montez la soirée ensemble.', 'You run the night together.', 'Montáis la noche juntos.') },
    { value: 'venue_rental', label: t('Location de salle', 'Venue rental', 'Alquiler de sala'), hint: t('L’organisation loue le club et encaisse la billetterie ; le bar reste au club.', 'The organization rents the club and keeps ticketing; the bar stays with the club.', 'La organización alquila el club y cobra la taquilla; la barra sigue siendo del club.') },
    { value: 'org_hosted', label: t('Le club pilote', 'Club-run', 'El club dirige'), hint: t('Le club gère la soirée sur place, l’organisation apporte la programmation.', 'The club runs the night on site, the organization brings the lineup.', 'El club gestiona la noche, la organización aporta la programación.') },
  ];

  return (
    <div className="space-y-2">
      {/* Toi d'abord : on voit qui mène avant de voir qui on invite. */}
      <div className="flex items-center gap-2.5 rounded-xl px-3 py-2" style={{ background: INNER_BG, border: `1px solid ${BORDER}` }}>
        <span className="flex h-[30px] w-[30px] flex-none items-center justify-center rounded-full" style={{ background: 'rgba(232,25,44,0.12)', color: RED }}>
          <UserRound className="h-4 w-4" />
        </span>
        <p className="min-w-0 flex-1" style={{ color: T1, fontSize: 12.5, fontWeight: 600 }}>
          {t('Toi', 'You', 'Tú')}
          <span style={{ color: T3, fontWeight: 500 }}> · {t('tu mènes la soirée', 'you run the event', 'tú llevas el evento')}</span>
        </p>
      </div>

      {existing}

      {drafts.map((d) => {
        const key = partnerDraftKey(d);
        const tabs = roleTabs(d);
        return (
          <div key={key} className="space-y-2 rounded-xl px-3 py-2.5" style={{ background: INNER_BG, border: `1px solid ${d.role === 'principal' ? 'rgba(232,25,44,0.35)' : BORDER}` }}>
            <div className="flex flex-wrap items-center gap-2.5">
              {d.source === 'email'
                ? <PartyAvatar name={d.name || d.email} kind={d.kind} size={30} />
                : <PartyAvatar name={d.name} url={d.avatar_url} kind={d.kind} size={30} />}
              <div className="min-w-0 flex-1">
                <p className="truncate" style={{ color: T1, fontSize: 13, fontWeight: 600 }}>{d.source === 'email' ? (d.name || d.email) : d.name}</p>
                <p className="truncate" style={{ color: T3, fontSize: 11 }}>
                  {kindLabel(d.kind)}
                  {d.source === 'email'
                    ? ` · ${t('invitation par email', 'email invitation', 'invitación por email')}${d.name ? ` · ${d.email}` : ''}`
                    : d.city ? ` · ${d.city}` : ''}
                </p>
              </div>
              {tabs.length > 1
                ? <OrgTabs size="sm" value={d.role} onChange={(v) => setRole(key, v)} tabs={tabs} />
                : tabs[0] && <OrgPill tone="default">{tabs[0].label}</OrgPill>}
              <button type="button" onClick={() => remove(key)} className="rounded-lg p-1.5" style={{ color: T3 }}
                aria-label={t('Retirer', 'Remove', 'Quitar')}>
                <X className="h-3.5 w-3.5" />
              </button>
            </div>
            <p style={{ color: T3, fontSize: 11.5, lineHeight: 1.45 }}>{roleHint(d)}</p>
            {d.role === 'principal' && (
              <div className="space-y-1.5 pt-0.5">
                <OrgTabs size="sm" value={mode} onChange={onModeChange} tabs={MODES.map((m) => ({ value: m.value, label: m.label }))} />
                <p style={{ color: T3, fontSize: 11, lineHeight: 1.45 }}>{MODES.find((m) => m.value === mode)?.hint}</p>
              </div>
            )}
          </div>
        );
      })}

      {/* Une seule recherche : clubs et organisations. Hors Yuno : par email. */}
      {!full && (
        <div className="space-y-2 rounded-xl p-2.5" style={{ border: `1px dashed ${BORDER}` }}>
          <div className="relative">
            <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2" style={{ color: T3 }} />
            <DarkInput value={query} onChange={setQuery} className="pl-9"
              placeholder={t('Ajouter un club ou une organisation…', 'Add a club or an organization…', 'Añadir un club o una organización…')} />
          </div>
          {(searching || results.length > 0) && (
            <div className="max-h-60 space-y-1.5 overflow-y-auto">
              {searching && <div className="flex justify-center py-2"><Loader2 className="h-4 w-4 animate-spin" style={{ color: T3 }} /></div>}
              {!searching && results.filter((r) => !taken.has(`${r.kind}:${r.id}`)).map((r) => (
                <button key={`${r.kind}:${r.id}`} type="button"
                  onClick={() => add({ source: 'yuno', kind: r.kind, id: r.id, name: r.name, avatar_url: r.avatar_url, city: r.city })}
                  className="flex w-full items-center gap-3 rounded-xl px-3 py-2 text-left transition-colors hover:bg-[rgb(var(--ink)/0.05)]"
                  style={{ border: `1px solid ${BORDER}` }}>
                  <PartyAvatar name={r.name} url={r.avatar_url} kind={r.kind} size={30} />
                  <span className="min-w-0 flex-1">
                    <span className="block truncate" style={{ color: T1, fontSize: 13, fontWeight: 600 }}>{r.name}</span>
                    <span className="block truncate" style={{ color: T3, fontSize: 11 }}>{kindLabel(r.kind)}{r.city ? ` · ${r.city}` : ''}</span>
                  </span>
                  <Plus className="h-4 w-4 flex-none" style={{ color: T3 }} />
                </button>
              ))}
            </div>
          )}

          {emailOpen ? (
            <div className="space-y-2 rounded-xl p-2.5" style={{ background: INNER_BG, border: `1px solid ${BORDER}` }}>
              <OrgTabs size="sm" value={emailKind} onChange={(v) => setEmailKind(v)} tabs={[
                { value: 'org', label: t('Organisation', 'Organization', 'Organización') },
                { value: 'venue', label: t('Club', 'Club', 'Club') },
              ]} />
              {emailKind === 'venue' && emailClubBlocked ? (
                <p style={{ color: T2, fontSize: 11.5, lineHeight: 1.45 }}>
                  {principalKindFor(ctx.lead) !== 'venue'
                    ? t('Un club hors Yuno ne peut pas encore rejoindre la soirée d’un autre club : invite-le à créer son compte, puis ajoute-le d’ici.',
                      'A club outside Yuno can’t yet join another club’s event: ask them to create their account, then add them here.',
                      'Un club fuera de Yuno aún no puede unirse al evento de otro club: invítalo a crear su cuenta y añádelo desde aquí.')
                    : t('Ta soirée a déjà son lieu. Un autre club devra créer son compte Yuno pour être ajouté en partenaire.',
                      'Your event already has its venue. Another club must create its Yuno account to be added as a partner.',
                      'Tu evento ya tiene su lugar. Otro club debe crear su cuenta Yuno para añadirse como socio.')}
                </p>
              ) : (
                <>
                  <DarkInput type="email" value={email} onChange={setEmail} placeholder={emailKind === 'venue' ? 'contact@club.fr' : 'contact@collectif.fr'} />
                  <DarkInput value={emailName} onChange={setEmailName}
                    placeholder={emailKind === 'venue' ? t('Nom du club', 'Club name', 'Nombre del club') : t('Nom de la structure', 'Organization name', 'Nombre de la estructura')} />
                  <p className="flex items-start gap-1.5" style={{ color: T3, fontSize: 11, lineHeight: 1.45 }}>
                    <Mail className="mt-0.5 h-3 w-3 flex-none" />
                    {t('Un email part à l’enregistrement : il crée son compte avec cette adresse en acceptant. Aucun compte Stripe exigé.',
                      'An email goes out on save: they create their account with this address when accepting. No Stripe account required.',
                      'Se envía un email al guardar: crea su cuenta con esta dirección al aceptar. Sin cuenta de Stripe.')}
                  </p>
                  <div className="flex gap-2">
                    <OrgButton size="sm" variant="secondary" disabled={!emailOk || (emailKind === 'venue' && !emailName.trim())}
                      onClick={() => add({ source: 'email', kind: emailKind, email: email.trim(), name: emailName.trim() })}>
                      <Plus className="h-3.5 w-3.5" /> {t('Ajouter', 'Add', 'Añadir')}
                    </OrgButton>
                    <OrgButton size="sm" variant="ghost" onClick={() => setEmailOpen(false)}>{t('Annuler', 'Cancel', 'Cancelar')}</OrgButton>
                  </div>
                </>
              )}
            </div>
          ) : (
            <button type="button" onClick={() => { setEmailOpen(true); if (query.trim() && !query.includes('@')) setEmailName(query.trim()); if (query.includes('@')) setEmail(query.trim()); }}
              className="flex items-center gap-1.5 px-1" style={{ color: T2, fontSize: 12, fontWeight: 560 }}>
              <Mail className="h-3.5 w-3.5" />
              {query.trim().length >= 2 && !searching && results.length === 0
                ? t(`Personne sous « ${query.trim()} » sur Yuno — l’inviter par email`, `No one called “${query.trim()}” on Yuno — invite them by email`, `Nadie llamado «${query.trim()}» en Yuno — invitar por email`)
                : t('Pas encore sur Yuno ? Inviter par email', 'Not on Yuno yet? Invite by email', '¿Aún no está en Yuno? Invitar por email')}
            </button>
          )}
        </div>
      )}
    </div>
  );
}

/**
 * Contrat Yuno proposé avec l'invitation du lieu / de l'organisateur : la part
 * de l'organisation sur les billets et les tables, le reste au club. Toujours
 * réglé par virement (le lead encaisse puis reverse).
 */
export function YunoSplitFields({ split, onChange, lead, partnerName }: {
  split: YunoSplit;
  onChange: (s: YunoSplit) => void;
  lead: 'organizer' | 'venue';
  partnerName: string;
}) {
  const { t } = useCoorgT();
  const steps = [0, 25, 50, 75, 100];
  const row = (label: string, value: number, set: (n: number) => void) => (
    <div className="flex flex-wrap items-center justify-between gap-2">
      <span style={{ color: T2, fontSize: 12.5 }}>{label}</span>
      <OrgTabs size="sm" value={String(value)} onChange={(v) => set(Number(v))}
        tabs={steps.map((n) => ({ value: String(n), label: `${n} %` }))} />
    </div>
  );
  return (
    <div className="space-y-2.5 rounded-xl p-3" style={{ background: INNER_BG, border: `1px solid ${BORDER}` }}>
      <p style={{ color: T1, fontSize: 12.5, fontWeight: 600 }}>{t('Part de l’organisation', 'Organization’s share', 'Parte de la organización')}</p>
      {row(t('Billets', 'Tickets', 'Entradas'), split.ticketsOrgPct, (n) => onChange({ ...split, ticketsOrgPct: n }))}
      {row(t('Tables VIP', 'VIP tables', 'Mesas VIP'), split.tablesOrgPct, (n) => onChange({ ...split, tablesOrgPct: n }))}
      <p style={{ color: T3, fontSize: 11.5, lineHeight: 1.45 }}>
        {t(
          `Le bar reste au club. ${lead === 'organizer' ? 'Tu encaisses' : 'Ton club encaisse'} les ventes et reverse sa part à ${partnerName} par virement après la soirée. Le contrat part à signer dès qu’il accepte ; la billetterie ferme le temps de sa signature.`,
          `The bar stays with the club. ${lead === 'organizer' ? 'You collect' : 'Your club collects'} sales and transfers ${partnerName}’s share after the event. The contract goes out to sign as soon as they accept; ticketing pauses until they sign.`,
          `La barra sigue siendo del club. ${lead === 'organizer' ? 'Cobras tú' : 'Tu club cobra'} las ventas y transfiere su parte a ${partnerName} tras el evento. El contrato sale a firmar en cuanto acepta; la taquilla se pausa hasta su firma.`,
        )}
      </p>
    </div>
  );
}
