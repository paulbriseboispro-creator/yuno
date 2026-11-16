/**
 * Les fenêtres (Dialog, Drawer, palette) sortent du flux par un portail. Pour
 * garder les variables du kit, elles se montent DANS la coquille (`[data-admin]`),
 * jamais sur `document.body`.
 */
import { createContext, useContext } from 'react';

export const AdminPortalContext = createContext<HTMLElement | null>(null);

export function useAdminPortal(): HTMLElement | null {
  return useContext(AdminPortalContext);
}
