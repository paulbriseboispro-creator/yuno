import CollabEventDetail from '@/components/collab/CollabEventDetail';

/**
 * Organizer event detail (/organizer-app/events/:eventId). Renders the shared
 * collaboration dashboard in organizer scope — the same page the club sees at
 * /owner/collab/event/:eventId, so both entities have identical transparency.
 */
export default function OrgAppEventDetail() {
  return <CollabEventDetail viewerRole="organizer" />;
}
