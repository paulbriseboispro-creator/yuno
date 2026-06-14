import React, { createContext, useContext } from 'react';

type DashboardMode = 'owner' | 'manager' | 'organizer';

interface DashboardModeContextType {
  mode: DashboardMode;
  basePath: string;
}

const DashboardModeContext = createContext<DashboardModeContextType | undefined>(undefined);

export function DashboardModeProvider({
  children,
  mode,
}: {
  children: React.ReactNode;
  mode: DashboardMode;
}) {
  const basePath =
    mode === 'manager' ? '/manager' : mode === 'organizer' ? '/organizer-app' : '/owner';

  return (
    <DashboardModeContext.Provider value={{ mode, basePath }}>
      {children}
    </DashboardModeContext.Provider>
  );
}

export function useDashboardMode(): DashboardModeContextType {
  const context = useContext(DashboardModeContext);
  // Default to owner mode if not in a provider
  if (!context) {
    return { mode: 'owner', basePath: '/owner' };
  }
  return context;
}
