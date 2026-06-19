import OwnerHelpCenter from './OwnerHelpCenter';
import { organizerHelpCategories } from '@/data/organizerHelpContent';

/**
 * Organizer help center. Reuses the shared OwnerHelpCenter rendering engine
 * (search, categories, callouts, screenshots, glossary) but feeds it the
 * organizer-specific content. actionLinks auto-prepend the `/organizer-app`
 * basePath via DashboardModeContext (mode="organizer").
 */
export default function OrganizerHelpCenter() {
  return <OwnerHelpCenter categories={organizerHelpCategories} />;
}
