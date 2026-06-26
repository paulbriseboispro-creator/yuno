import { CollabProposalsInbox } from '@/components/collab/CollabProposalsInbox';

/**
 * Organizer-side inbox of co-event proposals awaiting this org's signature.
 * Thin wrapper over the shared, role-aware {@link CollabProposalsInbox} — the
 * club dashboard renders the same surface with role="venue". Kept as a named
 * export so existing call sites (OrgAppDashboard, OrgAppCollaborations) are
 * unchanged.
 */
export function OrgPendingProposals() {
  return <CollabProposalsInbox role="organizer" />;
}
