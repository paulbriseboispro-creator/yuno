import { useEffect, useState } from 'react';
import { Loader2, Mail, Plus, Search, X } from 'lucide-react';
import { OrgButton, OrgTabs, DarkInput, T1, T2, T3, BORDER, INNER_BG } from '@/components/org-ui';
import {
  searchCoorgPartners, inviteEventCohost, inviteCohostByEmail, coorgErrorCode,
  type CoorgPartnerCandidate, type CohostAccess,
} from '@/lib/coorg';
import { PartyAvatar, useCoorgT } from './coorgUi';
import { capturePosthog } from '@/lib/posthog';

/**
 * Une organisation partenaire choisie DANS le formulaire de soirée, invitée à
 * l'enregistrement. Sur Yuno (annuaire) ou par email (pas encore de compte).
 */
export type CohostDraft =
  | { kind: 'org' | 'venue'; id: string; name: string; avatar_url: string | null; city: string | null; access: CohostAccess }
  | { kind: 'email'; email: string; name: string; access: CohostAccess };

export const draftKey = (d: CohostDraft) => (d.kind === 'email' ? `email:${d.email.toLowerCase()}` : `${d.kind}:${d.id}`);

/**
 * « Organisations partenaires » : l'organisateur principal ajoute, dès la
 * création, les structures avec qui il fait la soirée. Rôle par défaut
 * PARTENAIRE (lecture) : il suit les ventes, ses propres ventes et ses liens,
 * fait sa promo et ses emails ; billets, tables et guest list restent au
 * principal. « Co-gestion » ouvre aussi la vente et l'habillage.
 */
