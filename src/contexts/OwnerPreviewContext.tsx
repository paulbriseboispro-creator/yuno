import { createContext, useContext, useCallback } from 'react';
import { useNavigate, NavigateOptions, type To } from 'react-router-dom';

interface OwnerPreviewContextValue {
  isPreview: boolean;
}

export const OwnerPreviewContext = createContext<OwnerPreviewContextValue>({ isPreview: false });

export function useOwnerPreview() {
  return useContext(OwnerPreviewContext);
}

/**
 * Drop-in replacement for useNavigate inside owner preview pages.
 * When in preview mode, any /club/:slug/... path is transparently
 * rewritten to /owner/preview/:slug/... so navigation stays inside
 * the protected preview scope.
 */
export function usePreviewNavigate() {
  const navigate = useNavigate();
  const { isPreview } = useOwnerPreview();

  return useCallback(
    (to: string | number, options?: NavigateOptions) => {
      if (typeof to === 'string' && isPreview && to.startsWith('/club/')) {
        navigate(to.replace('/club/', '/owner/preview/'), options);
      } else {
        // `to` is a number only for history deltas; react-router routes that
        // through the same call at runtime.
        navigate(to as To, options);
      }
    },
    [navigate, isPreview],
  );
}
