import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import { CartItem, Order, Drink, Role } from '@/types';
import { v4 as uuidv4 } from 'uuid';
import { drinks as seedDrinks, mockOrders } from '@/data/seeds';
import { haptics } from '@/lib/haptics';

interface StoreState {
  // Cart
  cart: CartItem[];
  addToCart: (drink: Drink, eventId?: string, eventTitle?: string, eventStartAt?: string) => void;
  addBottleToCart: (
    bottle: { id: string; name: string; price: number; imgUrl?: string },
    mixers: { id: string; name: string; price: number }[],
    eventId?: string,
    eventTitle?: string
  ) => void;
  incrementQty: (drinkId: string) => void;
  decrementQty: (drinkId: string) => void;
  removeFromCart: (drinkId: string) => void;
  clearCart: () => void;
  getCartTotal: () => number;
  cleanExpiredItems: (expiredEventIds: string[]) => number;

  // Orders
  orders: Order[];
  createOrder: (venueId: string, userEmail?: string, eventId?: string) => Order;
  serveOrder: (token: string) => boolean;
  findOrderByToken: (token: string) => Order | undefined;

  // Drinks
  drinks: Drink[];
  updateDrink: (id: string, updates: Partial<Drink>) => void;
  createDrink: (drink: Omit<Drink, 'id'>) => void;

  // UI
  role: Role;
  setRole: (role: Role) => void;

  // Event selection
  selectedEventId: string | null;
  setSelectedEventId: (eventId: string | null) => void;

  // Reset
  resetDemo: () => void;
}

export const useStore = create<StoreState>()(
  persist(
    (set, get) => ({
      // Cart
      cart: [],
      addToCart: (drink, eventId, eventTitle, eventStartAt) => {
        haptics.selection();
        const existing = get().cart.find((item) => item.drinkId === drink.id && item.eventId === eventId);
        
        // Determine the price to use
        // Use presale price if presaleActive is true AND presalePrice exists
        let unitPrice = drink.price;
        if (drink.presaleActive && drink.presalePrice) {
          unitPrice = drink.presalePrice;
        } else if (drink.promoPrice) {
          unitPrice = drink.promoPrice;
        }
        
        if (existing) {
          set({
            cart: get().cart.map((item) =>
              item.drinkId === drink.id && item.eventId === eventId ? { ...item, qty: item.qty + 1 } : item
            ),
          });
        } else {
          set({
            cart: [
              ...get().cart,
              {
                drinkId: drink.id,
                name: drink.name,
                unitPrice,
                originalPrice: unitPrice < drink.price ? drink.price : undefined,
                qty: 1,
                imgUrl: drink.imgUrl,
                eventId,
                eventTitle,
                collection: drink.collection,
              },
            ],
          });
        }
      },
      // Bouteille solo (Mode Live) : une ligne = une bouteille + SES mixers.
      // unitPrice = bouteille + mixers (par unité) pour que getCartTotal colle
      // au total serveur ((price + Σ mixers) × qty). Merge uniquement si même
      // bouteille ET même sélection de mixers.
      addBottleToCart: (bottle, mixers, eventId, eventTitle) => {
        haptics.selection();
        const mixersTotal = mixers.reduce((sum, m) => sum + (m.price || 0), 0);
        const mixerKey = mixers.map((m) => m.id).sort().join(',');
        const existing = get().cart.find(
          (item) =>
            item.kind === 'bottle' &&
            item.drinkId === bottle.id &&
            item.eventId === eventId &&
            (item.mixers ?? []).map((m) => m.id).sort().join(',') === mixerKey
        );
        if (existing) {
          set({
            cart: get().cart.map((item) =>
              item === existing ? { ...item, qty: item.qty + 1 } : item
            ),
          });
          return;
        }
        set({
          cart: [
            ...get().cart,
            {
              drinkId: bottle.id,
              name: bottle.name,
              unitPrice: bottle.price + mixersTotal,
              qty: 1,
              imgUrl: bottle.imgUrl,
              eventId,
              eventTitle,
              collection: 'bottle',
              kind: 'bottle' as const,
              mixers,
            },
          ],
        });
      },
      incrementQty: (drinkId) => {
        set({
          cart: get().cart.map((item) =>
            item.drinkId === drinkId ? { ...item, qty: item.qty + 1 } : item
          ),
        });
      },
      decrementQty: (drinkId) => {
        const item = get().cart.find((i) => i.drinkId === drinkId);
        if (item && item.qty > 1) {
          set({
            cart: get().cart.map((i) =>
              i.drinkId === drinkId ? { ...i, qty: i.qty - 1 } : i
            ),
          });
        } else {
          get().removeFromCart(drinkId);
        }
      },
      removeFromCart: (drinkId) => {
        set({ cart: get().cart.filter((item) => item.drinkId !== drinkId) });
      },
      clearCart: () => set({ cart: [] }),
      cleanExpiredItems: (expiredEventIds: string[]) => {
        if (expiredEventIds.length === 0) return 0;
        const before = get().cart.length;
        set({ cart: get().cart.filter((item) => !item.eventId || !expiredEventIds.includes(item.eventId)) });
        return before - get().cart.length;
      },
      getCartTotal: () => {
        return get().cart.reduce((sum, item) => sum + item.unitPrice * item.qty, 0);
      },

      // Orders
      orders: mockOrders,
      createOrder: (venueId, userEmail, eventId) => {
        const token = uuidv4();
        const now = new Date();
        const expiresAt = new Date(now.getTime() + 8 * 60 * 60 * 1000); // +8h

        const order: Order = {
          id: uuidv4(),
          userEmail,
          venueId,
          items: [...get().cart],
          total: get().getCartTotal(),
          status: 'paid',
          createdAt: now.toISOString(),
          paidAt: now.toISOString(),
          token,
          tokenUsed: false,
          tokenExpiresAt: expiresAt.toISOString(),
        };

        set({ orders: [order, ...get().orders] });
        get().clearCart();
        return order;
      },
      serveOrder: (token) => {
        const order = get().findOrderByToken(token);
        if (!order) return false;

        if (order.tokenUsed) {
          return false;
        }

        if (order.tokenExpiresAt && new Date(order.tokenExpiresAt) < new Date()) {
          return false;
        }

        set({
          orders: get().orders.map((o) =>
            o.token === token
              ? {
                  ...o,
                  status: 'served' as const,
                  tokenUsed: true,
                  servedAt: new Date().toISOString(),
                }
              : o
          ),
        });
        return true;
      },
      findOrderByToken: (token) => {
        return get().orders.find((o) => o.token === token);
      },

      // Drinks
      drinks: seedDrinks,
      updateDrink: (id, updates) => {
        set({
          drinks: get().drinks.map((d) => (d.id === id ? { ...d, ...updates } : d)),
        });
      },
      createDrink: (drink) => {
        const newDrink: Drink = {
          ...drink,
          id: uuidv4(),
        };
        set({ drinks: [...get().drinks, newDrink] });
      },

      // UI - role is now managed by database but kept in store for UI state
      role: 'client',
      setRole: (role) => set({ role }),

      // Event selection
      selectedEventId: null,
      setSelectedEventId: (eventId) => set({ selectedEventId: eventId }),

      // Reset
      resetDemo: () => {
        set({
          cart: [],
          orders: [],
          drinks: seedDrinks,
        });
      },
    }),
    {
      name: 'yuno-storage',
      partialize: (state) => ({
        cart: state.cart,
        orders: state.orders,
        drinks: state.drinks,
        role: state.role,
        selectedEventId: state.selectedEventId,
      }),
    }
  )
);
