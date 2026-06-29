import CollabEventDetail from '@/components/collab/CollabEventDetail';

/**
 * Club co-event dashboard (/owner/collab/event/:eventId). Renders the shared
 * collaboration dashboard in venue scope — adopting the organizer's layout, with
 * every transparency surface mirrored so the club and the organizer see the same
 * information about the night.
 */
export default function OwnerCollabEventDashboard() {
  return <CollabEventDetail viewerRole="venue" />;
}
