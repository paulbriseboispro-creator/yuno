import type React from "react";
import { cn } from "@/lib/utils";
import { PRO_PAGE, proSkeletonVariantForPath, type ProSkeletonVariant } from "@/lib/proLayout";
import { useDashboardMode } from "@/contexts/DashboardModeContext";
import { OwnerHeader } from "@/components/OwnerHeader";

function Bone({ className, style }: { className?: string; style?: React.CSSProperties }) {
  return (
    <div className={cn("animate-pulse rounded-xl bg-white/5", className)} style={style} />
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

/* ============================================================
   ProPageSkeleton — silhouette d'une page de la Console.
   ------------------------------------------------------------
   Un seul gabarit générique (KPI + liste, centré en 4xl) servait
   toutes les pages : une page de formulaire, un tableau de commandes
   ou une grille de cartes « sautaient » à l'arrivée des données, et
   la Console Organisateur voyait un deuxième en-tête s'empiler sous
   celui de son layout. Ici :
   • pleine largeur, mêmes gouttières que la page (PRO_PAGE) ;
   • le VRAI en-tête de la page quand on connaît son titre (club,
     manager) — rien ne clignote en haut — et aucun en-tête doublé
     côté organisateur / agence, dont le layout a déjà sa barre ;
   • une silhouette par FORME de page (`variant`).
   ============================================================ */

export type { ProSkeletonVariant };

function SkCard({ className, children }: { className?: string; children: React.ReactNode }) {
  return <div className={cn("rounded-2xl border border-white/[0.06] bg-card p-4 sm:p-5", className)}>{children}</div>;
}

function KpiRow({ n = 4 }: { n?: number }) {
  return (
    <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
      {Array.from({ length: n }).map((_, i) => (
        <SkCard key={i} className="space-y-3">
          <Bone className="h-3 w-24 rounded-md" />
          <Bone className="h-7 w-20 rounded-md" />
          <Bone className="h-2.5 w-28 rounded-md" />
        </SkCard>
      ))}
    </div>
  );
}

function Toolbar() {
  return (
    <div className="flex flex-wrap items-center gap-2">
      <Bone className="h-9 w-full max-w-sm rounded-lg" />
      <Bone className="h-9 w-24 rounded-lg" />
      <Bone className="h-9 w-24 rounded-lg" />
      <Bone className="ml-auto h-9 w-32 rounded-lg" />
    </div>
  );
}

function SkeletonBody({ variant }: { variant: ProSkeletonVariant }) {
  switch (variant) {
    case 'table':
      return (
        <>
          <Toolbar />
          <SkCard className="space-y-0 p-0 sm:p-0 overflow-hidden">
            <div className="flex gap-4 border-b border-white/[0.06] px-4 py-3">
              {[20, 14, 12, 12, 10, 8].map((w, i) => <Bone key={i} className="h-3 rounded-md" style={{ width: `${w}%` }} />)}
            </div>
            {Array.from({ length: 9 }).map((_, i) => (
              <div key={i} className="flex items-center gap-4 border-b border-white/[0.04] px-4 py-3.5 last:border-0">
                {[20, 14, 12, 12, 10, 8].map((w, j) => <Bone key={j} className="h-3.5 rounded-md" style={{ width: `${w}%` }} />)}
              </div>
            ))}
          </SkCard>
        </>
      );
    case 'cards':
      return (
        <>
          <Toolbar />
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-3 2xl:grid-cols-4">
            {Array.from({ length: 8 }).map((_, i) => (
              <SkCard key={i} className="space-y-3">
                <Bone className="h-32 w-full rounded-xl" />
                <Bone className="h-4 w-3/4 rounded-md" />
                <Bone className="h-3 w-1/2 rounded-md" />
                <div className="flex gap-2 pt-1">
                  <Bone className="h-7 w-20 rounded-lg" />
                  <Bone className="h-7 w-16 rounded-lg" />
                </div>
              </SkCard>
            ))}
          </div>
        </>
      );
    case 'analytics':
      return (
        <>
          <div className="flex flex-wrap gap-2">
            {Array.from({ length: 4 }).map((_, i) => <Bone key={i} className="h-9 w-28 rounded-lg" />)}
            <Bone className="ml-auto h-9 w-40 rounded-lg" />
          </div>
          <KpiRow />
          <SkCard className="space-y-4">
            <div className="flex items-center justify-between">
              <Bone className="h-5 w-32 rounded-md" />
              <Bone className="h-8 w-28 rounded-lg" />
            </div>
            <Bone className="h-64 w-full rounded-xl" />
          </SkCard>
          <div className="grid grid-cols-1 gap-3 xl:grid-cols-2">
            {Array.from({ length: 2 }).map((_, i) => (
              <SkCard key={i} className="space-y-3">
                <Bone className="h-5 w-40 rounded-md" />
                <Bone className="h-44 w-full rounded-xl" />
              </SkCard>
            ))}
          </div>
        </>
      );
    case 'form':
      return (
        <div className="grid grid-cols-1 gap-4 xl:grid-cols-2">
          {Array.from({ length: 4 }).map((_, i) => (
            <SkCard key={i} className="space-y-4">
              <div className="space-y-2">
                <Bone className="h-5 w-44 rounded-md" />
                <Bone className="h-3 w-64 max-w-full rounded-md" />
              </div>
              {Array.from({ length: i % 2 ? 2 : 3 }).map((_, j) => (
                <div key={j} className="space-y-2">
                  <Bone className="h-3 w-24 rounded-md" />
                  <Bone className="h-10 w-full rounded-lg" />
                </div>
              ))}
            </SkCard>
          ))}
        </div>
      );
    case 'detail':
      return (
        <>
          <SkCard className="flex items-center gap-4">
            <Bone className="h-20 w-20 shrink-0 rounded-2xl" />
            <div className="flex-1 space-y-2">
              <Bone className="h-6 w-56 max-w-full rounded-md" />
              <Bone className="h-3 w-40 rounded-md" />
            </div>
            <Bone className="hidden h-9 w-28 rounded-lg sm:block" />
          </SkCard>
          <div className="flex gap-2">
            {Array.from({ length: 4 }).map((_, i) => <Bone key={i} className="h-9 w-24 rounded-lg" />)}
          </div>
          <div className="grid grid-cols-1 gap-4 xl:grid-cols-[minmax(0,2fr)_minmax(0,1fr)]">
            <SkCard className="space-y-3">
              {Array.from({ length: 6 }).map((_, i) => <Bone key={i} className="h-12 w-full rounded-lg" />)}
            </SkCard>
            <SkCard className="space-y-3">
              {Array.from({ length: 4 }).map((_, i) => <Bone key={i} className="h-10 w-full rounded-lg" />)}
            </SkCard>
          </div>
        </>
      );
    case 'list':
    default:
      return (
        <>
          <KpiRow />
          <Toolbar />
          <SkCard className="space-y-1">
            {Array.from({ length: 7 }).map((_, i) => (
              <div key={i} className="flex items-center gap-3 py-2">
                <Bone className="h-10 w-10 shrink-0 rounded-xl" />
                <div className="flex-1 space-y-2">
                  <Bone className="h-3.5 w-2/5 rounded-md" />
                  <Bone className="h-2.5 w-1/4 rounded-md" />
                </div>
                <Bone className="hidden h-3 w-24 rounded-md md:block" />
                <Bone className="h-6 w-16 shrink-0 rounded-full" />
              </div>
            ))}
          </SkCard>
        </>
      );
  }
}

export function ProPageSkeleton({ variant = 'list', title }: { variant?: ProSkeletonVariant; title?: string }) {
  const { mode } = useDashboardMode();
  // Organisateur / agence : le layout porte déjà la barre du haut.
  const layoutHasHeader = mode === 'organizer' || mode === 'agency';
  return (
    <div className="min-h-screen pb-24" aria-busy="true">
      {!layoutHasHeader && (title ? <OwnerHeader title={title} /> : (
        <div className="sticky top-0 z-40 border-b border-white/[0.06] bg-background/60 backdrop-blur-xl">
          <div className="flex h-14 w-full items-center justify-between px-3 sm:h-16 sm:px-6">
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
      ))}
      <div className={cn(PRO_PAGE, "space-y-4 pt-4")}>
        {layoutHasHeader && (title
          ? <h1 className="text-lg font-semibold tracking-tight">{title}</h1>
          : <Bone className="h-6 w-48 rounded-md" />)}
        <SkeletonBody variant={variant} />
      </div>
    </div>
  );
}

/** Ancien nom, gardé pour les pages qui n'ont pas encore choisi leur forme. */
export function OwnerPageSkeleton(props: { variant?: ProSkeletonVariant; title?: string }) {
  return <ProPageSkeleton {...props} />;
}

/**
 * Full-page skeleton with a sidebar silhouette on the left.
 * Used as the app-wide Suspense fallback.
 */
export function AppSkeleton({ path }: { path?: string } = {}) {
  const variant = path ? proSkeletonVariantForPath(path) : 'dashboard';
  return (
    <div className="flex h-screen bg-background overflow-hidden">
      {/* Sidebar silhouette — même largeur (16rem) et même panneau flottant
          que la vraie barre latérale : rien ne saute quand elle arrive. */}
      <div className="hidden md:block w-64 shrink-0 p-2">
        <div className="flex h-full flex-col gap-2 rounded-xl border border-white/[0.06] bg-sidebar p-3">
          <div className="flex items-center gap-2.5 pb-3">
            <div className="h-8 w-8 rounded-lg bg-white/10 animate-pulse" />
            <div className="flex-1 space-y-1.5">
              <div className="h-3 w-24 rounded bg-white/10 animate-pulse" />
              <div className="h-2.5 w-20 rounded bg-white/5 animate-pulse" />
            </div>
          </div>
          {[4, 5, 3, 4].map((n, g) => (
            <div key={g} className="space-y-1.5 pb-3">
              <div className="h-2.5 w-16 rounded bg-white/5 animate-pulse" />
              {Array.from({ length: n }).map((_, i) => (
                <div key={i} className="h-7 w-full rounded-md bg-white/[0.04] animate-pulse" />
              ))}
            </div>
          ))}
        </div>
      </div>
      {/* Content area */}
      <div className="flex-1 overflow-y-auto">
        {variant === 'dashboard' ? <DashboardSkeleton /> : <ProPageSkeleton variant={variant} />}
      </div>
    </div>
  );
}
