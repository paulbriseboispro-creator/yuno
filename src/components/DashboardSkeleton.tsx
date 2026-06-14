import { cn } from "@/lib/utils";

function Bone({ className }: { className?: string }) {
  return (
    <div className={cn("animate-pulse rounded-xl bg-white/5", className)} />
  );
}

/** Skeleton that matches the OwnerDashboard grid layout. */
export function DashboardSkeleton({ className }: { className?: string }) {
  return (
    <div className={cn("p-4 md:p-6 min-h-full", className)}>
      {/* AppHeader row */}
      <div className="mb-6 flex items-center justify-between">
        <div className="flex items-center gap-3">
          <Bone className="h-8 w-8 rounded-md" />
          <Bone className="h-4 w-px rounded-none" />
        </div>
        <div className="flex items-center gap-3">
          <Bone className="h-6 w-16 rounded-full" />
          <Bone className="h-4 w-px rounded-none" />
          <Bone className="h-8 w-8 rounded-full" />
        </div>
      </div>

      <div className="space-y-4">
        {/* 4 stat cards */}
        <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
          {Array.from({ length: 4 }).map((_, i) => (
            <div key={i} className="rounded-xl border border-white/[0.06] bg-card p-5 space-y-4">
              <Bone className="h-3 w-24 rounded-md" />
              <Bone className="h-7 w-20 rounded-md" />
              <Bone className="h-3 w-32 rounded-md" />
            </div>
          ))}
        </div>

        {/* Full-width chart */}
        <div className="rounded-xl border border-white/[0.06] bg-card p-5 space-y-4">
          <div className="flex items-center justify-between">
            <Bone className="h-5 w-24 rounded-md" />
            <Bone className="h-8 w-32 rounded-lg" />
          </div>
          <Bone className="h-56 w-full rounded-lg" />
          <Bone className="h-3 w-40 rounded-md" />
        </div>

        {/* Next event hero */}
        <div className="rounded-xl border border-white/[0.06] bg-card overflow-hidden">
          <div className="grid md:grid-cols-[260px_1fr]">
            <Bone className="h-44 md:h-52 rounded-none" />
            <div className="p-5 space-y-4">
              <div className="space-y-2">
                <Bone className="h-6 w-48 rounded-md" />
                <Bone className="h-3 w-36 rounded-md" />
              </div>
              <div className="grid grid-cols-4 gap-2">
                {Array.from({ length: 4 }).map((_, i) => (
                  <Bone key={i} className="h-16 rounded-lg" />
                ))}
              </div>
              <div className="flex gap-2">
                <Bone className="h-8 w-24 rounded-lg" />
                <Bone className="h-8 w-28 rounded-lg" />
              </div>
            </div>
          </div>
        </div>

        {/* Bottom row: activity chart + donut + quick actions */}
        <div className="grid grid-cols-1 gap-4 md:grid-cols-2 lg:grid-cols-3">
          <div className="rounded-xl border border-white/[0.06] bg-card p-5 space-y-4 md:col-span-2 lg:col-span-1">
            <Bone className="h-5 w-32 rounded-md" />
            <Bone className="h-48 w-full rounded-lg" />
          </div>
          <div className="rounded-xl border border-white/[0.06] bg-card p-5 space-y-4">
            <Bone className="h-5 w-40 rounded-md" />
            <Bone className="h-48 w-full rounded-lg" />
          </div>
          <div className="rounded-xl border border-white/[0.06] bg-card p-5 space-y-4">
            <Bone className="h-5 w-28 rounded-md" />
            {Array.from({ length: 4 }).map((_, i) => (
              <div key={i} className="flex items-center gap-3">
                <Bone className="h-9 w-9 rounded-lg shrink-0" />
                <div className="flex-1 space-y-1.5">
                  <Bone className="h-3 w-3/4 rounded-md" />
                  <Bone className="h-2.5 w-1/2 rounded-md" />
                </div>
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}

/**
 * Content-area skeleton for Owner sub-pages (already inside the app layout).
 * Mimics OwnerHeader + typical card grid below.
 */
export function OwnerPageSkeleton() {
  return (
    <div className="min-h-screen dashboard-gradient-bg pb-24">
      {/* OwnerHeader silhouette */}
      <div className="sticky top-0 z-40 border-b border-white/[0.06] bg-background/60 backdrop-blur-xl">
        <div className="mx-auto flex h-14 sm:h-16 max-w-7xl items-center justify-between px-3 sm:px-4">
          <div className="flex items-center gap-3">
            <Bone className="h-9 w-9 rounded-lg" />
            <Bone className="h-5 w-36 rounded-md" />
          </div>
          <div className="flex items-center gap-2">
            <Bone className="h-9 w-9 rounded-lg" />
            <Bone className="h-9 w-9 rounded-lg" />
          </div>
        </div>
      </div>

      {/* Content area */}
      <div className="p-4 space-y-4 max-w-4xl mx-auto">
        {/* KPI row */}
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
          {Array.from({ length: 4 }).map((_, i) => (
            <div key={i} className="rounded-xl border border-white/[0.06] bg-card p-4 space-y-3">
              <Bone className="h-4 w-4 rounded-full mx-auto" />
              <Bone className="h-7 w-16 rounded-md mx-auto" />
              <Bone className="h-3 w-20 rounded-md mx-auto" />
            </div>
          ))}
        </div>

        {/* Main list/table card */}
        <div className="rounded-xl border border-white/[0.06] bg-card p-4 space-y-3">
          <div className="flex items-center justify-between mb-2">
            <Bone className="h-5 w-32 rounded-md" />
            <Bone className="h-8 w-24 rounded-lg" />
          </div>
          {Array.from({ length: 5 }).map((_, i) => (
            <div key={i} className="flex items-center gap-3 py-2">
              <Bone className="h-10 w-10 rounded-full shrink-0" />
              <div className="flex-1 space-y-2">
                <Bone className="h-3 w-3/4 rounded-md" />
                <Bone className="h-2.5 w-1/2 rounded-md" />
              </div>
              <Bone className="h-6 w-14 rounded-full shrink-0" />
            </div>
          ))}
        </div>

        {/* Secondary card */}
        <div className="rounded-xl border border-white/[0.06] bg-card p-4 space-y-3">
          <Bone className="h-5 w-40 rounded-md" />
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            {Array.from({ length: 4 }).map((_, i) => (
              <Bone key={i} className="h-16 rounded-lg" />
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}

/**
 * Full-page skeleton with a sidebar silhouette on the left.
 * Used as the app-wide Suspense fallback.
 */
export function AppSkeleton() {
  return (
    <div className="flex h-screen bg-background overflow-hidden">
      {/* Sidebar silhouette */}
      <div className="hidden md:flex flex-col w-14 border-r border-white/[0.06] bg-sidebar py-3 gap-3 items-center">
        <div className="h-8 w-8 rounded-lg bg-white/10 animate-pulse" />
        <div className="mt-2 flex flex-col gap-2 w-full px-2">
          {Array.from({ length: 8 }).map((_, i) => (
            <div key={i} className="h-8 w-full rounded-md bg-white/5 animate-pulse" />
          ))}
        </div>
      </div>
      {/* Content area */}
      <div className="flex-1 overflow-y-auto">
        <DashboardSkeleton />
      </div>
    </div>
  );
}