export function CohostDraftPicker({ drafts, onChange, excludeKeys = [] }: {
  drafts: CohostDraft[];
  onChange: (d: CohostDraft[]) => void;
  /** Parties déjà sur la soirée (l'appelant, son partenaire club) : jamais proposées. */
  excludeKeys?: string[];
}) {
  const { t } = useCoorgT();
  const [open, setOpen] = useState(false);
  const [mode, setMode] = useState<'search' | 'email'>('search');
  const [query, setQuery] = useState('');
  const [results, setResults] = useState<CoorgPartnerCandidate[]>([]);
  const [searching, setSearching] = useState(false);
  const [email, setEmail] = useState('');
  const [emailName, setEmailName] = useState('');

  useEffect(() => {
    const q = query.trim();
    if (!open || mode !== 'search' || q.length < 2) { setResults([]); return; }
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
  }, [query, open, mode]);

  const taken = new Set([...drafts.map(draftKey), ...excludeKeys]);
  const add = (d: CohostDraft) => {
    if (taken.has(draftKey(d))) return;
    onChange([...drafts, d]);
    setQuery(''); setResults([]); setEmail(''); setEmailName(''); setOpen(false); setMode('search');
  };
  const setAccess = (key: string, access: CohostAccess) =>
    onChange(drafts.map((d) => (draftKey(d) === key ? { ...d, access } : d)));
  const remove = (key: string) => onChange(drafts.filter((d) => draftKey(d) !== key));
  const emailOk = /^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email.trim());

  return (
    <div className="space-y-2">
      {drafts.map((d) => {
        const key = draftKey(d);
        return (
          <div key={key} className="flex flex-wrap items-center gap-2.5 rounded-xl px-3 py-2.5" style={{ background: INNER_BG, border: `1px solid ${BORDER}` }}>
            {d.kind === 'email'
              ? <PartyAvatar name={d.name || d.email} kind="org" />
              : <PartyAvatar name={d.name} url={d.avatar_url} kind={d.kind} />}
            <div className="min-w-0 flex-1">
              <p className="truncate" style={{ color: T1, fontSize: 13, fontWeight: 600 }}>{d.kind === 'email' ? (d.name || d.email) : d.name}</p>
              <p className="truncate" style={{ color: T3, fontSize: 11 }}>
                {d.kind === 'email'
                  ? `${d.name ? `${d.email} · ` : ''}${t('invitation par email', 'email invitation', 'invitación por email')}`
                  : `${d.kind === 'venue' ? t('Club', 'Club', 'Club') : t('Organisateur', 'Organizer', 'Organizador')}${d.city ? ` · ${d.city}` : ''}`}
              </p>
            </div>
            <OrgTabs
              size="sm"
              value={d.access}
              onChange={(v) => setAccess(key, v as CohostAccess)}
              tabs={[
                { value: 'viewer', label: t('Partenaire', 'Partner', 'Socio') },
                { value: 'editor', label: t('Co-gestion', 'Co-manager', 'Cogestión') },
              ]}
            />
            <button type="button" onClick={() => remove(key)} className="rounded-lg p-1.5" style={{ color: T3 }}
              aria-label={t('Retirer', 'Remove', 'Quitar')}>
              <X className="h-3.5 w-3.5" />
            </button>
          </div>
        );
      })}

      {open ? (
        <div className="space-y-2.5 rounded-xl p-3" style={{ background: INNER_BG, border: `1px solid ${BORDER}` }}>
          <OrgTabs
            size="sm"
            value={mode}
            onChange={(v) => setMode(v as 'search' | 'email')}
            tabs={[
              { value: 'search', label: t('Sur Yuno', 'On Yuno', 'En Yuno') },
              { value: 'email', label: t('Pas encore sur Yuno', 'Not on Yuno yet', 'Aún no en Yuno') },
            ]}
          />
          {mode === 'search' ? (
            <>
              <div className="relative">
                <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2" style={{ color: T3 }} />
                <DarkInput value={query} onChange={setQuery} className="pl-9"
                  placeholder={t('Nom de l’orga ou du club, ville…', 'Organizer or club name, city…', 'Nombre del organizador o club, ciudad…')} />
              </div>
              <div className="max-h-56 space-y-1.5 overflow-y-auto">
                {searching && <div className="flex justify-center py-3"><Loader2 className="h-4 w-4 animate-spin" style={{ color: T3 }} /></div>}
                {!searching && query.trim().length >= 2 && results.length === 0 && (
                  <button type="button" onClick={() => { setEmailName(query.trim()); setMode('email'); }}
                    className="w-full py-2 text-center" style={{ color: T2, fontSize: 12 }}>
                    {t('Personne sous ce nom — l’inviter par email', 'No one by that name — invite them by email', 'Nadie con ese nombre — invitar por email')}
                  </button>
                )}
                {results.filter((r) => !taken.has(`${r.kind}:${r.id}`)).map((r) => (
                  <button key={`${r.kind}:${r.id}`} type="button"
                    onClick={() => add({ kind: r.kind, id: r.id, name: r.name, avatar_url: r.avatar_url, city: r.city, access: 'viewer' })}
                    className="flex w-full items-center gap-3 rounded-xl px-3 py-2 text-left transition-colors hover:bg-[rgb(var(--ink)/0.05)]"
                    style={{ border: `1px solid ${BORDER}` }}>
                    <PartyAvatar name={r.name} url={r.avatar_url} kind={r.kind} />
                    <span className="min-w-0 flex-1">
                      <span className="block truncate" style={{ color: T1, fontSize: 13, fontWeight: 600 }}>{r.name}</span>
                      <span className="block truncate" style={{ color: T3, fontSize: 11 }}>
                        {r.kind === 'venue' ? t('Club', 'Club', 'Club') : t('Organisateur', 'Organizer', 'Organizador')}{r.city ? ` · ${r.city}` : ''}
                      </span>
                    </span>
                  </button>
                ))}
              </div>
            </>
          ) : (
            <div className="space-y-2">
              <DarkInput type="email" value={email} onChange={setEmail} placeholder="contact@collectif.fr" />
              <DarkInput value={emailName} onChange={setEmailName} placeholder={t('Nom de la structure', 'Organization name', 'Nombre de la estructura')} />
              <p className="flex items-start gap-1.5" style={{ color: T3, fontSize: 11, lineHeight: 1.45 }}>
                <Mail className="mt-0.5 h-3 w-3 flex-none" />
                {t('Elle reçoit un lien, crée son compte avec cette adresse et rejoint la soirée. Aucun compte Stripe exigé.',
                  'They get a link, create their account with this address and join the event. No Stripe account required.',
                  'Recibe un enlace, crea su cuenta con esta dirección y se une al evento. Sin cuenta de Stripe.')}
              </p>
              <OrgButton size="sm" variant="secondary" disabled={!emailOk}
                onClick={() => add({ kind: 'email', email: email.trim(), name: emailName.trim(), access: 'viewer' })}>
                <Plus className="h-3.5 w-3.5" /> {t('Ajouter', 'Add', 'Añadir')}
              </OrgButton>
            </div>
          )}
          <div className="flex justify-end">
            <OrgButton size="sm" variant="ghost" onClick={() => { setOpen(false); setMode('search'); setQuery(''); }}>
              {t('Fermer', 'Close', 'Cerrar')}
            </OrgButton>
          </div>
        </div>
      ) : (
        <OrgButton size="sm" variant="secondary" onClick={() => setOpen(true)} disabled={drafts.length >= 8}>
          <Plus className="h-3.5 w-3.5" /> {t('Ajouter une organisation partenaire', 'Add a partner organization', 'Añadir una organización socia')}
        </OrgButton>
      )}
    </div>
  );
}

/**
 * Invite chaque organisation choisie dans le formulaire, une fois la soirée
 * enregistrée. Toujours CRM partagé (la case du checkout la nommera dès
 * qu'elle a accepté). Rend les échecs, jamais ne lève : la soirée existe déjà.
 */
export async function sendCohostDrafts(
  eventId: string,
  drafts: CohostDraft[],
  lang: 'fr' | 'en' | 'es',
): Promise<{ sent: number; errors: { name: string; code: string }[] }> {
  const errors: { name: string; code: string }[] = [];
  let sent = 0;
  // Une à une : l'invitation vérifie le plafond de co-hôtes et les doublons.
  for (const d of drafts) {
    try {
      if (d.kind === 'email') {
        await inviteCohostByEmail({ eventId, email: d.email, name: d.name || null, access: d.access, shareCrm: true, message: null, lang });
      } else {
        await inviteEventCohost({
          eventId,
          organizerUserId: d.kind === 'org' ? d.id : null,
          venueId: d.kind === 'venue' ? d.id : null,
          access: d.access, shareCrm: true,
        });
      }
      sent += 1;
      capturePosthog('coorg_cohost_invited', { event_id: eventId, cohost_kind: d.kind, access: d.access, source: 'event_form' });
    } catch (err) {
      errors.push({ name: d.kind === 'email' ? (d.name || d.email) : d.name, code: coorgErrorCode(err) });
    }
  }
  return { sent, errors };
}
