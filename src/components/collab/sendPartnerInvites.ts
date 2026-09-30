import { supabase } from '@/integrations/supabase/client';
import { inviteCohostByEmail, inviteEventCohost, coorgErrorCode, type PrincipalTerms } from '@/lib/coorg';
import { clubEmailInviteRules, type PartnerDraft } from '@/lib/collabInvite';
import { capturePosthog } from '@/lib/posthog';

/**
 * Envoie les invitations choisies dans « Avec qui ? », une fois la soirée
 * enregistrée. Une à une (la base vérifie doublons, plafond et place du
 * principal). Rend les échecs, ne lève jamais : la soirée existe déjà.
 *
 *  • Sur Yuno → `invite_event_cohost` (rôle + termes du principal).
 *  • Organisation par email → `create_cohost_email_invite` via l'edge.
 *  • Club par email (forcément le LIEU) → `invite-club-collab`, qui crée son
 *    club à l'acceptation et applique le même accord.
 */
export async function sendPartnerInvites(p: {
  eventId: string;
  drafts: PartnerDraft[];
  terms: PrincipalTerms;
  lang: 'fr' | 'en' | 'es';
  /** Organisation qui mène (invitation d'un club par email). */
  organizerUserId?: string | null;
  /** Ville de la soirée, reprise dans la fiche du club invité par email. */
  city?: string | null;
}): Promise<{ sent: number; errors: { name: string; code: string }[] }> {
  const errors: { name: string; code: string }[] = [];
  let sent = 0;
  // Le principal d'abord : s'il échoue (place prise), les autres partent quand même.
  const ordered = [...p.drafts].sort((a, b) => Number(b.role === 'principal') - Number(a.role === 'principal'));
  for (const d of ordered) {
    const principal = d.role === 'principal';
    const access = d.role === 'editor' ? 'editor' : 'viewer';
    try {
      if (d.source === 'yuno') {
        await inviteEventCohost({
          eventId: p.eventId,
          organizerUserId: d.kind === 'org' ? d.id : null,
          venueId: d.kind === 'venue' ? d.id : null,
          access, shareCrm: true, principal, terms: principal ? p.terms : null,
        });
      } else if (d.kind === 'org') {
        await inviteCohostByEmail({
          eventId: p.eventId, email: d.email, name: d.name || null, access, shareCrm: true,
          message: null, lang: p.lang, principal, terms: principal ? p.terms : null,
        });
      } else {
        const { data, error } = await supabase.functions.invoke('invite-club-collab', {
          body: {
            club_name: d.name, club_email: d.email, club_city: p.city ?? null,
            event_id: p.eventId, organizer_user_id: p.organizerUserId ?? null,
            default_split_rules: clubEmailInviteRules(p.terms), lang: p.lang, origin: window.location.origin,
          },
        });
        if (error) {
          let msg = error.message;
          try { msg = (await (error as { context?: Response }).context?.json())?.error ?? msg; } catch { /* corps illisible */ }
          throw new Error(msg);
        }
        if ((data as { error?: string } | null)?.error) throw new Error((data as { error: string }).error);
      }
      sent += 1;
      capturePosthog('coorg_cohost_invited', {
        event_id: p.eventId, cohost_kind: d.kind, access, source: 'event_form',
        principal, via: d.source, agreement: principal ? p.terms.agreement : undefined,
      });
    } catch (err) {
      errors.push({ name: d.source === 'email' ? (d.name || d.email) : d.name, code: coorgErrorCode(err) });
    }
  }
  return { sent, errors };
}
