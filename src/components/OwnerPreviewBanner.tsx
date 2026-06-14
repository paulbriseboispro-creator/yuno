import { Link } from 'react-router-dom';
import { Eye, LayoutDashboard } from 'lucide-react';

/**
 * Fixed top banner that appears on all /owner/preview/* pages.
 * Signals "you're in owner preview mode" and provides a one-click
 * return to the dashboard.
 */
export function OwnerPreviewBanner() {
  return (
    <div
      className="fixed top-0 left-0 right-0 z-[200] flex items-center justify-between gap-3 px-4"
      style={{
        height: '44px',
        background: 'rgba(10,10,10,0.85)',
        borderBottom: '1px solid rgba(232,25,44,0.35)',
        backdropFilter: 'blur(16px)',
        WebkitBackdropFilter: 'blur(16px)',
      }}
    >
      <div className="flex items-center gap-2 min-w-0">
        <div
          className="flex items-center justify-center rounded-full flex-shrink-0"
          style={{ width: 22, height: 22, background: 'rgba(232,25,44,0.18)', border: '1px solid rgba(232,25,44,0.4)' }}
        >
          <Eye className="h-3 w-3 text-[#E8192C]" />
        </div>
        <span className="text-[11px] font-medium text-white/60 truncate">
          <span className="text-[#E8192C] font-semibold">Aperçu owner</span>
          <span className="hidden sm:inline"> · tu vois ta page comme tes clients</span>
        </span>
      </div>

      <Link
        to="/owner/dashboard"
        className="flex items-center gap-1.5 flex-shrink-0 rounded-md px-3 py-1 text-[11px] font-semibold text-white transition-opacity hover:opacity-80"
        style={{ background: 'rgba(232,25,44,0.8)' }}
      >
        <LayoutDashboard className="h-3 w-3" />
        <span>Dashboard</span>
      </Link>
    </div>
  );
}
