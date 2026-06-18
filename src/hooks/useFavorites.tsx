import { useCallback } from 'react';
import { toast } from 'sonner';
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
      try {
        const result = await toggleFavoriteInContext(type, id);

        if (result === 'login_required') {
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
        toast.error(sub ? t('subscribe.error') : t('favorites.error'));
      }
    },
    [t, toggleFavoriteInContext]
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
