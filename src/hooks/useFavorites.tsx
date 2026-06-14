import { useCallback } from 'react';
import { toast } from 'sonner';
import { useLanguage } from '@/contexts/LanguageContext';
import { useFavoritesContext, FavoriteType, type Favorite } from '@/contexts/FavoritesContext';

export type { FavoriteType, Favorite };

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
      try {
        const result = await toggleFavoriteInContext(type, id);

        if (result === 'login_required') {
          toast.error(t('favorites.loginRequired'));
          return;
        }

        toast.success(result === 'added' ? t('favorites.added') : t('favorites.removed'));
      } catch (error) {
        console.error('Error toggling favorite:', error);
        toast.error(t('favorites.error'));
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
