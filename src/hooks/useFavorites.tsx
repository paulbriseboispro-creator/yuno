import { useCallback } from 'react';
import { toast } from 'sonner';
import { haptics } from '@/lib/haptics';
import { useLanguage } from '@/contexts/LanguageContext';
import { useFavoritesContext, FavoriteType, isSubscriptionType, type Favorite } from '@/contexts/FavoritesContext';

export type { FavoriteType, Favorite };
export { isSubscriptionType };

export function useFavorites() {
  const { t } = useLanguage();
  const {
    favorites,
    loading,
    refetch,
    isFavorite,
    toggleFavorite: toggleFavoriteInContext,
    getFavoritesByType,
  } = useFavoritesContext();

  const toggleFavorite = useCallback(
    async (type: FavoriteType, id: string) => {
      const sub = isSubscriptionType(type);

      // Haptique ICI (et pas dans FavoriteButton) : les cœurs des cartes Explore,
      // des pages affiliées et de Welcome appellent toggleFavorite EN DIRECT sans
      // passer par le composant bouton — un haptique posé sur le bouton seul ne
      // se déclenchait donc jamais sur la majorité des surfaces.
      // Immédiat (avant l'await réseau) : le pouce doit sentir le tap, pas la latence.
      const willActivate = !isFavorite(type, id);
      if (willActivate) haptics.success();
      else haptics.selection();

      try {
        const result = await toggleFavoriteInContext(type, id);

        if (result === 'login_required') {
          haptics.error();
          toast.error(sub ? t('subscribe.loginRequired') : t('favorites.loginRequired'));
          return;
        }

        if (sub) {
          toast.success(result === 'added' ? t('subscribe.added') : t('subscribe.removed'));
        } else {
          toast.success(result === 'added' ? t('favorites.added') : t('favorites.removed'));
        }
      } catch (error) {
        console.error('Error toggling favorite:', error);
        haptics.error();
        toast.error(sub ? t('subscribe.error') : t('favorites.error'));
      }
    },
    [t, toggleFavoriteInContext, isFavorite]
  );

  return {
    favorites,
    loading,
    isFavorite,
    toggleFavorite,
    getFavoritesByType,
    refetch,
  };
}
